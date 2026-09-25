/**
 * Deck themes.
 *
 * Colour is the only thing that varies between themes: every layout, measure
 * and spacing rule in pptx.ts is shared. That is deliberate. A theme that also
 * moved things around would be a second renderer to maintain, and the layouts
 * are where the degradation rules live.
 *
 * The palettes were taken from two reference decks by reading their OOXML
 * rather than sampling a screenshot, so the values are exact. Their card tints
 * were built as alpha over the page colour; PowerPoint renders that correctly
 * but the composite is what matters, so it is flattened here and applied as a
 * solid fill. That also keeps the deck readable if a viewer disables
 * transparency.
 */

export interface DeckTheme {
  /** Page colour. Never white: both references sit on a warm ground. */
  page: string;
  /** Headings, bars, chips and the section divider ground. */
  accent: string;
  /** Secondary band, used to tell two compared columns apart. */
  accentBright: string;
  /** Card fill, and the lighter half of an alternating list. */
  tintSoft: string;
  /** The heavier half of an alternating list, and the stat panel. */
  tintMid: string;
  /** Body text. Charcoal rather than the accent: navy on beige is too faint. */
  ink: string;
  /** Secondary body text. */
  inkSoft: string;
  /** Text on an accent ground. */
  onAccent: string;
  /** Chart series, in order. */
  chart: [string, string, string, string];
}

/**
 * Navy on beige. The default, and the one to demonstrate with.
 *
 * Palette from the blue reference; layout language from the orange one. The
 * cool cards against the warm ground are what stop it reading as flat beige.
 */
export const NAVY: DeckTheme = {
  page: 'F4EDE2',
  accent: '303870',
  accentBright: '4A5599',
  tintSoft: 'E1E4F0',
  tintMid: 'AFB7D4',
  ink: '252D37',
  inkSoft: '4A5160',
  onAccent: 'F4EDE2',
  chart: ['303870', '4A5599', '8E95B5', 'C7CAD9'],
};

/** Terracotta on cream, taken whole from the orange reference. */
export const TERRACOTTA: DeckTheme = {
  page: 'FFF0E9',
  accent: 'D96627',
  accentBright: 'E58A55',
  // #D96627 at 18.8% and 57.6% over the page colour, flattened.
  tintSoft: 'F8D6C5',
  tintMid: 'E9A079',
  ink: '252D37',
  inkSoft: '4A5160',
  onAccent: 'FFF0E9',
  chart: ['D96627', 'E58A55', '252D37', 'B3B3B3'],
};

export const DECK_THEMES = { navy: NAVY, terracotta: TERRACOTTA } as const;

export type DeckThemeName = keyof typeof DECK_THEMES;

/** Names as a tuple, for the wire schema and the picker. */
export const DECK_THEME_NAMES = ['navy', 'terracotta'] as const;

/** Labels shown in the interface. */
export const DECK_THEME_LABELS: Record<DeckThemeName, string> = {
  navy: 'Navy on beige',
  terracotta: 'Terracotta on cream',
};

export const DEFAULT_DECK_THEME: DeckThemeName = 'navy';

export function resolveTheme(name?: string): DeckTheme {
  return DECK_THEMES[(name ?? '') as DeckThemeName] ?? DECK_THEMES[DEFAULT_DECK_THEME];
}

/**
 * Display font for headings.
 *
 * Both references use a Canva-only face (Flatory Sans, Agrandir Wide) that no
 * other machine has. Rendering one of those reference decks on this machine
 * substituted a wider font and pushed the title slide's own heading onto a
 * second line mid-word, which is exactly the failure to avoid: a .pptx stores
 * a font name, not the font.
 *
 * So the default is a face that ships with Windows and is present on macOS
 * through Office. Set DECK_FONT to Barlow or Nunito -- the free faces the
 * references actually pair with -- if every machine that will open the deck
 * has it installed.
 */
export const DISPLAY_FONT = process.env.DECK_FONT?.trim() || 'Segoe UI';
