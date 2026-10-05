/**
 * Speech model rotation.
 *
 * Rendering a video speaks each scene in its own call, so the chain is walked
 * once per scene rather than once per render. Without a cooldown every scene
 * started again at a model the previous scene had just found exhausted: a
 * six-scene render spent its first attempt on a dead model six times over,
 * each one waiting out a refusal before rotating. These cases assert that a
 * refusal is remembered across calls, which is what makes the second scene
 * faster than the first rather than exactly as slow.
 *
 * Cooldowns are process-wide by design, so each case configures its own model
 * names rather than sharing them: that is what keeps one case from inheriting
 * another's stood-down models, without a reset hook existing only for tests.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const generateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

const { synthesizeSpeech, geminiKeys } = await import('@/lib/provider');

const ORIGINAL = { ...process.env };

/** A successful audio reply, in the shape the SDK returns. */
const audio = () => ({
  candidates: [
    {
      content: {
        parts: [
          {
            inlineData: {
              mimeType: 'audio/L16;codec=pcm;rate=24000',
              data: Buffer.alloc(24000 * 2).toString('base64'),
            },
          },
        ],
      },
    },
  ],
});

const exhausted = () =>
  new Error('{"error":{"code":429,"message":"quota exceeded perday freetier"}}');
const overloaded = () => new Error('{"error":{"code":503,"message":"overloaded"}}');

/** The models the chain actually called, in order. */
const called = () => generateContent.mock.calls.map((call) => call[0].model as string);

/**
 * Configure a chain of models named uniquely to this case.
 *
 * Returns the names so assertions can refer to them positionally.
 */
let caseId = 0;
function chainOf(count: number): string[] {
  caseId += 1;
  const names = Array.from({ length: count }, (_, i) => `tts-${caseId}-${i}`);
  process.env.GEMINI_TTS_MODELS = names.join(',');
  return names;
}

/** Run to completion under fake timers, letting the rotation sleeps elapse instantly. */
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

beforeEach(() => {
  vi.useFakeTimers();
  process.env.GEMINI_API_KEY = 'test-key';
  generateContent.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

describe('speech synthesis', () => {
  it('derives the duration from the byte count, not from an estimate', async () => {
    const [first] = chainOf(2);
    generateContent.mockResolvedValue(audio());

    const result = await run(synthesizeSpeech('Water use fell eighteen percent.'));

    // 24000 samples at 24 kHz is exactly one second.
    expect(result.seconds).toBe(1);
    expect(result.sampleRate).toBe(24000);
    expect(result.model).toBe(first);
  });

  it('refuses an empty line before calling the provider', async () => {
    chainOf(2);
    await expect(synthesizeSpeech('   ')).rejects.toThrow(/nothing to speak/i);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('rotates to the next model when one refuses', async () => {
    const [a, b] = chainOf(3);
    generateContent.mockRejectedValueOnce(exhausted()).mockResolvedValueOnce(audio());

    const result = await run(synthesizeSpeech('One line.'));
    expect(result.model).toBe(b);
    expect(called()).toEqual([a, b]);
  });

  it('does not ask an exhausted model again on the next scene', async () => {
    const [, b] = chainOf(3);

    // Scene one: the first model is spent, the second answers.
    generateContent.mockRejectedValueOnce(exhausted()).mockResolvedValueOnce(audio());
    await run(synthesizeSpeech('Scene one.'));

    // Scene two must start where scene one succeeded, not back at the model
    // that has already said no. This is the whole point of the cooldown.
    generateContent.mockReset();
    generateContent.mockResolvedValue(audio());
    const second = await run(synthesizeSpeech('Scene two.'));

    expect(called()).toEqual([b]);
    expect(second.model).toBe(b);
  });

  it('keeps a model that answered, rather than standing it down too', async () => {
    const [, b] = chainOf(3);
    generateContent.mockRejectedValueOnce(overloaded()).mockResolvedValueOnce(audio());
    await run(synthesizeSpeech('Scene one.'));

    // A success must not leave a stale cooldown behind for the model that
    // served it, or the next scene would skip a model known to be working.
    generateContent.mockReset();
    generateContent.mockResolvedValue(audio());
    await run(synthesizeSpeech('Scene two.'));
    expect(called()).toEqual([b]);
  });

  it('treats a reply with no audio as worth another model', async () => {
    const [, b] = chainOf(3);
    generateContent.mockResolvedValueOnce({ candidates: [] }).mockResolvedValueOnce(audio());

    const result = await run(synthesizeSpeech('One line.'));
    expect(result.model).toBe(b);
  });

  it('gives up with the provider’s own reason once every model refuses', async () => {
    const names = chainOf(3);
    generateContent.mockRejectedValue(exhausted());

    await expect(run(synthesizeSpeech('One line.'))).rejects.toThrow(/allowance is spent/i);
    // Every model was given a turn rather than failing on the first.
    expect(new Set(called())).toEqual(new Set(names));
  });

  it('falls back to the whole chain when every model is still cooling down', async () => {
    const [a] = chainOf(2);
    generateContent.mockRejectedValue(exhausted());
    await expect(run(synthesizeSpeech('Scene one.'))).rejects.toThrow();

    // Both are now in cooldown. A stale cooldown must never leave a render
    // with nothing to call, so the next scene still tries them.
    generateContent.mockReset();
    generateContent.mockResolvedValue(audio());
    const next = await run(synthesizeSpeech('Scene two.'));
    expect(next.model).toBe(a);
  });
});

/**
 * Several keys.
 *
 * The free allowance is counted per PROJECT, per model, per day. A second key
 * on the same project therefore buys nothing, and a key from another Google
 * account doubles it outright. That is the only way to have MORE of the good
 * voice rather than a worse one, so the chain walks every combination of key
 * and model before giving up and letting a local engine take over.
 */
describe('multiple keys', () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEYS;
  });

  it('uses the single key when only one is configured', () => {
    process.env.GEMINI_API_KEY = 'only-key';
    expect(geminiKeys()).toEqual(['only-key']);
  });

  it('keeps the original key first, so an existing deployment is unchanged', () => {
    process.env.GEMINI_API_KEY = 'first';
    process.env.GEMINI_API_KEYS = 'second, third';
    expect(geminiKeys()).toEqual(['first', 'second', 'third']);
  });

  it('ignores a key repeated across both settings', () => {
    process.env.GEMINI_API_KEY = 'same';
    process.env.GEMINI_API_KEYS = 'same, other';
    expect(geminiKeys()).toEqual(['same', 'other']);
  });

  it('works with no primary key at all', () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEYS = 'a,b';
    expect(geminiKeys()).toEqual(['a', 'b']);
  });

  it('moves to the next key when the first has spent its day', async () => {
    const [model] = chainOf(1);
    process.env.GEMINI_API_KEY = 'spent-account';
    process.env.GEMINI_API_KEYS = 'fresh-account';

    generateContent.mockRejectedValueOnce(exhausted()).mockResolvedValueOnce(audio());
    const result = await run(synthesizeSpeech('One line.'));

    // Same model, different project: a genuinely separate allowance.
    expect(result.model).toBe(model);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('does not ask a spent key again on the next scene', async () => {
    chainOf(1);
    process.env.GEMINI_API_KEY = 'spent-account';
    process.env.GEMINI_API_KEYS = 'fresh-account';

    generateContent.mockRejectedValueOnce(exhausted()).mockResolvedValueOnce(audio());
    await run(synthesizeSpeech('Scene one.'));

    generateContent.mockReset();
    generateContent.mockResolvedValue(audio());
    await run(synthesizeSpeech('Scene two.'));

    // Straight to the key that answered, rather than rediscovering the spent one.
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('tries every key and model before giving up', async () => {
    chainOf(2);
    process.env.GEMINI_API_KEY = 'key-a';
    process.env.GEMINI_API_KEYS = 'key-b,key-c';
    generateContent.mockRejectedValue(exhausted());

    await expect(run(synthesizeSpeech('One line.'))).rejects.toThrow();
    // 2 models x 3 keys: every separate allowance was given a turn.
    expect(generateContent).toHaveBeenCalledTimes(6);
  });

  it('reports no key configured rather than failing obscurely', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEYS;

    await expect(synthesizeSpeech('One line.')).rejects.toThrow(/needs a Gemini key/i);
  });
});
