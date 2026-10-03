/**
 * The verifier shipped inside the export.
 *
 * The provenance chain is only evidence if a recipient can actually check it,
 * so this runs the script the way they would: extract the archive, run
 * `node verify.mjs`, read what it says. It is executed as a real subprocess
 * rather than imported, because what is being tested is that the file in the
 * zip works standalone -- no imports from this project, no dependencies, and
 * the same canonical-JSON hashing as the writer.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { renderBundle } from '@/lib/export/bundle';
import { VERIFY_SCRIPT_FILENAME } from '@/lib/export/verifyScript';

const execFileAsync = (file: string, args: string[], cwd: string) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(file, args, { cwd }, (error, stdout, stderr) => {
      const code =
        error && typeof (error as NodeJS.ErrnoException & { code?: number }).code === 'number'
          ? ((error as unknown as { code: number }).code)
          : error
            ? 1
            : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

const execSummary = {
  title: 'Rainwater pilot',
  mainFinding: 'Household use fell.',
  whyItMatters: 'It informs the next phase.',
  keyEvidence: [{ point: 'Use fell 18%', evidence: ['src-1-p1-1'] }],
  implications: ['Scale carefully.'],
  actions: [{ action: 'Review the data', fromSource: true }],
  uncertainties: ['Attribution is unconfirmed.'],
};

let dir: string;

/** Extract a real bundle to disk, as a recipient would. */
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sourcebridge-verify-'));

  const { bytes } = await renderBundle(
    [{ format: 'exec_summary', content: execSummary, model: 'test-model' }],
    'rainwater-pilot-report.pdf',
    undefined,
    {
      source: { title: 'rainwater-pilot-report.pdf', kind: 'pdf', text: 'Use fell by 18%.' },
      ledger: { topic: 'Rainwater pilot', facts: [] },
    },
  );

  const zip = await JSZip.loadAsync(bytes);
  for (const name of ['provenance.json', VERIFY_SCRIPT_FILENAME, 'README.md']) {
    const file = zip.file(name);
    expect(file, `${name} is missing from the archive`).not.toBeNull();
    await writeFile(path.join(dir, name), await file!.async('nodebuffer'));
  }
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the archive', () => {
  it('ships the verifier alongside the record', async () => {
    const script = await readFile(path.join(dir, VERIFY_SCRIPT_FILENAME), 'utf8');
    // Standalone: nothing from this project, and nothing to install.
    expect(script).not.toMatch(/from '@\/|require\('\.\.?\//);
    expect(script).toMatch(/node:crypto/);
  });

  it('tells the recipient how to run it', async () => {
    const readme = await readFile(path.join(dir, 'README.md'), 'utf8');
    expect(readme).toContain(`node ${VERIFY_SCRIPT_FILENAME}`);
  });
});

describe('running it', () => {
  it('verifies an untouched record', async () => {
    const { code, stdout } = await execFileAsync(process.execPath, [VERIFY_SCRIPT_FILENAME], dir);

    expect(stdout).toMatch(/VERIFIED: all \d+ entries are intact and in order/);
    expect(code).toBe(0);
    // The source, the ledger and the artefact are each named.
    expect(stdout).toContain('source:');
    expect(stdout).toContain('ledger:');
    expect(stdout).toContain('artifact:');
  });

  it('states plainly what a pass does not prove', async () => {
    const { stdout } = await execFileAsync(process.execPath, [VERIFY_SCRIPT_FILENAME], dir);
    expect(stdout).toMatch(/does not\s+prove the source document was authentic/);
  });

  it('catches edited content and names the entry', async () => {
    const file = path.join(dir, 'tampered.json');
    const record = JSON.parse(await readFile(path.join(dir, 'provenance.json'), 'utf8'));
    // Change what an entry says it recorded, leaving its hash in place.
    record.entries[0].subject = 'something-else.pdf';
    await writeFile(file, JSON.stringify(record, null, 2));

    const { code, stdout } = await execFileAsync(
      process.execPath,
      [VERIFY_SCRIPT_FILENAME, 'tampered.json'],
      dir,
    );

    expect(stdout).toMatch(/FAILED at entry 0: entry has been altered/);
    expect(code).toBe(1);
  });

  it('catches a reordered chain', async () => {
    const file = path.join(dir, 'reordered.json');
    const record = JSON.parse(await readFile(path.join(dir, 'provenance.json'), 'utf8'));
    record.entries = [record.entries[1], record.entries[0], ...record.entries.slice(2)];
    await writeFile(file, JSON.stringify(record, null, 2));

    const { code, stdout } = await execFileAsync(
      process.execPath,
      [VERIFY_SCRIPT_FILENAME, 'reordered.json'],
      dir,
    );

    expect(stdout).toMatch(/FAILED at entry 0: entry is out of order/);
    expect(code).toBe(1);
  });

  it('catches a removed entry, which breaks the link', async () => {
    const file = path.join(dir, 'truncated.json');
    const record = JSON.parse(await readFile(path.join(dir, 'provenance.json'), 'utf8'));
    // Drop the middle entry and renumber, so only the links give it away.
    record.entries.splice(1, 1);
    record.entries.forEach((e: { index: number }, i: number) => (e.index = i));
    await writeFile(file, JSON.stringify(record, null, 2));

    const { code, stdout } = await execFileAsync(
      process.execPath,
      [VERIFY_SCRIPT_FILENAME, 'truncated.json'],
      dir,
    );

    expect(stdout).toMatch(/FAILED at entry 1: does not follow the previous entry/);
    expect(code).toBe(1);
  });

  it('reports a file that is not a provenance record, rather than crashing', async () => {
    await writeFile(path.join(dir, 'notarecord.json'), '{"hello":"world"}');
    const { code, stderr } = await execFileAsync(
      process.execPath,
      [VERIFY_SCRIPT_FILENAME, 'notarecord.json'],
      dir,
    );

    expect(stderr).toMatch(/not a SourceBridge provenance record/);
    expect(code).toBe(2);
  });

  it('reports a missing file with advice rather than a stack trace', async () => {
    const { code, stderr } = await execFileAsync(
      process.execPath,
      [VERIFY_SCRIPT_FILENAME, 'nope.json'],
      dir,
    );

    expect(stderr).toMatch(/Could not read nope\.json/);
    expect(stderr).not.toMatch(/at \w+ \(/);
    expect(code).toBe(2);
  });
});
