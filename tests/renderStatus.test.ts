/**
 * The render status route.
 *
 * An MP4 render takes minutes and the file comes back on the original request,
 * so this route is how the interface learns what the render is doing. Two
 * behaviours matter: an unknown id must not read as a failure, because a poll
 * can legitimately arrive before the render registers; and the subtitles must
 * come back as a real download, since they are the one thing speaking the
 * narration server-side actually buys.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { GET as status } from '@/app/api/export/status/route';
import { beginJob, recordProgress, resetJobs, updateJob } from '@/lib/export/renderJobs';

const ID = '3f1b9c42-7a8e-4d61-9b2f-0c5d8e4a1726';

const get = (query: string) => status(new Request(`http://localhost/api/export/status?${query}`));

beforeEach(() => {
  resetJobs();
});

describe('progress', () => {
  it('rejects an id that is not a render id', async () => {
    const response = await get('id=../../secret');
    expect(response.status).toBe(400);
  });

  it('rejects a missing id', async () => {
    expect((await get('')).status).toBe(400);
  });

  it('reports an unknown id as unknown rather than as an error', async () => {
    // A poll can arrive before the render has registered, after the record
    // expired, or at an instance not running it. None is a failure.
    const response = await get(`id=${ID}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ stage: 'unknown' });
  });

  it('reports the stage and scene of a render in flight', async () => {
    beginJob(ID, 6);
    recordProgress(ID, 'Speaking scene 4 of 6');

    const body = await (await get(`id=${ID}`)).json();
    expect(body).toMatchObject({
      stage: 'speaking',
      message: 'Speaking scene 4 of 6',
      scene: 4,
      sceneCount: 6,
      srtAvailable: false,
    });
    expect(body.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('reports a failure with its reason', async () => {
    beginJob(ID, 3);
    updateJob(ID, { stage: 'failed', message: 'Render failed', error: 'ffmpeg exited 1' });

    const body = await (await get(`id=${ID}`)).json();
    expect(body).toMatchObject({ stage: 'failed', error: 'ffmpeg exited 1' });
  });

  it('reports scenes the video left out', async () => {
    beginJob(ID, 8);
    updateJob(ID, { stage: 'complete', dropped: 4 });

    expect((await (await get(`id=${ID}`)).json()).dropped).toBe(4);
  });

  it('never carries the subtitle text in a progress poll', async () => {
    beginJob(ID, 1);
    updateJob(ID, { stage: 'complete', srt: '1\n00:00:00,000 --> 00:00:02,000\nHello\n' });

    const body = await (await get(`id=${ID}`)).json();
    expect(body.srtAvailable).toBe(true);
    expect(JSON.stringify(body)).not.toContain('Hello');
  });

  it('is never cached, so a poll reports the current stage', async () => {
    beginJob(ID, 2);
    expect((await get(`id=${ID}`)).headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('measured subtitles', () => {
  it('returns them as a download once the render is complete', async () => {
    const srt = '1\n00:00:02,500 --> 00:00:06,100\nWater use fell eighteen percent.\n';
    beginJob(ID, 1);
    updateJob(ID, { stage: 'complete', srt });

    const response = await get(`id=${ID}&file=srt`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toMatch(/subrip/);
    expect(response.headers.get('Content-Disposition')).toMatch(/attachment; filename=".*\.srt"/);
    expect(await response.text()).toBe(srt);
  });

  it('reports none available while the render is still speaking', async () => {
    beginJob(ID, 4);
    recordProgress(ID, 'Speaking scene 2 of 4');

    const response = await get(`id=${ID}&file=srt`);
    expect(response.status).toBe(404);
  });

  it('reports none available for an unknown render', async () => {
    expect((await get(`id=${ID}&file=srt`)).status).toBe(404);
  });
});
