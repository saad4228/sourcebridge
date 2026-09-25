import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  DECK_THEMES,
  DECK_THEME_LABELS,
  DECK_THEME_NAMES,
  DEFAULT_DECK_THEME,
  NAVY,
  TERRACOTTA,
  resolveTheme,
} from '@/lib/export/deckTheme';
import { renderPresentationPptx } from '@/lib/export/pptx';
import type { Presentation } from '@/lib/schemas';

const deck: Presentation = {
  title: 'Incident assessment',
  subtitle: 'Cyber Situational Awareness Unit',
  slides: [
    {
      title: 'Observed impact',
      layout: 'bullets',
      mainMessage: '37 systems were degraded.',
      bullets: ['37 systems degraded', 'Peak load 486 Gbps'],
      speakerNotes: '',
      visualType: 'none',
      evidence: [],
    },
  ],
};

describe('theme registry', () => {
  it('lists exactly the themes that exist', () => {
    // A name in the picker with no theme behind it would silently fall back.
    expect([...DECK_THEME_NAMES].sort()).toEqual(Object.keys(DECK_THEMES).sort());
  });

  it('labels every theme', () => {
    for (const name of DECK_THEME_NAMES) {
      expect(DECK_THEME_LABELS[name]).toBeTruthy();
    }
  });

  it('resolves by name', () => {
    expect(resolveTheme('terracotta')).toBe(TERRACOTTA);
    expect(resolveTheme('navy')).toBe(NAVY);
  });

  it('falls back to the default rather than throwing', () => {
    // The name arrives over the wire; an unknown one must still render a deck.
    expect(resolveTheme(undefined)).toBe(DECK_THEMES[DEFAULT_DECK_THEME]);
    expect(resolveTheme('does-not-exist')).toBe(DECK_THEMES[DEFAULT_DECK_THEME]);
    expect(resolveTheme('')).toBe(DECK_THEMES[DEFAULT_DECK_THEME]);
  });

  it('never puts content on a white page', () => {
    // Both references sit on a warm ground; white is what made the old deck
    // read as default PowerPoint.
    for (const theme of Object.values(DECK_THEMES)) {
      expect(theme.page.toUpperCase()).not.toBe('FFFFFF');
    }
  });

  it('gives every theme four chart colours', () => {
    for (const theme of Object.values(DECK_THEMES)) {
      expect(theme.chart).toHaveLength(4);
      expect(new Set(theme.chart).size).toBe(4);
    }
  });
});

describe('rendering with a theme', () => {
  const slideXml = async (theme?: string) => {
    const bytes = await renderPresentationPptx(deck, { theme });
    const zip = await JSZip.loadAsync(bytes);
    return zip.file('ppt/slides/slide2.xml')!.async('string');
  };

  it('uses the requested palette', async () => {
    expect(await slideXml('terracotta')).toContain(TERRACOTTA.accent);
    expect(await slideXml('navy')).toContain(NAVY.accent);
  });

  it('does not leak the other palette in', async () => {
    const terracotta = await slideXml('terracotta');
    expect(terracotta).not.toContain(NAVY.accent);
  });

  it('renders the default palette when none is given', async () => {
    expect(await slideXml(undefined)).toContain(DECK_THEMES[DEFAULT_DECK_THEME].accent);
  });

  it('still renders when handed an unknown theme name', async () => {
    const bytes = await renderPresentationPptx(deck, { theme: 'nonsense' });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
