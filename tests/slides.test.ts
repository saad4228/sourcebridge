import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { renderPresentationPptx } from '@/lib/export/pptx';
import { renderMarkdown } from '@/lib/export/markdown';
import { resolveLayout, type Slide } from '@/lib/export/slideLayout';
import { validateArtifact } from '@/lib/validate';
import { extractFromText } from '@/lib/extract';
import type { Presentation } from '@/lib/schemas';

function slide(overrides: Partial<Slide>): Slide {
  return {
    title: 'A slide',
    layout: 'bullets',
    mainMessage: 'The point of this slide.',
    bullets: ['One', 'Two'],
    speakerNotes: '',
    visualType: 'none',
    evidence: [],
    ...overrides,
  };
}

function deckOf(...slides: Slide[]): Presentation {
  return { title: 'Deck', subtitle: '', slides };
}

async function open(deck: Presentation) {
  return JSZip.loadAsync(await renderPresentationPptx(deck));
}

const barChart = {
  kind: 'bar' as const,
  categories: ['Baseline', 'Pilot'],
  values: [412, 338],
  seriesName: 'Litres per household per day',
};

describe('resolveLayout', () => {
  it('honours a usable request', () => {
    expect(resolveLayout(slide({ layout: 'chart', chart: barChart }))).toBe('chart');
    expect(
      resolveLayout(slide({ layout: 'stat', keyStat: { value: '18', unit: '%', caption: 'Fall' } })),
    ).toBe('stat');
  });

  it('falls back when a chart has no usable series', () => {
    // One value is not a comparison; mismatched lengths cannot be plotted.
    expect(resolveLayout(slide({ layout: 'chart', chart: { ...barChart, values: [412] } }))).toBe('bullets');
    expect(
      resolveLayout(slide({ layout: 'chart', chart: { ...barChart, categories: ['Only one'] } })),
    ).toBe('bullets');
    expect(resolveLayout(slide({ layout: 'chart', chart: { ...barChart, kind: 'none' } }))).toBe('bullets');
    expect(resolveLayout(slide({ layout: 'chart' }))).toBe('bullets');
  });

  it('falls back when a stat has no figure', () => {
    expect(resolveLayout(slide({ layout: 'stat' }))).toBe('bullets');
    expect(
      resolveLayout(slide({ layout: 'stat', keyStat: { value: '  ', unit: '', caption: 'x' } })),
    ).toBe('bullets');
  });

  it('uses a statement when there is nothing to fall back to', () => {
    expect(resolveLayout(slide({ layout: 'chart', bullets: [] }))).toBe('statement');
    expect(resolveLayout(slide({ layout: 'bullets', bullets: [] }))).toBe('statement');
  });

  it('needs both sides for a comparison', () => {
    const comparison = { leftLabel: 'Before', leftPoints: ['a'], rightLabel: 'After', rightPoints: [] };
    expect(resolveLayout(slide({ layout: 'comparison', comparison }))).toBe('bullets');
  });
});

describe('PPTX layouts', () => {
  it('writes a real, editable chart carrying the source values', async () => {
    const zip = await open(deckOf(slide({ title: 'Use fell', layout: 'chart', chart: barChart })));
    const charts = Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));

    // A native chart part, not a picture of one.
    expect(charts).toHaveLength(1);
    const xml = await zip.file(charts[0])!.async('string');
    expect(xml).toContain('412');
    expect(xml).toContain('338');
    expect(xml).toContain('Baseline');
    expect(xml).toContain('Pilot');
  });

  it('draws no chart when the requested chart is unusable', async () => {
    const zip = await open(
      deckOf(slide({ layout: 'chart', chart: { ...barChart, values: [412] }, bullets: ['Fallback bullet'] })),
    );
    const charts = Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
    expect(charts).toHaveLength(0);

    const slideXml = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(slideXml).toContain('Fallback bullet');
  });

  it('renders a headline figure exactly as given', async () => {
    const zip = await open(
      deckOf(
        slide({
          layout: 'stat',
          keyStat: { value: 'Rs 42,00,000', unit: '', caption: 'Total programme cost' },
        }),
      ),
    );
    const xml = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(xml).toContain('Rs 42,00,000');
    expect(xml).toContain('Total programme cost');
  });

  it('renders both sides of a comparison', async () => {
    const zip = await open(
      deckOf(
        slide({
          layout: 'comparison',
          comparison: {
            leftLabel: 'What the pilot showed',
            leftPoints: ['Use fell 18%'],
            rightLabel: 'What it did not show',
            rightPoints: ['No control group'],
          },
        }),
      ),
    );
    const xml = await zip.file('ppt/slides/slide2.xml')!.async('string');
    for (const text of ['What the pilot showed', 'Use fell 18%', 'What it did not show', 'No control group']) {
      expect(xml).toContain(text);
    }
  });

  it('keeps speaker notes and evidence on every layout', async () => {
    const zip = await open(
      deckOf(
        slide({ layout: 'chart', chart: barChart, speakerNotes: 'Chart note', evidence: ['src-1-p2-2'] }),
        slide({ layout: 'section', speakerNotes: 'Section note', evidence: ['src-1-p3-1'] }),
      ),
    );
    const notes = Object.keys(zip.files).filter((n) => /notesSlide\d+\.xml$/.test(n));
    const joined = (await Promise.all(notes.map((n) => zip.file(n)!.async('string')))).join('\n');

    expect(joined).toContain('Chart note');
    expect(joined).toContain('Section note');
    expect(joined).toContain('src-1-p2-2');
    expect(joined).toContain('src-1-p3-1');
  });
});

describe('validation of unused layout blocks', () => {
  it('ignores empty blocks belonging to a layout that is not drawn', () => {
    const source = extractFromText(
      'Summary\nThe pilot ran for three months and 250 households took part.\n\n' +
        'Limitations\nResults apply to the pilot population only.',
      'Pilot report',
    ).source;

    // The model routinely fills every layout block, leaving the unused ones blank.
    const deck = deckOf(
      slide({
        layout: 'bullets',
        bullets: ['250 households took part'],
        keyStat: { value: '', unit: '', caption: '' },
        comparison: { leftLabel: '', leftPoints: [], rightLabel: '', rightPoints: [] },
        chart: { kind: 'none', categories: [], values: [], seriesName: '' },
        speakerNotes: 'Notes.',
        evidence: [source.segments[0].id],
      }),
    );

    const findings = validateArtifact({ format: 'presentation', grounded: true, source, content: deck });
    expect(findings.filter((f) => f.type === 'empty_field')).toHaveLength(0);
  });

  it('still reports an empty field on the layout actually drawn', () => {
    const source = extractFromText(
      'Summary\nThe pilot ran for three months and 250 households took part.',
      'Pilot report',
    ).source;

    const deck = deckOf(
      slide({
        layout: 'stat',
        bullets: [],
        // Drawn as a stat, so a blank caption is a real defect.
        keyStat: { value: '250', unit: '', caption: '' },
        speakerNotes: 'Notes.',
        evidence: [source.segments[0].id],
      }),
    );

    const findings = validateArtifact({ format: 'presentation', grounded: true, source, content: deck });
    expect(findings.find((f) => f.type === 'empty_field')?.field).toBe('slides.0.keyStat.caption');
  });
});

describe('presentation Markdown', () => {
  it('describes each layout rather than dropping its data', () => {
    const md = renderMarkdown(
      'presentation',
      deckOf(
        slide({ title: 'Figure', layout: 'stat', keyStat: { value: '18', unit: '%', caption: 'Fall in use' } }),
        slide({ title: 'Trend', layout: 'chart', chart: barChart }),
      ),
    );

    expect(md).toContain('**18%** — Fall in use');
    expect(md).toContain('| Baseline | 412 |');
    expect(md).toContain('| Pilot | 338 |');
  });
});
