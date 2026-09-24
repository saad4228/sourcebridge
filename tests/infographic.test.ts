import { describe, expect, it } from 'vitest';
import { renderInfographicSvg } from '@/lib/export/svg';
import { resolveInfographicLayout } from '@/lib/export/infographicLayout';
import { validateArtifact } from '@/lib/validate';
import { extractFromText } from '@/lib/extract';
import type { Infographic } from '@/lib/schemas';

function graphic(overrides: Partial<Infographic>): Infographic {
  return {
    headline: 'A pilot cut household water use',
    subheadline: 'Riverside, October to December 2025',
    layout: 'stats',
    keyMessages: [
      { label: 'Lower demand', detail: 'Average household use fell across four wards.', evidence: [] },
    ],
    statistics: [{ value: '18', unit: '%', caption: 'Fall in household use', evidence: [] }],
    sourceFooter: 'Pilot report',
    altText: 'Household water use fell 18%.',
    ...overrides,
  };
}

const barChart = {
  kind: 'bar' as const,
  categories: ['Baseline', 'Pilot'],
  values: [412, 338],
  seriesName: 'Litres per household per day',
};

/** The drawn body, excluding the accessible description. */
function drawn(svg: string): string {
  return svg.slice(svg.indexOf('</desc>'));
}

function canvasHeight(svg: string): number {
  return Number(svg.match(/<svg[^>]*height="(\d+)"/)![1]);
}

describe('resolveInfographicLayout', () => {
  it('honours a usable request', () => {
    expect(resolveInfographicLayout(graphic({ layout: 'chart', chart: barChart }))).toBe('chart');
    expect(resolveInfographicLayout(graphic({ layout: 'stats' }))).toBe('stats');
  });

  it('falls back when a chart has no usable series', () => {
    expect(resolveInfographicLayout(graphic({ layout: 'chart' }))).toBe('stats');
    expect(resolveInfographicLayout(graphic({ layout: 'chart', chart: { ...barChart, values: [412] } }))).toBe('stats');
    expect(resolveInfographicLayout(graphic({ layout: 'chart', chart: { ...barChart, kind: 'none' } }))).toBe('stats');
  });

  it('refuses a donut of negative values, which has no meaningful share', () => {
    const negative = { ...barChart, kind: 'donut' as const, values: [-12, 40] };
    expect(resolveInfographicLayout(graphic({ layout: 'chart', chart: negative }))).toBe('stats');
    // The same values are fine as bars, where a negative simply reads as a magnitude.
    expect(resolveInfographicLayout(graphic({ layout: 'chart', chart: { ...negative, kind: 'bar' } }))).toBe('chart');
  });

  it('drops to qualitative when nothing numeric survives', () => {
    expect(resolveInfographicLayout(graphic({ layout: 'chart', statistics: [] }))).toBe('qualitative');
    expect(resolveInfographicLayout(graphic({ layout: 'stats', statistics: [] }))).toBe('qualitative');
  });

  it('needs both sides for a comparison', () => {
    const oneSided = {
      leftLabel: 'Before', leftValue: '412', leftPoints: [],
      rightLabel: 'After', rightValue: '', rightPoints: [],
    };
    expect(resolveInfographicLayout(graphic({ layout: 'comparison', comparison: oneSided }))).toBe('stats');
  });
});

describe('infographic rendering', () => {
  it('stays well-formed and escaped in every layout', () => {
    const hostile = '<script>alert(1)</script> & "quoted"';
    for (const content of [
      graphic({ headline: hostile }),
      graphic({ layout: 'chart', chart: barChart, headline: hostile }),
      graphic({ layout: 'qualitative', statistics: [], headline: hostile }),
    ]) {
      const svg = renderInfographicSvg(content);
      expect(svg.startsWith('<?xml')).toBe(true);
      expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
      expect(svg).not.toContain('<script>');
      expect(svg).toContain('&lt;script&gt;');
    }
  });

  it('plots the source values as bars, labelled', () => {
    const svg = renderInfographicSvg(graphic({ layout: 'chart', chart: barChart }));
    const body = drawn(svg);

    expect(body).toContain('412');
    expect(body).toContain('338');
    expect(body).toContain('Baseline');
    expect(body).toContain('Litres per household per day');
    expect(body).toContain('<rect');
  });

  it('draws a donut as arcs whose shares sum to the whole', () => {
    const svg = renderInfographicSvg(
      graphic({
        layout: 'chart',
        chart: { kind: 'donut', categories: ['Repaired', 'Working'], values: [14, 236], seriesName: 'Units' },
      }),
    );
    const body = drawn(svg);

    expect(body).toContain('<path');
    // 14 of 250 is 6%; 236 is 94%.
    expect(body).toContain('(6%)');
    expect(body).toContain('(94%)');
  });

  it('renders both sides of a comparison', () => {
    const svg = renderInfographicSvg(
      graphic({
        layout: 'comparison',
        comparison: {
          leftLabel: 'Baseline',
          leftValue: '412 L',
          leftPoints: ['Before the units were installed'],
          rightLabel: 'Pilot period',
          rightValue: '338 L',
          rightPoints: ['With harvesting in place'],
        },
      }),
    );
    const body = drawn(svg);

    for (const text of ['Baseline', '412 L', 'Pilot period', '338 L']) {
      expect(body).toContain(text);
    }
  });

  it('invents no figure when the source has none', () => {
    const svg = renderInfographicSvg(graphic({ layout: 'stats', statistics: [] }));
    const body = drawn(svg);

    expect(body).not.toContain('18%');
    expect(body).not.toContain('Fall in household use');
    // The message still carries the meaning in words.
    expect(body).toContain('Lower demand');
  });

  it('breaks an unbroken string rather than letting it run off the canvas', () => {
    // A URL, an identifier, or a script without spaces cannot be wrapped on
    // whitespace, so it has to be hard-broken.
    const svg = renderInfographicSvg(
      graphic({ headline: `https://example.gov.in/${'a'.repeat(200)}` }),
    );

    // The accessible <title> keeps the full string; the drawn text must not.
    const body = drawn(svg);
    expect(body).not.toContain('a'.repeat(200));

    const lines = [...body.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
  });

  it('fits the canvas to the content instead of padding it out', () => {
    const sparse = canvasHeight(renderInfographicSvg(graphic({ layout: 'qualitative', statistics: [] })));
    const full = canvasHeight(
      renderInfographicSvg(
        graphic({
          layout: 'chart',
          chart: barChart,
          keyMessages: Array.from({ length: 5 }, (_, i) => ({
            label: `Message ${i + 1}`,
            detail: 'A supporting sentence that takes a line of its own in the layout.',
            evidence: [],
          })),
        }),
      ),
    );

    expect(full).toBeGreaterThan(sparse);
    // Neither collapses nor runs away.
    expect(sparse).toBeGreaterThanOrEqual(620);
    expect(full).toBeLessThan(2000);
  });
});

describe('infographic validation', () => {
  const source = extractFromText(
    'Summary\nAverage household use fell from 412 to 338 litres per day across 250 households.',
    'Pilot report',
  ).source;

  it('checks plotted values against the source', () => {
    const findings = validateArtifact({
      format: 'infographic',
      grounded: true,
      source,
      content: graphic({
        layout: 'chart',
        // 338 is in the source; 999 is not.
        chart: { ...barChart, values: [412, 999] },
        statistics: [],
        keyMessages: [{ label: 'Lower demand', detail: 'Use fell.', evidence: [source.segments[0].id] }],
      }),
    });

    expect(findings.find((f) => f.type === 'unverified_number')?.message).toContain('999');
  });

  it('ignores an unused layout block left blank by the model', () => {
    const findings = validateArtifact({
      format: 'infographic',
      grounded: true,
      source,
      content: graphic({
        layout: 'stats',
        statistics: [{ value: '412', unit: '', caption: 'Litres per day', evidence: [source.segments[0].id] }],
        chart: { kind: 'none', categories: [], values: [], seriesName: '' },
        comparison: { leftLabel: '', leftValue: '', leftPoints: [], rightLabel: '', rightValue: '', rightPoints: [] },
        keyMessages: [{ label: 'Lower demand', detail: 'Use fell.', evidence: [source.segments[0].id] }],
      }),
    });

    expect(findings.filter((f) => f.type === 'empty_field')).toHaveLength(0);
  });
});
