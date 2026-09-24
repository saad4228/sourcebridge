import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { renderPresentationPptx } from '@/lib/export/pptx';
import { renderInfographicSvg } from '@/lib/export/svg';
import { renderSrt, renderStoryboardCsv, renderVideoPackageZip } from '@/lib/export/videoPackage';
import { renderMarkdown } from '@/lib/export/markdown';
import type { Infographic, Presentation, VideoPackage } from '@/lib/schemas';

const deck: Presentation = {
  title: 'Rainwater pilot results',
  subtitle: 'Riverside Municipal Water Board',
  slides: [
    {
      title: 'Consumption fell 18.0%',
      layout: 'bullets',
      mainMessage: 'The pilot reduced average household water use.',
      bullets: ['250 households took part', 'Average use fell from 412 to 338 L/day'],
      speakerNotes: 'Stress that this covers the pilot population only.',
      visualType: 'chart',
      evidence: ['src-1-p2-2'],
    },
    {
      title: 'Limitations',
      layout: 'bullets',
      mainMessage: 'Results do not generalise automatically.',
      bullets: ['No control group', 'Rainfall was 23% above average'],
      speakerNotes: 'Do not let this slide be cut.',
      visualType: 'none',
      evidence: ['src-1-p3-1'],
    },
  ],
};

const infographic: Infographic = {
  headline: 'A rainwater pilot cut household water use',
  subheadline: 'Riverside, October to December 2025',
  layout: 'stats',
  keyMessages: [
    { label: 'Lower demand', detail: 'Average household use fell across four wards.', evidence: ['src-1-p2-2'] },
    { label: 'Pilot only', detail: 'Results apply to participants, not the whole city.', evidence: ['src-1-p3-1'] },
  ],
  statistics: [
    { value: '18.0', unit: '%', caption: 'Fall in average household use', evidence: ['src-1-p2-2'] },
    { value: '250', unit: '', caption: 'Households participating', evidence: ['src-1-p1-3'] },
  ],
  sourceFooter: 'Rainwater Harvesting Pilot: Final Report, RMWB-2026-014',
  altText: 'Average household water use fell 18.0% across 250 participating households.',
};

const video: VideoPackage = {
  title: 'Rainwater pilot explained',
  objective: 'Inform residents about the pilot results',
  scenes: [
    {
      index: 1,
      heading: 'Opening',
      estimatedSeconds: 20,
      narration: 'Riverside ran a rainwater harvesting pilot. 250 households took part over three months.',
      onScreenText: 'A three-month pilot',
      visualRecommendation: 'Wide shot of a residential street.',
      evidence: ['src-1-p1-3'],
    },
    {
      index: 2,
      heading: 'Results',
      estimatedSeconds: 25,
      narration: 'Average household water use fell by 18.0%. These results apply to the pilot population only.',
      onScreenText: '-18.0%',
      visualRecommendation: 'Animated bar chart.',
      evidence: ['src-1-p2-2'],
    },
  ],
  fullScript:
    'Riverside ran a rainwater harvesting pilot. 250 households took part over three months. ' +
    'Average household water use fell by 18.0%. These results apply to the pilot population only.',
};

describe('PPTX export', () => {
  it('produces a structurally valid OOXML package', async () => {
    const bytes = await renderPresentationPptx(deck, { sourceTitle: 'Pilot report.pdf' });
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);

    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('ppt/presentation.xml');
    // A title slide plus one slide per content slide.
    expect(names).toContain('ppt/slides/slide3.xml');
  });

  it('preserves figures exactly and keeps slide order', async () => {
    const bytes = await renderPresentationPptx(deck);
    const zip = await JSZip.loadAsync(bytes);

    const slide2 = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(slide2).toContain('18.0%');
    expect(slide2).toContain('250 households took part');

    const slide3 = await zip.file('ppt/slides/slide3.xml')!.async('string');
    expect(slide3).toContain('Limitations');
  });

  it('includes speaker notes and evidence IDs', async () => {
    const bytes = await renderPresentationPptx(deck);
    const zip = await JSZip.loadAsync(bytes);
    const notes = Object.keys(zip.files).filter((n) => /notesSlide\d+\.xml$/.test(n));

    expect(notes.length).toBeGreaterThanOrEqual(2);
    const all = await Promise.all(notes.map((n) => zip.file(n)!.async('string')));
    const joined = all.join('\n');
    expect(joined).toContain('pilot population only');
    expect(joined).toContain('src-1-p2-2');
  });

  it('trims overlong text instead of producing a clipped slide', async () => {
    const bytes = await renderPresentationPptx({
      title: 'T',
      subtitle: '',
      slides: [
        {
          title: 'X'.repeat(200),
          layout: 'bullets',
          mainMessage: 'm',
          bullets: ['y'.repeat(300)],
          speakerNotes: '',
          visualType: 'none',
          evidence: [],
        },
      ],
    });
    const zip = await JSZip.loadAsync(bytes);
    const slide = await zip.file('ppt/slides/slide2.xml')!.async('string');

    expect(slide).not.toContain('X'.repeat(200));
    expect(slide).toContain('…');
  });

  it('exports the edited content, not the original', async () => {
    const edited: Presentation = {
      ...deck,
      slides: [{ ...deck.slides[0], title: 'Operator edited this title' }],
    };
    const bytes = await renderPresentationPptx(edited);
    const zip = await JSZip.loadAsync(bytes);
    const slide = await zip.file('ppt/slides/slide2.xml')!.async('string');

    expect(slide).toContain('Operator edited this title');
    expect(slide).not.toContain('Consumption fell 18.0%');
  });
});

describe('SVG export', () => {
  it('produces well-formed SVG with an accessible description', () => {
    const svg = renderInfographicSvg(infographic);

    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('<svg');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('role="img"');
    expect(svg).toContain(infographic.altText);
  });

  it('preserves figures with their units', () => {
    const svg = renderInfographicSvg(infographic);
    expect(svg).toContain('18.0%');
    expect(svg).toContain('250');
  });

  it('escapes special characters so markup cannot be injected', () => {
    const svg = renderInfographicSvg({
      ...infographic,
      headline: 'Water & sanitation <script>alert(1)</script>',
    });

    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('renders a qualitative layout when the source has no statistics', () => {
    const svg = renderInfographicSvg({ ...infographic, statistics: [] });

    expect(svg).toContain('<svg');
    // No statistic cards are drawn, and no figure is invented to fill the space.
    expect(svg).not.toContain('Fall in average household use');
    expect(svg).not.toContain('Households participating');
    // The alt text may still mention figures; the drawn layout carries none.
    const drawn = svg.slice(svg.indexOf('</desc>'));
    expect(drawn).not.toContain('18.0%');
    // Key messages still carry the meaning qualitatively.
    expect(svg).toContain('Lower demand');
  });
});

describe('video package export', () => {
  it('bundles every promised file', async () => {
    const bytes = await renderVideoPackageZip(video, 'Pilot report.pdf');
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);

    for (const file of [
      'README.md',
      'script.md',
      'narration.txt',
      'storyboard.csv',
      'storyboard.json',
      'subtitles.srt',
      'visual-recommendations.md',
    ]) {
      expect(names).toContain(file);
    }
  });

  it('labels subtitle timings as estimates', async () => {
    const bytes = await renderVideoPackageZip(video, null);
    const zip = await JSZip.loadAsync(bytes);

    const srt = await zip.file('subtitles.srt')!.async('string');
    expect(srt).toMatch(/ESTIMATES/i);
    // Valid SRT cue formatting.
    expect(srt).toMatch(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/);

    const readme = await zip.file('README.md')!.async('string');
    expect(readme).toMatch(/does \*\*not\*\* contain a rendered video/i);
  });

  it('produces subtitle cues in monotonically increasing order', () => {
    const srt = renderSrt(video);
    const stamps = [...srt.matchAll(/(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> /g)].map(
      (m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000,
    );

    expect(stamps.length).toBeGreaterThan(1);
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]).toBeGreaterThanOrEqual(stamps[i - 1]);
    }
  });

  it('escapes quotes in the storyboard CSV', () => {
    const csv = renderStoryboardCsv({
      ...video,
      scenes: [{ ...video.scenes[0], narration: 'She said "hello", then left.' }],
    });

    expect(csv).toContain('""hello""');
    expect(csv.split('\n')).toHaveLength(2);
  });
});

describe('markdown export', () => {
  it('renders every format without throwing', () => {
    expect(renderMarkdown('presentation', deck)).toContain('Rainwater pilot results');
    expect(renderMarkdown('infographic', infographic)).toContain('18.0');
    expect(renderMarkdown('video_package', video)).toContain('Scene 1');
  });

  it('marks suggested actions as distinct from source recommendations', () => {
    const md = renderMarkdown('exec_summary', {
      title: 'T',
      mainFinding: 'F',
      whyItMatters: 'W',
      keyEvidence: [],
      implications: [],
      actions: [
        { action: 'Extend the pilot', fromSource: true },
        { action: 'Launch a campaign', fromSource: false },
      ],
      uncertainties: [],
    });

    expect(md).toContain('- Extend the pilot\n');
    expect(md).toContain('Launch a campaign _(suggested, not stated in the source)_');
  });

  it('labels X character counts as approximate', () => {
    const md = renderMarkdown('x_thread', {
      isThread: true,
      posts: [
        { text: 'First post.', evidence: [] },
        { text: 'Second post.', evidence: [] },
      ],
      callToAction: '',
    });

    expect(md).toMatch(/approximate/i);
  });
});
