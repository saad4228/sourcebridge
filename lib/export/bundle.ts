/**
 * Bundle export: every completed artefact in one zip.
 *
 * Each format contributes its Markdown rendering, plus its richer file where
 * one exists (.pptx, .svg, the video package's own files). Content comes from
 * the caller, so the operator's edits are what get written.
 */

import JSZip from 'jszip';
import { FORMAT_LABELS } from '../types';
import type { FormatId, GenerationBrief } from '../types';
import { FORMAT_SCHEMAS } from '../schemas';
import type { Infographic, Presentation, VideoPackage } from '../schemas';
import { buildAuditChain, renderProvenanceText } from '../audit';
import { provenanceFooter, renderMarkdown } from './markdown';
import { renderPresentationPptx } from './pptx';
import { renderInfographicSvg } from './svg';
import { renderSrt, renderStoryboardCsv } from './videoPackage';

export interface BundleItem {
  format: FormatId;
  content: unknown;
  /** The model that produced it, recorded in the provenance chain. */
  model?: string;
}

export interface BundleResult {
  bytes: Uint8Array;
  /** Formats that could not be rendered, reported rather than silently dropped. */
  skipped: { format: FormatId; reason: string }[];
}

const FILE_STEM: Record<FormatId, string> = {
  exec_summary: 'executive-summary',
  linkedin: 'linkedin-post',
  x_thread: 'x-thread',
  advisory: 'advisory',
  presentation: 'presentation',
  infographic: 'infographic',
  video_package: 'video-package',
};

export interface BundleProvenance {
  /** Null in creative draft mode, where there is no source to record. */
  source: { title: string; kind: string; text: string } | null;
  ledger?: unknown;
}

export async function renderBundle(
  items: BundleItem[],
  sourceTitle: string | null,
  brief?: GenerationBrief,
  provenance?: BundleProvenance,
): Promise<BundleResult> {
  const zip = new JSZip();
  const skipped: { format: FormatId; reason: string }[] = [];
  const included: FormatId[] = [];

  for (const item of items) {
    // Re-validate: the content may have been edited in the browser.
    const parsed = FORMAT_SCHEMAS[item.format].safeParse(item.content);
    if (!parsed.success) {
      skipped.push({ format: item.format, reason: 'content no longer matches its schema' });
      continue;
    }

    const content = parsed.data;
    const stem = FILE_STEM[item.format];

    try {
      zip.file(
        `${stem}.md`,
        `${renderMarkdown(item.format, content)}\n\n${provenanceFooter(sourceTitle, brief)}\n`,
      );

      if (item.format === 'presentation') {
        zip.file(
          `${stem}.pptx`,
          await renderPresentationPptx(content as Presentation, {
            sourceTitle: sourceTitle ?? undefined,
          }),
        );
      } else if (item.format === 'infographic') {
        zip.file(`${stem}.svg`, renderInfographicSvg(content as Infographic));
      } else if (item.format === 'video_package') {
        const video = content as VideoPackage;
        zip.file(`${stem}/narration.txt`, video.scenes.map((s) => s.narration).join('\n\n'));
        zip.file(`${stem}/storyboard.csv`, renderStoryboardCsv(video));
        zip.file(`${stem}/subtitles.srt`, renderSrt(video));
      }

      included.push(item.format);
    } catch (err) {
      skipped.push({
        format: item.format,
        reason: err instanceof Error ? err.message : 'renderer failed',
      });
    }
  }

  // --- Provenance ----------------------------------------------------------
  // Written over the artefacts that were actually included, so the record
  // describes the bundle a recipient is holding rather than what was asked for.
  const timestamp = new Date().toISOString();
  const chain = await buildAuditChain({
    source: provenance?.source ?? null,
    ledger: provenance?.ledger,
    artifacts: items
      .filter((item) => included.includes(item.format))
      .map((item) => ({ format: item.format, content: item.content, model: item.model })),
    timestamp,
  });
  zip.file('provenance.json', JSON.stringify({ version: 1, entries: chain }, null, 2));
  zip.file('provenance.txt', renderProvenanceText(chain));

  zip.file(
    'README.md',
    [
      '# SourceBridge export',
      '',
      sourceTitle ? `Source: ${sourceTitle}` : 'Source: none (creative draft mode)',
      brief ? `Audience: ${brief.audience} · Objective: ${brief.objective} · Tone: ${brief.tone}` : '',
      `Exported: ${new Date().toISOString()}`,
      '',
      '## Included',
      '',
      ...included.map((f) => `- ${FORMAT_LABELS[f]} (\`${FILE_STEM[f]}\`)`),
      ...(skipped.length
        ? ['', '## Not included', '', ...skipped.map((s) => `- ${FORMAT_LABELS[s.format]} — ${s.reason}`)]
        : []),
      '',
      '## Provenance',
      '',
      '`provenance.json` and `provenance.txt` carry a hash chain over the source, the fact',
      'ledger and every artefact above. Altering any of them breaks verification at that',
      'entry. It is a hash chain, not a blockchain: it establishes integrity and ordering,',
      'not authenticity of the original document.',
      '',
      '## Before you publish',
      '',
      '- This content is AI-generated and requires human review.',
      '- Automated checks are structural; they do not verify that content is factually correct.',
      '- Subtitle timings in any video package are estimates, not aligned to real audio.',
      brief?.mode === 'creative'
        ? '- Produced in creative draft mode without a source document. Nothing here is source-verified.'
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  return { bytes: await zip.generateAsync({ type: 'uint8array' }), skipped };
}
