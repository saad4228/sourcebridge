import { describe, expect, it } from 'vitest';
import { collectCitedClaims, detectMeaningDrift } from '@/lib/meaningDrift';
import type { Source } from '@/lib/types';

/** A source whose passages carry the qualifiers a careless summary drops. */
const source: Source = {
  id: 'src-1',
  kind: 'pdf',
  title: 'incident.pdf',
  text: '',
  pageCount: 3,
  warnings: [],
  charCount: 0,
  extractedAt: '2026-09-25T00:00:00.000Z',
  segments: [
    {
      id: 'seg-partial',
      sourceId: 'src-1',
      page: 1,
      text: 'Some critical infrastructure may have been affected during the incident window.',
    },
    {
      id: 'seg-prelim',
      sourceId: 'src-1',
      page: 1,
      text:
        'Preliminary analysis indicates that approximately 68% of the affected systems were ' +
        'restored within six hours.',
    },
    {
      id: 'seg-attrib',
      sourceId: 'src-1',
      page: 3,
      text: 'Attribution to any specific actor remains unconfirmed.',
    },
    {
      id: 'seg-plain',
      sourceId: 'src-1',
      page: 2,
      text: 'Peak volumetric load measured 486 Gbps.',
    },
  ],
};

const run = (content: unknown) => detectMeaningDrift({ content, source });
const types = (content: unknown) => run(content).map((f) => f.type);

describe('escalation', () => {
  it('catches partial scope restated as total', () => {
    const findings = run({
      body: 'All critical infrastructure was affected.',
      evidence: ['seg-partial'],
    });

    // The number never changed, so the numeric check cannot see this. It is
    // the single most dangerous rewrite in an intelligence context.
    expect(findings[0].type).toBe('meaning_drift');
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('some');
    expect(findings[0].message).toContain('all');
    expect(findings[0].refs).toEqual(['seg-partial']);
  });

  it('catches an unverified claim restated as confirmed', () => {
    expect(types({ body: 'Attribution has been confirmed.', evidence: ['seg-attrib'] })).toContain(
      'meaning_drift',
    );
  });

  it('catches a provisional finding restated as settled', () => {
    expect(
      types({ body: 'Final analysis shows 68% were restored.', evidence: ['seg-prelim'] }),
    ).toContain('meaning_drift');
  });

  it('does not fire when the output keeps the weak form', () => {
    const findings = run({
      body: 'Some infrastructure may have been affected, and all of it is being reviewed.',
      evidence: ['seg-partial'],
    });

    // "all" appears, but the hedge survives alongside it, so the claim was
    // not escalated. Flagging this would train reviewers to ignore the check.
    expect(findings.filter((f) => f.type === 'meaning_drift')).toHaveLength(0);
  });
});

describe('dropped qualifiers', () => {
  it('flags a preliminary finding stated bare', () => {
    const findings = run({ body: '68% of systems were restored.', evidence: ['seg-prelim'] });
    const dropped = findings.filter((f) => f.type === 'qualifier_dropped');

    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped[0].severity).toBe('warning');
    expect(dropped[0].refs).toEqual(['seg-prelim']);
  });

  it('accepts a faithful paraphrase within the same family', () => {
    // "approximately" became "around" and "preliminary" became "initial".
    // Both still carry the qualification, so neither is drift.
    const findings = run({
      body: 'Initial analysis suggests around 68% of systems were restored.',
      evidence: ['seg-prelim'],
    });

    expect(findings).toHaveLength(0);
  });

  it('stays quiet on a passage with nothing to qualify', () => {
    expect(run({ body: 'Peak load reached 486 Gbps.', evidence: ['seg-plain'] })).toHaveLength(0);
  });

  it('reports each family once, not once per claim', () => {
    const findings = run({
      items: [
        { body: '68% were restored.', evidence: ['seg-prelim'] },
        { body: '68% of systems came back.', evidence: ['seg-prelim'] },
        { body: 'Systems were restored.', evidence: ['seg-prelim'] },
      ],
    });

    // Repeating the same warning for every bullet buries the other findings.
    const provisional = findings.filter((f) => f.type === 'qualifier_dropped');
    expect(new Set(provisional.map((f) => f.message)).size).toBe(provisional.length);
  });
});

describe('claim collection', () => {
  it('pairs each text block with the evidence it cites', () => {
    const claims = collectCitedClaims({
      title: 'Not cited, so not a claim',
      slides: [{ heading: 'Impact', body: '37 systems', evidence: ['seg-plain'] }],
    });

    expect(claims).toHaveLength(1);
    expect(claims[0].evidence).toEqual(['seg-plain']);
    expect(claims[0].text).toContain('37 systems');
    expect(claims[0].path).toBe('slides.0');
  });

  it('keeps a nested cited block separate from its parent', () => {
    // Otherwise a parent inherits its children's wording and the comparison
    // is made against text that does not cite that passage.
    const claims = collectCitedClaims({
      summary: 'Parent claim',
      evidence: ['seg-plain'],
      detail: { body: 'Child claim', evidence: ['seg-prelim'] },
    });

    expect(claims).toHaveLength(2);
    expect(claims[0].text).toBe('Parent claim');
    expect(claims[0].text).not.toContain('Child claim');
  });

  it('ignores evidence that does not resolve to a passage', () => {
    // Unresolvable IDs are already reported by the evidence check; comparing
    // against nothing would add a second, less useful finding.
    expect(run({ body: 'All systems failed.', evidence: ['seg-missing'] })).toHaveLength(0);
  });
});

describe('word matching', () => {
  it('does not match a qualifier inside a longer word', () => {
    // "may" inside "maybe"/"mayor" must not count as a hedge.
    const withMayor: Source = {
      ...source,
      segments: [{ id: 'seg-x', sourceId: 'src-1', page: 1, text: 'The mayor issued a statement.' }],
    };

    expect(
      detectMeaningDrift({ content: { body: 'A statement was issued.', evidence: ['seg-x'] }, source: withMayor }),
    ).toHaveLength(0);
  });
});

describe('negation', () => {
  it('does not read "not verified" as a claim that it was verified', () => {
    // This reached the findings panel: a slide correctly reporting that
    // attribution was not verified was flagged for saying "verified".
    const findings = run({
      body: 'Attribution has not been independently verified.',
      evidence: ['seg-attrib'],
    });

    expect(findings.filter((f) => f.type === 'meaning_drift')).toHaveLength(0);
  });

  it('handles the other negated forms', () => {
    for (const body of [
      'Attribution was never confirmed.',
      'No actor has been confirmed.',
      "Attribution hasn't been confirmed.",
      'Published without confirmed attribution.',
    ]) {
      expect(types({ body, evidence: ['seg-attrib'] })).not.toContain('meaning_drift');
    }
  });

  it('still catches the escalation when it really is asserted', () => {
    // The fix must not blunt the check it protects.
    expect(
      types({ body: 'Attribution has been confirmed.', evidence: ['seg-attrib'] }),
    ).toContain('meaning_drift');
  });

  it('catches an assertion elsewhere in a sentence that also negates', () => {
    // "confirmed" here is asserted despite the earlier negation.
    expect(
      types({
        body: 'The outage was not brief; attribution is confirmed.',
        evidence: ['seg-attrib'],
      }),
    ).toContain('meaning_drift');
  });
});

describe('finding volume', () => {
  it('reports every dropped family in one finding, not one each', () => {
    const findings = run({
      body: '68% of systems were restored.',
      evidence: ['seg-prelim'],
    });
    const dropped = findings.filter((f) => f.type === 'qualifier_dropped');

    // Three near-identical rows push the specific escalation out of view.
    expect(dropped).toHaveLength(1);
    expect(dropped[0].message).toContain('preliminary');
    expect(dropped[0].message).toContain('approximately');
  });

  it('keeps the singular reading when only one family is missing', () => {
    // seg-attrib carries one hedge family; seg-prelim carries two.
    const findings = run({ body: 'Attribution was discussed at length.', evidence: ['seg-attrib'] });
    const dropped = findings.filter((f) => f.type === 'qualifier_dropped');

    expect(dropped).toHaveLength(1);
    expect(dropped[0].message).toMatch(/That qualifier does not appear/);
    expect(dropped[0].message).toMatch(/Confirm it still applies/);
  });

  it('carries the evidence of every claim that dropped something', () => {
    const findings = run({
      items: [
        { body: '68% were restored.', evidence: ['seg-prelim'] },
        { body: 'Infrastructure was affected.', evidence: ['seg-partial'] },
      ],
    });
    const dropped = findings.find((f) => f.type === 'qualifier_dropped');

    expect(dropped?.refs).toEqual(expect.arrayContaining(['seg-prelim', 'seg-partial']));
  });
});
