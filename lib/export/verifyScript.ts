/**
 * The verifier shipped inside every export.
 *
 * The archive carries a hash chain over the source, the fact ledger and every
 * artefact, and `provenance.txt` explains how to check it: recompute each
 * entry's hash over its fields in sorted-key JSON form and confirm every
 * prevHash matches the entry before it. That is accurate and almost nobody
 * will do it. Canonical JSON has to match byte for byte, so an honest attempt
 * that orders keys differently reports a break that is not there -- and a
 * verification anyone can get wrong is not evidence of anything.
 *
 * So the check travels with the record. This is the same algorithm as
 * `buildAuditChain` and `verifyAuditChain`, written as a standalone script
 * with no imports beyond Node's own crypto, so a recipient runs one command
 * and needs neither this application nor its dependencies.
 *
 * Kept as a string rather than a file copied into the zip because the build
 * traces imports, not arbitrary assets: a file read from disk at request time
 * is one more thing that can be missing in a container, and this must never be
 * the part of the export that fails.
 */

export const VERIFY_SCRIPT_FILENAME = 'verify.mjs';

export const VERIFY_SCRIPT = `#!/usr/bin/env node
/**
 * SourceBridge provenance verifier.
 *
 *   node verify.mjs [provenance.json]
 *
 * Recomputes the hash chain in provenance.json and reports whether the record
 * is intact. Needs nothing but Node 18 or newer: no install, no network.
 *
 * What a pass means: the record has not been altered since it was written, and
 * the entries are in their original order. What it does NOT mean: that the
 * source document was authentic, or that any generated content is correct.
 * This is a hash chain, not a blockchain, and nothing is anchored externally.
 */

import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

const GENESIS = '0'.repeat(64);

/**
 * Stable JSON: object keys sorted at every depth.
 *
 * The hash is taken over this form, so two runs over equal content produce an
 * identical string. Undefined values are dropped, matching the writer.
 */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await webcrypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const path = process.argv[2] ?? 'provenance.json';

let record;
try {
  record = JSON.parse(await readFile(path, 'utf8'));
} catch (err) {
  console.error('Could not read ' + path + ': ' + err.message);
  console.error('Run this from the folder holding provenance.json, or pass its path.');
  process.exit(2);
}

const entries = Array.isArray(record?.entries) ? record.entries : null;
if (!entries) {
  console.error(path + ' has no "entries" array. This is not a SourceBridge provenance record.');
  process.exit(2);
}

console.log('SourceBridge provenance verifier');
console.log('Record: ' + path + ' (' + entries.length + ' entries)');
console.log('');

let prevHash = GENESIS;
let broken = null;

for (const [i, entry] of entries.entries()) {
  const label = '[' + i + '] ' + (entry.kind ?? '?') + ': ' + (entry.subject ?? '?');

  if (entry.index !== i) {
    broken = { index: i, reason: 'entry is out of order', label };
    break;
  }
  if (entry.prevHash !== prevHash) {
    broken = { index: i, reason: 'does not follow the previous entry', label };
    break;
  }

  // Hash over every field except the hash itself, exactly as it was written.
  const { entryHash, ...sealed } = entry;
  const recomputed = await sha256Hex(canonical(sealed));
  if (recomputed !== entryHash) {
    broken = { index: i, reason: 'entry has been altered', label };
    break;
  }

  console.log('  ok  ' + label);
  prevHash = entryHash;
}

console.log('');
if (broken) {
  console.log('FAILED at entry ' + broken.index + ': ' + broken.reason);
  console.log('  ' + broken.label);
  console.log('');
  console.log('Everything before that entry verified. The record has been changed');
  console.log('since it was written, at or around this entry.');
  process.exit(1);
}

console.log('VERIFIED: all ' + entries.length + ' entries are intact and in order.');
console.log('Final hash: ' + (entries.at(-1)?.entryHash ?? '(empty chain)'));
console.log('');
console.log('This proves the record has not been edited since export. It does not');
console.log('prove the source document was authentic, and it does not verify that');
console.log('any generated content is correct.');
`;
