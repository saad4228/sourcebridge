/**
 * Per-caller limits on the expensive exports.
 *
 * There are no accounts, so a public URL is open to everyone who has it. Most
 * of the application costs only CPU, but rendering a video speaks every scene,
 * and speech is the one resource that is genuinely scarce: metered per project
 * per model per day on the free tier, so a handful of renders could leave
 * nothing for anyone else that day. One visitor holding a refresh key should
 * not be able to take the day's capacity from everyone else.
 *
 * A fixed window rather than a token bucket, because the thing being protected
 * is itself a daily allowance: what matters is "how many in the last hour",
 * not smoothing bursts. In memory rather than a store, for the same reason the
 * rest of the application keeps no state -- a counter that resets when the
 * container restarts is a weaker guarantee than a shared one, and still stops
 * the behaviour this exists to stop.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Requests still available in the current window. */
  remaining: number;
  /** When the window resets, as epoch milliseconds. */
  resetAt: number;
  limit: number;
}

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Beyond this many distinct callers, the oldest windows are dropped. */
const MAX_TRACKED = 5000;

/**
 * Identify the caller.
 *
 * Behind a platform proxy the socket address is the proxy, so the forwarded
 * header is what distinguishes visitors. It is caller-supplied and therefore
 * spoofable; that is acceptable here because this protects a shared allowance
 * from ordinary over-use, and is not a security control. The first entry is
 * the original client, the rest are proxies.
 */
export function callerKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return (
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() ||
    'unknown'
  );
}

function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  if (windows.size <= MAX_TRACKED) return;

  const oldest = [...windows.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  for (const [key] of oldest.slice(0, windows.size - MAX_TRACKED)) windows.delete(key);
}

/**
 * Count one request against `key`, and say whether it may proceed.
 *
 * Nothing is counted once the limit is reached, so a caller hammering the
 * endpoint does not keep pushing their own reset time further away.
 */
export function consume(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = windows.get(key);
  const window =
    existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };

  if (window.count >= limit) {
    windows.set(key, window);
    return { allowed: false, remaining: 0, resetAt: window.resetAt, limit };
  }

  window.count += 1;
  windows.set(key, window);
  return { allowed: true, remaining: limit - window.count, resetAt: window.resetAt, limit };
}

/** Give back a request that turned out not to cost anything. */
export function refund(key: string): void {
  const window = windows.get(key);
  if (window && window.count > 0) window.count -= 1;
}

/** Visible to tests so each starts from an empty table. */
export function resetRateLimits(): void {
  windows.clear();
}

/**
 * How many videos one caller may render per window, and how long the window is.
 *
 * Deliberately small. A render is the most expensive thing here by a wide
 * margin, and the honest ceiling on a free tier is low enough that generosity
 * to one visitor is a refusal to the next. Set VIDEO_RENDERS_PER_HOUR to 0 to
 * turn the limit off, which is reasonable once speech runs locally and the
 * only cost is CPU.
 */
export function videoRenderLimit(): { limit: number; windowMs: number } {
  const configured = Number(process.env.VIDEO_RENDERS_PER_HOUR);
  const limit = Number.isFinite(configured) && configured >= 0 ? Math.round(configured) : 3;
  return { limit, windowMs: 60 * 60_000 };
}

/** A sentence telling the caller when they can try again. */
export function retryMessage(resetAt: number): string {
  const minutes = Math.max(1, Math.ceil((resetAt - Date.now()) / 60_000));
  return minutes === 1 ? 'Try again in about a minute.' : `Try again in about ${minutes} minutes.`;
}

// ---------------------------------------------------------------------------
// Simultaneous renders
// ---------------------------------------------------------------------------

/**
 * How many videos may render at the same moment, and how many may wait.
 *
 * The per-caller limit above stops one visitor taking a day's capacity. It
 * does nothing about ten visitors arriving at once, which is a different
 * problem with a different failure: rendering rasterises full frames and holds
 * the audio for every scene, so several at once on a small instance exhausts
 * its memory and the platform kills the container. An out-of-memory kill looks
 * exactly like a slow render that then errors, which is the least diagnosable
 * failure there is.
 *
 * So renders queue instead of running together. A render takes seconds, so
 * waiting a turn costs little; waiting behind a long queue does not, which is
 * why the queue has a depth and a caller beyond it is turned away promptly
 * rather than left holding a request that will time out anyway.
 */
function renderSlots(): number {
  const configured = Number(process.env.VIDEO_RENDER_CONCURRENCY);
  if (Number.isFinite(configured) && configured >= 1) return Math.min(Math.round(configured), 8);
  return 2;
}

function maxQueued(): number {
  const configured = Number(process.env.VIDEO_RENDER_QUEUE);
  if (Number.isFinite(configured) && configured >= 0) return Math.min(Math.round(configured), 50);
  return 6;
}

let active = 0;
const waiting: (() => void)[] = [];

export class RenderBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderBusyError';
  }
}

/**
 * Take a render slot, waiting for one if the queue has room.
 *
 * Returns the function that gives the slot back. The caller must call it in a
 * `finally`, or a failed render would hold a slot for the life of the process.
 */
export async function acquireRenderSlot(): Promise<() => void> {
  if (active >= renderSlots() && waiting.length >= maxQueued()) {
    throw new RenderBusyError(
      'Several videos are already rendering. This keeps the server from running out of memory ' +
        'and failing all of them. Wait a few seconds and try again — every other format, and the ' +
        'video package (.zip), are unaffected.',
    );
  }

  if (active >= renderSlots()) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }

  active += 1;
  let released = false;

  return () => {
    // Guarded: releasing twice would let more renders run than there are
    // slots, which is precisely the condition this exists to prevent.
    if (released) return;
    released = true;
    active -= 1;
    waiting.shift()?.();
  };
}

/** Current occupancy, for tests and for reporting. */
export function renderLoad(): { active: number; waiting: number; slots: number } {
  return { active, waiting: waiting.length, slots: renderSlots() };
}

/** Visible to tests so each starts from an idle server. */
export function resetRenderSlots(): void {
  active = 0;
  waiting.length = 0;
}
