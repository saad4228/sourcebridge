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
  constructor(message: string, readonly kind: 'no_ffmpeg' | 'render_failed' | 'invalid_input') {
    super(message);
    this.name = 'VideoRenderError';
  }
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
  if (!(await isFfmpegAvailable())) {
    throw new VideoRenderError(
      'Rendering an MP4 needs ffmpeg, which is not available on this host. Install ffmpeg (or set ' +
        'FFMPEG_PATH), or download the video package instead — it contains the script, storyboard, ' +
        'narration and subtitles.',
      'no_ffmpeg',
    );
  }

  const voice = options.voice?.trim() || 'Kore';
  const dir = await mkdtemp(path.join(tmpdir(), 'sourcebridge-video-'));

  try {
    const footer = options.sourceTitle ? `Source: ${options.sourceTitle}` : undefined;

    // --- Speak each scene, measuring its real duration ---------------------
    const audio: Buffer[] = [];
    const durations: { index: number; seconds: number }[] = [];
    let sampleRate = 24000;
    let ttsModel = '';

    for (const [i, scene] of scenes.entries()) {
      options.onProgress?.(`Speaking scene ${i + 1} of ${scenes.length}`);
      const speech = await speakScene(scene.narration, voice);
      audio.push(speech.pcm);
      durations.push({ index: scene.index, seconds: speech.seconds });
      sampleRate = speech.sampleRate;
      ttsModel = speech.model;
    }

    // Silence under the title card, in the same PCM format as the speech.
    const titleSilence = Buffer.alloc(Math.round(TITLE_SECONDS * sampleRate) * 2);
    await writeFile(path.join(dir, 'audio.pcm'), Buffer.concat([titleSilence, ...audio]));

    // --- Draw every frame --------------------------------------------------
    options.onProgress?.('Drawing frames');
    const rasterise = (svg: string) =>
      new Resvg(svg, { fitTo: { mode: 'width', value: renderWidth() } }).render().asPng();

    await writeFile(path.join(dir, 'frame00.png'), rasterise(renderTitleCardSvg(content, footer)));
    for (const [i, scene] of scenes.entries()) {
      const svg = renderSceneCardSvg(scene, {
        position: `Scene ${i + 1} of ${scenes.length}`,
        footer,
      });
      await writeFile(path.join(dir, `frame${String(i + 1).padStart(2, '0')}.png`), rasterise(svg));
    }

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
        '-pix_fmt', 'yuv420p',
        // Even dimensions are required by yuv420p.
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=25',
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
