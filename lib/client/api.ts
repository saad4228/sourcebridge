/**
 * Browser-side API helpers.
 *
 * Every call returns a discriminated result rather than throwing, so a single
 * failed format never unwinds the whole generation run.
 */

import type {
  FactLedger,
  FormatId,
  GenerationBrief,
  Source,
  ValidationFinding,
} from '../types';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; retryable?: boolean };

async function readError(response: Response): Promise<{ error: string; code?: string; retryable?: boolean }> {
  try {
    const body = await response.json();
    return {
      error: typeof body.error === 'string' ? body.error : 'The request failed.',
      code: body.code,
      retryable: body.retryable,
    };
  } catch {
    return { error: `The request failed (HTTP ${response.status}).`, retryable: true };
  }
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthStatus {
  configured: boolean;
  reachable: boolean;
  model?: string;
  latencyMs?: number;
  message: string;
}

export async function checkHealth(): Promise<HealthStatus> {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    return (await response.json()) as HealthStatus;
  } catch {
    return {
      configured: false,
      reachable: false,
      message: 'Could not reach the SourceBridge server.',
    };
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export async function extractPdf(file: File): Promise<ApiResult<Source>> {
  const form = new FormData();
  form.append('file', file);
  try {
    const response = await fetch('/api/extract', { method: 'POST', body: form });
    if (!response.ok) return { ok: false, ...(await readError(response)) };
    const body = await response.json();
    return { ok: true, data: body.source as Source };
  } catch {
    return { ok: false, error: 'Upload failed. Check that the dev server is still running.' };
  }
}

export async function extractText(text: string, title?: string): Promise<ApiResult<Source>> {
  try {
    const response = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, title }),
    });
    if (!response.ok) return { ok: false, ...(await readError(response)) };
    const body = await response.json();
    return { ok: true, data: body.source as Source };
  } catch {
    return { ok: false, error: 'Extraction failed. Check that the dev server is still running.' };
  }
}

/** Fetch and extract a web article by URL. */
export async function extractUrl(url: string): Promise<ApiResult<Source>> {
  try {
    const response = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) return { ok: false, ...(await readError(response)) };
    const body = await response.json();
    return { ok: true, data: body.source as Source };
  } catch {
    return { ok: false, error: 'The page could not be fetched.' };
  }
}

/**
 * Load the bundled sample, already extracted by the server. The PDF bytes never
 * reach the browser, which keeps this working where endpoint security blocks
 * binary responses from localhost.
 */
export async function loadSample(
  type: 'report' | 'image' = 'report',
): Promise<ApiResult<Source>> {
  try {
    const response = await fetch(`/api/sample?type=${type}`, { cache: 'no-store' });
    if (!response.ok) return { ok: false, ...(await readError(response)) };
    const body = await response.json();
    return { ok: true, data: body.source as Source };
  } catch {
    return { ok: false, error: 'The sample document could not be loaded.' };
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export async function analyzeSource(source: Source, context?: string): Promise<ApiResult<FactLedger>> {
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, context }),
    });
    if (!response.ok) return { ok: false, ...(await readError(response)) };
    const body = await response.json();
    return { ok: true, data: body.ledger as FactLedger };
  } catch {
    return { ok: false, error: 'Source analysis failed to reach the server.', retryable: true };
  }
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface GeneratedArtifact {
  format: FormatId;
  content: unknown;
  findings: ValidationFinding[];
  latencyMs: number;
  generatedAt: string;
}

export interface GenerateInput {
  format: FormatId;
  brief: GenerationBrief;
  source: Source | null;
  ledger: FactLedger | null;
  creativePrompt?: string;
}

export async function generateArtifact(input: GenerateInput): Promise<ApiResult<GeneratedArtifact>> {
  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) return { ok: false, ...(await readError(response)) };
    return { ok: true, data: (await response.json()) as GeneratedArtifact };
  } catch {
    return { ok: false, error: 'Generation failed to reach the server.', retryable: true };
  }
}

/**
 * Run tasks with bounded concurrency so the provider's rate limit is respected.
 * Each task reports through `onSettled` as it finishes, so completed artefacts
 * appear immediately instead of waiting for the slowest one.
 */
export async function runBounded<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportKind = 'markdown' | 'text' | 'pptx' | 'svg' | 'zip' | 'mp4';

export interface ExportInput {
  kind: ExportKind;
  format: FormatId;
  content: unknown;
  sourceTitle: string | null;
  brief?: GenerationBrief;
}

export interface BundleInput {
  kind: 'bundle';
  items: { format: FormatId; content: unknown }[];
  sourceTitle: string | null;
  brief?: GenerationBrief;
}

/** Request a file and hand it to the browser as a download. */
export async function downloadExport(
  input: ExportInput | BundleInput,
): Promise<ApiResult<string>> {
  try {
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) return { ok: false, ...(await readError(response)) };

    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename =
      match?.[1] ?? (input.kind === 'bundle' ? 'sourcebridge-export.zip' : `sourcebridge-${input.format}`);

    const skipped = response.headers.get('X-Export-Skipped');

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoke on the next tick so the download has started.
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    return {
      ok: true,
      data: skipped ? `${filename} (skipped: ${skipped})` : filename,
    };
  } catch {
    return { ok: false, error: 'The download could not be started.' };
  }
}
