import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ExtractionError, LIMITS, extractFromPdf, extractFromText, resolveEvidence } from '@/lib/extract';

const sample = (name: string) => path.join(process.cwd(), 'samples', name);

describe('extractFromText', () => {
  it('rejects empty input rather than producing an empty source', () => {
    expect(() => extractFromText('   \n  ')).toThrow(ExtractionError);
  });

  it('rejects oversized input instead of silently truncating', () => {
    const huge = 'word '.repeat(LIMITS.maxChars);
    try {
      extractFromText(huge);
      throw new Error('expected a rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(ExtractionError);
      expect((err as ExtractionError).kind).toBe('too_large');
      // The operator must be told, not quietly given partial coverage.
      expect((err as ExtractionError).message).toMatch(/will not silently truncate/i);
    }
  });

  it('warns on a very short source without failing', () => {
    const { source } = extractFromText('A brief note about water use falling by 18%.');
    expect(source.warnings).toHaveLength(1);
    expect(source.warnings[0]).toMatch(/short/i);
    expect(source.segments.length).toBeGreaterThan(0);
  });

  it('preserves the original text verbatim', () => {
    const text = 'Consumption fell by 18.0% across 250 households.\nCost was Rs 42,00,000.';
    const { source } = extractFromText(text);
    expect(source.text).toBe(text);
  });
});

describe('extractFromPdf', () => {
  it('extracts text, page count and section-aligned segments', async () => {
    const bytes = new Uint8Array(await readFile(sample('rainwater-pilot-report.pdf')));
    const { source } = await extractFromPdf(bytes, 'rainwater-pilot-report.pdf');

    expect(source.pageCount).toBe(3);
    expect(source.segments.length).toBeGreaterThan(5);
    expect(source.warnings).toHaveLength(0);

    // Every page is represented.
    expect([...new Set(source.segments.map((s) => s.page))].sort()).toEqual([1, 2, 3]);

    // Segment IDs are unique -- evidence resolution depends on this.
    const ids = source.segments.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('preserves figures, units and qualifications exactly', async () => {
    const bytes = new Uint8Array(await readFile(sample('rainwater-pilot-report.pdf')));
    const { source } = await extractFromPdf(bytes, 'rainwater-pilot-report.pdf');

    for (const fact of ['18.0%', '250 households', 'Rs 42,00,000', '1,120 mm', '5.6%', 'Rs 16,800']) {
      expect(source.text).toContain(fact);
    }
    // The limitation must survive extraction; it is the thing most easily lost.
    expect(source.text).toContain('do not automatically');
  });

  it('keeps a results table together as one evidence unit', async () => {
    const bytes = new Uint8Array(await readFile(sample('rainwater-pilot-report.pdf')));
    const { source } = await extractFromPdf(bytes, 'rainwater-pilot-report.pdf');

    const table = source.segments.find((s) => s.text.includes('Avg. household use'));
    expect(table).toBeDefined();
    for (const row of ['412', '96.2', '38%', '14 of 250']) {
      expect(table!.text).toContain(row);
    }
  });

  it('reports a scanned PDF as unsupported instead of returning empty content', async () => {
    const bytes = new Uint8Array(await readFile(sample('scanned-no-text.pdf')));
    await expect(extractFromPdf(bytes, 'scanned-no-text.pdf')).rejects.toThrow(/scanned|no extractable text/i);
  });
});

describe('paragraph reflow', () => {
  it('rejoins lines a PDF broke mid-sentence', async () => {
    const bytes = new Uint8Array(await readFile(sample('rainwater-pilot-report.pdf')));
    const { source } = await extractFromPdf(bytes, 'rainwater-pilot-report.pdf');

    const summary = source.segments.find((s) => s.heading?.startsWith('1. Summary'));
    expect(summary).toBeDefined();
    // The sentence spans three rendered lines in the PDF.
    expect(summary!.text).toContain('the Board ran a household rainwater harvesting pilot across four wards');
  });

  it('keeps a heading on its own line', async () => {
    const bytes = new Uint8Array(await readFile(sample('rainwater-pilot-report.pdf')));
    const { source } = await extractFromPdf(bytes, 'rainwater-pilot-report.pdf');

    const summary = source.segments.find((s) => s.heading?.startsWith('1. Summary'));
    expect(summary!.text.split('\n')[0]).toBe('1. Summary');
  });

  it('does not alter the figures while reflowing', async () => {
    const bytes = new Uint8Array(await readFile(sample('rainwater-pilot-report.pdf')));
    const { source } = await extractFromPdf(bytes, 'rainwater-pilot-report.pdf');
    const joined = source.segments.map((s) => s.text).join('\n');

    for (const fact of ['18%', '250 households', 'Rs 42,00,000', '1,120 mm', '5.6%']) {
      expect(joined).toContain(fact);
    }
  });
});

describe('resolveEvidence', () => {
  it('separates resolvable references from invalid ones', () => {
    const { source } = extractFromText(
      'Section one\nWater use fell by 18% across the pilot.\n\nSection two\nResults apply to the pilot only.',
    );
    const realId = source.segments[0].id;
    const { found, missing } = resolveEvidence(source, [realId, 'not-a-real-id']);

    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(realId);
    expect(missing).toEqual(['not-a-real-id']);
  });
});
