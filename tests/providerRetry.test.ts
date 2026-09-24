import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { ProviderError, modelChain, withRetry, type ModelRef } from '@/lib/provider';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.useFakeTimers();
  // A real key in .env.local must not decide what the chain contains here.
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_FALLBACK_MODELS;
  // Waits are asserted, not endured.
  vi.spyOn(globalThis, 'setTimeout');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL };
  delete process.env.GROQ_API_KEY;
});

const chain: ModelRef[] = [
  { provider: 'openai', model: 'fast-a' },
  { provider: 'openai', model: 'fast-b' },
  { provider: 'gemini', model: 'slow-a' },
];

/** Run to completion under fake timers, letting any sleeps elapse instantly. */
async function run<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
  await vi.runAllTimersAsync();
  const result = await settled;
  if (!result.ok) throw result.error;
  return result.value;
}

const rateLimited = (retryAfterMs?: number) => {
  const err = new ProviderError('limited', 'rate_limit', true);
  err.retryAfterMs = retryAfterMs;
  return err;
};

describe('model selection', () => {
  it('returns the first model that answers', async () => {
    const result = await run(withRetry(chain, async (ref) => ref.model));

    expect(result).toEqual({ value: 'fast-a', model: 'fast-a' });
  });

  it('moves down the chain when a model refuses', async () => {
    const seen: string[] = [];
    const result = await run(
      withRetry(chain, async (ref) => {
        seen.push(ref.model);
        if (ref.model !== 'slow-a') throw new ProviderError('down', 'unavailable', true);
        return 'ok';
      }),
    );

    expect(seen).toEqual(['fast-a', 'fast-b', 'slow-a']);
    expect(result.model).toBe('slow-a');
  });

  it('gives up immediately on a failure no other model can fix', async () => {
    const seen: string[] = [];
    await expect(
      run(
        withRetry(chain, async (ref) => {
          seen.push(ref.model);
          throw new ProviderError('bad key', 'auth');
        }),
      ),
    ).rejects.toMatchObject({ code: 'auth' });

    // A rejected key is rejected everywhere; trying the rest wastes a request
    // against every model and delays telling the operator what is wrong.
    expect(seen).toEqual(['fast-a']);
  });

  it('refuses up front when no model can serve the step', async () => {
    await expect(run(withRetry([], async () => 'x'))).rejects.toMatchObject({
      code: 'not_configured',
    });
  });
});

describe('short rate limits', () => {
  it('waits out a brief stated limit and retries the same model', async () => {
    const seen: string[] = [];
    let first = true;

    const result = await run(
      withRetry(chain, async (ref) => {
        seen.push(ref.model);
        if (first) {
          first = false;
          throw rateLimited(8_000);
        }
        return 'ok';
      }),
    );

    // Falling through here would hand the work to a far slower provider for
    // the sake of eight seconds.
    expect(seen).toEqual(['fast-a', 'fast-a']);
    expect(result.model).toBe('fast-a');
  });

  it('stops waiting and moves on once the limit keeps repeating', async () => {
    const seen: string[] = [];
    const result = await run(
      withRetry(chain, async (ref) => {
        seen.push(ref.model);
        if (ref.model === 'fast-a') throw rateLimited(5_000);
        return 'ok';
      }),
    );

    // Two waits, then the chain: a provider limited this persistently is no
    // longer the fast route, whatever it says about the delay.
    expect(seen).toEqual(['fast-a', 'fast-a', 'fast-a', 'fast-b']);
    expect(result.model).toBe('fast-b');
  });

  it('does not wait out a long limit', async () => {
    const seen: string[] = [];
    await run(
      withRetry(chain, async (ref) => {
        seen.push(ref.model);
        if (ref.model === 'fast-a') throw rateLimited(10 * 60_000);
        return 'ok';
      }),
    );

    // A limit measured in minutes is not worth holding the run for.
    expect(seen).toEqual(['fast-a', 'fast-b']);
  });

  it('does not wait when the provider states no delay', async () => {
    const seen: string[] = [];
    await run(
      withRetry(chain, async (ref) => {
        seen.push(ref.model);
        if (ref.model === 'fast-a') throw rateLimited(undefined);
        return 'ok';
      }),
    );

    // Without a stated delay there is nothing to wait for; guessing one would
    // be the five-minute cooldown that lost us the fast provider before.
    expect(seen).toEqual(['fast-a', 'fast-b']);
  });
});

describe('cooldowns', () => {
  it('skips a model a previous call found to be down', async () => {
    process.env.GEMINI_MODEL = 'cooldown-primary';
    process.env.GEMINI_FALLBACK_MODELS = 'cooldown-second';

    await run(
      withRetry(modelChain(), async (ref) => {
        if (ref.model === 'cooldown-primary') throw new ProviderError('down', 'unavailable', true);
        return 'ok';
      }),
    );

    // Overload is a property of the model, not of one request. Without this,
    // every format rediscovers the same dead model at the cost of a timeout.
    expect(modelChain().map((ref) => ref.model)).toEqual(['cooldown-second']);
  });

  it('keeps a model usable after one malformed reply', async () => {
    const seen: string[] = [];
    await run(
      withRetry(chain, async (ref) => {
        seen.push(ref.model);
        if (seen.length === 1) throw new ProviderError('bad shape', 'invalid_output', true);
        return 'ok';
      }),
    );

    // One unusable response says nothing about the model's health. Treating it
    // as a fault retired the fast provider for an hour over a single reply.
    expect(seen).toEqual(['fast-a', 'fast-b']);
  });
});
