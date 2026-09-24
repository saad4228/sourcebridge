/**
 * Lightweight structural validation (PRD FR-09).
 *
 * These are review signals, not fact verification. A clean result means the
 * output is structurally sound and its figures also appear in the source. It
 * does NOT mean the content is true, complete or correctly interpreted. The UI
 * must never present these findings as a correctness guarantee.
 */

import type { FormatId, Source, ValidationFinding } from './types';
import { X_POST_CHAR_LIMIT } from './schemas';
import { resolveLayout } from './export/slideLayout';
import { resolveInfographicLayout } from './export/infographicLayout';
import type {
  Advisory,
  ExecSummary,
  Infographic,
  LinkedInPost,
  Presentation,
  VideoPackage,
  XThread,
} from './schemas';

/**
 * Fields whose numbers are produced by the application or the layout rather
 * than drawn from the source. Numbers found here are never reported as
 * unsupported figures.
 */
const STRUCTURAL_FIELDS = new Set(['index', 'estimatedSeconds']);

/** Collect evidence IDs alongside the path where each was found. */
function collectEvidence(node: unknown, path: string[] = []): { id: string; path: string }[] {
  const out: { id: string; path: string }[] = [];

  const walk = (value: unknown, trail: string[]) => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, [...trail, String(i)]));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'evidence' && Array.isArray(child)) {
        for (const id of child) {
          if (typeof id === 'string') out.push({ id, path: [...trail, key].join('.') });
        }
        continue;
      }
      walk(child, [...trail, key]);
    }
  };

  walk(node, path);
  return out;
}

/**
 * Collect prose strings and numeric values, skipping structural fields.
 *
 * Numbers matter as much as prose: a chart's plotted values are claims about
 * the source, and skipping them would let an invented figure through simply
 * because it was stored as a number rather than written in a sentence.
 */
function collectProse(node: unknown): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];

  const walk = (value: unknown, trail: string[]) => {
    if (typeof value === 'string') {
      out.push({ field: trail.join('.') || '(root)', text: value });
      return;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      out.push({ field: trail.join('.') || '(root)', text: String(value) });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, [...trail, String(i)]));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (STRUCTURAL_FIELDS.has(key) || key === 'evidence') continue;
      walk(child, [...trail, key]);
    }
  };

  walk(node, []);
  return out;
}

/**
 * Normalise a figure for comparison: strip grouping separators and redundant
 * trailing decimal zeros, so "18%" matches "18.0%" and "42,00,000" matches
 * "4200000". The percent sign is removed before trimming and reattached after,
 * otherwise it blocks the trailing-zero match.
 */
function normaliseNumber(raw: string): string {
  const isPercent = raw.endsWith('%');
  let n = raw.replace(/%$/, '').replace(/,/g, '');
  if (n.includes('.')) n = n.replace(/0+$/, '').replace(/\.$/, '');
  return isPercent ? `${n}%` : n;
}

/** Numbers worth checking: multi-digit, decimal or percentage. Bare 1-9 is noise. */
const NUMBER_PATTERN = /\d[\d,]*(?:\.\d+)?%?/g;

function significantNumbers(text: string): string[] {
  const matches = text.match(NUMBER_PATTERN) ?? [];
  return matches.filter((m) => {
    const digits = m.replace(/[^\d]/g, '');
    return digits.length >= 2 || m.includes('%') || m.includes('.');
  });
}

/**
 * Field prefixes belonging to a layout the renderer will not draw.
 *
 * The presentation schema gives every slide a block per layout. The model often
 * fills the unused ones with empty strings, which are not defects: the exporter
 * ignores them entirely.
 */
function inactiveLayoutPaths(format: FormatId, content: unknown): string[] {
  if (format === 'presentation') {
    const slides = (content as Presentation).slides ?? [];
    const blocks = ['keyStat', 'comparison', 'chart'] as const;

    return slides.flatMap((slide, i) => {
      const layout = resolveLayout(slide);
      const active =
        layout === 'stat' ? 'keyStat' : layout === 'comparison' ? 'comparison' : layout === 'chart' ? 'chart' : null;
      return blocks.filter((block) => block !== active).map((block) => `slides.${i}.${block}`);
    });
  }

  if (format === 'infographic') {
    const layout = resolveInfographicLayout(content as Infographic);
    const blocks = ['chart', 'comparison', 'statistics'] as const;
    const active = layout === 'chart' ? 'chart' : layout === 'comparison' ? 'comparison' : layout === 'stats' ? 'statistics' : null;
    return blocks.filter((block) => block !== active);
  }

  return [];
}

export interface ValidateOptions {
  format: FormatId;
  content: unknown;
  /** Null in creative mode, where evidence and figures are not source-backed. */
  source: Source | null;
  grounded: boolean;
}

export function validateArtifact(options: ValidateOptions): ValidationFinding[] {
  const { format, content, source, grounded } = options;
  const findings: ValidationFinding[] = [];

  if (!content || typeof content !== 'object') {
    return [
      {
        type: 'empty_content',
        severity: 'error',
        message: 'This artefact has no content.',
      },
    ];
  }

  // --- Evidence references -------------------------------------------------
  const references = collectEvidence(content);

  if (grounded && source) {
    const valid = new Set(source.segments.map((s) => s.id));
    const invalid = references.filter((r) => !valid.has(r.id));

    if (invalid.length > 0) {
      findings.push({
        type: 'invalid_evidence',
        severity: 'error',
        message:
          `${invalid.length} evidence reference${invalid.length > 1 ? 's do' : ' does'} not match ` +
          `any passage in the source. ${invalid.length > 1 ? 'They are' : 'It is'} excluded from ` +
          `the evidence panel.`,
        refs: invalid.map((r) => r.id),
      });
    }
    if (references.length === 0) {
      findings.push({
        type: 'no_evidence',
        severity: 'warning',
        message:
          'This artefact cites no source passages, so none of its claims can be traced back to ' +
          'the document. Review it closely before use.',
      });
    }
  } else if (references.length > 0) {
    // Creative mode has no source; citations here would be fabricated.
    findings.push({
      type: 'evidence_in_creative_mode',
      severity: 'warning',
      message:
        'This draft was generated without a source, so its references are not source-verified ' +
        'and have been ignored.',
    });
  }

  // --- Empty prose ---------------------------------------------------------
  const prose = collectProse(content);
  // A slide carries a block for each layout it could have used; only the one
  // the renderer actually draws is worth checking. Without this, a bullets
  // slide that also carries an empty chart object reports phantom defects.
  const inactive = inactiveLayoutPaths(format, content);
  const emptyRequired = prose.filter(
    (p) =>
      p.text.trim().length === 0 &&
      !/callToAction|subtitle|subheadline|onScreenText|unit/.test(p.field) &&
      !inactive.some((prefix) => p.field.startsWith(prefix)),
  );
  for (const field of emptyRequired.slice(0, 3)) {
    findings.push({
      type: 'empty_field',
      severity: 'warning',
      message: `"${field.field}" is empty.`,
      field: field.field,
    });
  }

  // --- Figures present in output but not in the source ---------------------
  if (grounded && source) {
    const sourceNumbers = new Set<string>();
    for (const raw of significantNumbers(source.text)) {
      const normalised = normaliseNumber(raw);
      sourceNumbers.add(normalised);
      // Some schemas hold the figure and its unit in separate fields, so the
      // value arrives bare ("18") while the source reads "18%". Index both
      // forms, otherwise every such figure is a false positive.
      sourceNumbers.add(normalised.replace(/%$/, ''));
    }
    const unsupported = new Map<string, string>();

    for (const { field, text } of prose) {
      for (const num of significantNumbers(text)) {
        const key = normaliseNumber(num);
        // A year present in the source in another form is a common false positive;
        // only report figures with no normalised match at all.
        if (!sourceNumbers.has(key) && !unsupported.has(key)) {
          unsupported.set(key, `${num} (in ${field})`);
        }
      }
    }

    if (unsupported.size > 0) {
      const examples = [...unsupported.values()].slice(0, 4);
      findings.push({
        type: 'unverified_number',
        severity: 'warning',
        message:
          `${unsupported.size} figure${unsupported.size > 1 ? 's do' : ' does'} not appear in the ` +
          `source text: ${examples.join(', ')}${unsupported.size > 4 ? ', ...' : ''}. ` +
          `${unsupported.size > 1 ? 'These may be' : 'This may be'} a rounding, a derived value ` +
          `or an error. Check before publishing.`,
      });
    }
  }

  // --- Format-specific structural checks -----------------------------------
  findings.push(...formatChecks(format, content));

  return findings;
}

function formatChecks(format: FormatId, content: unknown): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  switch (format) {
    case 'x_thread': {
      const thread = content as XThread;
      thread.posts?.forEach((post, i) => {
        if (post.text.length > X_POST_CHAR_LIMIT) {
          findings.push({
            type: 'length_exceeded',
            severity: 'warning',
            message:
              `Post ${i + 1} is ${post.text.length} characters, over the ${X_POST_CHAR_LIMIT} ` +
              `limit. Character counts are approximate and do not account for how the platform ` +
              `counts links or emoji.`,
            field: `posts.${i}.text`,
          });
        }
      });
      if (!thread.isThread && (thread.posts?.length ?? 0) > 1) {
        findings.push({
          type: 'inconsistent_structure',
          severity: 'info',
          message: `Marked as a single post but ${thread.posts.length} posts were produced.`,
        });
      }
      break;
    }

    case 'presentation': {
      const deck = content as Presentation;
      deck.slides?.forEach((slide, i) => {
        // These thresholds match what the PPTX layout can render without clipping.
        if (slide.title.length > 60) {
          findings.push({
            type: 'overflow_risk',
            severity: 'warning',
            message: `Slide ${i + 1} title is ${slide.title.length} characters and may be clipped in the export.`,
            field: `slides.${i}.title`,
          });
        }
        const longBullets = slide.bullets?.filter((b) => b.length > 120).length ?? 0;
        if (longBullets > 0) {
          findings.push({
            type: 'overflow_risk',
            severity: 'warning',
            message: `Slide ${i + 1} has ${longBullets} bullet${longBullets > 1 ? 's' : ''} over 120 characters, which may overflow.`,
            field: `slides.${i}.bullets`,
          });
        }
        if ((slide.bullets?.length ?? 0) > 6) {
          findings.push({
            type: 'overflow_risk',
            severity: 'warning',
            message: `Slide ${i + 1} has ${slide.bullets.length} bullets; the layout fits about 5.`,
            field: `slides.${i}.bullets`,
          });
        }
      });
      break;
    }

    case 'infographic': {
      const info = content as Infographic;
      if (info.headline?.length > 70) {
        findings.push({
          type: 'overflow_risk',
          severity: 'warning',
          message: `The headline is ${info.headline.length} characters and may be clipped in the SVG.`,
          field: 'headline',
        });
      }
      if ((info.statistics?.length ?? 0) === 0) {
        findings.push({
          type: 'qualitative_layout',
          severity: 'info',
          message:
            'No statistics were drawn from the source, so a qualitative layout is used. ' +
            'This is expected when the source contains no figures.',
        });
      }
      if (!info.altText?.trim()) {
        findings.push({
          type: 'missing_alt_text',
          severity: 'warning',
          message: 'No accessible text description was produced for this infographic.',
          field: 'altText',
        });
      }
      break;
    }

    case 'video_package': {
      const pkg = content as VideoPackage;
      const total = pkg.scenes?.reduce((sum, s) => sum + (s.estimatedSeconds || 0), 0) ?? 0;
      findings.push({
        type: 'estimated_timing',
        severity: 'info',
        message:
          `Estimated total runtime is ${Math.round(total)} seconds. Scene durations and subtitle ` +
          `timings are production estimates, not measured against generated audio.`,
      });
      break;
    }

    case 'advisory': {
      const advisory = content as Advisory;
      if ((advisory.caveats?.length ?? 0) === 0) {
        findings.push({
          type: 'no_caveats',
          severity: 'warning',
          message:
            'This advisory lists no caveats. Confirm the source genuinely has no limitations ' +
            'worth carrying forward.',
          field: 'caveats',
        });
      }
      break;
    }

    case 'exec_summary': {
      const summary = content as ExecSummary;
      if ((summary.uncertainties?.length ?? 0) === 0) {
        findings.push({
          type: 'no_uncertainties',
          severity: 'info',
          message: 'No uncertainties were listed. Confirm the source states none.',
          field: 'uncertainties',
        });
      }
      break;
    }

    case 'linkedin': {
      const post = content as LinkedInPost;
      const length = `${post.hook}\n\n${post.body}`.length;
      if (length > 3000) {
        findings.push({
          type: 'length_exceeded',
          severity: 'warning',
          message: `The post is about ${length} characters, beyond the usual LinkedIn limit of 3,000.`,
        });
      }
      break;
    }
  }

  return findings;
}

/** Highest severity present, for badge display. */
export function worstSeverity(findings: ValidationFinding[]): 'error' | 'warning' | 'info' | null {
  if (findings.some((f) => f.severity === 'error')) return 'error';
  if (findings.some((f) => f.severity === 'warning')) return 'warning';
  if (findings.some((f) => f.severity === 'info')) return 'info';
  return null;
}
