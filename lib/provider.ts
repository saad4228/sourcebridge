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
import {
  OpenAICompatibleError,
  chatJson,
  type OpenAICompatibleConfig,
} from './providers/openaiCompatible';

/**
 * The model tried first, overridable with GEMINI_MODEL.
 *
 * Free-tier daily quotas are per-model and small on the flagship flash models,
 * so no single model carries a working day: the chain below spreads the load,
 * and one seven-format run costs eight requests.
 */
const DEFAULT_MODEL = 'gemini-3.6-flash';

export class ProviderError extends Error {
  /** How long the provider asked us to wait, when it said so. */
  retryAfterMs?: number;

  constructor(
    message: string,
    readonly code:
      | 'not_configured'
      | 'auth'
      | 'rate_limit'
      | 'timeout'
      | 'invalid_output'
      | 'unavailable'
      | 'network'
      | 'bad_model'
      | 'upstream',
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** True when text generation can run on at least one provider. */
export function isProviderConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GROQ_API_KEY?.trim());
}

/**
 * Reading images and video needs Gemini specifically.
 *
 * The OpenAI-compatible chain covers text only, so a Groq-only deployment can
 * generate every format but cannot ingest a screenshot. Routes that need vision
 * check this rather than isProviderConfigured, so the refusal names the missing
 * key instead of failing part-way through an upload.
 */
export function isVisionConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function client(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new ProviderError(
      'This step needs a Gemini key. Add GEMINI_API_KEY to .env.local and restart the dev server.',
      'not_configured',
    );
  }
  return new GoogleGenAI({ apiKey });
}

export function modelName(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Models tried when the primary will not serve, ordered by measured
 * reliability rather than by tier. Override with GEMINI_FALLBACK_MODELS.
 *
 * Free-tier capacity fluctuates minute to minute, so rotating to a different
 * model recovers far faster than waiting on a saturated one. The lite models
 * look attractive on paper but were observed refusing work for sustained
 * periods and — worse — occasionally accepting a request then hanging for
 * minutes, so they sit at the end as a last resort.
 */
const DEFAULT_FALLBACKS = [
  'gemini-3.5-flash',
  // Gemma draws on a separate allowance and supports structured output, so it
  // keeps the app working after the Gemini daily quotas are spent.
  'gemma-4-26b-a4b-it',
  'gemma-4-31b-it',
  'gemini-3.8-flash',
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite',
];

/**
 * Give up on a single request after this long and try another model.
 *
 * Without a deadline one slow model stalls the whole run: a model was measured
 * taking 261 seconds to answer a trivial prompt, which is far worse than an
 * outright refusal because nothing else can proceed meanwhile.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? 45_000);

/**
 * Text models on an OpenAI-compatible provider, tried before Gemini.
 *
 * These are put first because they answer in about a second where Gemini's
 * free tier was measured taking tens of seconds, and because they draw on an
 * entirely separate allowance — which is what stops a spent Gemini quota
 * stopping the application.
 *
 * Only text generation moves: reading images and video, and speaking
 * narration, remain Gemini's, because this provider does neither.
 */
const DEFAULT_OPENAI_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];

/**
 * Hidden reasoning budget for models that support it.
 *
 * Kept low deliberately. These formats are transformations of a supplied
 * source, not puzzles, and measurement showed low effort roughly halving both
 * the tokens spent and the time taken with no loss of output quality -- which
 * also means twice as many requests fit inside the per-minute allowance.
 */
const REASONING_EFFORT = (process.env.GROQ_REASONING_EFFORT?.trim() || 'low') as
  | 'low'
  | 'medium'
  | 'high';

/** Where an OpenAI-compatible key points. Groq by default; any such API works. */
function openAiConfig(): OpenAICompatibleConfig | null {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: process.env.GROQ_BASE_URL?.trim() || 'https://api.groq.com/openai/v1',
    label: process.env.GROQ_LABEL?.trim() || 'Groq',
  };
}

/** A model together with the provider that serves it. */
export interface ModelRef {
  provider: 'gemini' | 'openai';
  model: string;
}

/** Stable key for cooldowns, so the same model on two providers stays distinct. */
const refKey = (ref: ModelRef) => `${ref.provider}:${ref.model}`;

function configuredChain(): ModelRef[] {
  const geminiConfigured = process.env.GEMINI_FALLBACK_MODELS?.trim();
  const geminiFallbacks = geminiConfigured
    ? geminiConfigured.split(',').map((m) => m.trim()).filter(Boolean)
    : DEFAULT_FALLBACKS;

  // Primary first, then fallbacks, without repeating the primary.
  const gemini: ModelRef[] = [...new Set([modelName(), ...geminiFallbacks])].map((model) => ({
    provider: 'gemini' as const,
    model,
  }));

  if (!openAiConfig()) return gemini;

  const configured = process.env.GROQ_MODELS?.trim();
  const openai: ModelRef[] = (
    configured ? configured.split(',').map((m) => m.trim()).filter(Boolean) : DEFAULT_OPENAI_MODELS
  ).map((model) => ({ provider: 'openai' as const, model }));

  return [...openai, ...gemini];
}

/**
 * Models known to be refusing work, and when to reconsider them.
 *
 * Without this, every format independently rediscovers that the same models are
 * down: seven formats times three dead models is twenty-one pointless requests,
 * each waiting on a timeout. Overload is a property of the model, not of one
 * request, so it is remembered for the whole process.
 */
const cooldowns = new Map<string, number>();

/** How long to skip a model after it reports overload or exhausted quota. */
const COOLDOWN_MS = { unavailable: 60_000, rate_limit: 5 * 60_000, bad_model: 60 * 60_000 } as const;

function markUnavailable(ref: ModelRef, code: string, statedMs?: number) {
  const ms =
    // A provider that names its own wait knows better than any default. Groq's
    // limits clear in seconds, and standing its models down for the default
    // five minutes gave the rest of a run to the slow provider for no reason.
    statedMs !== undefined
      ? Math.min(statedMs + 500, COOLDOWN_MS.rate_limit)
      : code === 'rate_limit'
        ? COOLDOWN_MS.rate_limit
        : code === 'bad_model'
          ? COOLDOWN_MS.bad_model
          : COOLDOWN_MS.unavailable;
  cooldowns.set(refKey(ref), Date.now() + ms);
}

function markAvailable(ref: ModelRef) {
  cooldowns.delete(refKey(ref));
}

/**
 * The chain to try, skipping models still in cooldown.
 *
 * If every model is cooling down the full chain is returned anyway: a stale
 * cooldown must never leave the application with nothing to call.
 *
 * Pass a provider to narrow the chain to it, which is how vision and speech
 * stay on Gemini while text generation uses whichever model answers fastest.
 */
export function modelChain(provider?: ModelRef['provider']): ModelRef[] {
  const all = configuredChain().filter((ref) => !provider || ref.provider === provider);
  const now = Date.now();
  const live = all.filter((ref) => (cooldowns.get(refKey(ref)) ?? 0) <= now);
  return live.length > 0 ? live : all;
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

/**
 * Pull the human-readable part out of a provider error.
 *
 * The SDK surfaces failures as a raw JSON envelope. Interpolating that into a
 * message puts `{"error":{"code":500,...}}` in front of the operator, which
 * tells them nothing they can act on.
 */
function readableDetail(message: string): string {
  const start = message.indexOf('{');
  if (start !== -1) {
    try {
      const parsed = JSON.parse(message.slice(start));
      const inner = parsed?.error?.message;
      if (typeof inner === 'string' && inner.trim()) return inner.trim();
    } catch {
      // Not JSON after all; fall through to the original text.
    }
  }
  return message;
}

/** Map provider failures onto messages an operator can act on. */
function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;

  // The OpenAI-compatible adapter carries an HTTP status, which classifies the
  // failure exactly. Falling through to the text matching below would misread,
  // say, a rate-limit body that happens to mention a model name.
  if (err instanceof OpenAICompatibleError) {
    if (err.status === 401 || err.status === 403) {
      return new ProviderError(`${err.message} Check GROQ_API_KEY in .env.local.`, 'auth');
    }
    if (err.status === 429) {
      const error = new ProviderError(
        'That provider rate limit was reached. Another model is being tried.',
        'rate_limit',
        true,
      );
      error.retryAfterMs = err.retryAfterMs;
      return error;
    }
    // A retired or misspelled model name: retrying it will never help.
    if (err.status === 404) {
      return new ProviderError(err.message, 'bad_model', false);
    }
    // A 400 here is almost always the model's own output failing schema
    // validation. That is a fact about this one response, not about the model,
    // so it must not put the model in cooldown -- doing so retired the fast
    // provider for an hour over a single malformed reply.
    if (err.status === 400) {
      return new ProviderError(
        'The model returned content that did not match the required structure.',
        'invalid_output',
        true,
      );
    }
    if (err.status >= 500) return new ProviderError(err.message, 'unavailable', true);
    return new ProviderError(err.message, 'upstream', true);
  }
  const raw = err instanceof Error ? err.message : String(err);
  const message = readableDetail(raw);
  // Classify against the full text: the status code lives in the envelope.
  const lower = raw.toLowerCase();

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
    // Say which it is: a momentary rate limit clears in seconds, a spent daily
    // allowance does not clear today at all, and "retry shortly" would be a lie.
    return new ProviderError(
      daily
        ? "This model's free-tier daily allowance is spent. Other models are tried automatically; " +
          'once every one is spent, generation resumes when the allowance resets (about 24 hours).'
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
  // A 500 is the provider failing on its own side. It says nothing about this
  // request, so another model is worth trying — treating it as permanent meant
  // giving up while a healthy model sat unused further down the chain.
  if (lower.includes('"code":500') || lower.includes('internal error') || lower.includes('"internal"')) {
    return new ProviderError(
      'The AI provider hit an internal error on this model. Another model is being tried.',
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
  if (
    lower.includes('fetch failed') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound') ||
    lower.includes('socket') ||
    lower.includes('network')
  ) {
    // The connection dropped rather than the model refusing: worth another go,
    // but it says nothing about whether that model is healthy.
    return new ProviderError(
      'The connection to the AI provider dropped. Check your network, then retry this format.',
      'network',
      true,
    );
  }
  // Unrecognised, but still worth another model: an unclassified failure on one
  // model is no reason to give up on the rest of the chain.
  return new ProviderError(`AI provider error: ${message}`, 'unavailable', true);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run one provider call under a deadline.
 *
 * A model that hangs is worse than one that refuses: the refusal moves us on
 * immediately, while the hang blocks every remaining format. The abort is
 * reported as a timeout so the caller treats it like any other transient
 * failure and tries a different model.
 */
async function withDeadline<T>(
  label: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ProviderError(
        `${label} did not respond within ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds.`,
        'timeout',
        true,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Failures worth trying a different model for.
 *
 * `network` covers a dropped or refused connection, which surfaces as a bare
 * "fetch failed". It was previously classed as permanent, so a single flaky
 * connection failed the whole format without a retry.
 */
const TRANSIENT_CODES = new Set([
  'unavailable',
  'rate_limit',
  'timeout',
  'network',
  'invalid_output',
]);

/**
 * Failures that say nothing about the model's health.
 *
 * A dropped connection or one malformed reply is not grounds for standing a
 * model down: the next request to it may well succeed.
 */
const NO_COOLDOWN_CODES = new Set(['network', 'invalid_output']);
/**
 * Give every model in the chain a turn, plus a couple of retries for a model
 * that was merely unlucky. A fixed budget smaller than the chain would leave
 * the last models never tried at all.
 */
function attemptBudget(chainLength: number): number {
  return chainLength + 2;
}

/**
 * A stated rate-limit delay this short is worth waiting out.
 *
 * The providers are not interchangeable in speed: the fast one answers in
 * about a second, the slow one was measured taking over two minutes for the
 * same format. So when the fast one says "try again in eight seconds", doing
 * exactly that beats falling through, by an order of magnitude.
 */
const RATE_LIMIT_WAIT_MS = Number(process.env.PROVIDER_RATE_LIMIT_WAIT_MS ?? 12_000);

/** How often one call may wait before falling through is the better bet. */
const MAX_RATE_LIMIT_WAITS = 2;

/**
 * Invoke `fn`, moving to another model when one refuses work.
 *
 * A model that reports overload is put in cooldown, so the remaining formats in
 * a run skip it instead of each rediscovering it. Permanent failures (a rejected
 * key) fail immediately.
 *
 * The chain is supplied by the caller, so a step only one provider can serve is
 * never handed a model incapable of the work.
 *
 * Exported for tests: the ordering and cooldown rules here decide whether a run
 * takes seconds or minutes, which is worth asserting directly.
 */
export async function withRetry<T>(
  chain: ModelRef[],
  fn: (ref: ModelRef) => Promise<T>,
): Promise<{ value: T; model: string }> {
  if (chain.length === 0) {
    throw new ProviderError(
      'No model is configured for this step. Add a provider key to .env.local.',
      'not_configured',
    );
  }
  let lastError: ProviderError | undefined;

  const maxAttempts = attemptBudget(chain.length);
  // Tracked separately from the attempt count, because waiting out a short
  // rate limit retries the same model and must not spend its place in the
  // chain -- otherwise a brief limit would still cost us the fast provider.
  let index = 0;
  let waits = 0;

  for (let attempt = 0; attempt < maxAttempts; ) {
    // Rotate through the chain, then start again from the top.
    const ref = chain[index % chain.length];
    try {
      const value = await fn(ref);
      markAvailable(ref);
      return { value, model: ref.model };
    } catch (err) {
      const error = toProviderError(err);

      if (
        error.code === 'rate_limit' &&
        error.retryAfterMs !== undefined &&
        error.retryAfterMs <= RATE_LIMIT_WAIT_MS &&
        waits < MAX_RATE_LIMIT_WAITS
      ) {
        waits++;
        // A little past the stated time, so the limit has certainly cleared.
        await sleep(error.retryAfterMs + 250);
        continue;
      }

      // A retired model name is permanent for that model but the next one in
      // the chain may still work, so keep going unless nothing is left.
      const worthRetrying = TRANSIENT_CODES.has(error.code) || error.code === 'bad_model';
      if (worthRetrying && !NO_COOLDOWN_CODES.has(error.code)) {
        // Remember this model is refusing work, so other formats skip it.
        markUnavailable(ref, error.code, error.retryAfterMs);
      }
      attempt++;
      index++;
      if (!worthRetrying || attempt === maxAttempts) throw error;
      lastError = error;
      // Only pause once we have been round the whole chain.
      if (index % chain.length === 0) await sleep(2000);
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
  const started = Date.now();
  const responseSchema = sanitizeSchema(z.toJSONSchema(options.schema)) as JsonSchema;

  // Built on demand rather than up front: a deployment with only an
  // OpenAI-compatible key has no Gemini credentials, and constructing the
  // client eagerly would fail the request before the chain was even consulted.
  let gemini: GoogleGenAI | undefined;

  let usedModel = modelChain()[0]?.model ?? modelName();

  const call = async (prompt: string): Promise<string> => {
    const { value, model } = await withRetry(modelChain(), (ref) =>
      withDeadline(ref.model, (signal) => {
        if (ref.provider === 'openai') {
          const config = openAiConfig();
          if (!config) {
            throw new ProviderError('The OpenAI-compatible key went missing.', 'not_configured');
          }
          return chatJson(config, {
            model: ref.model,
            system: options.system,
            prompt,
            schema: responseSchema,
            schemaName: 'response',
            temperature: options.temperature,
            maxOutputTokens: options.maxOutputTokens,
            reasoningEffort: REASONING_EFFORT,
            signal,
          });
        }

        gemini ??= client();
        return gemini.models
          .generateContent({
            model: ref.model,
            contents: prompt,
            config: {
              systemInstruction: options.system,
              responseMimeType: 'application/json',
              responseSchema,
              temperature: options.temperature ?? 0.4,
              maxOutputTokens: options.maxOutputTokens ?? 8192,
              abortSignal: signal,
            },
          })
          .then((response) => response.text ?? '');
      }),
    );
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
      const response = await withDeadline(model, (signal) =>
        ai.models.generateContent({
          model,
          contents: spoken,
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            abortSignal: signal,
          },
        }),
      );

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

  // Gemini only: the OpenAI-compatible chain has no vision model, so offering
  // it here would burn an attempt on a request it cannot serve.
  const { value, model } = await withRetry(modelChain('gemini'), (ref) =>
    withDeadline(ref.model, (signal) =>
      ai.models
        .generateContent({
          model: ref.model,
          contents: [
            {
              parts: [
                { inlineData: { mimeType, data: base64 } },
                { text: MEDIA_PROMPTS[kind] },
              ],
            },
          ],
          // A video transcript runs longer than an image caption.
          config: {
            temperature: 0,
            maxOutputTokens: kind === 'video' ? 8192 : 4096,
            abortSignal: signal,
          },
        })
        .then((response) => response.text ?? ''),
    ),
  );

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
