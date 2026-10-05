/**
 * Where narration comes from.
 *
 * Speech was the one part of the pipeline with a hard daily ceiling. The
 * provider meters it per project, per model, per day -- the refusal names the
 * quota as `GenerateRequestsPerDayPerProjectPerModel-FreeTier` -- and since
 * every scene costs one request, a single six-scene video could spend the
 * whole allowance. More keys on the same project do not help, because the
 * count is against the project rather than the key. A public demo therefore
 * had roughly one video a day in it, however many people visited.
 *
 * So speech is no longer tied to one provider. An engine is anything that can
 * turn a line into PCM, tried in order, and the local ones have no quota at
 * all: they run on this machine, so the only limit is CPU. The cloud voice is
 * still preferred while it lasts, because it sounds better; when it refuses,
 * the render continues on a local engine instead of failing. That is the same
 * rule the text chain already follows, applied to audio.
 *
 * Every engine returns raw signed 16-bit PCM at one rate, normalised through
 * ffmpeg -- which the MP4 export already requires, so this adds no dependency.
 * Keeping the format identical is what lets subtitle timing stay honest: the
 * duration still follows from the byte count, whoever spoke the line.
 */

import 'server-only';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProviderError, synthesizeSpeech } from '../provider';

/** The rate everything is resampled to, matching what the cloud voice returns. */
export const SPEECH_SAMPLE_RATE = 24000;

export interface SpokenAudio {
  /** Raw signed 16-bit little-endian PCM, mono, at SPEECH_SAMPLE_RATE. */
  pcm: Buffer;
  sampleRate: number;
  /** Exact duration, from the byte count rather than an estimate. */
  seconds: number;
  /** Which engine spoke it, so the interface can say so. */
  engine: string;
  /** Model or voice used, for the provenance record and the UI. */
  model: string;
  voice: string;
}

export class SpeechError extends Error {
  constructor(message: string, readonly kind: 'unavailable' | 'failed') {
    super(message);
    this.name = 'SpeechError';
  }
}

function ffmpegPath(): string {
  return process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
}

interface RunResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

function run(bin: string, args: string[], input?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = '';

    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c) => {
      stderr += String(c);
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ code: code ?? -1, stdout: Buffer.concat(chunks), stderr }),
    );

    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

/** True when `bin` can be invoked at all. Cached: it cannot change at runtime. */
const presence = new Map<string, Promise<boolean>>();

function isInstalled(bin: string, versionArg = '--version'): Promise<boolean> {
  const cached = presence.get(bin);
  if (cached) return cached;

  const probe = run(bin, [versionArg])
    .then(({ code }) => code === 0)
    .catch(() => false);
  presence.set(bin, probe);
  return probe;
}

/** Visible to tests, which need to probe more than one configuration. */
export function resetEngineProbes(): void {
  presence.clear();
}

/**
 * Convert any audio file to the one PCM format the pipeline uses.
 *
 * Local engines emit WAV at whatever rate their voice was trained on, so
 * normalising here keeps every downstream calculation -- durations, subtitle
 * timings, the concat list -- identical regardless of which engine spoke.
 */
async function toPcm(file: string): Promise<Buffer> {
  const { code, stdout, stderr } = await run(ffmpegPath(), [
    '-v', 'error',
    '-i', file,
    '-f', 's16le',
    '-ar', String(SPEECH_SAMPLE_RATE),
    '-ac', '1',
    'pipe:1',
  ]);

  if (code !== 0 || stdout.length === 0) {
    throw new SpeechError(
      `Narration could not be converted to audio (${stderr.split('\n').slice(-2).join(' ').trim()}).`,
      'failed',
    );
  }
  return stdout;
}

/** Run a local engine that writes a WAV file, and return normalised PCM. */
async function speakToFile(
  label: string,
  build: (outFile: string) => { bin: string; args: string[]; input?: string },
  text: string,
): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sourcebridge-speech-'));
  try {
    const outFile = path.join(dir, 'speech.wav');
    const { bin, args, input } = build(outFile);
    const { code, stderr } = await run(bin, args, input ?? text);

    if (code !== 0) {
      throw new SpeechError(
        `${label} could not speak this line (exit ${code}). ${stderr.split('\n').slice(-2).join(' ').trim()}`,
        'failed',
      );
    }
    return await toPcm(outFile);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

export interface SpeechEngine {
  name: string;
  /** Whether this engine can run here, checked once per process. */
  available(): Promise<boolean>;
  speak(text: string, voice: string): Promise<Omit<SpokenAudio, 'seconds' | 'engine'>>;
}

/**
 * The provider's voice. Best quality, and the only one with a daily ceiling.
 *
 * Kept first while it lasts: it is noticeably better than either local engine,
 * and the rest of the chain exists so that running out stops being fatal.
 */
const geminiEngine: SpeechEngine = {
  name: 'gemini',
  available: async () => Boolean(process.env.GEMINI_API_KEY?.trim()),
  async speak(text, voice) {
    const result = await synthesizeSpeech(text, voice);
    return {
      pcm: result.pcm,
      sampleRate: result.sampleRate,
      model: result.model,
      voice: result.voice,
    };
  },
};

/**
 * Piper: neural speech that runs here, with no quota and no network.
 *
 * Opt-in because it needs a voice model file, which is tens of megabytes and
 * has to be chosen for the language. Set PIPER_VOICE to the .onnx model, and
 * PIPER_PATH if the binary is not on PATH. Quality is close enough to the
 * cloud voice that a viewer is unlikely to notice.
 */
const piperEngine: SpeechEngine = {
  name: 'piper',
  available: async () =>
    Boolean(process.env.PIPER_VOICE?.trim()) &&
    (await isInstalled(process.env.PIPER_PATH?.trim() || 'piper')),
  async speak(text) {
    const model = process.env.PIPER_VOICE!.trim();
    const pcm = await speakToFile(
      'Piper',
      (outFile) => ({
        bin: process.env.PIPER_PATH?.trim() || 'piper',
        args: ['--model', model, '--output_file', outFile],
      }),
      text,
    );
    return {
      pcm,
      sampleRate: SPEECH_SAMPLE_RATE,
      model: `piper:${path.basename(model, '.onnx')}`,
      voice: 'piper',
    };
  },
};

/**
 * eSpeak NG: the floor, and the reason a render can always finish.
 *
 * Two megabytes, in every distribution's repositories, no model file and no
 * configuration. It sounds synthetic, which is why it sits last -- but a
 * synthetic voice reading the correct words beats a render that refuses
 * because a daily allowance ran out hours ago.
 */
const espeakEngine: SpeechEngine = {
  name: 'espeak',
  available: () => isInstalled(espeakBin(), '--version'),
  async speak(text) {
    const voice = await espeakVoice();
    const pcm = await speakToFile(
      'eSpeak NG',
      (outFile) => ({
        bin: espeakBin(),
        args: [
          '-v', voice,
          // Slightly under the default, which runs fast for narration.
          '-s', process.env.ESPEAK_WPM?.trim() || '160',
          '-w', outFile,
          // Read from stdin, so no quoting or length limit applies.
          '--stdin',
        ],
      }),
      text,
    );
    return { pcm, sampleRate: SPEECH_SAMPLE_RATE, model: `espeak-ng:${voice}`, voice: 'espeak' };
  },
};

function espeakBin(): string {
  return process.env.ESPEAK_PATH?.trim() || 'espeak-ng';
}

/**
 * The best eSpeak voice this host can actually produce.
 *
 * eSpeak's own synthesis is formant-based and sounds like a machine from the
 * nineties, which is a poor thing to put under a video someone will show to an
 * audience. MBROLA voices are diphone recordings of a real speaker driven by
 * the same engine: markedly more natural, the same negligible CPU cost, and
 * free. They need a voice package that may or may not be installed, so rather
 * than probing for it, the better voice is simply tried first and the result
 * remembered. A host without it pays one failed attempt, once per process.
 */
const MBROLA_VOICE = 'mb-en1';
let resolvedVoice: string | undefined;

async function espeakVoice(): Promise<string> {
  const configured = process.env.ESPEAK_VOICE?.trim();
  if (configured) return configured;
  if (resolvedVoice) return resolvedVoice;

  const dir = await mkdtemp(path.join(tmpdir(), 'sourcebridge-voice-'));
  try {
    const probe = path.join(dir, 'probe.wav');
    const { code } = await run(
      espeakBin(),
      ['-v', MBROLA_VOICE, '-w', probe, '--stdin'],
      'test',
    );
    resolvedVoice = code === 0 ? MBROLA_VOICE : 'en-gb';
  } catch {
    resolvedVoice = 'en-gb';
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return resolvedVoice;
}

/** Visible to tests, which need to probe more than one configuration. */
export function resetVoiceProbe(): void {
  resolvedVoice = undefined;
}

const ENGINES: Record<string, SpeechEngine> = {
  gemini: geminiEngine,
  piper: piperEngine,
  espeak: espeakEngine,
};

/**
 * The engines to try, in order.
 *
 * `auto` prefers the cloud voice and falls back to whatever local engine is
 * installed, which is what keeps quality while removing the ceiling. Set
 * VIDEO_TTS_ENGINE to `local` to skip the provider entirely -- faster, since
 * nothing waits on a network, and it spends no allowance at all -- or name a
 * single engine to pin it.
 */
export function speechChain(): SpeechEngine[] {
  const configured = process.env.VIDEO_TTS_ENGINE?.trim().toLowerCase() || 'auto';

  if (configured === 'local') return [piperEngine, espeakEngine];
  if (configured !== 'auto') {
    const named = configured
      .split(',')
      .map((n) => ENGINES[n.trim()])
      .filter(Boolean);
    if (named.length > 0) return named;
  }
  return [geminiEngine, piperEngine, espeakEngine];
}

/**
 * Speak one line, falling through to the next engine when one cannot.
 *
 * A quota refusal is not an error here, it is a reason to use another engine:
 * the whole point is that running out of cloud allowance degrades the voice
 * rather than ending the render.
 */
export async function speakLine(text: string, voice: string): Promise<SpokenAudio> {
  const spoken = text.trim();
  if (!spoken) throw new SpeechError('Nothing to speak.', 'failed');

  const chain = speechChain();
  const tried: string[] = [];
  let lastError: Error | undefined;

  for (const engine of chain) {
    if (!(await engine.available())) continue;
    tried.push(engine.name);

    try {
      const result = await engine.speak(spoken, voice);
      return {
        ...result,
        seconds: result.pcm.length / 2 / result.sampleRate,
        engine: engine.name,
      };
    } catch (err) {
      // A spent allowance, an overloaded model or a missing binary all mean
      // the same thing to the caller: ask the next engine instead.
      lastError = err instanceof Error ? err : new Error(String(err));
      if (err instanceof ProviderError && err.code === 'not_configured') continue;
    }
  }

  if (tried.length === 0) {
    throw new SpeechError(
      'No speech engine is available on this host. Set GEMINI_API_KEY for the cloud voice, or ' +
        'install eSpeak NG (`apt install espeak-ng`) for a local one that needs no key and has ' +
        'no daily limit. The video package (.zip) needs neither and is unaffected.',
      'unavailable',
    );
  }

  throw new SpeechError(
    `Narration failed on every available speech engine (${tried.join(', ')}). ` +
      `${lastError?.message ?? ''}`.trim(),
    'failed',
  );
}
