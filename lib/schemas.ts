/**
 * Per-format output schemas.
 *
 * Each schema serves two purposes: it is converted to the provider's structured
 * output schema, and it validates the response server-side afterwards. The
 * provider's schema support is treated as a hint, never as a guarantee.
 *
 * Keep these shapes simple (objects, arrays, strings, numbers, enums). Unions,
 * records and recursive types are not reliably supported by provider schema
 * modes and would weaken validation.
 */

import { z } from 'zod';
import type { FormatId } from './types';

/** Evidence references: source segment IDs. Validated against the real source later. */
const evidence = z
  .array(z.string())
  .describe('IDs of source segments supporting this content. Use [] if none apply.');

// ---------------------------------------------------------------------------
// Fact ledger
// ---------------------------------------------------------------------------

export const factLedgerSchema = z.object({
  topic: z.string().describe('The single main topic of the source, in one sentence.'),
  facts: z
    .array(
      z.object({
        id: z.string().describe('Short stable id such as "f1", "f2".'),
        claim: z.string().describe('One factual claim, stated as the source states it.'),
        evidence,
        numbers: z.array(
          z.object({
            value: z.string().describe('The figure exactly as written in the source.'),
            unit: z.string().describe('Unit or currency. Empty string if none.'),
            context: z.string().describe('What this figure measures.'),
          }),
        ),
        dates: z.array(z.string()).describe('Dates or periods, as written in the source.'),
        caveats: z.array(z.string()).describe('Qualifications the source attaches to this claim.'),
      }),
    )
    .describe('The important claims. Prefer 5-12 well-evidenced facts over exhaustive coverage.'),
  entities: z.array(z.string()).describe('Named people and organisations mentioned.'),
  sourceActions: z
    .array(z.string())
    .describe('Actions or recommendations EXPLICITLY present in the source. Do not invent any.'),
  missingInformation: z
    .array(z.string())
    .describe('Information a reader would reasonably expect that the source does not contain.'),
  caveats: z
    .array(z.string())
    .describe('Document-level limitations, scope restrictions and uncertainties.'),
  warnings: z
    .array(z.string())
    .describe('Problems with the source itself: contradictions, unclear passages, truncation.'),
});

export type FactLedgerOutput = z.infer<typeof factLedgerSchema>;

// ---------------------------------------------------------------------------
// Format schemas
// ---------------------------------------------------------------------------

export const execSummarySchema = z.object({
  title: z.string(),
  mainFinding: z.string().describe('The single most important finding.'),
  whyItMatters: z.string(),
  keyEvidence: z.array(
    z.object({
      point: z.string(),
      evidence,
    }),
  ),
  implications: z.array(z.string()),
  actions: z.array(
    z.object({
      action: z.string(),
      /** Separates what the source recommends from what the model proposes. */
      fromSource: z
        .boolean()
        .describe('True only if this action appears explicitly in the source.'),
    }),
  ),
  uncertainties: z.array(z.string()).describe('What remains unknown or unverified.'),
});

export const linkedinSchema = z.object({
  hook: z.string().describe('Opening line that earns attention without hype.'),
  body: z.string().describe('Main explanation. Short paragraphs separated by blank lines.'),
  keyTakeaway: z.string(),
  callToAction: z.string().describe('Empty string if not appropriate.'),
  hashtags: z.array(z.string()).describe('Without the # prefix. Up to 5. May be empty.'),
  evidence,
});

export const xThreadSchema = z.object({
  isThread: z.boolean(),
  posts: z
    .array(
      z.object({
        text: z.string().describe('One post. Keep within the configured character limit.'),
        evidence,
      }),
    )
    .describe('A single post when isThread is false, otherwise an ordered thread.'),
  callToAction: z.string().describe('Empty string if not appropriate.'),
});

export const advisorySchema = z.object({
  title: z.string(),
  audience: z.string().describe('Who this advisory is addressed to.'),
  severity: z
    .enum(['Not stated', 'Informational', 'Low', 'Medium', 'High', 'Critical'])
    .describe(
      'Severity ONLY if the source states or clearly implies one. Use "Not stated" otherwise — ' +
        'never assign a severity the source does not support.',
    ),
  affected: z
    .array(z.string())
    .describe('Who or what is affected, as the source describes it. Empty array if not stated.'),
  background: z.string(),
  impact: z.string().describe('What this means for the stated audience.'),
  recommendedActions: z.array(
    z.object({
      action: z.string(),
      fromSource: z.boolean().describe('True only if the source states this action explicitly.'),
    }),
  ),
  caveats: z.array(z.string()),
  references: z.array(
    z.object({
      label: z.string(),
      evidence,
    }),
  ),
});

export const presentationSchema = z.object({
  title: z.string(),
  subtitle: z.string().describe('Empty string if not needed.'),
  slides: z
    .array(
      z.object({
        title: z.string().describe('Slide title, at most 60 characters.'),
        mainMessage: z.string().describe('The one thing this slide must convey.'),
        /**
         * Chooses the rendered layout. The application draws each one; the model
         * only says which suits the content.
         */
        layout: z
          .enum(['bullets', 'statement', 'stat', 'comparison', 'chart', 'section'])
          .default('bullets')
          .describe(
            'bullets = supporting points. statement = one strong sentence, no bullets. ' +
              'stat = one headline figure from the source. comparison = two contrasting sides. ' +
              'chart = numeric series worth plotting. section = a divider between parts. ' +
              'Vary these: a deck of nothing but "bullets" is a wall of text.',
          ),
        bullets: z
          .array(z.string())
          .describe('3-5 bullets, each at most 120 characters. Fragments, not paragraphs. Empty for statement, stat, section.'),
        /** Populated only for the `stat` layout. */
        keyStat: z
          .object({
            value: z.string().describe('The figure exactly as the source writes it. Empty string if unused.'),
            unit: z.string().describe('Unit, percent sign or currency. Empty string if none.'),
            caption: z.string().describe('At most 70 characters. What the figure measures.'),
          })
          .optional()
          .describe('Only for layout "stat". Omit otherwise.'),
        /** Populated only for the `comparison` layout. */
        comparison: z
          .object({
            leftLabel: z.string().describe('Empty string if unused.'),
            leftPoints: z.array(z.string()),
            rightLabel: z.string().describe('Empty string if unused.'),
            rightPoints: z.array(z.string()),
          })
          .optional()
          .describe('Only for layout "comparison". Omit otherwise.'),
        /**
         * Populated only for the `chart` layout. Values must come from the
         * source; they are checked against it like any other figure.
         */
        chart: z
          .object({
            kind: z.enum(['bar', 'line', 'pie', 'none']).describe('Use "none" when there is no chart.'),
            categories: z.array(z.string()).describe('Axis labels. Empty array when unused.'),
            values: z.array(z.number()).describe('One value per category. Empty array when unused.'),
            seriesName: z.string().describe('What the values measure. Empty string when unused.'),
          })
          .optional()
          .describe(
            'Only for layout "chart", and only when the source actually contains a comparable ' +
              'series. Never invent values to make a chart possible.',
          ),
        speakerNotes: z.string(),
        visualType: z
          .enum(['none', 'chart', 'photo', 'diagram', 'icon', 'table'])
          .describe('Suggested imagery. The application does not generate pictures.'),
        evidence,
      }),
    )
    .describe(
      '6-10 slides. Open with context, close with actions or implications, and include at least ' +
        'one slide covering limitations. Mix the layouts rather than repeating one.',
    ),
});

export const infographicSchema = z.object({
  headline: z.string().describe('At most 70 characters.'),
  subheadline: z.string().describe('At most 110 characters. Empty string if not needed.'),
  /**
   * Chooses the centrepiece. The application draws each one; the model only
   * says which the content actually supports.
   */
  layout: z
    .enum(['stats', 'chart', 'comparison', 'qualitative'])
    .default('stats')
    .describe(
      'stats = two or three headline figures. chart = one comparable series worth plotting. ' +
        'comparison = a before/after or this-versus-that contrast. qualitative = the source has ' +
        'no usable figures, so the piece carries meaning in words alone. Choose what the source ' +
        'supports; never pick a numeric layout and then invent numbers for it.',
    ),
  /** Populated only for the `chart` layout. Values are checked against the source. */
  chart: z
    .object({
      kind: z.enum(['bar', 'donut', 'none']).describe('Use "none" when there is no chart.'),
      categories: z.array(z.string()).describe('Short labels, at most 18 characters each.'),
      values: z.array(z.number()).describe('One value per category, taken from the source.'),
      seriesName: z.string().describe('What the values measure, including the unit.'),
    })
    .optional()
    .describe(
      'Only for layout "chart", and only when the source contains 2-5 genuinely comparable ' +
        'values. Never invent, estimate or convert a value to make a chart possible.',
    ),
  /** Populated only for the `comparison` layout. */
  comparison: z
    .object({
      leftLabel: z.string().describe('At most 28 characters.'),
      leftValue: z
        .string()
        .describe(
          'The headline figure for this side, e.g. 412 L/day. Rendered large, so it ' +
            'must be short and must not be empty. Supporting detail belongs in leftPoints.',
        ),
      leftPoints: z.array(z.string()).describe('Up to 3 points, at most 60 characters each.'),
      rightLabel: z.string().describe('At most 28 characters.'),
      rightValue: z
        .string()
        .describe(
          'The headline figure for this side, e.g. 338 L/day. Rendered large, so it ' +
            'must be short and must not be empty. Supporting detail belongs in rightPoints.',
        ),
      rightPoints: z.array(z.string()).describe('Up to 3 points, at most 60 characters each.'),
    })
    .optional()
    .describe('Only for layout "comparison". Omit otherwise.'),
  keyMessages: z
    .array(
      z.object({
        label: z.string().describe('At most 40 characters.'),
        detail: z.string().describe('At most 90 characters.'),
        evidence,
      }),
    )
    .describe('Three to five key messages.'),
  statistics: z
    .array(
      z.object({
        value: z.string().describe('The figure exactly as it appears in the source.'),
        unit: z.string().describe('Unit, percent sign or currency. Empty string if none.'),
        caption: z.string().describe('At most 60 characters. What the figure measures.'),
        evidence,
      }),
    )
    .describe(
      'Statistics drawn from the source. Return an empty array if the source has no figures. ' +
        'Never invent a number to fill the layout.',
    ),
  sourceFooter: z.string().describe('Short attribution line naming the source document.'),
  altText: z.string().describe('Accessible description conveying the same information.'),
});

export const videoPackageSchema = z.object({
  title: z.string(),
  objective: z.string(),
  scenes: z
    .array(
      z.object({
        index: z.number().describe('1-based scene order.'),
        heading: z.string(),
        estimatedSeconds: z
          .number()
          .describe('Estimated duration. This is a production estimate, not measured timing.'),
        narration: z.string().describe('Spoken narration for this scene.'),
        onScreenText: z.string().describe('Text shown on screen. Empty string if none.'),
        visualRecommendation: z.string().describe('What to show. Describe, do not generate.'),
        evidence,
      }),
    )
    .describe('5-8 scenes.'),
  fullScript: z.string().describe('The complete narration as continuous prose.'),
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const FORMAT_SCHEMAS = {
  exec_summary: execSummarySchema,
  linkedin: linkedinSchema,
  x_thread: xThreadSchema,
  advisory: advisorySchema,
  presentation: presentationSchema,
  infographic: infographicSchema,
  video_package: videoPackageSchema,
} as const satisfies Record<FormatId, z.ZodType>;

export type ExecSummary = z.infer<typeof execSummarySchema>;
export type LinkedInPost = z.infer<typeof linkedinSchema>;
export type XThread = z.infer<typeof xThreadSchema>;
export type Advisory = z.infer<typeof advisorySchema>;
export type Presentation = z.infer<typeof presentationSchema>;
export type Infographic = z.infer<typeof infographicSchema>;
export type VideoPackage = z.infer<typeof videoPackageSchema>;

/** Union of every format's validated content shape. */
export type ArtifactContent =
  | ExecSummary
  | LinkedInPost
  | XThread
  | Advisory
  | Presentation
  | Infographic
  | VideoPackage;

/** Platform limit for X. Configurable because the real limit varies by account. */
export const X_POST_CHAR_LIMIT = 280;
