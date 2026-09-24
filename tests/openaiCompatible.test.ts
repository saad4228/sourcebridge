import { describe, expect, it, afterEach, vi } from 'vitest';
import { OpenAICompatibleError, chatJson } from '@/lib/providers/openaiCompatible';

const config = { baseUrl: 'https://example.test/v1', apiKey: 'test-key', label: 'TestProvider' };

const request = {
  model: 'test-model',
  system: 'system',
  prompt: 'prompt',
  schema: { type: 'object' as const },
  schemaName: 'response',
};

/** The parts of the request body these assertions look at. */
interface SentBody {
  reasoning_effort?: string;
  response_format: { json_schema: { strict: boolean; schema: unknown } };
}

/** Stand in for the endpoint, recording the body it was sent. */
function stubFetch(response: Response) {
  const sent: SentBody[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return response;
  });
  return { sent };
}

const reply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

const failure = (status: number, body: unknown, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request shape', () => {
  it('returns the reply text without parsing it', async () => {
    stubFetch(reply('{"a":1}'));
    expect(await chatJson(config, request)).toBe('{"a":1}');
  });

  it('omits the reasoning budget unless one is asked for', async () => {
    const stub = stubFetch(reply('{}'));
    await chatJson(config, request);

    const sent = stub.sent[0];
    // Endpoints that do not know the field may reject a request carrying it.
    expect(sent).not.toHaveProperty('reasoning_effort');
  });

  it('passes the reasoning budget through when set', async () => {
    const stub = stubFetch(reply('{}'));
    await chatJson(config, { ...request, reasoningEffort: 'low' });

    expect(stub.sent[0]!.reasoning_effort).toBe('low');
  });

  it('sends the schema without demanding strict mode', async () => {
    const stub = stubFetch(reply('{}'));
    await chatJson(config, request);

    // Strict mode forbids optional properties, which every per-layout block is.
    const sent = stub.sent[0];
    expect(sent!.response_format.json_schema.strict).toBe(false);
    expect(sent!.response_format.json_schema.schema).toEqual({ type: 'object' });
  });
});

describe('rate limits', () => {
  it('reads the wait from the retry-after header', async () => {
    stubFetch(failure(429, { error: { message: 'slow down' } }, { 'retry-after': '8' }));

    await expect(chatJson(config, request)).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 8000,
    });
  });

  it('reads the wait from the message when no header is sent', async () => {
    // This provider states the delay in prose and omits the header entirely.
    stubFetch(
      failure(429, {
        error: { message: 'Rate limit reached. Please try again in 7.66s.', code: 'rate_limit_exceeded' },
      }),
    );

    const err = await chatJson(config, request).catch((e) => e as OpenAICompatibleError);
    expect(err).toBeInstanceOf(OpenAICompatibleError);
    expect((err as OpenAICompatibleError).retryAfterMs).toBe(7660);
  });

  it('handles a wait stated in minutes or milliseconds', async () => {
    stubFetch(failure(429, { error: { message: 'try again in 2m' } }));
    await expect(chatJson(config, request)).rejects.toMatchObject({ retryAfterMs: 120_000 });

    stubFetch(failure(429, { error: { message: 'try again in 250ms' } }));
    await expect(chatJson(config, request)).rejects.toMatchObject({ retryAfterMs: 250 });
  });

  it('leaves the wait unset when none is stated', async () => {
    stubFetch(failure(429, { error: { message: 'too many requests' } }));

    const err = await chatJson(config, request).catch((e) => e as OpenAICompatibleError);
    expect((err as OpenAICompatibleError).retryAfterMs).toBeUndefined();
  });
});

describe('failures', () => {
  it('carries the endpoint error code, so a bad reply is not read as a bad model', async () => {
    stubFetch(
      failure(400, { error: { message: 'Failed to validate JSON.', code: 'json_validate_failed' } }),
    );

    await expect(chatJson(config, request)).rejects.toMatchObject({
      status: 400,
      code: 'json_validate_failed',
    });
  });

  it('names the provider in the message', async () => {
    stubFetch(failure(401, { error: { message: 'Invalid API Key' } }));

    await expect(chatJson(config, request)).rejects.toThrow(/TestProvider: Invalid API Key/);
  });

  it('rejects an empty reply rather than returning it as content', async () => {
    stubFetch(reply('   '));

    // An empty string would fail JSON parsing later with a far less useful
    // message than naming the provider that returned nothing.
    await expect(chatJson(config, request)).rejects.toMatchObject({ status: 502 });
  });

  it('rejects a body that is not JSON at all', async () => {
    stubFetch(new Response('<html>502 Bad Gateway</html>', { status: 200 }));

    await expect(chatJson(config, request)).rejects.toMatchObject({ status: 502 });
  });
});
