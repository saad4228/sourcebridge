import { NextResponse } from 'next/server';
import { isRenderId, readJob } from '@/lib/export/renderJobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Progress for a render in flight, and its measured subtitles once it is done.
 *
 * Rendering an MP4 takes minutes and the file comes back on the original
 * request, so this is how the interface learns what the render is doing rather
 * than showing a spinner and hoping. Polling rather than streaming because the
 * answer is a few fields that the browser asks for on its own schedule; a
 * stream would need holding open for the whole render to say the same thing.
 *
 * `?file=srt` returns the subtitles instead of the status. Their timings come
 * from the audio that was actually produced, which is the whole reason the
 * narration is spoken on the server.
 *
 * An unknown id is not an error: a poll can arrive before the render has
 * registered, after the record expired, or — on a multi-instance host — at an
 * instance that is not running it. Reporting "unknown" lets the interface stay
 * quiet instead of showing a failure for a render that is proceeding normally.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get('id') ?? '';

  if (!isRenderId(id)) {
    return NextResponse.json({ error: 'Not a valid render id.' }, { status: 400 });
  }

  const job = readJob(id);

  if (params.get('file') === 'srt') {
    if (!job?.srt) {
      return NextResponse.json(
        { error: 'No subtitles are available for that render.' },
        { status: 404 },
      );
    }
    return new NextResponse(job.srt, {
      headers: {
        'Content-Type': 'application/x-subrip; charset=utf-8',
        'Content-Disposition': 'attachment; filename="video-subtitles.srt"',
        'Cache-Control': 'no-store',
      },
    });
  }

  if (!job) {
    return NextResponse.json({ stage: 'unknown' }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json(
    {
      stage: job.stage,
      message: job.message,
      scene: job.scene,
      sceneCount: job.sceneCount,
      dropped: job.dropped,
      // Reported rather than the text itself: the subtitles are fetched
      // deliberately, not carried along with every poll.
      srtAvailable: Boolean(job.srt),
      error: job.error,
      elapsedMs: Date.now() - job.startedAt,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
