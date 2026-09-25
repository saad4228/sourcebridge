import { NextResponse } from 'next/server';
import { z } from 'zod';
import { FORMAT_SCHEMAS } from '@/lib/schemas';
import { renderPresentationPptx } from '@/lib/export/pptx';
import { renderInfographicSvg } from '@/lib/export/svg';
import { renderVideoPackageZip } from '@/lib/export/videoPackage';
import { provenanceFooter, renderMarkdown } from '@/lib/export/markdown';
import { renderBundle } from '@/lib/export/bundle';
import { VideoRenderError, renderVideo } from '@/lib/export/video';
import { briefWireSchema } from '@/lib/wire';
import { FORMAT_IDS } from '@/lib/types';
import type { GenerationBrief } from '@/lib/types';
import type { Infographic, Presentation, VideoPackage } from '@/lib/schemas';

export const runtime = 'nodejs';
// Rendering a video speaks every scene and then encodes, so it needs far longer
// than a pure renderer.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  format: z.enum(FORMAT_IDS),
  kind: z.enum(['markdown', 'text', 'pptx', 'svg', 'zip', 'mp4']),
  /** The content to render: the operator's edited version when one exists. */
  content: z.unknown(),
  sourceTitle: z.string().nullable().optional(),
  brief: briefWireSchema.optional(),
});

/** Every completed artefact in one archive. */
const bundleSchema = z.object({
  kind: z.literal('bundle'),
  items: z
    .array(
      z.object({
        format: z.enum(FORMAT_IDS),
        content: z.unknown(),
        /** Recorded in the provenance chain alongside the artefact. */
        model: z.string().optional(),
      }),
    )
    .min(1),
  sourceTitle: z.string().nullable().optional(),
  brief: briefWireSchema.optional(),
  /**
   * What the outputs were derived from. Sent by the client because the server
   * holds no session state; the archive is self-contained either way.
   */
  provenance: z
    .object({
      source: z
        .object({ title: z.string(), kind: z.string(), text: z.string() })
        .nullable(),
      ledger: z.unknown().optional(),
    })
    .optional(),
});

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'sourcebridge'
  );
}

function fileResponse(bytes: Uint8Array | string, filename: string, contentType: string) {
  const body = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return new NextResponse(body as BodyInit, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Renders an artefact to a downloadable file. No model call happens here: the
 * content already exists, so an export cannot fail because of the provider, and
 * the operator's edits are what get rendered.
 */
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed export request.' }, { status: 400 });
  }

  // Bundle export renders every artefact at once.
  const asBundle = bundleSchema.safeParse(raw);
  if (asBundle.success) {
    try {
      const { bytes, skipped } = await renderBundle(
        asBundle.data.items,
        asBundle.data.sourceTitle ?? null,
        asBundle.data.brief as GenerationBrief | undefined,
        asBundle.data.provenance,
      );
      const base = slug(asBundle.data.sourceTitle ?? 'sourcebridge');
      const response = fileResponse(bytes, `${base}-all-formats.zip`, 'application/zip');
      // Tell the client what could not be rendered instead of dropping it silently.
      if (skipped.length > 0) {
        response.headers.set('X-Export-Skipped', skipped.map((s) => s.format).join(','));
      }
      return response;
    } catch (err) {
      console.error('[export:bundle] failed', err);
      return NextResponse.json(
        { error: 'The archive could not be generated. Your artefacts are unaffected.' },
        { status: 500 },
      );
    }
  }

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Malformed export request.' }, { status: 400 });
  }

  // Re-validate the content against its schema. The client may have edited it,
  // and a renderer must never be handed a shape it cannot draw.
  const parsed = FORMAT_SCHEMAS[body.format].safeParse(body.content);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          'This artefact cannot be exported because its content no longer matches the expected ' +
          'structure. Regenerate it, or undo recent edits.',
        issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 422 },
    );
  }

  const content = parsed.data;
  const sourceTitle = body.sourceTitle ?? null;
  const brief = body.brief as GenerationBrief | undefined;
  const base = slug(sourceTitle ?? body.format);

  try {
    switch (body.kind) {
      case 'pptx': {
        if (body.format !== 'presentation') {
          return NextResponse.json({ error: 'PPTX export applies only to presentations.' }, { status: 400 });
        }
        const bytes = await renderPresentationPptx(content as Presentation, {
          sourceTitle: sourceTitle ?? undefined,
          theme: body.brief?.deckTheme,
        });
        return fileResponse(
          bytes,
          `${base}-presentation.pptx`,
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        );
      }

      case 'svg': {
        if (body.format !== 'infographic') {
          return NextResponse.json({ error: 'SVG export applies only to infographics.' }, { status: 400 });
        }
        const svg = renderInfographicSvg(content as Infographic);
        return fileResponse(svg, `${base}-infographic.svg`, 'image/svg+xml');
      }

      case 'mp4': {
        if (body.format !== 'video_package') {
          return NextResponse.json({ error: 'MP4 export applies only to video packages.' }, { status: 400 });
        }
        const rendered = await renderVideo(content as VideoPackage, { sourceTitle });
        const response = fileResponse(rendered.mp4, `${base}-video.mp4`, 'video/mp4');
        // Measured from the rendered audio, so it is safe to state.
        response.headers.set('X-Video-Seconds', rendered.totalSeconds.toFixed(1));
        response.headers.set('X-Video-Voice', rendered.voice);
        return response;
      }

      case 'zip': {
        if (body.format !== 'video_package') {
          return NextResponse.json({ error: 'Package export applies only to video packages.' }, { status: 400 });
        }
        const bytes = await renderVideoPackageZip(content as VideoPackage, sourceTitle);
        return fileResponse(bytes, `${base}-video-package.zip`, 'application/zip');
      }

      case 'markdown':
      case 'text': {
        const markdown = `${renderMarkdown(body.format, content)}\n\n${provenanceFooter(sourceTitle, brief)}\n`;
        return fileResponse(
          markdown,
          `${base}-${body.format}.${body.kind === 'markdown' ? 'md' : 'txt'}`,
          body.kind === 'markdown' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8',
        );
      }
    }
  } catch (err) {
    if (err instanceof VideoRenderError) {
      // A missing ffmpeg is a host capability gap, not a bad request.
      return NextResponse.json(
        { error: err.message, kind: err.kind },
        { status: err.kind === 'no_ffmpeg' ? 501 : 500 },
      );
    }
    console.error(`[export:${body.format}:${body.kind}] failed`, err);
    return NextResponse.json(
      { error: 'The file could not be generated. The artefact itself is unaffected.' },
      { status: 500 },
    );
  }
}
