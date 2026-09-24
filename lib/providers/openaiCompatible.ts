/**
 * Structured generation against any OpenAI-compatible chat endpoint.
 *
 * Groq, OpenRouter, Cerebras and GitHub Models all speak this shape, so one
 * adapter covers them: a base URL and a key are the only difference. Keeping it
 * separate from the Gemini client means a second provider is configuration
 * rather than a rewrite.
 *
 * Schemas are sent with `strict: false`. Strict mode requires every property to
 * be required and forbids extra keys, which our per-format schemas deliberately
 * break: a slide carries one optional block per layout. Non-strict still steers
 * the model well, and every response is validated against Zod afterwards
 * regardless of what the provider promises.
 */

import 'server-only';

export interface OpenAICompatibleConfig {
  /** e.g. https://api.groq.com/openai/v1 */
  baseUrl: string;
  apiKey: string;
  label: string;
}

export interface ChatRequest {
  model: string;
  system: string;
  prompt: string;
  /** JSON Schema describing the expected reply. */
  schema: Record<string, unknown>;
  schemaName: string;
  temperature?: number;
  maxOutputTokens?: number;
  /**
   * How much hidden reasoning the model may spend, where the endpoint supports
   * it. Reasoning tokens count against the output budget and against the
   * per-minute token allowance, so a lower setting is both faster and leaves
   * room for more requests before the limit is reached.
   */
  reasoningEffort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
}

export class OpenAICompatibleError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /**
     * How long the endpoint asked us to wait, when it said so.
     *
     * A rate limit here is usually seconds, not minutes. Without the stated
     * delay the caller can only guess, and guessing high means standing down a
     * fast provider long after it would have served again.
     */
    readonly retryAfterMs?: number,
    /** The endpoint's own error code, e.g. json_validate_failed. */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'OpenAICompatibleError';
  }
}

/**
 * Read the wait the endpoint asked for, from the header or the message body.
 *
 * The header is authoritative but is not always sent; the message reliably
 * carries a phrase like "try again in 7.66s", so both are worth reading.
 */
function retryAfterMs(response: Response, message: string): number | undefined {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.round(seconds * 1000);
  }
  const match = message.match(/try again in ([\d.]+)\s*(ms|s|m)\b/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  const unit = match[2].toLowerCase();
  return Math.round(value * (unit === 'ms' ? 1 : unit === 'm' ? 60_000 : 1000));
}

/**
 * Send one chat completion and return the raw text of the reply.
 *
 * Parsing and validation stay with the caller, which already has the Zod schema
 * and a repair path for a malformed response.
 */
export async function chatJson(
  config: OpenAICompatibleConfig,
  request: ChatRequest,
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: request.signal,
    body: JSON.stringify({
      model: request.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ],
      temperature: request.temperature ?? 0.4,
      max_tokens: request.maxOutputTokens ?? 8192,
      ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
      response_format: {
        type: 'json_schema',
        json_schema: { name: request.schemaName, strict: false, schema: request.schema },
      },
    }),
  });

  const body = await response.text();

  if (!response.ok) {
    let detail = body.slice(0, 300);
    let code: string | undefined;
    try {
      const parsed = JSON.parse(body);
      detail = parsed?.error?.message ?? detail;
      code = parsed?.error?.code;
    } catch {
      // Not JSON; the raw body is the best available detail.
    }
    throw new OpenAICompatibleError(
      `${config.label}: ${detail}`,
      response.status,
      retryAfterMs(response, detail),
      code,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new OpenAICompatibleError(`${config.label} returned a non-JSON response.`, 502);
  }

  const text = (parsed as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message
    ?.content;

  if (typeof text !== 'string' || !text.trim()) {
    throw new OpenAICompatibleError(`${config.label} returned an empty reply.`, 502);
  }
  return text;
}
