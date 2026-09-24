/**
 * Source ingestion: validation, PDF text extraction and segmentation.
 *
 * Segmentation assigns every passage a stable ID. Evidence references produced
 * later in the pipeline resolve against these IDs, so the scheme must stay
 * deterministic for a given source.
 */

import { extractText, getDocumentProxy } from 'unpdf';
import type { Source, SourceSegment, SourceKind } from './types';

/** Input limits. Kept visible in the UI rather than enforced silently. */
export const LIMITS = {
  maxPdfBytes: 10 * 1024 * 1024,
  maxImageBytes: 8 * 1024 * 1024,
  maxVideoBytes: 15 * 1024 * 1024,
  maxChars: 60_000,
  minChars: 200,
} as const;

/** Image types the provider's vision model accepts. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic'] as const;

/** Video types the provider's model accepts inline. */
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/mpeg'] as const;

export class ExtractionError extends Error {
  constructor(message: string, readonly kind: 'invalid_input' | 'unreadable' | 'too_large') {
    super(message);
    this.name = 'ExtractionError';
  }
}

/** Below this many non-whitespace characters a PDF page has no usable text layer. */
const SCANNED_PAGE_THRESHOLD = 20;

/** Target segment size: large enough to be meaningful, small enough to quote. */
const TARGET_SEGMENT_CHARS = 450;

/**
 * Rejoin lines that a PDF broke mid-sentence.
 *
 * PDF extraction returns one line per rendered line, so a paragraph arrives as
 * several fragments. Keeping those breaks makes the source preview ragged and
 * gives the model artificially chopped sentences. Only lines that clearly
 * continue the previous one are joined; genuine line breaks are preserved.
 */
function reflowLines(lines: string[]): string {
  const out: string[] = [];

  for (const line of lines) {
    const previous = out[out.length - 1];
    if (previous === undefined) {
      out.push(line);
      continue;
    }

    // A hyphen at the end of a line is a split word.
    if (/[a-z]-$/.test(previous)) {
      out[out.length - 1] = previous.slice(0, -1) + line;
      continue;
    }

    const previousEndsSentence = /[.!?:;]$/.test(previous);
    const startsNewBlock = /^([-*•]|\d+[.)]|[A-Z][.)]\s)/.test(line);
    const continuesSentence =
      !previousEndsSentence &&
      !startsNewBlock &&
      !isHeading(line) &&
      // A heading stands on its own line; body text must not be folded into it.
      !isHeading(previous);

    if (continuesSentence) out[out.length - 1] = `${previous} ${line}`;
    else out.push(line);
  }

  return out.join('\n');
}

function newSourceId(): string {
  return `src-${Date.now().toString(36)}`;
}

/** A line that reads as a section heading rather than body prose. */
function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (/^(\d+[.)]|[A-Z][.)]\s|Section\b|Appendix\b|Table\b)/.test(t)) return true;
  // A line carrying several figures is tabular data, not a heading. Without
  // this, every row of a results table becomes its own segment.
  if ((t.match(/\d[\d.,]*%?/g) ?? []).length >= 2) return false;
  // Title-ish: short, with no sentence-ending punctuation.
  return t.length <= 70 && !/[.!?;,:]$/.test(t);
}

/**
 * Split page text into passage-sized segments. PDF extraction usually yields
 * single newlines rather than blank lines, so blank-line splitting alone would
 * return one segment per page and make evidence links useless. Break on
 * heading-like lines, and again whenever a segment grows past the target size.
 */
function segmentPage(
  sourceId: string,
  pageIndex: number,
  page: number | null,
  text: string,
): SourceSegment[] {
  const lines = text
    .split(/\n/)
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0);

  const blocks: { heading?: string; lines: string[] }[] = [];

  for (const line of lines) {
    const current = blocks[blocks.length - 1];
    const charCount = current ? current.lines.join(' ').length : 0;
    const startNew =
      !current || (isHeading(line) && charCount > 0) || charCount >= TARGET_SEGMENT_CHARS;

    if (startNew) {
      blocks.push({ lines: [line], heading: isHeading(line) ? line : undefined });
    } else {
      current.lines.push(line);
    }
  }

  // Fold a trailing fragment back into the preceding block.
  for (let i = blocks.length - 1; i > 0; i--) {
    if (blocks[i].lines.join(' ').length < 80 && !blocks[i].heading) {
      blocks[i - 1].lines.push(...blocks[i].lines);
      blocks.splice(i, 1);
    }
  }

  return blocks.map((block, i) => ({
    id: `${sourceId}-p${pageIndex + 1}-${i + 1}`,
    sourceId,
    page,
    text: reflowLines(block.lines),
    heading: block.heading,
  }));
}

export interface ExtractResult {
  source: Source;
}

/** Build a Source from operator-pasted text. */
export function extractFromText(raw: string, title?: string): ExtractResult {
  const text = raw.replace(/\r\n/g, '\n').trim();

  if (!text) {
    throw new ExtractionError(
      'No text was provided. Paste your source material first.',
      'invalid_input',
    );
  }
  if (text.length > LIMITS.maxChars) {
    throw new ExtractionError(
      `This source is ${text.length.toLocaleString()} characters, over the ` +
        `${LIMITS.maxChars.toLocaleString()} character limit. Shorten it or split it into separate ` +
        `transformations. SourceBridge will not silently truncate it.`,
      'too_large',
    );
  }

  const sourceId = newSourceId();
  const warnings: string[] = [];
  if (text.length < LIMITS.minChars) {
    warnings.push(
      `This source is quite short (${text.length} characters). Generated artefacts may be thin on ` +
        `supporting detail.`,
    );
  }

  const segments = segmentPage(sourceId, 0, null, text);
  const derivedTitle = title?.trim() || text.split('\n')[0]?.slice(0, 80).trim() || 'Pasted text';

  return {
    source: {
      id: sourceId,
      kind: 'text' as SourceKind,
      title: derivedTitle,
      text,
      pageCount: null,
      segments,
      warnings,
      charCount: text.length,
      extractedAt: new Date().toISOString(),
    },
  };
}

/** Build a Source from a text-based PDF, preserving page numbers. */
export async function extractFromPdf(bytes: Uint8Array, filename: string): Promise<ExtractResult> {
  if (bytes.byteLength > LIMITS.maxPdfBytes) {
    throw new ExtractionError(
      `${filename} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB, over the ` +
        `${LIMITS.maxPdfBytes / 1024 / 1024} MB limit.`,
      'too_large',
    );
  }

  let pages: string[];
  let totalPages: number;
  try {
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: false });
    totalPages = result.totalPages;
    pages = result.text;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ExtractionError(
      `${filename} could not be read as a PDF (${detail}). If it is password protected or damaged, ` +
        `paste the text instead.`,
      'unreadable',
    );
  }

  const sourceId = newSourceId();
  const warnings: string[] = [];

  const emptyPages = pages
    .map((t, i) => ({ page: i + 1, chars: t.replace(/\s/g, '').length }))
    .filter((p) => p.chars < SCANNED_PAGE_THRESHOLD)
    .map((p) => p.page);

  // A PDF with no text layer anywhere is a scan. Say so rather than proceeding.
  if (emptyPages.length === pages.length) {
    throw new ExtractionError(
      `${filename} contains no extractable text. It looks like a scanned document, and SourceBridge ` +
        `does not include OCR. Use a text-based PDF, or paste the text directly.`,
      'unreadable',
    );
  }
  if (emptyPages.length > 0) {
    const plural = emptyPages.length > 1;
    warnings.push(
      `No text could be extracted from page${plural ? 's' : ''} ${emptyPages.join(', ')}. ` +
        `${plural ? 'These pages appear' : 'This page appears'} to be scanned or image-only, and ` +
        `${plural ? 'their' : 'its'} content is not included.`,
    );
  }

  const segments: SourceSegment[] = [];
  pages.forEach((pageText, i) => {
    segments.push(...segmentPage(sourceId, i, i + 1, pageText.replace(/\r\n/g, '\n')));
  });

  const text = pages.map((t, i) => `[Page ${i + 1}]\n${t.trim()}`).join('\n\n');

  if (text.length > LIMITS.maxChars) {
    throw new ExtractionError(
      `${filename} extracts to ${text.length.toLocaleString()} characters, over the ` +
        `${LIMITS.maxChars.toLocaleString()} character limit. Use a shorter document or a subset of ` +
        `pages. SourceBridge will not silently truncate it.`,
      'too_large',
    );
  }

  return {
    source: {
      id: sourceId,
      kind: 'pdf',
      title: filename,
      text,
      pageCount: totalPages,
      segments,
      warnings,
      charCount: text.length,
      extractedAt: new Date().toISOString(),
    },
  };
}

/**
 * Build a Source from text a vision model read out of an image.
 *
 * The text is a model transcription, not a literal extraction, so the warning
 * is attached unconditionally: a vision model can misread a figure or skip part
 * of a dense layout, and the operator must check it against the original.
 */
/**
 * Build a Source from a video transcript.
 *
 * The model samples frames, so on-screen text that persists across several
 * frames comes back repeated. Adjacent duplicates are collapsed; the transcript
 * is otherwise left as the model produced it.
 */
export function extractFromVideoText(
  transcript: string,
  filename: string,
  model: string,
): ExtractResult {
  const lines = transcript
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const deduped = lines.filter((line, i) => line !== lines[i - 1]);
  const text = deduped.join('\n').trim();

  if (!text || text.replace(/\s/g, '').length < 20) {
    throw new ExtractionError(
      `No speech or on-screen text could be read from ${filename}. If the video has no narration ` +
        `or captions, describe its content in the paste box instead.`,
      'unreadable',
    );
  }
  if (text.length > LIMITS.maxChars) {
    throw new ExtractionError(
      `${filename} transcribes to ${text.length.toLocaleString()} characters, over the ` +
        `${LIMITS.maxChars.toLocaleString()} character limit. Use a shorter clip.`,
      'too_large',
    );
  }

  const sourceId = newSourceId();
  const warnings = [
    `This source was transcribed from a video by an AI model (${model}). Speech and on-screen ` +
      `text may have been misheard or misread, and the model samples frames rather than watching ` +
      `every one. Check it against the original before publishing anything derived from it.`,
  ];
  if (text.includes('[unclear]')) {
    warnings.push('Parts of the video were unclear and are marked [unclear] in the transcript.');
  }

  return {
    source: {
      id: sourceId,
      kind: 'video',
      title: filename,
      text,
      pageCount: null,
      segments: segmentPage(sourceId, 0, null, text),
      warnings,
      charCount: text.length,
      extractedAt: new Date().toISOString(),
    },
  };
}

export function extractFromImageText(
  transcript: string,
  filename: string,
  model: string,
): ExtractResult {
  const text = transcript.replace(/\r\n/g, "\n").trim();
  if (!text || text.replace(/\s/g, '').length < 20) {
    throw new ExtractionError(
      `No readable text or data could be found in ${filename}. If the image is a photograph ` +
        `without text, describe its content in the paste box instead.`,
      'unreadable',
    );
  }
  if (text.length > LIMITS.maxChars) {
    throw new ExtractionError(
      `${filename} transcribes to ${text.length.toLocaleString()} characters, over the ` +
        `${LIMITS.maxChars.toLocaleString()} character limit.`,
      'too_large',
    );
  }

  const sourceId = newSourceId();
  const warnings = [
    `This source was read from an image by a vision model (${model}), not extracted from a text ` +
      `layer. Figures and labels may have been misread. Check them against the original image ` +
      `before publishing anything derived from it.`,
  ];
  if (text.includes('[unreadable]')) {
    warnings.push('Parts of the image were unreadable and are marked [unreadable] in the text.');
  }

  return {
    source: {
      id: sourceId,
      kind: 'image',
      title: filename,
      text,
      pageCount: null,
      segments: segmentPage(sourceId, 0, null, text),
      warnings,
      charCount: text.length,
      extractedAt: new Date().toISOString(),
    },
  };
}

/** Build a Source from text fetched and extracted from a web page. */
export function extractFromArticle(
  articleText: string,
  title: string,
  fetchWarnings: string[],
): ExtractResult {
  const text = articleText.trim();

  if (text.length > LIMITS.maxChars) {
    throw new ExtractionError(
      `That page extracts to ${text.length.toLocaleString()} characters, over the ` +
        `${LIMITS.maxChars.toLocaleString()} character limit. Paste the section you need instead.`,
      'too_large',
    );
  }

  const sourceId = newSourceId();
  const warnings = [...fetchWarnings];
  if (text.length < LIMITS.minChars) {
    warnings.push(
      `Only ${text.length} characters were extracted. Generated artefacts may be thin on detail.`,
    );
  }

  return {
    source: {
      id: sourceId,
      kind: 'url',
      title: title.slice(0, 120),
      text,
      pageCount: null,
      segments: segmentPage(sourceId, 0, null, text),
      warnings,
      charCount: text.length,
      extractedAt: new Date().toISOString(),
    },
  };
}

/** Resolve evidence IDs against a source, reporting any that do not exist. */
export function resolveEvidence(
  source: Source,
  ids: string[],
): { found: SourceSegment[]; missing: string[] } {
  const index = new Map(source.segments.map((s) => [s.id, s]));
  const found: SourceSegment[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const segment = index.get(id);
    if (segment) found.push(segment);
    else missing.push(id);
  }
  return { found, missing };
}
