/**
 * Passage sizing.
 *
 * Evidence links resolve to a passage, so passage size decides what "click a
 * claim to see the source behind it" actually shows. Segmentation used to
 * break only between lines, which meant the size target had no effect on prose
 * arriving as one long line -- and that is exactly what pasted text and web
 * articles give, since `blocksToText` emits one line per block element. Ten
 * thousand characters without a line break became a single passage covering
 * the whole document, and every claim cited all of it.
 *
 * It also cost precision in meaning-drift detection, which compares an output
 * against the passage it cites: an oversized passage lends its qualifiers to
 * claims that never made them.
 */

import { describe, expect, it } from 'vitest';
import { extractFromArticle, extractFromText } from '@/lib/extract';
import { detectMeaningDrift } from '@/lib/meaningDrift';

/** Realistic prose: full sentences, no hard line breaks. */
const sentence = (i: number) =>
  `Finding ${i}: preliminary analysis indicates that approximately ${60 + i} percent of ` +
  `households in the pilot wards reduced daily consumption, though attribution remains ` +
  `unconfirmed.`;

const unbroken = (count: number) =>
  Array.from({ length: count }, (_, i) => sentence(i + 1)).join(' ');

const sizes = (text: string, title = 'pasted') =>
  extractFromText(text, title).source.segments.map((s) => s.text.length);

describe('a long line with no breaks', () => {
  it('is split into quotable passages rather than becoming one', () => {
    const text = unbroken(60);
    const segments = sizes(text);

    expect(text.length).toBeGreaterThan(9000);
    // Previously exactly one segment, whatever the length.
    expect(segments.length).toBeGreaterThan(8);
    expect(Math.max(...segments)).toBeLessThan(1000);
  });

  it('keeps every passage well under the whole document', () => {
    const text = unbroken(20);
    for (const size of sizes(text)) expect(size).toBeLessThan(text.length / 2);
  });

  it('leaves a short source as a single passage', () => {
    // Splitting here would fragment a paragraph that is already quotable.
    expect(sizes(unbroken(1))).toHaveLength(1);
    expect(sizes(unbroken(2))).toHaveLength(1);
  });

  it('loses no words while splitting', () => {
    const text = unbroken(12);
    const { source } = extractFromText(text, 'pasted');

    const original = text.split(/\s+/).filter(Boolean).join(' ');
    const rejoined = source.segments
      .map((s) => s.text)
      .join(' ')
      .split(/\s+/)
      .filter(Boolean)
      .join(' ');

    expect(rejoined).toBe(original);
  });

  it('breaks on sentence ends, so a passage reads as the source wrote it', () => {
    const { source } = extractFromText(unbroken(30), 'pasted');
    // Every passage but the last ends a sentence rather than stopping mid-clause.
    for (const segment of source.segments.slice(0, -1)) {
      expect(segment.text.trim()).toMatch(/[.!?]$/);
    }
  });

  it('still splits prose with no sentence punctuation at all', () => {
    const runOn = Array.from({ length: 400 }, (_, i) => `token${i}`).join(' ');
    const segments = sizes(runOn);

    expect(segments.length).toBeGreaterThan(1);
    expect(Math.max(...segments)).toBeLessThan(1000);
  });

  it('breaks a single unbroken token rather than holding a whole document', () => {
    const segments = sizes('x'.repeat(5000));
    expect(segments.length).toBeGreaterThan(1);
    expect(Math.max(...segments)).toBeLessThan(1000);
  });

  it('gives every passage a unique, resolvable id', () => {
    const { source } = extractFromText(unbroken(40), 'pasted');
    const ids = source.segments.map((s) => s.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith(source.id)).toBe(true);
  });
});

describe('a web article of long paragraphs', () => {
  it('splits each paragraph instead of one passage per paragraph', () => {
    // blocksToText emits one line per block element, so a paragraph is a line.
    const article = [unbroken(8), unbroken(8), unbroken(8)].join('\n');
    const { source } = extractFromArticle(article, 'Pilot report', []);

    expect(source.segments.length).toBeGreaterThan(3);
    expect(Math.max(...source.segments.map((s) => s.text.length))).toBeLessThan(1000);
  });
});

describe('drift precision', () => {
  /**
   * A passage can only lend its qualifiers to claims that cite it, so bounding
   * passage size bounds how far a qualifier reaches. Adjacent short sentences
   * still share a passage, which is correct at a 450-character target; what
   * changes is that a hedge on page three no longer attaches to a claim drawn
   * from the opening line.
   */
  it('does not charge a claim with a qualifier from far away in the source', () => {
    const plain = 'Twelve wards took part in the pilot programme between March and August.';
    const neutral =
      'The programme covered residential buildings in the northern district and the eastern ' +
      'district of the municipality.';
    const hedged =
      'Preliminary analysis indicates that approximately 68 percent of households reduced ' +
      'consumption, though attribution remains unconfirmed.';

    // One line: the hedge sits well past the opening claim, as it would in a
    // real document. Before passages were bounded this was all one passage.
    const text = `${plain} ${Array.from({ length: 14 }, () => neutral).join(' ')} ${hedged}`;
    const { source } = extractFromText(text, 'pilot');

    expect(source.segments.length).toBeGreaterThan(2);

    const cited = source.segments.find((s) => s.text.includes('Twelve wards'))!;
    expect(cited).toBeDefined();
    // The distant hedge is no longer part of the passage this claim cites.
    expect(cited.text).not.toMatch(/preliminary|approximately|unconfirmed/i);

    const findings = detectMeaningDrift({
      content: {
        keyEvidence: [
          { point: 'Twelve wards took part between March and August.', evidence: [cited.id] },
        ],
      },
      source,
    });

    expect(findings).toEqual([]);
  });

  it('still reports a qualifier that really is in the cited passage', () => {
    // The check must stay sensitive: bounding passages must not blind it.
    const { source } = extractFromText(unbroken(30), 'pilot');
    const cited = source.segments.find((s) => /preliminary/i.test(s.text))!;

    const findings = detectMeaningDrift({
      content: {
        keyEvidence: [{ point: '61 percent of households reduced use.', evidence: [cited.id] }],
      },
      source,
    });

    expect(findings.some((f) => f.type === 'qualifier_dropped')).toBe(true);
  });
});
