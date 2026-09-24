import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { isProviderConfigured, isVisionConfigured, modelChain, modelName } from '@/lib/provider';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_FALLBACK_MODELS;
  // A real key in .env.local must not decide what these assertions see.
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_MODELS;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

/** The model names in the chain, which is what most assertions care about. */
const names = (provider?: 'gemini' | 'openai') => modelChain(provider).map((ref) => ref.model);

describe('model chain', () => {
  it('puts the configured primary first and never repeats it', () => {
    process.env.GEMINI_MODEL = 'gemini-3.5-flash';
    const chain = names();

    expect(chain[0]).toBe('gemini-3.5-flash');
    expect(chain.filter((m) => m === 'gemini-3.5-flash')).toHaveLength(1);
    expect(new Set(chain).size).toBe(chain.length);
  });

  it('is long enough that one exhausted model is not the end of it', () => {
    // A single model carries only a fraction of a working day on the free tier.
    expect(modelChain().length).toBeGreaterThanOrEqual(4);
  });

  it('includes a model family with a separate allowance', () => {
    // Once the Gemini daily quotas are spent, Gemma is what keeps it working.
    expect(names().some((m) => m.startsWith('gemma'))).toBe(true);
  });

  it('honours an explicit override', () => {
    process.env.GEMINI_MODEL = 'model-a';
    process.env.GEMINI_FALLBACK_MODELS = 'model-b, model-c';

    expect(names()).toEqual(['model-a', 'model-b', 'model-c']);
  });

  it('falls back to a default when nothing is configured', () => {
    expect(modelName()).toBeTruthy();
    expect(names()[0]).toBe(modelName());
  });
});

describe('second provider', () => {
  it('is absent from the chain until a key is configured', () => {
    expect(modelChain().every((ref) => ref.provider === 'gemini')).toBe(true);
  });

  it('is tried before Gemini, because it answers in about a second', () => {
    process.env.GROQ_API_KEY = 'test-key';

    // Ordering is the whole point: a fast provider placed after a slow one
    // would only ever be reached once the slow one had already cost the wait.
    expect(modelChain()[0].provider).toBe('openai');
    expect(modelChain().some((ref) => ref.provider === 'gemini')).toBe(true);
  });

  it('keeps the two providers distinct even on a shared model name', () => {
    process.env.GROQ_API_KEY = 'test-key';
    process.env.GROQ_MODELS = 'shared-name';
    process.env.GEMINI_MODEL = 'shared-name';
    process.env.GEMINI_FALLBACK_MODELS = 'other';

    // De-duplication is per provider: the same name on two providers is two
    // different models, and collapsing them would silently drop one.
    expect(modelChain()).toEqual([
      { provider: 'openai', model: 'shared-name' },
      { provider: 'gemini', model: 'shared-name' },
      { provider: 'gemini', model: 'other' },
    ]);
  });

  it('is excluded when a step asks for Gemini', () => {
    process.env.GROQ_API_KEY = 'test-key';

    // Vision and speech have no equivalent on the OpenAI-compatible endpoint,
    // so offering those models would spend attempts on impossible requests.
    expect(names('gemini').length).toBeGreaterThan(0);
    expect(modelChain('gemini').every((ref) => ref.provider === 'gemini')).toBe(true);
  });
});

describe('configuration checks', () => {
  it('reports text generation as available on either provider alone', () => {
    delete process.env.GEMINI_API_KEY;
    expect(isProviderConfigured()).toBe(false);

    process.env.GROQ_API_KEY = 'test-key';
    expect(isProviderConfigured()).toBe(true);
  });

  it('reports vision as unavailable without a Gemini key', () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GROQ_API_KEY = 'test-key';

    // Uploading a screenshot must be refused up front rather than failing
    // part-way through, once the file has already been read.
    expect(isVisionConfigured()).toBe(false);
  });
});
