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
