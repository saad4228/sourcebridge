/**
 * In-process progress for a long render.
 *
 * Rendering an MP4 speaks every scene, draws every frame and then encodes,
 * which takes minutes. The file itself comes back on the original request, so
 * that response cannot also carry progress — a download needs a binary body
 * and a Content-Disposition, not a stream of status lines. Instead the render
 * writes its stage here and the browser polls for it, which turns a silent
 * wait into "Speaking scene 3 of 6".
 *
 * The same record carries the measured subtitles once the render finishes.
 * `renderVideo` derives them from the real audio durations, and before this
 * they were computed and then discarded, which threw away the one thing that
 * speaking the narration server-side actually buys.
 *
 * Deliberately in memory, not a store. The application keeps no session state
 * and a render is useful only to the request that asked for it. The cost is
 * that a multi-instance deployment could route a poll to an instance that is
 * not running the render; the caller treats an unknown id as "no progress yet"
 * rather than as an error, so the download still completes normally.
 */

export type RenderStage = 'queued' | 'speaking' | 'drawing' | 'encoding' | 'complete' | 'failed';

export interface RenderJob {
  id: string;
  stage: RenderStage;
  /** Human-readable progress, shown as-is in the interface. */
  message: string;
  /** 1-based scene index while speaking, so the UI can show a count. */
  scene?: number;
  sceneCount?: number;
  /** Scenes the renderer would not include, reported rather than hidden. */
  dropped?: number;
  startedAt: number;
  updatedAt: number;
  /** Subtitles aligned to the audio actually produced. Set on completion. */
  srt?: string;
  error?: string;
}

/**
 * Records are dropped this long after their last update.
 *
 * Long enough that the browser can still collect the subtitles after a render
 * finishes, short enough that an abandoned render does not hold its transcript
 * for the life of the process.
 */
const JOB_TTL_MS = 15 * 60_000;

/**
 * Hard cap on concurrent records.
 *
 * The id comes from the client, so without a cap a caller could grow this map
 * indefinitely by starting renders it never completes. The oldest record is
 * evicted first; losing progress for a stale render costs nothing.
 */
const MAX_JOBS = 32;

const jobs = new Map<string, RenderJob>();

/**
 * Ids are client-supplied, so only a UUID shape is accepted.
 *
 * This is the whole validation: the id is a correlation handle, never a
 * capability. It is unguessable enough that one browser tab does not read
 * another's progress by accident, and it grants nothing but a progress line
 * and the subtitles for audio the same caller just paid to generate.
 */
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRenderId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** Drop expired records, and the oldest ones if the map is over its cap. */
function sweep(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > JOB_TTL_MS) jobs.delete(id);
  }
  if (jobs.size <= MAX_JOBS) return;

  const oldest = [...jobs.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  for (const job of oldest.slice(0, jobs.size - MAX_JOBS)) jobs.delete(job.id);
}

export function beginJob(id: string, sceneCount?: number): void {
  if (!isRenderId(id)) return;
  const now = Date.now();
  jobs.set(id, {
    id,
    stage: 'queued',
    message: 'Preparing the render',
    sceneCount,
    startedAt: now,
    updatedAt: now,
  });
  // Swept after inserting, not before: sweeping first trimmed the map to the
  // cap and then added one more, so the cap held one job too many. The job
  // just added is the newest, so it is never the one evicted.
  sweep();
}

export function updateJob(id: string, patch: Partial<Omit<RenderJob, 'id' | 'startedAt'>>): void {
  const job = jobs.get(id);
  if (!job) return;
  jobs.set(id, { ...job, ...patch, updatedAt: Date.now() });
}

export function readJob(id: string): RenderJob | null {
  if (!isRenderId(id)) return null;
  const job = jobs.get(id);
  if (!job) return null;
  if (Date.now() - job.updatedAt > JOB_TTL_MS) {
    jobs.delete(id);
    return null;
  }
  return job;
}

/** Forget a record, used when a render is abandoned before it reports. */
export function clearJob(id: string): void {
  jobs.delete(id);
}

/** Visible to tests so each can start from an empty registry. */
export function resetJobs(): void {
  jobs.clear();
}

/**
 * Translate a renderer progress line into a structured update.
 *
 * `renderVideo` reports in prose because that is what belongs on screen; the
 * stage and scene number are parsed out so the interface can also show a
 * count without the renderer needing to know anything about the UI.
 */
export function recordProgress(id: string, message: string): void {
  const scene = message.match(/^Speaking scene (\d+) of (\d+)/);
  if (scene) {
    updateJob(id, {
      stage: 'speaking',
      message,
      scene: Number(scene[1]),
      sceneCount: Number(scene[2]),
    });
    return;
  }
  if (/^Drawing/.test(message)) {
    updateJob(id, { stage: 'drawing', message });
    return;
  }
  if (/^Encoding/.test(message)) {
    updateJob(id, { stage: 'encoding', message });
    return;
  }
  updateJob(id, { message });
}
