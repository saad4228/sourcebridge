/**
 * Markdown / plain-text renderers.
 *
 * Every format has one, so the operator can always take something away even if
 * a richer export is unavailable. Renderers read the edited content when the
 * operator has changed it.
 */

import { X_POST_CHAR_LIMIT } from '../schemas';
import type {
  Advisory,
  ExecSummary,
  Infographic,
  LinkedInPost,
  Presentation,
  VideoPackage,
  XThread,
} from '../schemas';
import type { FormatId, GenerationBrief } from '../types';
import { resolveLayout } from './slideLayout';
import { resolveInfographicLayout } from './infographicLayout';

/** Provenance footer. States plainly how the artefact was produced. */
export function provenanceFooter(sourceTitle: string | null, brief?: GenerationBrief): string {
  const lines = ['---', '', 'Generated with SourceBridge.'];
  if (sourceTitle) lines.push(`Source: ${sourceTitle}`);
  if (brief) lines.push(`Audience: ${brief.audience} · Objective: ${brief.objective} · Tone: ${brief.tone}`);
  if (brief?.mode === 'creative') {
    lines.push(
      'Creative draft mode: produced without a source document. Its claims are not source-verified.',
    );
  }
  lines.push('Review before publication. Automated checks do not verify factual correctness.');
  return lines.join('\n');
}

const bullets = (items: string[]) => items.map((i) => `- ${i}`).join('\n');

function actionList(actions: { action: string; fromSource: boolean }[]): string {
  return actions
    .map((a) => `- ${a.action}${a.fromSource ? '' : ' _(suggested, not stated in the source)_'}`)
    .join('\n');
}

export function execSummaryMarkdown(c: ExecSummary): string {
  const sections = [
    `# ${c.title}`,
    `## Main finding\n\n${c.mainFinding}`,
    `## Why it matters\n\n${c.whyItMatters}`,
  ];
  if (c.keyEvidence?.length) {
    sections.push(`## Key evidence\n\n${bullets(c.keyEvidence.map((e) => e.point))}`);
  }
  if (c.implications?.length) sections.push(`## Implications\n\n${bullets(c.implications)}`);
  if (c.actions?.length) sections.push(`## Actions\n\n${actionList(c.actions)}`);
  if (c.uncertainties?.length) sections.push(`## Uncertainties\n\n${bullets(c.uncertainties)}`);
  return sections.join('\n\n');
}

export function linkedinMarkdown(c: LinkedInPost): string {
  const parts = [c.hook, '', c.body, '', c.keyTakeaway];
  if (c.callToAction?.trim()) parts.push('', c.callToAction);
  if (c.hashtags?.length) parts.push('', c.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' '));
  return parts.join('\n');
}

export function xThreadMarkdown(c: XThread): string {
  if (!c.isThread && c.posts.length === 1) {
    const post = c.posts[0];
    return `${post.text}\n\n_${post.text.length} characters (approximate; the platform counts links and emoji differently)._`;
  }
  const posts = c.posts
    .map((p, i) => {
      const over = p.text.length > X_POST_CHAR_LIMIT ? ' — OVER LIMIT' : '';
      return `**${i + 1}/${c.posts.length}**\n\n${p.text}\n\n_${p.text.length} characters${over}_`;
    })
    .join('\n\n---\n\n');
  return `${posts}\n\n_Character counts are approximate; the platform counts links and emoji differently._`;
}

export function advisoryMarkdown(c: Advisory): string {
  const sections = [`# ${c.title}`, `**Audience:** ${c.audience}`];
  // Severity and affected parties are omitted entirely when the source does not
  // state them, rather than printed as "Not stated" noise.
  if (c.severity && c.severity !== 'Not stated') sections.push(`**Severity:** ${c.severity}`);
  if (c.affected?.length) sections.push(`**Affected:** ${c.affected.join(', ')}`);
  sections.push(`## Background\n\n${c.background}`);
  if (c.impact?.trim()) sections.push(`## Impact\n\n${c.impact}`);
  if (c.recommendedActions?.length) {
    sections.push(`## Recommended actions\n\n${actionList(c.recommendedActions)}`);
  }
  if (c.caveats?.length) sections.push(`## Caveats\n\n${bullets(c.caveats)}`);
  if (c.references?.length) {
    sections.push(`## References\n\n${bullets(c.references.map((r) => r.label))}`);
  }
  return sections.join('\n\n');
}

export function presentationMarkdown(c: Presentation): string {
  const head = [`# ${c.title}`];
  if (c.subtitle?.trim()) head.push(`_${c.subtitle}_`);

  const slides = c.slides.map((s, i) => {
    // Same layout decision as the .pptx, so the Markdown describes the same deck.
    const layout = resolveLayout(s);
    const parts = [`## Slide ${i + 1}: ${s.title}`];
    if (s.mainMessage?.trim()) parts.push(`**Main message:** ${s.mainMessage}`);

    if (layout === 'stat' && s.keyStat) {
      parts.push(`**${s.keyStat.value}${s.keyStat.unit ?? ''}** — ${s.keyStat.caption}`);
    } else if (layout === 'comparison' && s.comparison) {
      parts.push(
        `**${s.comparison.leftLabel}**\n\n${bullets(s.comparison.leftPoints)}\n\n` +
          `**${s.comparison.rightLabel}**\n\n${bullets(s.comparison.rightPoints)}`,
      );
    } else if (layout === 'chart' && s.chart) {
      const rows = s.chart.categories.map((category, j) => `| ${category} | ${s.chart!.values[j]} |`);
      parts.push(
        `_${s.chart.kind} chart — ${s.chart.seriesName}_\n\n| Category | Value |\n| --- | --- |\n${rows.join('\n')}`,
      );
    } else if (s.bullets?.length) {
      parts.push(bullets(s.bullets));
    }
    if (s.visualType && s.visualType !== 'none') {
      parts.push(`_Suggested visual: ${s.visualType} (recommendation only; not generated)_`);
    }
    if (s.speakerNotes?.trim()) parts.push(`> **Speaker notes:** ${s.speakerNotes}`);
    return parts.join('\n\n');
  });

  return [...head, ...slides].join('\n\n');
}

export function infographicMarkdown(c: Infographic): string {
  const sections = [`# ${c.headline}`];
  if (c.subheadline?.trim()) sections.push(`_${c.subheadline}_`);

  // Describe whichever block the renderer drew, so the Markdown and the SVG
  // carry the same content.
  const layout = resolveInfographicLayout(c);

  if (layout === 'stats') {
    sections.push(
      `## Key figures\n\n${bullets(
        c.statistics.map((s) => `**${s.value}${s.unit ?? ''}** — ${s.caption}`),
      )}`,
    );
  } else if (layout === 'chart' && c.chart) {
    const rows = c.chart.categories.map((category, i) => `| ${category} | ${c.chart!.values[i]} |`);
    sections.push(
      `## ${c.chart.seriesName || 'Chart'}\n\n| Category | Value |\n| --- | --- |\n${rows.join('\n')}`,
    );
  } else if (layout === 'comparison' && c.comparison) {
    const side = (label: string, value: string, points: string[]) =>
      `**${label}**${value ? ` — ${value}` : ''}${points.length ? `\n\n${bullets(points)}` : ''}`;
    sections.push(
      `## Comparison\n\n${side(c.comparison.leftLabel, c.comparison.leftValue, c.comparison.leftPoints)}\n\n` +
        side(c.comparison.rightLabel, c.comparison.rightValue, c.comparison.rightPoints),
    );
  } else {
    sections.push('_The source contained no usable figures, so a qualitative layout was used._');
  }

  if (c.keyMessages?.length) {
    sections.push(
      `## Key messages\n\n${bullets(c.keyMessages.map((m) => `**${m.label}** — ${m.detail}`))}`,
    );
  }
  sections.push(`## Accessible description\n\n${c.altText}`);
  if (c.sourceFooter?.trim()) sections.push(`_${c.sourceFooter}_`);
  return sections.join('\n\n');
}

export function videoPackageMarkdown(c: VideoPackage): string {
  const total = c.scenes.reduce((sum, s) => sum + (s.estimatedSeconds || 0), 0);
  const head = [
    `# ${c.title}`,
    `**Objective:** ${c.objective}`,
    `**Estimated runtime:** ${Math.round(total)} seconds (estimated from narration length, not measured)`,
  ];

  const scenes = c.scenes.map((s) => {
    const parts = [
      `## Scene ${s.index}: ${s.heading}`,
      `**Estimated duration:** ${s.estimatedSeconds}s`,
      `**Narration:** ${s.narration}`,
    ];
    if (s.onScreenText?.trim()) parts.push(`**On-screen text:** ${s.onScreenText}`);
    parts.push(`**Visual recommendation:** ${s.visualRecommendation}`);
    return parts.join('\n\n');
  });

  return [...head, '## Full script', c.fullScript, ...scenes].join('\n\n');
}

/** Render any format to Markdown. */
export function renderMarkdown(format: FormatId, content: unknown): string {
  switch (format) {
    case 'exec_summary':
      return execSummaryMarkdown(content as ExecSummary);
    case 'linkedin':
      return linkedinMarkdown(content as LinkedInPost);
    case 'x_thread':
      return xThreadMarkdown(content as XThread);
    case 'advisory':
      return advisoryMarkdown(content as Advisory);
    case 'presentation':
      return presentationMarkdown(content as Presentation);
    case 'infographic':
      return infographicMarkdown(content as Infographic);
    case 'video_package':
      return videoPackageMarkdown(content as VideoPackage);
  }
}
