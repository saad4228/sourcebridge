/**
 * Script detection and font selection for exported files.
 *
 * Indic text renders only if the machine opening the file has a font covering
 * that script. Relying on a generic fallback happens to work on Windows (which
 * ships Nirmala UI) but not everywhere, so the stacks below name the fonts
 * explicitly across Windows, macOS and Linux before falling back.
 */

export type Script = 'latin' | 'devanagari' | 'bengali' | 'tamil' | 'telugu';

const RANGES: { script: Exclude<Script, 'latin'>; test: RegExp }[] = [
  { script: 'devanagari', test: /[ऀ-ॿ]/ },
  { script: 'bengali', test: /[ঀ-৿]/ },
  { script: 'tamil', test: /[஀-௿]/ },
  { script: 'telugu', test: /[ఀ-౿]/ },
];

/** The dominant non-Latin script in `text`, or 'latin' when there is none. */
export function detectScript(text: string): Script {
  let best: Script = 'latin';
  let bestCount = 0;

  for (const { script, test } of RANGES) {
    const pattern = new RegExp(test.source, 'g');
    const count = (text.match(pattern) ?? []).length;
    if (count > bestCount) {
      bestCount = count;
      best = script;
    }
  }
  return best;
}

/**
 * Font stack for SVG. Names Windows, macOS and Noto families before the
 * generic fallback so the file travels between machines.
 */
export function svgFontStack(script: Script): string {
  const latin = 'Segoe UI, Helvetica, Arial, sans-serif';
  switch (script) {
    case 'devanagari':
      return `Nirmala UI, Noto Sans Devanagari, Kohinoor Devanagari, Mangal, ${latin}`;
    case 'bengali':
      return `Nirmala UI, Noto Sans Bengali, Kohinoor Bangla, Vrinda, ${latin}`;
    case 'tamil':
      return `Nirmala UI, Noto Sans Tamil, Tamil Sangam MN, Latha, ${latin}`;
    case 'telugu':
      return `Nirmala UI, Noto Sans Telugu, Kohinoor Telugu, Gautami, ${latin}`;
    default:
      return latin;
  }
}

/**
 * Single font name for PPTX. OOXML takes one family per run rather than a
 * stack, so pick the one most likely to be installed where the deck is opened.
 * Nirmala UI ships with Windows and covers all four scripts; PowerPoint
 * substitutes elsewhere.
 */
export function pptxFontFace(script: Script): string | undefined {
  return script === 'latin' ? undefined : 'Nirmala UI';
}

/**
 * Indic glyphs are wider than Latin at the same point size, and their clusters
 * cannot be broken mid-syllable. Shrink the character budget so wrapped text
 * still fits the fixed SVG layout.
 */
export function widthFactor(script: Script): number {
  return script === 'latin' ? 1 : 0.82;
}
