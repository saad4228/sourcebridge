/**
 * SourceBridge data contracts (PRD section 13).
 *
 * These are in-memory shapes, not database schemas. The prototype keeps active
 * work in application state; nothing here implies persistence.
 */

/** The seven output categories. Order here drives display order in the UI. */
export const FORMAT_IDS = [
  'exec_summary',
  'linkedin',
  'x_thread',
  'advisory',
  'presentation',
  'infographic',
  'video_package',
] as const;

export type FormatId = (typeof FORMAT_IDS)[number];

export const FORMAT_LABELS: Record<FormatId, string> = {
  exec_summary: 'Executive summary',
  linkedin: 'LinkedIn post',
  x_thread: 'X post / thread',
  advisory: 'Advisory',
  presentation: 'Presentation',
  infographic: 'Infographic',
  video_package: 'Video production package',
};

/** Short description shown under each format in the selector. */
export const FORMAT_DESCRIPTIONS: Record<FormatId, string> = {
  exec_summary: 'Finding, evidence, implications and decisions',
  linkedin: 'Hook, explanation, takeaway, optional CTA',
  x_thread: 'Single post or ordered thread',
  advisory: 'Formal notice with actions and caveats',
  presentation: 'Slides with speaker notes — exports .pptx',
  infographic: 'Headline and key messages — exports .svg',
  video_package: 'Script, storyboard, narration, subtitles',
};

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

export type SourceKind = 'text' | 'pdf' | 'image' | 'video' | 'url' | 'prompt';

export interface SourceSegment {
  /** Stable identifier, e.g. "s1-p2-3". Evidence references point at these. */
  id: string;
  sourceId: string;
  /** 1-based page number for PDFs; null for pasted text. */
  page: number | null;
  text: string;
  heading?: string;
}

export interface Source {
  id: string;
  kind: SourceKind;
  /** Filename for PDFs, operator-supplied or derived title for text. */
  title: string;
  /** Full extracted text, preserved separately from any generated summary. */
  text: string;
  pageCount: number | null;
  segments: SourceSegment[];
  /** Extraction problems surfaced to the operator rather than swallowed. */
  warnings: string[];
  charCount: number;
  extractedAt: string;
}

// ---------------------------------------------------------------------------
// Fact ledger
// ---------------------------------------------------------------------------

export interface FactNumber {
  value: string;
  unit?: string;
  /** What the number counts or measures, in the source's own terms. */
  context: string;
}

export interface Fact {
  id: string;
  claim: string;
  /** Segment IDs supporting this claim. Validated server-side; may be empty. */
  evidence: string[];
  numbers: FactNumber[];
  dates: string[];
  caveats: string[];
}

export interface FactLedger {
  topic: string;
  facts: Fact[];
  entities: string[];
  /** Explicit actions present in the source, not invented recommendations. */
  sourceActions: string[];
  /** Things a reader would expect but the source does not contain. */
  missingInformation: string[];
  caveats: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Generation brief
// ---------------------------------------------------------------------------

/**
 * `grounded` treats the source as the factual basis.
 * `creative` drafts from a prompt with no source evidence, and must never
 * present its output as source-verified.
 */
export type GenerationMode = 'grounded' | 'creative';

/**
 * Audience, objective and tone are free strings rather than closed unions: the
 * presets in the UI are a convenience, and the values flow into a prompt rather
 * than into a lookup, so an unlisted value is meaningful rather than invalid.
 */
export type Audience = string;
export type Objective = string;
export type Tone = string;

export type DetailLevel = 'Brief' | 'Standard' | 'Detailed';

export interface GenerationBrief {
  mode: GenerationMode;
  audience: Audience;
  objective: Objective;
  tone: Tone;
  language: string;
  detail: DetailLevel;
  formats: FormatId[];
  /** Optional advanced fields. Empty values are omitted from the prompt. */
  requiredMessages?: string;
  callToAction?: string;
  preserveTerms?: string;
  avoidClaims?: string;
}

// ---------------------------------------------------------------------------
// Artefacts and validation
// ---------------------------------------------------------------------------

export type ArtifactStatus = 'pending' | 'generating' | 'complete' | 'failed';

export type FindingSeverity = 'info' | 'warning' | 'error';

export interface ValidationFinding {
  type: string;
  severity: FindingSeverity;
  message: string;
  field?: string;
  /** Related fact or segment IDs, when the finding points at specific content. */
  refs?: string[];
}

export interface Artifact<T = unknown> {
  id: string;
  format: FormatId;
  status: ArtifactStatus;
  /** Model output after schema validation. Never overwritten by edits. */
  content: T | null;
  /** Operator edits, kept separate so regeneration can warn before discarding. */
  edited: T | null;
  findings: ValidationFinding[];
  error?: string;
  generatedAt?: string;
  editedAt?: string;
}

/** The version that should be previewed, exported and downloaded. */
export function activeContent<T>(artifact: Artifact<T>): T | null {
  return artifact.edited ?? artifact.content;
}
