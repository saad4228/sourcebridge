/**
 * The health endpoint's cost.
 *
 * The interface asks for the deep check once on load, and the deep check makes
 * a real model call. That is affordable for one operator and ruinous for a
 * demo: ten people opening the site and refreshing spent dozens of generations
 * against an allowance measured in tens per day, before anyone had generated
 * anything. Whether the provider is reachable is a fact about the server, not
 * about the visitor, so one answer serves everyone.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const pingProvider = vi.fn();

vi.mock('@/lib/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/provider')>('@/lib/provider');
  return { ...actual, pingProvider: () => pingProvider() };
});

const { GET, resetHealthCache } = await import('@/app/api/health/route');

const ORIGINAL = { ...process.env };

const get = (query = '') => GET(new Request(`http://localhost/api/health${query}`));

beforeEach(() => {
  resetHealthCache();
  pingProvider.mockReset();
  pingProvider.mockResolvedValue({ ok: true, model: 'test-model', latencyMs: 12 });
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.HEALTH_CACHE_MS;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

describe('the shallow check', () => {
  it('never calls the provider, so a platform probe costs nothing', async () => {
    const body = await (await get()).json();

    expect(pingProvider).not.toHaveBeenCalled();
    expect(body).toMatchObject({ configured: true, reachable: null });
  });
});

describe('the deep check', () => {
  it('calls the provider the first time', async () => {
    const body = await (await get('?deep=1')).json();

    expect(pingProvider).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ reachable: true, model: 'test-model' });
  });

  it('serves every later visitor from one answer', async () => {
    for (let i = 0; i < 10; i++) await get('?deep=1');

    // Ten visitors, one model call -- this is the whole point.
    expect(pingProvider).toHaveBeenCalledTimes(1);
  });

  it('says it is a cached answer, and how old', async () => {
    await get('?deep=1');
    const body = await (await get('?deep=1')).json();

    expect(body.cached).toBe(true);
    expect(body.checkedMsAgo).toBeGreaterThanOrEqual(0);
    expect(body.reachable).toBe(true);
  });

  it('caches a failure too, rather than re-probing a spent allowance', async () => {
    const { ProviderError } = await import('@/lib/provider');
    pingProvider.mockRejectedValue(
      new ProviderError("This model's free-tier daily allowance is spent.", 'rate_limit', true),
    );

    const first = await (await get('?deep=1')).json();
    for (let i = 0; i < 5; i++) await get('?deep=1');

    expect(pingProvider).toHaveBeenCalledTimes(1);
    expect(first.reachable).toBe(false);
    // Re-asking would spend the very thing that had run out.
    expect(first.message).toMatch(/allowance is spent/i);
  });

  it('checks again once the answer is stale', async () => {
    process.env.HEALTH_CACHE_MS = '1';
    await get('?deep=1');
    await new Promise((r) => setTimeout(r, 10));
    await get('?deep=1');

    expect(pingProvider).toHaveBeenCalledTimes(2);
  });

  it('reports a missing key without calling anything', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;

    const body = await (await get('?deep=1')).json();
    expect(pingProvider).not.toHaveBeenCalled();
    expect(body).toMatchObject({ configured: false, reachable: false });
  });

  it('is never cached by the browser, so a stale answer is the server’s choice', async () => {
    const response = await get('?deep=1');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
