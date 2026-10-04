import { describe, expect, it } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import {
  VideoRenderError,
  canRenderText,
  cuesForScene,
  isFfmpegAvailable,
  renderVideo,
  resetFontProbe,
  srtTimestamp,
} from '@/lib/export/video';
import { svgFontStack } from '@/lib/export/fonts';
import { FRAME_HEIGHT, FRAME_WIDTH, renderSceneCardSvg, renderTitleCardSvg } from '@/lib/export/sceneCard';
import type { VideoPackage } from '@/lib/schemas';

const scene: VideoPackage['scenes'][number] = {
  index: 2,
  heading: 'Water use fell 18 percent',
  estimatedSeconds: 12,
  narration:
    'Average household water consumption fell by eighteen percent. Daily use dropped from 412 litres to 338 litres.',
  onScreenText: '412 L → 338 L per household per day',
  visualRecommendation: 'Animated bar chart.',
  evidence: ['src-1-p2-2'],
};

const pkg: VideoPackage = {
  title: 'Rainwater Harvesting Pilot',
  objective: 'Explain what the pilot found',
  scenes: [scene],
  fullScript: scene.narration,
};

describe('subtitle timing', () => {
  it('formats SRT timestamps', () => {
    expect(srtTimestamp(0)).toBe('00:00:00,000');
    expect(srtTimestamp(6.85)).toBe('00:00:06,850');
    expect(srtTimestamp(125.5)).toBe('00:02:05,500');
    expect(srtTimestamp(3661.25)).toBe('01:01:01,250');
  });

  it('distributes the measured duration across cues, losing none of it', () => {
    const measured = 9.4;
    const cues = cuesForScene(scene.narration, measured);

    expect(cues.length).toBeGreaterThan(1);
    const total = cues.reduce((sum, c) => sum + c.seconds, 0);
    // The whole scene is covered; nothing is dropped or invented.
    expect(total).toBeCloseTo(measured, 5);
  });

  it('gives a longer cue more time than a shorter one', () => {
    const [short, long] = cuesForScene('Short one. A considerably longer sentence than the first.', 10);
    expect(long.seconds).toBeGreaterThan(short.seconds);
  });

  it('splits a sentence too long for one subtitle line', () => {
    const wordy = `${'word '.repeat(60)}.`;
    const cues = cuesForScene(wordy, 12);

    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) expect(cue.text.length).toBeLessThanOrEqual(90);
  });

  it('handles narration with no sentence punctuation', () => {
    const cues = cuesForScene('a single clause with no full stop', 4);
    expect(cues).toHaveLength(1);
    expect(cues[0].seconds).toBeCloseTo(4, 5);
  });
});

describe('when ffmpeg is unavailable', () => {
  it('reports it as unavailable rather than throwing', async () => {
    const original = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = 'definitely-not-ffmpeg-xyz';
    try {
      // spawn raises ENOENT for a missing binary; that must not escape.
      await expect(isFfmpegAvailable()).resolves.toBe(false);
    } finally {
      process.env.FFMPEG_PATH = original;
    }
  });

  it('explains the gap and points at the package instead', async () => {
    const original = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = 'definitely-not-ffmpeg-xyz';
    try {
      await renderVideo(pkg);
      throw new Error('expected a VideoRenderError');
    } catch (err) {
      expect(err).toBeInstanceOf(VideoRenderError);
      const error = err as VideoRenderError;
      expect(error.kind).toBe('no_ffmpeg');
      // The operator is told what to do, and that a usable export still exists.
      expect(error.message).toMatch(/ffmpeg/i);
      expect(error.message).toMatch(/video package/i);
    } finally {
      process.env.FFMPEG_PATH = original;
    }
  });

  it('rejects a package with no scenes before touching ffmpeg', async () => {
    await expect(renderVideo({ ...pkg, scenes: [] })).rejects.toMatchObject({
      kind: 'invalid_input',
    });
  });
});

describe('scene frames', () => {
  it('prints figures exactly as given, never re-rendered by a model', () => {
    const svg = renderSceneCardSvg(scene, { position: 'Scene 2 of 3', footer: 'Source: report.pdf' });

    expect(svg).toContain('412 L');
    expect(svg).toContain('338 L');
    expect(svg).toContain('Water use fell 18 percent');
    expect(svg).toContain('SCENE 2 OF 3');
  });

  it('escapes text so a frame cannot be broken by content', () => {
    const svg = renderSceneCardSvg({
      ...scene,
      heading: 'Water & sanitation',
      onScreenText: '<script>alert(1)</script>',
    });

    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('rasterises to a real PNG at broadcast size', () => {
    const png = new Resvg(renderSceneCardSvg(scene), {
      fitTo: { mode: 'width', value: FRAME_WIDTH },
    }).render();

    expect(png.width).toBe(FRAME_WIDTH);
    expect(png.height).toBe(FRAME_HEIGHT);
    expect(png.asPng().subarray(1, 4).toString()).toBe('PNG');
  });

  it('renders a title card carrying the objective', () => {
    const svg = renderTitleCardSvg(pkg, 'Source: report.pdf');

    expect(svg).toContain('Rainwater Harvesting Pilot');
    expect(svg).toContain('Explain what the pilot found');
    expect(svg).toContain('Source: report.pdf');
  });

  it('does not spill an overlong heading off the frame', () => {
    const svg = renderSceneCardSvg({ ...scene, heading: 'A'.repeat(300) });
    // Wrapped to a line budget and truncated, rather than running past the edge.
    expect(svg).toContain('…');
    expect(svg).not.toContain('A'.repeat(300));
  });
});

/**
 * Text on the frames.
 *
 * resvg draws text only with a font it can find, and a minimal container image
 * ships none -- node:22-alpine has zero. When the family in the SVG resolves to
 * nothing, resvg neither warns nor substitutes: it draws no glyphs. The render
 * then succeeds, the file plays, and the viewer gets narration over blank
 * slides. Nothing in the pipeline reports it, which is why it reached a
 * deployment and why the renderer now refuses rather than producing one.
 */
describe('frames without a usable font', () => {
  const probe = (text: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80">` +
    `<text x="8" y="56" font-family="${svgFontStack('latin')}" font-size="48" fill="#000">${text}</text></svg>`;

  it('draws glyphs when a font is available', () => {
    const drawn = new Resvg(probe('Ag8'), { font: { loadSystemFonts: true } }).render().asPng();
    const blank = new Resvg(probe(''), { font: { loadSystemFonts: true } }).render().asPng();
    expect(Buffer.compare(Buffer.from(drawn), Buffer.from(blank))).not.toBe(0);
  });

  it('is detectable: no font means the text contributes nothing at all', () => {
    // Exactly the container case, reproduced by denying resvg system fonts.
    const drawn = new Resvg(probe('Ag8'), { font: { loadSystemFonts: false } }).render().asPng();
    const blank = new Resvg(probe(''), { font: { loadSystemFonts: false } }).render().asPng();
    expect(Buffer.compare(Buffer.from(drawn), Buffer.from(blank))).toBe(0);
  });

  it('reports this machine can draw text, so the other cases mean something', () => {
    resetFontProbe();
    expect(canRenderText()).toBe(true);
  });

  it('reports a host with no font at all', () => {
    // Exactly the container case: no system fonts and no font directory.
    process.env.VIDEO_FONT_LOAD_SYSTEM = '0';
    resetFontProbe();
    try {
      expect(canRenderText()).toBe(false);
    } finally {
      delete process.env.VIDEO_FONT_LOAD_SYSTEM;
      resetFontProbe();
    }
  });

  it('refuses the render, naming the fix, before spending any speech quota', async () => {
    process.env.VIDEO_FONT_LOAD_SYSTEM = '0';
    resetFontProbe();
    try {
      // The message has to say what went wrong, what to do about it on the
      // hosts this actually happens on, and that the package export still works.
      await expect(renderVideo(pkg)).rejects.toThrow(/no font available/i);
      await expect(renderVideo(pkg)).rejects.toThrow(/apk add font-noto|fonts-noto-core/);
      await expect(renderVideo(pkg)).rejects.toThrow(/video package/i);
      await expect(renderVideo(pkg)).rejects.toBeInstanceOf(VideoRenderError);
    } finally {
      delete process.env.VIDEO_FONT_LOAD_SYSTEM;
      resetFontProbe();
    }
  });

});
