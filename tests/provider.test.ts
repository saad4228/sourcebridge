import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { modelChain, modelName } from '@/lib/provider';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_FALLBACK_MODELS;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('model chain', () => {
  it('puts the configured primary first and never repeats it', () => {
    process.env.GEMINI_MODEL = 'gemini-3.5-flash';
    const chain = modelChain();

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
    expect(modelChain().some((m) => m.startsWith('gemma'))).toBe(true);
  });

  it('honours an explicit override', () => {
    process.env.GEMINI_MODEL = 'model-a';
    process.env.GEMINI_FALLBACK_MODELS = 'model-b, model-c';

    expect(modelChain()).toEqual(['model-a', 'model-b', 'model-c']);
  });

  it('falls back to a default when nothing is configured', () => {
    expect(modelName()).toBeTruthy();
    expect(modelChain()[0]).toBe(modelName());
  });
});
