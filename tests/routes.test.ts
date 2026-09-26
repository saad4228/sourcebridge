import { describe, expect, it } from 'vitest';
import { POST as extract } from '@/app/api/extract/route';
import { POST as exportRoute } from '@/app/api/export/route';

/**
 * Route-level error handling.
 *
 * A malformed request is the caller's mistake and must read as one. Returning
 * 500 for it hides real faults in the noise and logs a stack trace every time
 * someone sends a bad body.
 */
const post = (url: string, body?: BodyInit, headers?: HeadersInit) =>
  new Request(url, { method: 'POST', body, headers });

describe('extract', () => {
  it('rejects a missing body as a client error', async () => {
    const response = await extract(post('http://localhost/api/extract'));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/No source was received/i);
  });

  it('rejects an unparseable body as a client error', async () => {
    const response = await extract(
      post('http://localhost/api/extract', 'not json', { 'Content-Type': 'application/json' }),
    );

    expect(response.status).toBe(400);
  });

  it('rejects empty text with a usable message', async () => {
    const response = await extract(
      post('http://localhost/api/extract', JSON.stringify({ text: '' }), {
        'Content-Type': 'application/json',
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error');
  });

  it('reports a multipart request carrying no file', async () => {
    const form = new FormData();
    form.append('notafile', 'x');

    const response = await extract(post('http://localhost/api/extract', form));
    expect(response.status).toBe(400);
  });

  it('never returns a stack trace to the caller', async () => {
    const response = await extract(post('http://localhost/api/extract'));
    const body = JSON.stringify(await response.json());

    expect(body).not.toMatch(/at \w+ \(|\.ts:\d+|node_modules/);
  });
});

describe('export', () => {
  it('rejects a malformed body', async () => {
    const response = await exportRoute(
      post('http://localhost/api/export', 'not json', { 'Content-Type': 'application/json' }),
    );

    expect(response.status).toBe(400);
  });

  it('refuses a pptx export of something that is not a presentation', async () => {
    const response = await exportRoute(
      post(
        'http://localhost/api/export',
        JSON.stringify({ format: 'linkedin', kind: 'pptx', content: {} }),
        { 'Content-Type': 'application/json' },
      ),
    );

    // Understood but not satisfiable: the request is well-formed and wrong.
    expect(response.status).toBe(422);
  });

  it('rejects a bundle with nothing in it', async () => {
    const response = await exportRoute(
      post('http://localhost/api/export', JSON.stringify({ kind: 'bundle', items: [] }), {
        'Content-Type': 'application/json',
      }),
    );

    expect(response.status).toBe(400);
  });
});

describe('export: video failures are explained', () => {
  const videoPackage = {
    title: 'Incident explained',
    objective: 'Inform',
    scenes: [
      {
        index: 1,
        heading: 'Opening',
        estimatedSeconds: 10,
        narration: '37 systems were degraded.',
        onScreenText: '37 systems',
        visualRecommendation: 'Wide shot.',
        evidence: [],
      },
    ],
    fullScript: '37 systems were degraded.',
  };

  const renderMp4 = () =>
    exportRoute(
      post(
        'http://localhost/api/export',
        JSON.stringify({ format: 'video_package', kind: 'mp4', content: videoPackage }),
        { 'Content-Type': 'application/json' },
      ),
    );

  it('names the missing key rather than reporting a generic failure', async () => {
    const saved = { ...process.env };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;

    try {
      const response = await renderMp4();
      const body = await response.json();

      // The old behaviour returned "The file could not be generated", which
      // told an operator nothing about what to change.
      expect(body.error).not.toMatch(/could not be generated\. The artefact/i);
      expect([501, 500]).toContain(response.status);
      // Either the key is named, or ffmpeg is — both are actionable.
      expect(body.error).toMatch(/GEMINI_API_KEY|ffmpeg/i);
    } finally {
      process.env = saved;
    }
  });
});
