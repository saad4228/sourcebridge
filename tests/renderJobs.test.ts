import { describe, expect, it, beforeEach } from 'vitest';
import {
  beginJob,
  isRenderId,
  readJob,
  recordProgress,
  resetJobs,
  updateJob,
} from '@/lib/export/renderJobs';

const ID = '3f1b9c42-7a8e-4d61-9b2f-0c5d8e4a1726';
const OTHER = 'aa11bb22-cc33-4d44-8e55-ff6677889900';

beforeEach(() => {
  resetJobs();
});

describe('render ids', () => {
  it('accepts a UUID shape', () => {
    expect(isRenderId(ID)).toBe(true);
    expect(isRenderId(ID.toUpperCase())).toBe(true);
  });

  it('rejects anything else, so the registry cannot be grown by arbitrary keys', () => {
    expect(isRenderId('')).toBe(false);
    expect(isRenderId('not-an-id')).toBe(false);
    expect(isRenderId('../../etc/passwd')).toBe(false);
    // One character short of a UUID.
    expect(isRenderId('3f1b9c42-7a8e-4d61-9b2f-0c5d8e4a172')).toBe(false);
    expect(isRenderId(undefined)).toBe(false);
    expect(isRenderId(42)).toBe(false);
  });

  it('does not register a job under an id it would refuse to read', () => {
    beginJob('not-an-id');
    expect(readJob('not-an-id')).toBeNull();
  });
});

describe('progress reporting', () => {
  it('starts queued, so a poll before the first scene has something to show', () => {
    beginJob(ID, 6);
    const job = readJob(ID);
    expect(job?.stage).toBe('queued');
    expect(job?.sceneCount).toBe(6);
  });

  it('reads the scene number out of the renderer’s own message', () => {
    beginJob(ID, 6);
    recordProgress(ID, 'Speaking scene 3 of 6');

    const job = readJob(ID);
    expect(job?.stage).toBe('speaking');
    expect(job?.scene).toBe(3);
    expect(job?.sceneCount).toBe(6);
    // The message is kept verbatim: it is what appears on screen.
    expect(job?.message).toBe('Speaking scene 3 of 6');
  });

  it('classifies the drawing and encoding stages', () => {
    beginJob(ID, 2);
    recordProgress(ID, 'Drawing frames');
    expect(readJob(ID)?.stage).toBe('drawing');

    recordProgress(ID, 'Encoding video');
    expect(readJob(ID)?.stage).toBe('encoding');
  });

  it('keeps an unrecognised message without inventing a stage', () => {
    beginJob(ID, 2);
    recordProgress(ID, 'Drawing frames');
    recordProgress(ID, 'Something new the renderer reports');

    const job = readJob(ID);
    expect(job?.message).toBe('Something new the renderer reports');
    // The last real stage stands rather than being reset.
    expect(job?.stage).toBe('drawing');
  });

  it('ignores progress for a job that was never started', () => {
    recordProgress(OTHER, 'Speaking scene 1 of 3');
    expect(readJob(OTHER)).toBeNull();
  });

  it('keeps jobs separate', () => {
    beginJob(ID, 3);
    beginJob(OTHER, 8);
    recordProgress(ID, 'Speaking scene 2 of 3');

    expect(readJob(ID)?.scene).toBe(2);
    expect(readJob(OTHER)?.scene).toBeUndefined();
    expect(readJob(OTHER)?.sceneCount).toBe(8);
  });
});

describe('measured subtitles', () => {
  it('holds the subtitles the render produced, so they are not discarded', () => {
    beginJob(ID, 1);
    updateJob(ID, { stage: 'complete', message: 'Render complete', srt: '1\n00:00:00,000 --> 00:00:02,000\nHello\n' });

    const job = readJob(ID);
    expect(job?.stage).toBe('complete');
    expect(job?.srt).toContain('00:00:00,000 --> 00:00:02,000');
  });

  it('records a failure with its reason rather than leaving the job running', () => {
    beginJob(ID, 4);
    recordProgress(ID, 'Speaking scene 2 of 4');
    updateJob(ID, { stage: 'failed', message: 'Render failed', error: 'ffmpeg exited 1' });

    const job = readJob(ID);
    expect(job?.stage).toBe('failed');
    expect(job?.error).toBe('ffmpeg exited 1');
  });

  it('reports scenes the video left out', () => {
    beginJob(ID, 8);
    updateJob(ID, { stage: 'complete', dropped: 4 });
    expect(readJob(ID)?.dropped).toBe(4);
  });
});

describe('registry bounds', () => {
  it('evicts the oldest jobs past the cap so a caller cannot grow it without limit', () => {
    const ids = Array.from(
      { length: 40 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    for (const id of ids) beginJob(id, 1);

    const live = ids.filter((id) => readJob(id) !== null);
    expect(live.length).toBeLessThanOrEqual(32);
    // The most recent survive; the first ones were evicted.
    expect(readJob(ids[ids.length - 1])).not.toBeNull();
    expect(readJob(ids[0])).toBeNull();
  });
});
