/**
 * Rendered MP4 export.
 *
 * Narration is spoken by the provider's TTS model; every frame is drawn by our
 * own renderer; ffmpeg composites the two. The model never draws a figure, so
 * numbers on screen are exactly the numbers in the source.
 *
 * The point of rendering audio is honesty as much as output: because the PCM
 * byte count gives each scene's true duration, the subtitles shipped with the
 * video are aligned to real audio rather than to a words-per-minute estimate.
 *
 * Requires ffmpeg on the host. This is a local/Docker feature: serverless
 * platforms generally do not provide it, and the caller reports that plainly
 * rather than failing obscurely.
 */

import 'server-only';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import type { VideoPackage } from '../schemas';
import { synthesizeSpeech, type SpeechResult } from '../provider';
import { FRAME_WIDTH, renderSceneCardSvg, renderTitleCardSvg } from './sceneCard';
import { svgFontStack } from './fonts';

/**
 * Raster width for the frames, independent of the layout.
 *
 * The scene cards are authored in a 1920x1080 coordinate space and rasterised
 * to whatever width is asked for, so lowering this changes the output
 * resolution and nothing about the design.
 *
 * It exists because memory, not time, is what limits a render on a small host.
 * Measured against a 512 MB container: one, two and three scenes rendered at
 * 1920 in 78 to 149 seconds, and four scenes died after 54 -- failing sooner
 * than the longer runs that succeeded, which is a crash rather than a timeout.
 * At 1280 each frame costs 55% fewer pixels.
 *
 * Left at 1920 by default, since a machine with room should produce full HD.
 * Set VIDEO_RENDER_WIDTH=1280 where memory is tight.
 */
function renderWidth(): number {
  const configured = Number(process.env.VIDEO_RENDER_WIDTH);
  return Number.isFinite(configured) && configured >= 640 ? Math.round(configured) : FRAME_WIDTH;
}

/** Scenes beyond this make the render slow and the quota cost high. */
export const MAX_SCENES = 8;

/**
 * How many scenes are spoken at once.
 *
 * Speech is essentially the whole render. Measured on six scenes: 33.2s to
 * speak them one after another, against 1.8s to draw all seven frames and
 * under a second to encode. Each call waits on the provider rather than on
 * this machine, so they overlap almost perfectly and nothing else in the
 * pipeline is the constraint.
 *
 * Four rather than all of them at once: the per-minute allowance is shared
 * with everything else the deployment is doing, and a burst that trips a rate
 * limit costs more in retries than it saves in wall clock. Raise it with
 * VIDEO_TTS_CONCURRENCY where the allowance is known to be generous.
 */
function speechConcurrency(): number {
  const configured = Number(process.env.VIDEO_TTS_CONCURRENCY);
  if (Number.isFinite(configured) && configured >= 1) return Math.min(Math.round(configured), 8);
  return 4;
}
/** How long the title card holds before the first narrated scene. */
const TITLE_SECONDS = 2.5;

/**
 * Narration already spoken, so a failed render does not pay for it twice.
 *
 * Speech is metered per model per day and every scene costs one call, so a
 * six-scene package spends six of a small daily allowance. Before this, a
 * render that failed on the last scene threw away the five calls that had
 * already succeeded, and the retry bought them again -- which is how two
 * attempts at one video could exhaust a day's capacity.
 *
 * Keyed by the voice and the exact narration, so an edited scene is correctly
 * re-spoken while the untouched ones are reused. Entries are dropped oldest
 * first past the byte cap; losing one only costs a call that would have been
 * made anyway.
 */
const SPEECH_CACHE_MAX_BYTES = 48 * 1024 * 1024;
const speechCache = new Map<string, SpeechResult>();
let speechCacheBytes = 0;

function speechKey(text: string, voice: string): string {
  return createHash('sha256').update(`${voice}\u0000${text.trim()}`).digest('hex');
}

function cacheSpeech(key: string, speech: SpeechResult): void {
  // Never cache something that cannot be evicted back under the cap.
  if (speech.pcm.byteLength > SPEECH_CACHE_MAX_BYTES) return;

  speechCache.set(key, speech);
  speechCacheBytes += speech.pcm.byteLength;

  for (const [oldest, entry] of speechCache) {
    if (speechCacheBytes <= SPEECH_CACHE_MAX_BYTES) break;
    if (oldest === key) continue;
    speechCache.delete(oldest);
    speechCacheBytes -= entry.pcm.byteLength;
  }
}

/**
 * Speak a scene, reusing the audio if this exact narration was spoken before.
 *
 * Exported for tests: whether a retry re-pays for narration already spoken is
 * what decides how many videos a day a free key can render, which is worth
 * asserting without standing up ffmpeg and a real encode.
 */
export async function speakScene(text: string, voice: string): Promise<SpeechResult> {
  const key = speechKey(text, voice);
  const cached = speechCache.get(key);
  if (cached) return cached;

  const speech = await synthesizeSpeech(text, voice);
  cacheSpeech(key, speech);
  return speech;
}

/** Visible to tests, which must not inherit audio cached by another case. */
export function resetSpeechCache(): void {
  speechCache.clear();
  speechCacheBytes = 0;
}

export class VideoRenderError extends Error {
  constructor(
    message: string,
    readonly kind: 'no_ffmpeg' | 'no_fonts' | 'render_failed' | 'invalid_input',
  ) {
    super(message);
    this.name = 'VideoRenderError';
  }
}

/**
 * Font family the frames ask for, and what resvg falls back to.
 *
 * resvg draws text only with a font it can actually find. A minimal container
 * image has none at all -- node:22-alpine ships zero -- and when the family in
 * the SVG resolves to nothing, resvg does not warn or substitute: it draws no
 * glyphs. The result rendered and played perfectly, with narration over blank
 * slides, which is the worst way for this to fail because nothing reports it.
 */
const DEFAULT_FONT_FAMILY = process.env.VIDEO_FONT_FAMILY?.trim() || 'Noto Sans';

/**
 * Font options shared by every rasterisation, so frames never vary by host.
 *
 * Setting VIDEO_FONT_DIR and VIDEO_FONT_LOAD_SYSTEM=0 together pins rendering
 * to exactly the supplied font files, which is what a deployment wanting
 * byte-identical frames across hosts should do: system fonts differ between
 * machines, so the same deck can wrap differently on two of them.
 */
function fontOptions() {
  return {
    loadSystemFonts: process.env.VIDEO_FONT_LOAD_SYSTEM?.trim() !== '0',
    defaultFontFamily: DEFAULT_FONT_FAMILY,
    ...(process.env.VIDEO_FONT_DIR?.trim()
      ? { fontDirs: [process.env.VIDEO_FONT_DIR.trim()] }
      : {}),
  };
}

/**
 * Whether this host can draw text at all.
 *
 * Rasterises the same string twice, once with text and once without, and
 * compares the output. Identical bytes mean the glyphs contributed nothing,
 * which is exactly the silent-blank-slide failure. Cheap, and it asks resvg
 * the question directly rather than trusting a font list.
 *
 * Cached: the answer cannot change while the process runs, and a render would
 * otherwise repeat it per frame.
 */
let fontProbe: boolean | undefined;

export function canRenderText(): boolean {
  if (fontProbe !== undefined) return fontProbe;

  const probe = (text: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80">` +
    `<text x="8" y="56" font-family="${svgFontStack('latin')}" font-size="48" fill="#000">${text}</text></svg>`;

  try {
    const drawn = new Resvg(probe('Ag8'), { font: fontOptions() }).render().asPng();
    const blank = new Resvg(probe(''), { font: fontOptions() }).render().asPng();
    fontProbe = Buffer.compare(Buffer.from(drawn), Buffer.from(blank)) !== 0;
  } catch {
    fontProbe = false;
  }
  return fontProbe;
}

/** Visible to tests, which need to probe more than one font configuration. */
export function resetFontProbe(): void {
  fontProbe = undefined;
}

/** Resolve ffmpeg, allowing an explicit override for hosts that place it oddly. */
function ffmpegPath(): string {
  return process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
}

function run(bin: string, args: string[], cwd?: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      // ffmpeg is extremely chatty; keep only the tail for diagnostics.
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stderr }));
  });
}

/** True when ffmpeg can be invoked on this host. */
export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    const { code } = await run(ffmpegPath(), ['-version']);
    return code === 0;
  } catch {
    return false;
  }
}

export function srtTimestamp(totalSeconds: number): string {
  const ms = Math.round((totalSeconds % 1) * 1000);
  const whole = Math.floor(totalSeconds);
  const h = String(Math.floor(whole / 3600)).padStart(2, '0');
  const m = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
  const s = String(whole % 60).padStart(2, '0');
  return `${h}:${m}:${s},${String(ms).padStart(3, '0')}`;
}

/**
 * Split a scene's narration into subtitle cues and distribute that scene's
 * MEASURED duration across them in proportion to their length.
 */
export function cuesForScene(narration: string, seconds: number): { text: string; seconds: number }[] {
  const sentences = narration
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const cues: string[] = [];
  for (const sentence of sentences.length ? sentences : [narration.trim()]) {
    if (sentence.length <= 90) {
      cues.push(sentence);
      continue;
    }
    let chunk = '';
    for (const word of sentence.split(/\s+/)) {
      const candidate = chunk ? `${chunk} ${word}` : word;
      if (candidate.length > 90) {
        cues.push(chunk);
        chunk = word;
      } else {
        chunk = candidate;
      }
    }
    if (chunk) cues.push(chunk);
  }

  const totalChars = cues.reduce((sum, c) => sum + c.length, 0) || 1;
  return cues.filter(Boolean).map((text) => ({ text, seconds: (text.length / totalChars) * seconds }));
}

export interface RenderedVideo {
  mp4: Uint8Array;
  /** Subtitles aligned to the audio actually produced. */
  srt: string;
  /** Measured, not estimated. */
  totalSeconds: number;
  scenes: { index: number; seconds: number }[];
  voice: string;
  ttsModel: string;
  /**
   * Scenes the package carried that the video does not.
   *
   * The renderer caps a video at MAX_SCENES, but a Detailed package can hold
   * up to twelve scenes. Dropping four of them silently gave an MP4 that just
   * stopped early with nothing to explain why, so the count is reported and
   * the interface says so.
   */
  droppedScenes: number;
}

export interface RenderVideoOptions {
  voice?: string;
  sourceTitle?: string | null;
  /** Reports progress so a long render is not a silent wait. */
  onProgress?: (message: string) => void;
}

/**
 * Speak every scene, draw every frame, and composite them into an MP4.
 */
export async function renderVideo(
  content: VideoPackage,
  options: RenderVideoOptions = {},
): Promise<RenderedVideo> {
  const all = content.scenes ?? [];
  const scenes = all.slice(0, MAX_SCENES);
  const droppedScenes = all.length - scenes.length;
  if (scenes.length === 0) {
    throw new VideoRenderError('This video package has no scenes to render.', 'invalid_input');
  }
  // Both host requirements are checked together, and before any speech is
  // spent. Reporting only the first meant a host missing both was told to
  // install ffmpeg, and then -- after doing so and waiting out another render
  // -- told about fonts. They are one setup problem and read as one message.
  const missing: string[] = [];

  if (!(await isFfmpegAvailable())) {
    missing.push(
      'ffmpeg is not available (install it, or set FFMPEG_PATH to the binary)',
    );
  }
  // A silent video of blank slides is worse than no video: it plays, so
  // nothing reports that it is broken.
  if (!canRenderText()) {
    missing.push(
      'no font available, so every frame would render with no text on it — narration over ' +
        'blank slides (on Alpine: `apk add font-noto`; on Debian: `apt install fonts-noto-core`; ' +
        'or set VIDEO_FONT_DIR to a directory of font files)',
    );
  }

  if (missing.length > 0) {
    throw new VideoRenderError(
      `This host cannot render an MP4: ${missing.join('; and ')}. Download the video package ` +
        `instead — it contains the script, storyboard, narration and subtitles, and needs neither.`,
      missing.length > 1 || /ffmpeg/.test(missing[0]) ? 'no_ffmpeg' : 'no_fonts',
    );
  }

  const voice = options.voice?.trim() || 'Kore';
  const dir = await mkdtemp(path.join(tmpdir(), 'sourcebridge-video-'));

  try {
    const footer = options.sourceTitle ? `Source: ${options.sourceTitle}` : undefined;

    // --- Draw every frame --------------------------------------------------
    // Frames depend on the script, not on the audio, so they are drawn while
    // the provider is still speaking rather than after it. Costs nothing and
    // takes the whole drawing stage off the clock.
    const rasterise = (svg: string) =>
      new Resvg(svg, {
        fitTo: { mode: 'width', value: renderWidth() },
        font: fontOptions(),
      })
        .render()
        .asPng();

    const drawing = (async () => {
      await writeFile(path.join(dir, 'frame00.png'), rasterise(renderTitleCardSvg(content, footer)));
      for (const [i, scene] of scenes.entries()) {
        const svg = renderSceneCardSvg(scene, {
          position: `Scene ${i + 1} of ${scenes.length}`,
          footer,
        });
        await writeFile(path.join(dir, `frame${String(i + 1).padStart(2, '0')}.png`), rasterise(svg));
      }
    })();

    // --- Speak every scene, measuring its real duration --------------------
    // Spoken concurrently: each call waits on the provider, not on this
    // machine, so overlapping them turns the dominant cost of a render from
    // the sum of the scenes into roughly the slowest few.
    options.onProgress?.(`Speaking ${scenes.length} scene${scenes.length > 1 ? 's' : ''}`);

    const spoken = new Array<SpeechResult>(scenes.length);
    let done = 0;
    const queue = scenes.map((scene, i) => ({ scene, i }));

    await Promise.all(
      Array.from({ length: Math.min(speechConcurrency(), queue.length) }, async () => {
        for (;;) {
          const next = queue.shift();
          if (!next) return;
          spoken[next.i] = await speakScene(next.scene.narration, voice);
          done += 1;
          // Reports completions rather than starts: with several in flight at
          // once, "scene 3 of 6" would otherwise jump about and go backwards.
          options.onProgress?.(`Speaking scene ${done} of ${scenes.length}`);
        }
      }),
    );

    const durations = scenes.map((scene, i) => ({
      index: scene.index,
      seconds: spoken[i].seconds,
    }));
    const sampleRate = spoken[0].sampleRate;
    const ttsModel = spoken[0].model;

    // Silence under the title card, in the same PCM format as the speech.
    const titleSilence = Buffer.alloc(Math.round(TITLE_SECONDS * sampleRate) * 2);
    await writeFile(
      path.join(dir, 'audio.pcm'),
      Buffer.concat([titleSilence, ...spoken.map((s) => s.pcm)]),
    );

    options.onProgress?.('Drawing frames');
    await drawing;

    // --- Frame list, timed to the measured audio ---------------------------
    const entries = [
      { file: 'frame00.png', seconds: TITLE_SECONDS },
      ...durations.map((d, i) => ({ file: `frame${String(i + 1).padStart(2, '0')}.png`, seconds: d.seconds })),
    ];
    const concat =
      entries.map((e) => `file '${e.file}'\nduration ${e.seconds.toFixed(3)}`).join('\n') +
      // The concat demuxer ignores the final entry's duration unless the last
      // file is repeated, which would otherwise clip the closing scene.
      `\nfile '${entries[entries.length - 1].file}'\n`;
    await writeFile(path.join(dir, 'frames.txt'), concat);

    // --- Composite ---------------------------------------------------------
    options.onProgress?.('Encoding video');
    const { code, stderr } = await run(
      ffmpegPath(),
      [
        '-y',
        '-f', 'concat', '-safe', '0', '-i', 'frames.txt',
        '-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', 'audio.pcm',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        // The frames are static slides, so x264's still-image tuning fits what
        // it is actually encoding, and 25 fps spends frames on content that
        // never moves. At 10 the file is markedly smaller and the encode does
        // less work on a small host, with nothing to see at the higher rate.
        '-tune', 'stillimage',
        '-pix_fmt', 'yuv420p',
        // Even dimensions are required by yuv420p.
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=10',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-shortest',
        '-movflags', '+faststart',
        'out.mp4',
      ],
      dir,
    );

    if (code !== 0) {
      throw new VideoRenderError(
        `ffmpeg could not encode the video (exit ${code}). ${stderr.split('\n').slice(-3).join(' ').trim()}`,
        'render_failed',
      );
    }

    // --- Subtitles from the measured durations -----------------------------
    let clock = TITLE_SECONDS;
    let index = 1;
    const blocks: string[] = [];
    for (const [i, scene] of scenes.entries()) {
      for (const cue of cuesForScene(scene.narration, durations[i].seconds)) {
        blocks.push(`${index}\n${srtTimestamp(clock)} --> ${srtTimestamp(clock + cue.seconds)}\n${cue.text}`);
        clock += cue.seconds;
        index += 1;
      }
    }

    const mp4 = new Uint8Array(await readFile(path.join(dir, 'out.mp4')));
    return {
      mp4,
      srt: `${blocks.join('\n\n')}\n`,
      totalSeconds: clock,
      scenes: durations,
      voice,
      ttsModel,
      droppedScenes,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
