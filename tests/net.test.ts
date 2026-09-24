import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from '@/lib/net';

describe('SSRF address screening', () => {
  it('blocks loopback', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('127.99.1.2')).toBe(true);
    expect(isPrivateAddress('::1')).toBe(true);
  });

  it('blocks RFC1918 private ranges', () => {
    expect(isPrivateAddress('10.0.0.1')).toBe(true);
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('172.31.255.255')).toBe(true);
  });

  it('allows public addresses that merely look adjacent to private ones', () => {
    // 172.15 and 172.32 sit outside the private block and must stay reachable.
    expect(isPrivateAddress('172.15.0.1')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('192.169.0.1')).toBe(false);
    expect(isPrivateAddress('11.0.0.1')).toBe(false);
  });

  it('blocks the cloud metadata endpoint', () => {
    // The single most important case: 169.254.169.254 serves instance
    // credentials on AWS, GCP and Azure.
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
    expect(isPrivateAddress('169.254.0.1')).toBe(true);
  });

  it('blocks carrier-grade NAT, multicast and "this network"', () => {
    expect(isPrivateAddress('100.64.0.1')).toBe(true);
    expect(isPrivateAddress('224.0.0.1')).toBe(true);
    expect(isPrivateAddress('255.255.255.255')).toBe(true);
    expect(isPrivateAddress('0.0.0.0')).toBe(true);
  });

  it('blocks IPv6 link-local and unique-local', () => {
    expect(isPrivateAddress('fe80::1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
    expect(isPrivateAddress('fc00::1')).toBe(true);
  });

  it('applies the IPv4 rules to IPv4-mapped IPv6 addresses', () => {
    // ::ffff:127.0.0.1 is a well-known bypass if only the v4 form is checked.
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('allows ordinary public addresses', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('1.1.1.1')).toBe(false);
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('rejects anything that is not a parseable IP', () => {
    // Fail closed: an unparseable value must never be treated as public.
    expect(isPrivateAddress('not-an-ip')).toBe(true);
    expect(isPrivateAddress('')).toBe(true);
  });
});
