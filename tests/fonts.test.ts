import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { detectScript, pptxFontFace, svgFontStack, widthFactor } from '@/lib/export/fonts';
import { renderInfographicSvg } from '@/lib/export/svg';
import { renderPresentationPptx } from '@/lib/export/pptx';
import type { Infographic, Presentation } from '@/lib/schemas';

describe('script detection', () => {
  it('identifies each supported script', () => {
    expect(detectScript('Water use fell by 18%')).toBe('latin');
    expect(detectScript('वर्षा जल संचयन पायलट')).toBe('devanagari');
    expect(detectScript('முடிவுகள் பங்கேற்பாளர்கள்')).toBe('tamil');
    expect(detectScript('একটি বৃহত্তর পরীক্ষা')).toBe('bengali');
    expect(detectScript('ఫలితాలు పాల్గొనేవారికి')).toBe('telugu');
  });

  it('picks the dominant script when text is mixed', () => {
    // A stray Latin word in a Hindi sentence must not switch the font.
    expect(detectScript('वर्षा जल संचयन पायलट report 2026')).toBe('devanagari');
  });

  it('treats digits and punctuation as Latin', () => {
    expect(detectScript('18.0% — 250 (2026)')).toBe('latin');
  });
});

describe('font selection', () => {
  it('names an Indic family before the Latin fallback', () => {
    const stack = svgFontStack('devanagari');
    expect(stack).toMatch(/Nirmala UI/);
    expect(stack).toMatch(/Noto Sans Devanagari/);
    // The Latin fallback still trails the stack.
    expect(stack).toMatch(/sans-serif$/);
    expect(stack.indexOf('Nirmala UI')).toBeLessThan(stack.indexOf('Segoe UI'));
  });

  it('leaves Latin content on the default stack', () => {
    expect(svgFontStack('latin')).toBe('Segoe UI, Helvetica, Arial, sans-serif');
    // undefined lets PptxGenJS use its own default rather than forcing a face.
    expect(pptxFontFace('latin')).toBeUndefined();
  });

  it('sets a single covering family for PPTX Indic runs', () => {
    expect(pptxFontFace('tamil')).toBe('Nirmala UI');
    expect(pptxFontFace('bengali')).toBe('Nirmala UI');
  });

  it('shrinks the wrap budget for wider Indic glyphs', () => {
    expect(widthFactor('latin')).toBe(1);
    expect(widthFactor('devanagari')).toBeLessThan(1);
  });
});

const hindiInfographic: Infographic = {
  headline: 'वर्षा जल संचयन पायलट ने पानी की खपत घटाई',
  subheadline: 'रिवरसाइड नगर जल बोर्ड',
  layout: 'stats',
  keyMessages: [
    { label: 'कम मांग', detail: 'चार वार्डों में औसत घरेलू उपयोग घटा।', evidence: [] },
  ],
  statistics: [
    { value: '18.0', unit: '%', caption: 'घरेलू उपयोग में गिरावट', evidence: [] },
  ],
  sourceFooter: 'अंतिम रिपोर्ट',
  altText: 'हिंदी इन्फोग्राफिक।',
};

describe('Indic SVG export', () => {
  it('declares an Indic font stack on the rendered group', () => {
    const svg = renderInfographicSvg(hindiInfographic);
    expect(svg).toMatch(/font-family="Nirmala UI, Noto Sans Devanagari/);
  });

  it('preserves the Devanagari text and the figures', () => {
    const svg = renderInfographicSvg(hindiInfographic);
    expect(svg).toContain('वर्षा जल संचयन');
    expect(svg).toContain('18.0%');
  });

  it('keeps the Latin stack for Latin content', () => {
    const svg = renderInfographicSvg({ ...hindiInfographic, headline: 'Water use fell', subheadline: '', keyMessages: [{ label: 'Lower demand', detail: 'Use fell.', evidence: [] }], statistics: [], sourceFooter: 'Report', altText: 'Chart.' });
    expect(svg).toMatch(/font-family="Segoe UI/);
  });
});

describe('Indic PPTX export', () => {
  const hindiDeck: Presentation = {
    title: 'वर्षा जल संचयन पायलट',
    subtitle: 'अंतिम रिपोर्ट',
    slides: [
      {
        title: 'पानी की खपत 18% घटी',
        layout: 'bullets',
        mainMessage: 'पायलट ने औसत घरेलू उपयोग घटाया।',
        bullets: ['250 घरों ने भाग लिया', 'चार वार्डों में'],
        speakerNotes: 'केवल पायलट आबादी पर लागू।',
        visualType: 'chart',
        evidence: [],
      },
    ],
  };

  it('sets a covering font face on Indic runs', async () => {
    const bytes = await renderPresentationPptx(hindiDeck);
    const zip = await JSZip.loadAsync(bytes);
    const slide = await zip.file('ppt/slides/slide2.xml')!.async('string');

    // The typeface must be declared in the run properties, or PowerPoint falls
    // back to the theme font, which has no Devanagari coverage.
    expect(slide).toMatch(/typeface="Nirmala UI"/);
  });

  it('preserves the Devanagari text and figures in the slide XML', async () => {
    const bytes = await renderPresentationPptx(hindiDeck);
    const zip = await JSZip.loadAsync(bytes);
    const slide = await zip.file('ppt/slides/slide2.xml')!.async('string');

    expect(slide).toContain('पानी की खपत 18% घटी');
    expect(slide).toContain('250 घरों ने भाग लिया');
  });

  it('does not force a font face on a Latin deck', async () => {
    const bytes = await renderPresentationPptx({
      title: 'Pilot results',
      subtitle: '',
      slides: [
        {
          title: 'Consumption fell 18.0%',
          layout: 'bullets',
          mainMessage: 'The pilot reduced use.',
          bullets: ['250 households'],
          speakerNotes: '',
          visualType: 'none',
          evidence: [],
        },
      ],
    });
    const zip = await JSZip.loadAsync(bytes);
    const slide = await zip.file('ppt/slides/slide2.xml')!.async('string');

    expect(slide).not.toMatch(/typeface="Nirmala UI"/);
  });
});
