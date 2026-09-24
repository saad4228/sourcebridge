/**
 * Deterministic PPTX renderer.
 *
 * Fixed layouts with controlled text density. The model chooses the words and
 * says which layout suits each slide; this module decides where everything
 * sits, so a long response degrades to trimmed text rather than a broken deck.
 *
 * Charts are drawn by PowerPoint from real values, not pasted as pictures, so
 * they stay crisp and editable in the exported file.
 *
 * Layout rules that keep the deck looking designed rather than defaulted:
 * content fills the full body region instead of floating in the upper half,
 * every block sits on a tinted card rather than bare white, and list items get
 * numbered chips instead of bullet dots. Each is applied by this module alone,
 * so no model output can break them.
 */

import PptxGenJS from 'pptxgenjs';
import type { Presentation } from '../schemas';
import { detectScript, pptxFontFace } from './fonts';
import { resolveLayout, type Slide } from './slideLayout';

/**
 * A tint scale rather than a single accent.
 *
 * Depth is what separates a designed deck from a default one, and it comes
 * from several steps of one hue used deliberately -- not from more colours.
 */
const THEME = {
  ink: '0B1220',
  inkSoft: '334155',
  muted: '64748B',
  accent: '0F766E',
  accentDeep: '0A574F',
  accentBright: '14B8A6',
  tint: 'F2FAF8',
  tintDeep: 'DCF0EC',
  rule: 'E2E8F0',
  page: 'FFFFFF',
  onAccent: 'FFFFFF',
} as const;

/** Slide geometry for LAYOUT_16x9 (10 x 5.625 inches). */
const W = 10;
const H = 5.625;
const MARGIN = 0.7;

/**
 * The content region: everything between the heading and the footer.
 *
 * Deliberately tall. The previous box stopped well short of the footer, which
 * left a dead band across the bottom third of every slide no matter what the
 * model wrote.
 */
const BODY_Y = 1.52;
const BODY_H = H - 0.62 - BODY_Y;

/** Corner softness for every card. One value, so the deck stays consistent. */
const RADIUS = 0.08;

/** Caps matched to the layouts below. Beyond these, text is trimmed. */
const MAX_TITLE_CHARS = 70;
const MAX_BULLET_CHARS = 130;
const MAX_BULLETS = 5;

function clamp(text: string, limit: number): string {
  const t = (text ?? '').trim();
  return t.length <= limit ? t : `${t.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Roughly how many lines a string will wrap to in a box of the given width.
 *
 * Used to size cards to their contents rather than stretching every card to
 * the full body height, which left a tall empty band under short lists. It
 * only has to be close: results are clamped to the body region either way, so
 * an underestimate costs a little whitespace and never overflows the slide.
 */
function estimateLines(text: string, charsPerLine: number): number {
  return Math.max(1, Math.ceil(text.trim().length / charsPerLine));
}

export interface PptxOptions {
  /** Shown on the title slide under the deck title. */
  sourceTitle?: string;
}

type PptxSlide = ReturnType<PptxGenJS['addSlide']>;

/** A soft card. Every content block sits on one, so nothing floats on bare white. */
function card(
  s: PptxSlide,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string = THEME.tint,
) {
  s.addShape('roundRect', { x, y, w, h, rectRadius: RADIUS, fill: { color } });
}

/** Title plus a short accent rule, set tight beneath it rather than adrift. */
function drawHeading(s: PptxSlide, slide: Slide, fontFace?: string) {
  s.addText(clamp(slide.title, MAX_TITLE_CHARS), {
    x: MARGIN,
    y: 0.46,
    w: W - MARGIN * 2,
    h: 0.7,
    fontSize: 30,
    bold: true,
    color: THEME.ink,
    valign: 'middle',
    fontFace,
  });
  // Close under the title: the old gap left this dash floating between two
  // blocks, belonging to neither.
  s.addShape('roundRect', {
    x: MARGIN,
    y: 1.19,
    w: 0.62,
    h: 0.07,
    rectRadius: 0.5,
    fill: { color: THEME.accent },
  });
}

/**
 * Page number and a progress bar along the bottom edge.
 *
 * The bar is decoration that happens to be informative: it shows how far
 * through the deck a slide sits, which a bare number does not.
 */
function drawFooter(s: PptxSlide, index: number, total: number, onAccent = false) {
  // Section dividers are a breath in the deck, so they carry no progress bar:
  // full-bleed slides read better without chrome across the bottom edge.
  if (!onAccent) {
    const done = (index + 1) / total;
    s.addShape('rect', { x: 0, y: H - 0.06, w: W, h: 0.06, fill: { color: THEME.rule } });
    s.addShape('rect', {
      x: 0,
      y: H - 0.06,
      w: W * done,
      h: 0.06,
      fill: { color: THEME.accent },
    });
  }
  s.addText(`${index + 1}`, {
    x: W - MARGIN - 0.5,
    y: H - 0.52,
    w: 0.5,
    h: 0.3,
    fontSize: 10,
    color: onAccent ? THEME.tintDeep : THEME.muted,
    align: 'right',
  });
}

function attachNotes(s: PptxSlide, slide: Slide) {
  const notes: string[] = [];
  if (slide.mainMessage?.trim()) notes.push(`Main message: ${slide.mainMessage.trim()}`);
  if (slide.speakerNotes?.trim()) notes.push(slide.speakerNotes.trim());
  // A production recommendation, not a generated image. It belongs with the
  // speaker, not printed on the slide the audience sees.
  if (slide.visualType && slide.visualType !== 'none') {
    notes.push(`Suggested visual: ${slide.visualType}`);
  }
  if (slide.evidence?.length) notes.push(`Evidence: ${slide.evidence.join(', ')}`);
  if (notes.length) s.addNotes(notes.join('\n\n'));
}

/**
 * Build a .pptx and return it as bytes.
 *
 * Speaker notes are attached to every content slide, with evidence IDs, so the
 * deck stays traceable once it leaves the application.
 */
export async function renderPresentationPptx(
  content: Presentation,
  options: PptxOptions = {},
): Promise<Uint8Array> {
  // One font family per run in OOXML, so pick from the script actually used.
  const script = detectScript(
    [
      content.title,
      content.subtitle,
      ...content.slides.flatMap((s) => [s.title, s.mainMessage, ...(s.bullets ?? [])]),
    ].join(' '),
  );
  const fontFace = pptxFontFace(script);

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'SourceBridge';
  pptx.title = content.title;

  // --- Title slide ---------------------------------------------------------
  const title = pptx.addSlide();
  title.background = { color: THEME.page };
  // A large soft disc bleeding off the corner. Geometry carries the design
  // here, so the slide needs no imagery to look composed.
  title.addShape('ellipse', {
    x: W - 3.1,
    y: H - 2.9,
    w: 5.2,
    h: 5.2,
    fill: { color: THEME.tint },
  });
  title.addShape('ellipse', {
    x: W - 1.9,
    y: H - 1.75,
    w: 2.9,
    h: 2.9,
    fill: { color: THEME.tintDeep },
  });
  title.addShape('rect', { x: 0, y: 0, w: 0.26, h: H, fill: { color: THEME.accent } });

  title.addShape('roundRect', {
    x: 0.85,
    y: 1.42,
    w: 0.62,
    h: 0.07,
    rectRadius: 0.5,
    fill: { color: THEME.accent },
  });
  title.addText(clamp(content.title, 90), {
    x: 0.85,
    y: 1.72,
    w: 7.6,
    h: 1.6,
    fontSize: 42,
    bold: true,
    color: THEME.ink,
    valign: 'top',
    lineSpacingMultiple: 0.92,
    fontFace,
  });
  if (content.subtitle?.trim()) {
    title.addText(clamp(content.subtitle, 120), {
      x: 0.85,
      y: 3.45,
      w: 7.2,
      h: 0.7,
      fontSize: 18,
      color: THEME.inkSoft,
      fontFace,
    });
  }
  if (options.sourceTitle) {
    title.addText(`Source: ${clamp(options.sourceTitle, 80)}`, {
      x: 0.85,
      y: H - 0.92,
      w: 6,
      h: 0.4,
      fontSize: 11,
      color: THEME.muted,
    });
  }

  // --- Content slides ------------------------------------------------------
  const total = content.slides.length;

  content.slides.forEach((slide, index) => {
    const layout = resolveLayout(slide);
    const s = pptx.addSlide();
    s.background = { color: THEME.page };

    switch (layout) {
      case 'section': {
        // A divider: no heading rule, the title is the whole slide.
        s.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: THEME.accent } });
        // Tonal discs give the flat fill depth without introducing a colour.
        s.addShape('ellipse', {
          x: W - 2.6,
          y: -1.5,
          w: 4.6,
          h: 4.6,
          fill: { color: THEME.accentDeep },
        });
        s.addShape('ellipse', {
          x: -1.3,
          y: H - 1.9,
          w: 3.2,
          h: 3.2,
          fill: { color: THEME.accentDeep },
        });
        s.addShape('roundRect', {
          x: MARGIN,
          y: H / 2 - 1.62,
          w: 0.62,
          h: 0.07,
          rectRadius: 0.5,
          fill: { color: THEME.accentBright },
        });
        // Bottom-aligned in a two-line box, so a one-line and a two-line title
        // both finish at the same place and the sub-line sits just under it.
        s.addText(clamp(slide.title, 80), {
          x: MARGIN,
          y: H / 2 - 1.35,
          w: W - MARGIN * 2 - 1.4,
          h: 1.35,
          fontSize: 38,
          bold: true,
          color: THEME.onAccent,
          valign: 'bottom',
          lineSpacingMultiple: 0.95,
          fontFace,
        });
        if (slide.mainMessage?.trim()) {
          s.addText(clamp(slide.mainMessage, 150), {
            x: MARGIN,
            y: H / 2 + 0.14,
            w: W - MARGIN * 2 - 1.8,
            h: 0.9,
            fontSize: 16,
            color: THEME.tintDeep,
            valign: 'top',
            fontFace,
          });
        }
        drawFooter(s, index, total, true);
        break;
      }

      case 'statement': {
        drawHeading(s, slide, fontFace);
        card(s, MARGIN, BODY_Y, W - MARGIN * 2, BODY_H);
        // An accent edge turns a plain panel into a pull quote.
        s.addShape('roundRect', {
          x: MARGIN,
          y: BODY_Y,
          w: 0.1,
          h: BODY_H,
          rectRadius: 0.5,
          fill: { color: THEME.accent },
        });
        s.addText(clamp(slide.mainMessage, 240), {
          x: MARGIN + 0.55,
          y: BODY_Y,
          w: W - MARGIN * 2 - 1.1,
          h: BODY_H,
          fontSize: 24,
          color: THEME.ink,
          valign: 'middle',
          lineSpacingMultiple: 1.15,
          fontFace,
        });
        drawFooter(s, index, total);
        break;
      }

      case 'stat': {
        drawHeading(s, slide, fontFace);
        // resolveLayout only returns 'stat' when keyStat carries a value.
        const stat = slide.keyStat!;
        const figure = `${stat.value}${stat.unit ?? ''}`;
        // Shrink rather than let a long figure collide with the caption.
        const size = figure.length > 10 ? 46 : figure.length > 6 ? 64 : 88;
        const panelW = 4.25;

        // The figure gets a panel of its own, so it reads as a headline rather
        // than as text that happens to be large.
        card(s, MARGIN, BODY_Y, panelW, BODY_H, THEME.tintDeep);
        s.addText(figure, {
          x: MARGIN + 0.2,
          y: BODY_Y + BODY_H / 2 - 1.05,
          w: panelW - 0.4,
          h: 1.3,
          fontSize: size,
          bold: true,
          color: THEME.accent,
          align: 'center',
          valign: 'bottom',
          fontFace,
        });
        s.addText(clamp(stat.caption, 80), {
          x: MARGIN + 0.3,
          y: BODY_Y + BODY_H / 2 + 0.34,
          w: panelW - 0.6,
          h: 0.7,
          fontSize: 13,
          color: THEME.inkSoft,
          align: 'center',
          valign: 'top',
          fontFace,
        });

        // The message gets a panel too. A full-height block beside a bare
        // column reads as unfinished; two panels read as a composition.
        const restX = MARGIN + panelW + 0.35;
        const restW = W - restX - MARGIN;
        card(s, restX, BODY_Y, restW, BODY_H);
        s.addText(clamp(slide.mainMessage, 220), {
          x: restX + 0.34,
          y: BODY_Y,
          w: restW - 0.68,
          h: BODY_H,
          fontSize: 18,
          color: THEME.ink,
          valign: 'middle',
          lineSpacingMultiple: 1.12,
          fontFace,
        });
        drawFooter(s, index, total);
        break;
      }

      case 'comparison': {
        drawHeading(s, slide, fontFace);
        // resolveLayout only returns 'comparison' when both sides have points.
        const comparison = slide.comparison!;
        const gap = 0.35;
        const colW = (W - MARGIN * 2 - gap) / 2;
        const headH = 0.52;
        const sides = [
          { label: comparison.leftLabel, points: comparison.leftPoints, x: MARGIN },
          {
            label: comparison.rightLabel,
            points: comparison.rightPoints,
            x: MARGIN + colW + gap,
          },
        ];

        // Size both columns to whichever side has more to say, then centre the
        // pair. Stretching each card to the full body height left a tall band
        // of empty tint under a short list.
        const lineH = 0.24;
        const paraGap = 0.16;
        const tallest = Math.max(
          ...sides.map((side) =>
            side.points
              .slice(0, 4)
              .reduce((sum, text) => sum + estimateLines(text, 36) * lineH + paraGap, 0),
          ),
        );
        const cardH = Math.min(BODY_H, headH + 0.22 + tallest + 0.1);
        const cardY = BODY_Y + (BODY_H - cardH) / 2;

        sides.forEach((side, i) => {
          card(s, side.x, cardY, colW, cardH);
          // A filled header band reads as a label; bold text alone does not.
          s.addShape('roundRect', {
            x: side.x,
            y: cardY,
            w: colW,
            h: headH,
            rectRadius: RADIUS,
            fill: { color: i === 0 ? THEME.accent : THEME.accentBright },
          });
          s.addText(clamp(side.label || ' ', 40), {
            x: side.x + 0.24,
            y: cardY,
            w: colW - 0.48,
            h: headH,
            fontSize: 14,
            bold: true,
            color: THEME.onAccent,
            valign: 'middle',
            fontFace,
          });
          s.addText(
            side.points.slice(0, 4).map((text) => ({
              text: clamp(text, 90),
              options: {
                bullet: { characterCode: '2013' },
                fontSize: 13,
                color: THEME.ink,
                breakLine: true,
                paraSpaceAfter: 10,
                fontFace,
              },
            })),
            {
              x: side.x + 0.28,
              y: cardY + headH + 0.18,
              w: colW - 0.56,
              h: cardH - headH - 0.3,
              valign: 'top',
            },
          );
        });
        drawFooter(s, index, total);
        break;
      }

      case 'chart': {
        drawHeading(s, slide, fontFace);
        // resolveLayout only returns 'chart' when the series is usable.
        const chart = slide.chart!;
        const type =
          chart.kind === 'line'
            ? pptx.ChartType.line
            : chart.kind === 'pie'
              ? pptx.ChartType.pie
              : pptx.ChartType.bar;
        const chartW = 5.75;
        const restX = MARGIN + chartW + 0.35;

        card(s, MARGIN, BODY_Y, chartW, BODY_H);
        // A real chart object, so it stays editable in PowerPoint. Inset
        // slightly so the card reads as a frame around it.
        s.addChart(
          type,
          [{ name: chart.seriesName || 'Value', labels: chart.categories, values: chart.values }],
          {
            x: MARGIN + 0.18,
            y: BODY_Y + 0.18,
            w: chartW - 0.36,
            h: BODY_H - 0.36,
            chartColors: ['0F766E', '14B8A6', '5EEAD4', '99F6E4'],
            showLegend: chart.kind === 'pie',
            legendPos: 'b',
            legendColor: THEME.muted,
            legendFontSize: 10,
            showValue: chart.kind !== 'pie',
            dataLabelColor: THEME.inkSoft,
            dataLabelFontSize: 10,
            catAxisLabelColor: THEME.muted,
            valAxisLabelColor: THEME.muted,
            catAxisLabelFontSize: 10,
            valAxisLabelFontSize: 10,
            valGridLine: { color: THEME.rule, size: 1 },
            catGridLine: { style: 'none' },
          },
        );

        const restW = W - restX - MARGIN;
        card(s, restX, BODY_Y, restW, BODY_H);
        s.addText(clamp(slide.mainMessage, 200), {
          x: restX + 0.3,
          y: BODY_Y,
          w: restW - 0.6,
          h: BODY_H,
          fontSize: 16,
          color: THEME.ink,
          valign: 'middle',
          lineSpacingMultiple: 1.12,
          fontFace,
        });
        drawFooter(s, index, total);
        break;
      }

      default: {
        drawHeading(s, slide, fontFace);
        const bullets = (slide.bullets ?? []).slice(0, MAX_BULLETS);
        const n = Math.max(bullets.length, 1);
        const gap = 0.14;
        // Rows are sized to fill the body, so three points and five points
        // both produce a balanced slide instead of a top-heavy one.
        const rowH = Math.min(0.92, (BODY_H - gap * (n - 1)) / n);
        const blockH = rowH * n + gap * (n - 1);
        const startY = BODY_Y + (BODY_H - blockH) / 2;
        const chip = Math.min(0.34, rowH - 0.22);
        const fontSize = n <= 3 ? 17 : 15;

        bullets.forEach((text, i) => {
          const y = startY + i * (rowH + gap);
          card(s, MARGIN, y, W - MARGIN * 2, rowH);
          // A numbered chip instead of a bullet dot: the dot is the clearest
          // single signal of a deck nobody designed.
          s.addShape('roundRect', {
            x: MARGIN + 0.26,
            y: y + (rowH - chip) / 2,
            w: chip,
            h: chip,
            rectRadius: 0.35,
            fill: { color: THEME.accent },
          });
          s.addText(`${i + 1}`, {
            x: MARGIN + 0.26,
            y: y + (rowH - chip) / 2,
            w: chip,
            h: chip,
            fontSize: 11,
            bold: true,
            color: THEME.onAccent,
            align: 'center',
            valign: 'middle',
          });
          s.addText(clamp(text, MAX_BULLET_CHARS), {
            x: MARGIN + 0.26 + chip + 0.26,
            y,
            w: W - MARGIN * 2 - chip - 0.9,
            h: rowH,
            fontSize,
            color: THEME.ink,
            valign: 'middle',
            lineSpacingMultiple: 1.05,
            fontFace,
          });
        });
        drawFooter(s, index, total);
      }
    }

    attachNotes(s, slide);
  });

  const output = await pptx.write({ outputType: 'nodebuffer' });
  return new Uint8Array(output as Buffer);
}
