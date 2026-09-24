/**
 * Address screening for user-supplied URLs.
 *
 * Kept separate from the fetching code (which is server-only) so the rules can
 * be unit-tested directly. Getting these wrong turns the server into a proxy
 * for internal services, so each range is listed explicitly.
 */

import { isIP } from 'node:net';

/** True when an address must never be reachable from a user-supplied URL. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 || // "this network"
      a === 10 || // RFC1918 private
      a === 127 || // loopback
      (a === 169 && b === 254) || // link-local, incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) || // RFC1918 private
      (a === 192 && b === 168) || // RFC1918 private
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      a >= 224 // multicast and reserved
    );
  }

  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    // Link-local (fe80::/10) and unique-local (fc00::/7).
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // IPv4-mapped addresses carry the v4 rules with them.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  // Not a parseable IP: treat as unsafe rather than assuming.
  return true;
}
