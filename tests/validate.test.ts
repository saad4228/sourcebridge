import { describe, expect, it } from 'vitest';
import { extractFromText } from '@/lib/extract';
import { validateArtifact } from '@/lib/validate';
import type { Presentation, VideoPackage, XThread } from '@/lib/schemas';

const SOURCE_TEXT = [
  '1. Summary',
  'The pilot ran for three months. 250 households participated.',
  'Average household water consumption fell by 18.0%.',
  'Programme cost was Rs 42,00,000.',
  '',
  '2. Limitations',
  'Results apply to the pilot population only and do not automatically generalise.',
].join('\n');

function buildSource() {
  return extractFromText(SOURCE_TEXT, 'Pilot report').source;
}

describe('evidence validation', () => {
  it('flags evidence IDs that do not exist in the source', () => {
    const source = buildSource();
    const findings = validateArtifact({
      format: 'exec_summary',
      grounded: true,
      source,
      content: {
        title: 'Pilot results',
        mainFinding: 'Consumption fell by 18.0%.',
        whyItMatters: 'It suggests the intervention works.',
        keyEvidence: [{ point: 'Consumption fell', evidence: ['made-up-id'] }],
        implications: ['Consider a wider trial.'],
        actions: [{ action: 'Extend the pilot', fromSource: true }],
        uncertainties: ['No control group was used.'],
      },
    });

    const invalid = findings.find((f) => f.type === 'invalid_evidence');
    expect(invalid).toBeDefined();
    expect(invalid!.severity).toBe('error');
    expect(invalid!.refs).toEqual(['made-up-id']);
  });

  it('accepts evidence IDs that resolve against the source', () => {
    const source = buildSource();
    const findings = validateArtifact({
      format: 'exec_summary',
      grounded: true,
      source,
      content: {
        title: 'Pilot results',
        mainFinding: 'Consumption fell by 18.0%.',
        whyItMatters: 'It suggests the intervention works.',
        keyEvidence: [{ point: 'Consumption fell', evidence: [source.segments[0].id] }],
        implications: ['Consider a wider trial.'],
        actions: [{ action: 'Extend the pilot', fromSource: true }],
        uncertainties: ['No control group was used.'],
      },
    });

    expect(findings.find((f) => f.type === 'invalid_evidence')).toBeUndefined();
  });

  it('warns when a grounded artefact cites nothing at all', () => {
    const source = buildSource();
    const findings = validateArtifact({
      format: 'linkedin',
      grounded: true,
      source,
      content: {
        hook: 'A pilot cut water use.',
        body: 'Consumption fell by 18.0% across 250 households.',
        keyTakeaway: 'Small interventions add up.',
        callToAction: '',
        hashtags: [],
        evidence: [],
      },
    });

    expect(findings.find((f) => f.type === 'no_evidence')).toBeDefined();
  });
});

describe('numeric validation', () => {
  it('flags a figure that does not appear in the source', () => {
    const source = buildSource();
    const findings = validateArtifact({
      format: 'linkedin',
      grounded: true,
      source,
      content: {
        hook: 'Water use dropped sharply.',
        // 34% is not in the source. This is exactly the drift we must catch.
        body: 'Consumption fell by 34% across 250 households.',
        keyTakeaway: 'Worth scaling.',
        callToAction: '',
        hashtags: [],
        evidence: [source.segments[0].id],
      },
    });

    const numeric = findings.find((f) => f.type === 'unverified_number');
    expect(numeric).toBeDefined();
    expect(numeric!.message).toContain('34%');
  });

  it('does not flag figures that match the source, allowing for formatting', () => {
    const source = buildSource();
    const findings = validateArtifact({
      format: 'linkedin',
      grounded: true,
      source,
      content: {
        hook: 'Water use dropped.',
        // "18%" should match the source's "18.0%"; the rupee figure matches exactly.
        body: 'Consumption fell by 18% across 250 households, at a cost of Rs 42,00,000.',
        keyTakeaway: 'Worth scaling.',
        callToAction: '',
        hashtags: [],
        evidence: [source.segments[0].id],
      },
    });

    expect(findings.find((f) => f.type === 'unverified_number')).toBeUndefined();
  });

  it('matches a bare figure against a percentage in the source', () => {
    const source = buildSource();
    // The infographic schema holds the figure and its unit in separate fields,
    // so "18" arrives bare while the source reads "18.0%".
    const findings = validateArtifact({
      format: 'infographic',
      grounded: true,
      source,
      content: {
        headline: 'Water use fell',
        subheadline: '',
        keyMessages: [{ label: 'Lower use', detail: 'Consumption dropped.', evidence: [source.segments[0].id] }],
        statistics: [
          { value: '18', unit: '%', caption: 'Fall in household use', evidence: [source.segments[0].id] },
          { value: '250', unit: '', caption: 'Households', evidence: [source.segments[0].id] },
        ],
        sourceFooter: 'Pilot report',
        altText: 'Water use fell 18% across 250 households.',
      },
    });

    expect(findings.find((f) => f.type === 'unverified_number')).toBeUndefined();
  });

  it('checks chart values, which are numbers rather than prose', () => {
    const source = buildSource();
    const deck: Presentation = {
      title: 'Pilot results',
      subtitle: '',
      slides: [
        {
          title: 'Use before and after',
          layout: 'chart',
          mainMessage: 'Household use fell.',
          bullets: [],
          chart: {
            kind: 'bar',
            categories: ['Before', 'After'],
            // 250 is in the source; 612 is not. A plotted figure is a claim like any other.
            values: [250, 612],
            seriesName: 'Litres per day',
          },
          speakerNotes: '',
          visualType: 'chart',
          evidence: [source.segments[0].id],
        },
      ],
    };

    const findings = validateArtifact({ format: 'presentation', grounded: true, source, content: deck });
    const numeric = findings.find((f) => f.type === 'unverified_number');

    expect(numeric).toBeDefined();
    expect(numeric!.message).toContain('612');
    expect(numeric!.message).not.toContain('250 (');
  });

  it('checks a headline stat on a slide', () => {
    const source = buildSource();
    const deck: Presentation = {
      title: 'Pilot results',
      subtitle: '',
      slides: [
        {
          title: 'The headline',
          layout: 'stat',
          mainMessage: 'Use fell sharply.',
          bullets: [],
          keyStat: { value: '41', unit: '%', caption: 'Fall in household use' },
          speakerNotes: '',
          visualType: 'none',
          evidence: [source.segments[0].id],
        },
      ],
    };

    const findings = validateArtifact({ format: 'presentation', grounded: true, source, content: deck });
    // The unit lives in its own field, so the value is reported bare, with its location.
    expect(findings.find((f) => f.type === 'unverified_number')?.message).toContain(
      '41 (in slides.0.keyStat.value)',
    );
  });

  it('ignores structural numbers such as scene indices and durations', () => {
    const source = buildSource();
    const pkg: VideoPackage = {
      title: 'Pilot results',
      objective: 'Inform residents',
      scenes: [
        {
          index: 1,
          heading: 'Opening',
          // 27 and 1 are structural, not claims about the world.
          estimatedSeconds: 27,
          narration: 'A three-month pilot reduced water use by 18.0%.',
          onScreenText: '',
          visualRecommendation: 'Footage of a collection unit.',
          evidence: [source.segments[0].id],
        },
      ],
      fullScript: 'A three-month pilot reduced water use by 18.0%.',
    };

    const findings = validateArtifact({
      format: 'video_package',
      grounded: true,
      source,
      content: pkg,
    });

    expect(findings.find((f) => f.type === 'unverified_number')).toBeUndefined();
  });
});

describe('format-specific checks', () => {
  it('flags X posts over the character limit and labels counts as approximate', () => {
    const source = buildSource();
    const thread: XThread = {
      isThread: true,
      posts: [
        { text: 'x'.repeat(320), evidence: [source.segments[0].id] },
        { text: 'A short post.', evidence: [] },
      ],
      callToAction: '',
    };

    const findings = validateArtifact({ format: 'x_thread', grounded: true, source, content: thread });
    const overflow = findings.find((f) => f.type === 'length_exceeded');

    expect(overflow).toBeDefined();
    expect(overflow!.message).toMatch(/approximate/i);
  });

  it('flags slide content likely to overflow the exported layout', () => {
    const source = buildSource();
    const deck: Presentation = {
      title: 'Pilot results',
      subtitle: '',
      slides: [
        {
          title: 'T'.repeat(85),
          layout: 'bullets',
          mainMessage: 'Overlong title.',
          bullets: ['b'.repeat(150)],
          speakerNotes: 'Notes.',
          visualType: 'none',
          evidence: [source.segments[0].id],
        },
      ],
    };

    const findings = validateArtifact({ format: 'presentation', grounded: true, source, content: deck });
    expect(findings.filter((f) => f.type === 'overflow_risk')).toHaveLength(2);
  });

  it('treats an infographic with no statistics as expected, not broken', () => {
    const source = buildSource();
    const findings = validateArtifact({
      format: 'infographic',
      grounded: true,
      source,
      content: {
        headline: 'A pilot reduced household water use',
        subheadline: '',
        keyMessages: [{ label: 'Lower demand', detail: 'Households used less.', evidence: [source.segments[0].id] }],
        statistics: [],
        sourceFooter: 'Pilot report',
        altText: 'A summary of the pilot.',
      },
    });

    const qualitative = findings.find((f) => f.type === 'qualitative_layout');
    expect(qualitative).toBeDefined();
    expect(qualitative!.severity).toBe('info');
  });

  it('labels video timings as estimates', () => {
    const source = buildSource();
    const findings = validateArtifact({
      format: 'video_package',
      grounded: true,
      source,
      content: {
        title: 'T',
        objective: 'O',
        scenes: [
          {
            index: 1,
            heading: 'H',
            estimatedSeconds: 30,
            narration: 'N',
            onScreenText: '',
            visualRecommendation: 'V',
            evidence: [],
          },
        ],
        fullScript: 'N',
      } satisfies VideoPackage,
    });

    const timing = findings.find((f) => f.type === 'estimated_timing');
    expect(timing).toBeDefined();
    expect(timing!.message).toMatch(/estimate/i);
  });
});

describe('creative mode', () => {
  it('ignores citations when there is no source to verify them against', () => {
    const findings = validateArtifact({
      format: 'linkedin',
      grounded: false,
      source: null,
      content: {
        hook: 'Ideas for a campaign.',
        body: 'Draft copy.',
        keyTakeaway: 'Take it further.',
        callToAction: '',
        hashtags: [],
        evidence: ['invented-citation'],
      },
    });

    const finding = findings.find((f) => f.type === 'evidence_in_creative_mode');
    expect(finding).toBeDefined();
    expect(finding!.message).toMatch(/not source-verified/i);
  });
});
