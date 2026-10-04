/**
 * Per-caller limits on video rendering.
 *
 * There are no accounts, so a public URL is open to everyone who has it, and
 * rendering a video is by far the most expensive thing the application does.
 * This exists so one visitor holding a refresh key cannot take the day's
 * capacity from everybody else.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  callerKey,
  consume,
  refund,
  resetRateLimits,
  retryMessage,
  videoRenderLimit,
} from '@/lib/rateLimit';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  resetRateLimits();
  delete process.env.VIDEO_RENDERS_PER_HOUR;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

const req = (headers: Record<string, string>) =>
  new Request('http://localhost/api/export', { method: 'POST', headers });

describe('identifying the caller', () => {
  it('uses the original client from a proxy chain, not the proxy', () => {
    // Behind a platform load balancer the socket address is the balancer, so
    // the first forwarded entry is what distinguishes one visitor from another.
    expect(callerKey(req({ 'x-forwarded-for': '203.0.113.9, 70.41.3.18, 150.172.238.178' }))).toBe(
      '203.0.113.9',
    );
  });

  it('falls back through the other forwarding headers', () => {
    expect(callerKey(req({ 'x-real-ip': '203.0.113.5' }))).toBe('203.0.113.5');
    expect(callerKey(req({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('groups callers it cannot identify rather than letting them through', () => {
    // Sharing one bucket is the safe direction: an unidentifiable caller is
    // limited, instead of being treated as a new visitor on every request.
    expect(callerKey(req({}))).toBe('unknown');
  });
});

describe('the window', () => {
  it('allows up to the limit and then refuses', () => {
    for (let i = 0; i < 3; i++) {
      expect(consume('a', 3, 60_000).allowed, `request ${i + 1}`).toBe(true);
    }
    expect(consume('a', 3, 60_000).allowed).toBe(false);
  });

  it('counts down what is left', () => {
    expect(consume('a', 3, 60_000).remaining).toBe(2);
    expect(consume('a', 3, 60_000).remaining).toBe(1);
    expect(consume('a', 3, 60_000).remaining).toBe(0);
  });

  it('keeps callers apart, so one cannot spend another’s allowance', () => {
    for (let i = 0; i < 3; i++) consume('a', 3, 60_000);

    expect(consume('a', 3, 60_000).allowed).toBe(false);
    expect(consume('b', 3, 60_000).allowed).toBe(true);
  });

  it('does not push the reset further away on a refused request', () => {
    for (let i = 0; i < 3; i++) consume('a', 3, 60_000);
    const first = consume('a', 3, 60_000).resetAt;
    const second = consume('a', 3, 60_000).resetAt;

    // Hammering the endpoint must not extend the lockout indefinitely.
    expect(second).toBe(first);
  });

  it('starts a fresh window once the old one has passed', () => {
    for (let i = 0; i < 2; i++) consume('a', 2, 1);
    expect(consume('a', 2, 1).allowed).toBe(false);

    // A window of 1ms has already elapsed by the next call.
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        expect(consume('a', 2, 1).allowed).toBe(true);
        resolve();
      }, 5),
    );
  });

  it('gives back an allowance that bought nothing', () => {
    // A render that failed on a host misconfiguration must not lock the
    // caller out for the rest of the hour.
    for (let i = 0; i < 3; i++) consume('a', 3, 60_000);
    expect(consume('a', 3, 60_000).allowed).toBe(false);

    refund('a');
    expect(consume('a', 3, 60_000).allowed).toBe(true);
  });

  it('never refunds below zero', () => {
    refund('never-seen');
    consume('a', 3, 60_000);
    refund('a');
    refund('a');
    expect(consume('a', 3, 60_000).remaining).toBe(2);
  });
});

describe('configuration', () => {
  it('defaults to a small number, because the thing it guards is small', () => {
    expect(videoRenderLimit().limit).toBe(3);
    expect(videoRenderLimit().windowMs).toBe(3600_000);
  });

  it('honours an explicit limit', () => {
    process.env.VIDEO_RENDERS_PER_HOUR = '10';
    expect(videoRenderLimit().limit).toBe(10);
  });

  it('can be switched off, which is reasonable once speech runs locally', () => {
    process.env.VIDEO_RENDERS_PER_HOUR = '0';
    expect(videoRenderLimit().limit).toBe(0);
  });

  it('ignores a nonsense value rather than disabling itself', () => {
    process.env.VIDEO_RENDERS_PER_HOUR = 'lots';
    expect(videoRenderLimit().limit).toBe(3);
    process.env.VIDEO_RENDERS_PER_HOUR = '-5';
    expect(videoRenderLimit().limit).toBe(3);
  });
});

describe('what the caller is told', () => {
  it('says when to come back, in units a person uses', () => {
    expect(retryMessage(Date.now() + 30_000)).toMatch(/about a minute/);
    expect(retryMessage(Date.now() + 25 * 60_000)).toMatch(/about 25 minutes/);
  });

  it('never reports a wait of zero', () => {
    expect(retryMessage(Date.now() - 1000)).toMatch(/about a minute/);
  });
});
