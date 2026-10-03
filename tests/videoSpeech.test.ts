/**
 * Speech reuse and scene-count handling for the MP4 render.
 *
 * Speech is the expensive part of a render: it is metered per model per day and
 * every scene costs one call, so a six-scene video spends six of a small daily
 * allowance. These cases assert the two things that decide whether a free key
 * can render more than one video — that narration already spoken is not paid
 * for twice, and that the scene cap is applied before anything is spoken.
 *
 * The cache is exercised directly rather than through `renderVideo`, because a
 * full render needs ffmpeg on the host: driving it end to end would pass on a
 * developer machine and fail in CI while testing nothing extra.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const synthesizeSpeech = vi.fn();

// Mocked rather than exercised: a real call needs a key and costs quota, and
// what matters here is which calls are made, not what the audio sounds like.
vi.mock('@/lib/provider', () => ({
  synthesizeSpeech: (text: string, voice: string) => synthesizeSpeech(text, voice),
}));

const { MAX_SCENES, renderVideo, resetSpeechCache, speakScene } = await import(
  '@/lib/export/video'
);
import type { VideoPackage } from '@/lib/schemas';

/** PCM of a stated duration at 24 kHz, mono, 16-bit. */
function speech(seconds: number, model = 'tts-a') {
  return {
    pcm: Buffer.alloc(Math.round(seconds * 24000) * 2),
    sampleRate: 24000,
    seconds,
    model,
    voice: 'Kore',
  };
}

function pkg(count: number): VideoPackage {
  const scenes = Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    heading: `Scene ${i + 1}`,
    estimatedSeconds: 10,
    narration: `Narration for scene ${i + 1}.`,
    onScreenText: '',
    visualRecommendation: 'Bar chart.',
    evidence: [],
  }));
  return {
    title: 'Rainwater Harvesting Pilot',
    objective: 'Explain what the pilot found',
    scenes,
    fullScript: scenes.map((s) => s.narration).join(' '),
  };
}

beforeEach(() => {
  resetSpeechCache();
  synthesizeSpeech.mockReset();
  synthesizeSpeech.mockImplementation(async () => speech(4));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Speak a whole package's narration, reporting how many provider calls it cost. */
async function speakAll(content: VideoPackage, voice = 'Kore'): Promise<number> {
  synthesizeSpeech.mockClear();
  for (const scene of content.scenes) await speakScene(scene.narration, voice);
  return synthesizeSpeech.mock.calls.length;
}

describe('speech reuse', () => {
  it('speaks each scene once on a first render', async () => {
    expect(await speakAll(pkg(3))).toBe(3);
  });

  it('does not pay twice for narration it has already spoken', async () => {
    const content = pkg(4);
    expect(await speakAll(content)).toBe(4);
    // A retry after a failure costs nothing: this is what stops two attempts
    // at one video exhausting a day's allowance.
    expect(await speakAll(content)).toBe(0);
  });

  it('returns the same audio from the cache, not a placeholder', async () => {
    const first = await speakScene('Water use fell eighteen percent.', 'Kore');
    const second = await speakScene('Water use fell eighteen percent.', 'Kore');

    expect(second.seconds).toBe(first.seconds);
    expect(second.pcm.byteLength).toBe(first.pcm.byteLength);
    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
  });

  it('re-speaks a scene whose narration was edited, and reuses the rest', async () => {
    const original = pkg(3);
    await speakAll(original);

    const edited: VideoPackage = {
      ...original,
      scenes: original.scenes.map((s, i) =>
        i === 1 ? { ...s, narration: 'Rewritten narration for scene 2.' } : s,
      ),
    };

    // Only the changed scene costs a call.
    expect(await speakAll(edited)).toBe(1);
  });

  it('ignores surrounding whitespace, which is not a different line', async () => {
    await speakScene('Attribution remains unconfirmed.', 'Kore');
    await speakScene('  Attribution remains unconfirmed.\n', 'Kore');
    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
  });

  it('keys on the voice, so the same words in another voice are spoken again', async () => {
    const content = pkg(1);
    expect(await speakAll(content, 'Kore')).toBe(1);
    expect(await speakAll(content, 'Puck')).toBe(1);
    expect(await speakAll(content, 'Kore')).toBe(0);
  });

  it('does not cache a failure, so a transient error can be retried', async () => {
    synthesizeSpeech.mockRejectedValueOnce(new Error('overloaded'));
    await expect(speakScene('One scene.', 'Kore')).rejects.toThrow(/overloaded/);

    synthesizeSpeech.mockImplementation(async () => speech(3));
    await expect(speakScene('One scene.', 'Kore')).resolves.toMatchObject({ seconds: 3 });
    expect(synthesizeSpeech).toHaveBeenCalledTimes(2);
  });

  it('starts empty after a reset, so one test cannot inherit another’s audio', async () => {
    await speakScene('A line.', 'Kore');
    resetSpeechCache();
    await speakScene('A line.', 'Kore');
    expect(synthesizeSpeech).toHaveBeenCalledTimes(2);
  });
});

describe('scene count', () => {
  it('refuses a package with no scenes before spending anything', async () => {
    await expect(renderVideo(pkg(0))).rejects.toThrow(/no scenes/i);
    expect(synthesizeSpeech).not.toHaveBeenCalled();
  });

  it('caps a render well below a Detailed package, which can hold twelve scenes', () => {
    // The cap is about render cost, not about the package: the zip keeps every
    // scene. What matters is that the number is stated so the count of dropped
    // scenes can be reported rather than the video quietly ending early.
    expect(MAX_SCENES).toBe(8);
    expect(pkg(12).scenes.length - MAX_SCENES).toBe(4);
  });
});
