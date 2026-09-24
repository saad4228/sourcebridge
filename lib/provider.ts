/**
 * Server-only AI provider access.
 *
 * The API key is read from the environment inside route handlers and is never
 * exposed to the browser. Every model response is validated against a Zod
 * schema server-side, regardless of the provider's structured-output support.
 */

import 'server-only';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

// Free-tier daily quotas are per-model and small on the flagship flash models
// (gemini-3.6-flash allows 20 requests/day). The lite models carry far higher
// limits, so the default primary is a lite model and the chain spreads load
// across several — one seven-format run costs eight requests.
const DEFAULT_MODEL = 'gemini-flash-lite-latest';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_configured'
      | 'auth'
      | 'rate_limit'
      | 'timeout'
      | 'invalid_output'
      | 'unavailable'
      | 'bad_model'
      | 'upstream',
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function isProviderConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new ProviderError(
      'No AI provider key is configured. Add GEMINI_API_KEY to .env.local and restart the dev server.',
      'not_configured',
    );
  }
  return new GoogleGenAI({ apiKey });
}

export function modelName(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Models tried in order when the primary is overloaded.
 *
 * Free-tier capacity fluctuates: a model can return 503 "high demand" for a
 * minute and be fine the next. Rotating to a different model recovers far
 * faster than waiting on one that is currently saturated. Override the whole
 * chain with GEMINI_FALLBACK_MODELS (comma-separated).
 */
const DEFAULT_FALLBACKS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.6-flash'];

export function modelChain(): string[] {
  const configured = process.env.GEMINI_FALLBACK_MODELS?.trim();
  const fallbacks = configured
    ? configured.split(',').map((m) => m.trim()).filter(Boolean)
    : DEFAULT_FALLBACKS;
  // Primary first, then fallbacks, without repeating the primary.
  return [...new Set([modelName(), ...fallbacks])];
}

/**
 * Gemini accepts a subset of JSON Schema. Strip the keywords it rejects so a
 * single Zod definition can drive both structured output and validation.
 */
type JsonSchema = Record<string, unknown>;

function sanitizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchema);
  if (!node || typeof node !== 'object') return node;

  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node as JsonSchema)) {
    if (key === '$schema' || key === 'additionalProperties' || key === '$ref') continue;
    out[key] = sanitizeSchema(value);
  }
  return out;
}

/** Map provider failures onto messages an operator can act on. */
function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes('api key') || lower.includes('unauthenticated') || lower.includes('permission')) {
    return new ProviderError(
      'The AI provider rejected the API key. Check GEMINI_API_KEY in .env.local.',
      'auth',
    );
  }
  if (lower.includes('quota') || lower.includes('rate') || lower.includes('429') || lower.includes('resource_exhausted')) {
    // A per-day quota is not a momentary spike: say so, because "retry shortly"
    // would be misleading when the allowance resets tomorrow.
    const daily = lower.includes('perday') || lower.includes('per day') || lower.includes('freetier');
    return new ProviderError(
      daily
        ? 'The free-tier daily quota for this model is used up. SourceBridge will try other models ' +
          'automatically; if all are exhausted the allowance resets after 24 hours.'
        : 'The AI provider rate limit was reached. Wait a moment and retry this format.',
      'rate_limit',
      true,
    );
  }
  if (lower.includes('timeout') || lower.includes('deadline')) {
    return new ProviderError('The AI provider timed out. Retry this format.', 'timeout', true);
  }
  if (lower.includes('503') || lower.includes('unavailable') || lower.includes('high demand')) {
    return new ProviderError(
      'The AI provider is temporarily overloaded. Retry this format in a moment.',
      'unavailable',
      true,
    );
  }
  if (lower.includes('404') || lower.includes('not_found') || lower.includes('no longer available')) {
    // A wrong or retired model name -- retrying will never help.
    return new ProviderError(
      `The configured model is not available: ${message}. Update GEMINI_MODEL in .env.local.`,
      'bad_model',
      false,
    );
  }
  return new ProviderError(`AI provider error: ${message}`, 'upstream', true);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Transient overload and rate limiting are common on free tiers; ride them out. */
const TRANSIENT_CODES = new Set(['unavailable', 'rate_limit', 'timeout']);
const MAX_ATTEMPTS = 6;

/**
 * Invoke `fn`, retrying transient provider failures with exponential backoff.
 * Permanent failures (bad key, retired model) fail immediately.
 */
async function withRetry<T>(fn: (model: string) => Promise<T>): Promise<{ value: T; model: string }> {
  const chain = modelChain();
  let lastError: ProviderError | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Rotate through the chain, then start again from the top.
    const model = chain[attempt % chain.length];
    try {
      return { value: await fn(model), model };
    } catch (err) {
      const error = toProviderError(err);
      // A retired model name is permanent for that model but the next one in
      // the chain may still work, so keep going unless nothing is left.
      const worthRetrying = TRANSIENT_CODES.has(error.code) || error.code === 'bad_model';
      if (!worthRetrying || attempt === MAX_ATTEMPTS - 1) throw error;
      lastError = error;
      // Only pause once we have been round the whole chain.
      const exhaustedChain = (attempt + 1) % chain.length === 0;
      if (exhaustedChain) await sleep(2000);
    }
  }

  throw lastError ?? new ProviderError('The AI provider call failed.', 'upstream', true);
}

export interface GenerateJsonOptions<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Caps output size; also keeps cost predictable. */
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface GenerateJsonResult<T> {
  data: T;
  /** True when the first response failed validation and a repair pass was used. */
  repaired: boolean;
  latencyMs: number;
  /** The model that actually produced the result, which may be a fallback. */
  model: string;
}

/**
 * Request structured JSON and validate it. If the first response fails schema
 * validation, one repair attempt is made with the validation errors fed back.
 * There is no third attempt: a format that fails twice is reported as failed so
 * the operator can retry it without losing other artefacts.
 */
export async function generateJson<T>(
  options: GenerateJsonOptions<T>,
): Promise<GenerateJsonResult<T>> {
  const ai = client();
  const started = Date.now();
  const responseSchema = sanitizeSchema(z.toJSONSchema(options.schema)) as JsonSchema;

  let usedModel = modelName();

  const call = async (prompt: string): Promise<string> => {
    const { value, model } = await withRetry(async (candidate) => {
      const response = await ai.models.generateContent({
        model: candidate,
        contents: prompt,
        config: {
          systemInstruction: options.system,
          responseMimeType: 'application/json',
          responseSchema,
          temperature: options.temperature ?? 0.4,
          maxOutputTokens: options.maxOutputTokens ?? 8192,
          abortSignal: options.signal,
        },
      });
      return response.text ?? '';
    });
    usedModel = model;
    return value;
  };

  const parse = (raw: string): { ok: true; value: T } | { ok: false; issues: string } => {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: false, issues: 'Response was not valid JSON.' };
    }
    const result = options.schema.safeParse(json);
    if (result.success) return { ok: true, value: result.data };
    return {
      ok: false,
      issues: result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
    };
  };

  const first = parse(await call(options.prompt));
  if (first.ok) {
    return { data: first.value, repaired: false, latencyMs: Date.now() - started, model: usedModel };
  }

  const repairPrompt =
    `${options.prompt}\n\n` +
    `Your previous response did not satisfy the required schema. ` +
    `Problems: ${first.issues}\n` +
    `Return corrected JSON that satisfies the schema exactly. Output JSON only.`;

  const second = parse(await call(repairPrompt));
  if (second.ok) {
    return { data: second.value, repaired: true, latencyMs: Date.now() - started, model: usedModel };
  }

  throw new ProviderError(
    `The model returned content that did not match the required structure (${second.issues}).`,
    'invalid_output',
    true,
  );
}

/**
 * Read an image with the provider's vision model and return its text content.
 *
 * This is a model transcription, not a literal extraction: the caller must
 * surface it as such, because a vision model can misread a figure or omit part
 * of a busy layout. The prompt asks for verbatim figures and an explicit note
 * when something is unreadable, rather than a confident guess.
 */
export type MediaKind = 'image' | 'video';

const MEDIA_PROMPTS: Record<MediaKind, string> = {
  image: [
    'Transcribe the information in this image so it can be used as a source document.',
    '- Reproduce every figure, unit, date, label and caption EXACTLY as shown.',
    '- Preserve structure: keep headings on their own line, and keep table rows together.',
    '- Describe charts by stating the values they show, not by interpreting them.',
    '- If part of the image is unreadable, write [unreadable] there. Never guess.',
    '- Do not add commentary, analysis or anything not present in the image.',
    'Output plain text only.',
  ].join('\n'),
  video: [
    'Transcribe this video so it can be used as a source document.',
    '- Write the spoken narration in order, then any on-screen text that adds information.',
    '- Reproduce every figure, unit, date and name EXACTLY as spoken or shown.',
    '- Do not repeat a line just because it stays on screen across several frames.',
    '- If audio is inaudible or text unreadable, write [unclear] there. Never guess.',
    '- Do not summarise, interpret or add anything not present in the video.',
    'Output plain text only.',
  ].join('\n'),
};

/**
 * Text-to-speech models, tried in order.
 *
 * Separate from the text chain: TTS is a different model family with its own
 * per-model daily allowance, so exhausting one does not affect generation.
 */
const DEFAULT_TTS_MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-3.8-flash-tts'];

function ttsChain(): string[] {
  const configured = process.env.GEMINI_TTS_MODELS?.trim();
  const models = configured
    ? configured.split(',').map((m) => m.trim()).filter(Boolean)
    : DEFAULT_TTS_MODELS;
  return [...new Set(models)];
}

export interface SpeechResult {
  /** Raw signed 16-bit little-endian PCM, mono. */
  pcm: Buffer;
  sampleRate: number;
  /** Exact duration, derived from the byte count rather than estimated. */
  seconds: number;
  model: string;
  voice: string;
}

/**
 * Speak a line of narration.
 *
 * The provider returns raw PCM rather than an encoded file, which is what makes
 * subtitle timing honest: the duration follows from the byte count exactly, so
 * captions align to the audio that was actually produced instead of to a
 * words-per-minute guess.
 */
export async function synthesizeSpeech(text: string, voice = 'Kore'): Promise<SpeechResult> {
  const ai = client();
  const spoken = text.trim();
  if (!spoken) throw new ProviderError('Nothing to speak.', 'invalid_output');

  const chain = ttsChain();
  let lastError: ProviderError | undefined;

  for (let attempt = 0; attempt < Math.max(chain.length * 2, 2); attempt++) {
    const model = chain[attempt % chain.length];
    try {
      const response = await ai.models.generateContent({
        model,
        contents: spoken,
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      });

      const inline = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inline?.data) {
        throw new ProviderError('The speech model returned no audio.', 'invalid_output', true);
      }

      const pcm = Buffer.from(inline.data, 'base64');
      // The mime type carries the rate, e.g. "audio/L16;codec=pcm;rate=24000".
      const sampleRate = Number(inline.mimeType?.match(/rate=(\d+)/)?.[1] ?? 24000);

      return {
        pcm,
        sampleRate,
        seconds: pcm.length / 2 / sampleRate,
        model,
        voice,
      };
    } catch (err) {
      const error = toProviderError(err);
      const worthRetrying = TRANSIENT_CODES.has(error.code) || error.code === 'bad_model';
      if (!worthRetrying || attempt === Math.max(chain.length * 2, 2) - 1) throw error;
      lastError = error;
      if ((attempt + 1) % chain.length === 0) await sleep(2000);
    }
  }

  throw lastError ?? new ProviderError('Speech synthesis failed.', 'upstream', true);
}

export async function transcribeMedia(
  base64: string,
  mimeType: string,
  kind: MediaKind,
): Promise<{ text: string; model: string; latencyMs: number }> {
  const ai = client();
  const started = Date.now();

  const { value, model } = await withRetry(async (candidate) => {
    const response = await ai.models.generateContent({
      model: candidate,
      contents: [
        {
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: MEDIA_PROMPTS[kind] },
          ],
        },
      ],
      // A video transcript runs longer than an image caption.
      config: { temperature: 0, maxOutputTokens: kind === 'video' ? 8192 : 4096 },
    });
    return response.text ?? '';
  });

  return { text: value, model, latencyMs: Date.now() - started };
}

/** Named alias kept for image callers. */
export const transcribeImage = (base64: string, mimeType: string) =>
  transcribeMedia(base64, mimeType, 'image');

/** Minimal round-trip used by the health check. */
export async function pingProvider(): Promise<{ ok: true; model: string; latencyMs: number }> {
  const started = Date.now();
  const result = await generateJson({
    system: 'You are a connectivity check. Answer with the exact value requested.',
    prompt: 'Return JSON with field "status" set to the string "ok".',
    schema: z.object({ status: z.string() }),
    // Enough headroom for reasoning-style models that emit thinking tokens.
    maxOutputTokens: 2048,
    temperature: 0,
  });
  if (result.data.status.toLowerCase() !== 'ok') {
    throw new ProviderError('Provider responded but the reply was unexpected.', 'upstream', true);
  }
  // Report the model that actually answered, which may be a fallback.
  return { ok: true, model: result.model, latencyMs: Date.now() - started };
}
