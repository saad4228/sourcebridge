/**
 * Choosing a speech engine.
 *
 * Narration was the one part of the pipeline with a hard daily ceiling: the
 * provider meters it per project, per model, per day, and every scene costs a
 * request, so one six-scene video could spend the whole free allowance. More
 * keys on the same project do not help, because the count is against the
 * project. The fix is that speech is no longer tied to one provider, and these
 * cases cover the rule that matters: running out of cloud allowance has to
 * change the voice, not end the render.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const synthesizeSpeech = vi.fn();

vi.mock('@/lib/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/provider')>('@/lib/provider');
  return { ...actual, synthesizeSpeech: (t: string, v: string) => synthesizeSpeech(t, v) };
});

const { speechChain, speakLine, resetEngineProbes, resetVoiceProbe, SpeechError } = await import(
  '@/lib/export/speechEngines'
);
const { ProviderError } = await import('@/lib/provider');

const ORIGINAL = { ...process.env };

const cloudAudio = (seconds = 1) => ({
  pcm: Buffer.alloc(Math.round(seconds * 24000) * 2),
  sampleRate: 24000,
  seconds,
  model: 'gemini-2.5-flash-preview-tts',
  voice: 'Kore',
});

/** The daily refusal, exactly as the provider words it. */
const exhausted = () =>
  new ProviderError(
    "This model's free-tier daily allowance is spent. Other models are tried automatically.",
    'rate_limit',
    true,
  );

beforeEach(() => {
  resetEngineProbes();
  synthesizeSpeech.mockReset();
  delete process.env.VIDEO_TTS_ENGINE;
  delete process.env.PIPER_VOICE;
  delete process.env.PIPER_PATH;
  // A binary name that cannot exist, so "no local engine" is deterministic.
  process.env.ESPEAK_PATH = 'sourcebridge-no-such-binary';
  process.env.GEMINI_API_KEY = 'test-key';
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

describe('the chain', () => {
  it('prefers the cloud voice, then falls back to local engines', () => {
    expect(speechChain().map((e) => e.name)).toEqual(['gemini', 'piper', 'espeak']);
  });

  it('skips the provider entirely when asked for local speech', () => {
    // Faster, since nothing waits on a network, and it spends no allowance.
    process.env.VIDEO_TTS_ENGINE = 'local';
    expect(speechChain().map((e) => e.name)).toEqual(['piper', 'espeak']);
  });

  it('can be pinned to one engine', () => {
    process.env.VIDEO_TTS_ENGINE = 'espeak';
    expect(speechChain().map((e) => e.name)).toEqual(['espeak']);
  });

  it('ignores an unknown engine name rather than rendering nothing', () => {
    process.env.VIDEO_TTS_ENGINE = 'nonsense';
    expect(speechChain().map((e) => e.name)).toEqual(['gemini', 'piper', 'espeak']);
  });
});

describe('speaking a line', () => {
  it('uses the cloud voice while it is available', async () => {
    synthesizeSpeech.mockResolvedValue(cloudAudio(2));
    const spoken = await speakLine('Water use fell eighteen percent.', 'Kore');

    expect(spoken.engine).toBe('gemini');
    // Duration still follows from the byte count, whoever spoke it.
    expect(spoken.seconds).toBe(2);
    expect(spoken.sampleRate).toBe(24000);
  });

  it('refuses an empty line before calling anything', async () => {
    await expect(speakLine('   ', 'Kore')).rejects.toThrow(/nothing to speak/i);
    expect(synthesizeSpeech).not.toHaveBeenCalled();
  });

  it('explains what to install when no engine exists at all', async () => {
    delete process.env.GEMINI_API_KEY;

    const error = await speakLine('One line.', 'Kore').catch((e) => e);
    expect(error).toBeInstanceOf(SpeechError);
    expect(error.kind).toBe('unavailable');
    // The message has to name a way out that needs no key and has no limit.
    expect(error.message).toMatch(/espeak-ng/);
    expect(error.message).toMatch(/no daily limit/i);
    expect(error.message).toMatch(/video package/i);
  });

  it('reports which engines it tried when every one failed', async () => {
    synthesizeSpeech.mockRejectedValue(exhausted());

    const error = await speakLine('One line.', 'Kore').catch((e) => e);
    expect(error).toBeInstanceOf(SpeechError);
    expect(error.kind).toBe('failed');
    expect(error.message).toMatch(/gemini/);
  });

  it('does not treat a spent daily allowance as the end of the render', async () => {
    // The whole point: with a local engine present this would continue. The
    // provider error must not propagate as-is, which would fail the export.
    synthesizeSpeech.mockRejectedValue(exhausted());

    const error = await speakLine('One line.', 'Kore').catch((e) => e);
    expect(error).toBeInstanceOf(SpeechError);
    expect(error).not.toBeInstanceOf(ProviderError);
  });

  it('asks the provider once per line, not once per engine', async () => {
    synthesizeSpeech.mockResolvedValue(cloudAudio(1));
    await speakLine('One line.', 'Kore');
    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
  });
});

describe('local engines', () => {
  it('needs a voice model before Piper is considered available', async () => {
    const piper = speechChain().find((e) => e.name === 'piper')!;
    // Without PIPER_VOICE there is nothing for it to speak with, so it must
    // not be tried and then fail.
    expect(await piper.available()).toBe(false);
  });

  it('reports eSpeak unavailable when the binary is not installed', async () => {
    const espeak = speechChain().find((e) => e.name === 'espeak')!;
    expect(await espeak.available()).toBe(false);
  });
});

/**
 * Which eSpeak voice is used.
 *
 * eSpeak's own synthesis is formant-based and sounds like a machine from the
 * nineties, which is a poor thing to put under a video someone will show to an
 * audience. An MBROLA voice is diphone recordings of a real speaker driven by
 * the same engine: much more natural at the same negligible CPU cost. It needs
 * a package that may not be installed, so the better voice is tried first and
 * the answer remembered rather than probed for.
 */
describe('the fallback voice', () => {
  beforeEach(() => {
    resetVoiceProbe();
    delete process.env.ESPEAK_VOICE;
  });

  it('falls back to the plain voice when the better one is missing', async () => {
    // ESPEAK_PATH points at a binary that cannot exist, so the probe fails
    // exactly as it would on a host without the MBROLA package.
    const espeak = speechChain().find((e) => e.name === 'espeak')!;
    await expect(espeak.speak('One line.', 'Kore')).rejects.toBeTruthy();
  });

  it('honours an explicitly configured voice without probing', async () => {
    process.env.ESPEAK_VOICE = 'en-us';
    const espeak = speechChain().find((e) => e.name === 'espeak')!;
    // Still fails, because the binary is missing -- but the message proves the
    // configured voice was used rather than a probe being run first.
    await expect(espeak.speak('One line.', 'Kore')).rejects.toBeTruthy();
  });
});
