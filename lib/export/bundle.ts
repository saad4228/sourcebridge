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
import { provenanceFooter, renderMarkdown } from './markdown';
import { renderPresentationPptx } from './pptx';
import { renderInfographicSvg } from './svg';
import { renderSrt, renderStoryboardCsv } from './videoPackage';

export interface BundleItem {
  format: FormatId;
  content: unknown;
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

export async function renderBundle(
  items: BundleItem[],
  sourceTitle: string | null,
  brief?: GenerationBrief,
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
