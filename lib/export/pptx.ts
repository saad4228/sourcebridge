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
 * The visual language comes from two reference decks, read out of their OOXML:
 * a warm ground rather than white, headings in the accent colour, content on
 * rounded cards with a heavy accent bar down the left edge, lists as
 * alternating tinted rows, and compared columns under filled header chips.
 * Colour lives in deckTheme.ts; every measurement below is shared by all
 * themes, because the layouts are where the degradation rules live.
 */

import PptxGenJS from 'pptxgenjs';
import type { Presentation } from '../schemas';
import { detectScript, pptxFontFace } from './fonts';
import { resolveLayout, type Slide } from './slideLayout';
import { DISPLAY_FONT, resolveTheme } from './deckTheme';

/** Slide geometry for LAYOUT_16x9 (10 x 5.625 inches). */
const W = 10;
const H = 5.625;
const MARGIN = 0.7;

/**
 * The content region: everything between the heading and the footer.
 *
 * Deliberately tall. A box that stops short of the footer leaves a dead band
 * across the bottom third of every slide no matter what the model writes.
 */
const BODY_Y = 1.62;
const BODY_H = H - 0.6 - BODY_Y;

/** Corner softness for every card. One value, so the deck stays consistent. */
const RADIUS = 0.08;
/** Width of the accent bar down a card's left edge — the references' signature. */
const EDGE_W = 0.11;

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
  /** Theme name; falls back to the default when unknown. */
  theme?: string;
}

type PptxSlide = ReturnType<PptxGenJS['addSlide']>;

export async function renderPresentationPptx(
  content: Presentation,
  options: PptxOptions = {},
): Promise<Uint8Array> {
  const T = resolveTheme(options.theme);

  // One font family per run in OOXML, so pick from the script actually used.
  // Indic text keeps its own face: the display font covers Latin only.
  const script = detectScript(
    [
      content.title,
      content.subtitle,
      ...content.slides.flatMap((s) => [s.title, s.mainMessage, ...(s.bullets ?? [])]),
    ].join(' '),
  );
  const scriptFont = pptxFontFace(script);
  const fontFace = scriptFont ?? DISPLAY_FONT;

  /** A soft card. Every content block sits on one; nothing floats on bare ground. */
  const card = (s: PptxSlide, x: number, y: number, w: number, h: number, color = T.tintSoft) => {
    s.addShape('roundRect', { x, y, w, h, rectRadius: RADIUS, fill: { color } });
  };

  /** A card with the accent bar down its left edge. */
  const edgedCard = (
    s: PptxSlide,
    x: number,
    y: number,
    w: number,
    h: number,
    color = T.tintSoft,
  ) => {
    card(s, x, y, w, h, color);
    s.addShape('rect', { x, y: y + RADIUS * 0.5, w: EDGE_W, h: h - RADIUS, fill: { color: T.accent } });
  };

  /** Slide title: accent colour, large and bold, with no rule beneath it. */
  const drawHeading = (s: PptxSlide, slide: Slide) => {
    s.addText(clamp(slide.title, MAX_TITLE_CHARS), {
      x: MARGIN,
      y: 0.46,
      w: W - MARGIN * 2 - 0.5,
      h: 0.86,
      fontSize: 33,
      bold: true,
      color: T.accent,
      valign: 'middle',
      lineSpacingMultiple: 0.92,
      fontFace,
    });
  };

  /** Page number, bottom right, in the accent colour as both references do. */
  const drawFooter = (s: PptxSlide, index: number, onAccent = false) => {
    s.addText(`${index + 1}`, {
      x: W - MARGIN - 0.5,
      y: H - 0.58,
      w: 0.5,
      h: 0.34,
      fontSize: 13,
      bold: true,
      color: onAccent ? T.onAccent : T.accent,
      align: 'right',
    });
  };

  const attachNotes = (s: PptxSlide, slide: Slide) => {
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
  };

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'SourceBridge';
  pptx.title = content.title;

  // --- Title slide ---------------------------------------------------------
  const title = pptx.addSlide();
  title.background = { color: T.page };
  // The tall rounded panel bleeding off the right edge, from the blue
  // reference. It carries the slide on its own, so no imagery is needed.
  title.addShape('roundRect', {
    x: W - 0.62,
    y: 0.16,
    w: 1.1,
    h: H - 0.32,
    rectRadius: 0.5,
    fill: { color: T.accent },
  });

  title.addText('SOURCEBRIDGE', {
    x: MARGIN,
    y: 0.62,
    w: 5,
    h: 0.32,
    fontSize: 11,
    bold: true,
    color: T.inkSoft,
    charSpacing: 2,
    fontFace,
  });
  title.addText(clamp(content.title, 90), {
    x: MARGIN,
    y: 1.55,
    w: W - MARGIN - 1.5,
    h: 1.75,
    fontSize: 44,
    bold: true,
    color: T.accent,
    valign: 'top',
    lineSpacingMultiple: 0.9,
    fontFace,
  });
  if (content.subtitle?.trim()) {
    // The outlined capsule from the blue reference, which gives the subtitle
    // a shape of its own instead of leaving it adrift under the title.
    const label = clamp(content.subtitle, 78);
    const capsuleW = Math.min(W - MARGIN - 1.6, 0.34 + label.length * 0.093);
    title.addShape('roundRect', {
      x: MARGIN,
      y: 3.52,
      w: capsuleW,
      h: 0.46,
      rectRadius: 0.5,
      fill: { color: T.page },
      line: { color: T.accent, width: 1.25 },
    });
    title.addText(label, {
      x: MARGIN + 0.17,
      y: 3.52,
      w: capsuleW - 0.34,
      h: 0.46,
      fontSize: 13,
      color: T.accent,
      align: 'center',
      valign: 'middle',
      fontFace,
    });
  }
  if (options.sourceTitle) {
    title.addText(`Source: ${clamp(options.sourceTitle, 80)}`, {
      x: MARGIN,
      y: H - 0.95,
      w: 6,
      h: 0.4,
      fontSize: 11,
      color: T.inkSoft,
      fontFace,
    });
  }

  // --- Content slides ------------------------------------------------------
  content.slides.forEach((slide, index) => {
    const layout = resolveLayout(slide);
    const s = pptx.addSlide();
    s.background = { color: T.page };

    switch (layout) {
      case 'section': {
        // A divider: the accent fills the slide and the title is the whole of it.
        s.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: T.accent } });
        s.addShape('roundRect', {
          x: -0.7,
          y: 0.16,
          w: 1.1,
          h: H - 0.32,
          rectRadius: 0.5,
          fill: { color: T.accentBright },
        });
        s.addText(clamp(slide.title, 80), {
          x: MARGIN + 0.35,
          y: H / 2 - 1.3,
          w: W - MARGIN * 2 - 0.6,
          h: 1.3,
          fontSize: 38,
          bold: true,
          color: T.onAccent,
          valign: 'bottom',
          lineSpacingMultiple: 0.92,
          fontFace,
        });
        if (slide.mainMessage?.trim()) {
          s.addText(clamp(slide.mainMessage, 150), {
            x: MARGIN + 0.35,
            y: H / 2 + 0.16,
            w: W - MARGIN * 2 - 1.4,
            h: 0.9,
            fontSize: 15,
            color: T.onAccent,
            valign: 'top',
            fontFace,
          });
        }
        drawFooter(s, index, true);
        break;
      }

      case 'statement': {
        drawHeading(s, slide);
        edgedCard(s, MARGIN, BODY_Y, W - MARGIN * 2, BODY_H, T.tintMid);
        s.addText(clamp(slide.mainMessage, 240), {
          x: MARGIN + EDGE_W + 0.5,
          y: BODY_Y,
          w: W - MARGIN * 2 - EDGE_W - 1,
          h: BODY_H,
          fontSize: 23,
          color: T.ink,
          valign: 'middle',
          lineSpacingMultiple: 1.15,
          fontFace,
        });
        drawFooter(s, index);
        break;
      }

      case 'stat': {
        drawHeading(s, slide);
        // resolveLayout only returns 'stat' when keyStat carries a value.
        const stat = slide.keyStat!;
        const figure = `${stat.value}${stat.unit ?? ''}`;
        // Shrink rather than let a long figure collide with the caption.
        const size = figure.length > 10 ? 46 : figure.length > 6 ? 64 : 86;
        const panelW = 4.15;

        // The figure gets a panel of its own, so it reads as a headline rather
        // than as text that happens to be large.
        card(s, MARGIN, BODY_Y, panelW, BODY_H, T.tintMid);
        s.addText(figure, {
          x: MARGIN + 0.2,
          y: BODY_Y + BODY_H / 2 - 1.02,
          w: panelW - 0.4,
          h: 1.3,
          fontSize: size,
          bold: true,
          color: T.accent,
          align: 'center',
          valign: 'bottom',
          fontFace,
        });
        s.addText(clamp(stat.caption, 80), {
          x: MARGIN + 0.3,
          y: BODY_Y + BODY_H / 2 + 0.2,
          w: panelW - 0.6,
          h: 0.7,
          fontSize: 13,
          color: T.ink,
          align: 'center',
          valign: 'top',
          fontFace,
        });

        // A second panel beside it: a full-height block next to a bare column
        // reads as unfinished, two panels read as a composition.
        const restX = MARGIN + panelW + 0.32;
        const restW = W - restX - MARGIN;
        edgedCard(s, restX, BODY_Y, restW, BODY_H);
        s.addText(clamp(slide.mainMessage, 220), {
          x: restX + EDGE_W + 0.3,
          y: BODY_Y,
          w: restW - EDGE_W - 0.6,
          h: BODY_H,
          fontSize: 17,
          color: T.ink,
          valign: 'middle',
          lineSpacingMultiple: 1.12,
          fontFace,
        });
        drawFooter(s, index);
        break;
      }

      case 'comparison': {
        drawHeading(s, slide);
        // resolveLayout only returns 'comparison' when both sides have points.
        const comparison = slide.comparison!;
        const gap = 0.32;
        const colW = (W - MARGIN * 2 - gap) / 2;
        const chipH = 0.5;
        const chipGap = 0.14;
        const sides = [
          { label: comparison.leftLabel, points: comparison.leftPoints, x: MARGIN },
          { label: comparison.rightLabel, points: comparison.rightPoints, x: MARGIN + colW + gap },
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
              .reduce((sum, text) => sum + estimateLines(text, 34) * lineH + paraGap, 0),
          ),
        );
        // The running total adds a gap after the final item too, so take it
        // back: otherwise every card carries a spare line of empty tint.
        const cardH = Math.min(BODY_H - chipH - chipGap, tallest - paraGap + 0.38);
        const top = BODY_Y + (BODY_H - (chipH + chipGap + cardH)) / 2;

        sides.forEach((side, i) => {
          // A separate filled chip above the card, from the orange reference.
          s.addShape('roundRect', {
            x: side.x,
            y: top,
            w: colW,
            h: chipH,
            rectRadius: RADIUS,
            fill: { color: i === 0 ? T.accent : T.accentBright },
          });
          s.addText(clamp(side.label || ' ', 40), {
            x: side.x + 0.2,
            y: top,
            w: colW - 0.4,
            h: chipH,
            fontSize: 15,
            bold: true,
            color: T.onAccent,
            align: 'center',
            valign: 'middle',
            fontFace,
          });

          card(s, side.x, top + chipH + chipGap, colW, cardH);
          s.addText(
            side.points.slice(0, 4).map((text) => ({
              text: clamp(text, 90),
              options: {
                bullet: { characterCode: '2013' },
                fontSize: 13,
                color: T.ink,
                breakLine: true,
                paraSpaceAfter: 10,
                fontFace,
              },
            })),
            {
              x: side.x + 0.26,
              y: top + chipH + chipGap + 0.18,
              w: colW - 0.52,
              h: cardH - 0.34,
              valign: 'top',
            },
          );
        });
        drawFooter(s, index);
        break;
      }

      case 'chart': {
        drawHeading(s, slide);
        // resolveLayout only returns 'chart' when the series is usable.
        const chart = slide.chart!;
        const type =
          chart.kind === 'line'
            ? pptx.ChartType.line
            : chart.kind === 'pie'
              ? pptx.ChartType.pie
              : pptx.ChartType.bar;
        const chartW = 5.6;
        const restX = MARGIN + chartW + 0.32;
        const restW = W - restX - MARGIN;

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
            chartColors: [...T.chart],
            showLegend: chart.kind === 'pie',
            legendPos: 'b',
            legendColor: T.inkSoft,
            legendFontSize: 10,
            showValue: chart.kind !== 'pie',
            dataLabelColor: T.ink,
            dataLabelFontSize: 10,
            catAxisLabelColor: T.inkSoft,
            valAxisLabelColor: T.inkSoft,
            catAxisLabelFontSize: 10,
            valAxisLabelFontSize: 10,
            // Horizontal rules only, as both references draw them.
            valGridLine: { color: T.tintMid, size: 1 },
            catGridLine: { style: 'none' },
          },
        );

        edgedCard(s, restX, BODY_Y, restW, BODY_H);
        s.addText(clamp(slide.mainMessage, 200), {
          x: restX + EDGE_W + 0.26,
          y: BODY_Y,
          w: restW - EDGE_W - 0.52,
          h: BODY_H,
          fontSize: 15,
          color: T.ink,
          valign: 'middle',
          lineSpacingMultiple: 1.12,
          fontFace,
        });
        drawFooter(s, index);
        break;
      }

      default: {
        drawHeading(s, slide);
        const bullets = (slide.bullets ?? []).slice(0, MAX_BULLETS);
        const n = Math.max(bullets.length, 1);
        const gap = 0.13;
        // Rows sized to fill the body, so three points and five points both
        // produce a balanced slide instead of a top-heavy one.
        const rowH = Math.min(0.92, (BODY_H - gap * (n - 1)) / n);
        const blockH = rowH * n + gap * (n - 1);
        const startY = BODY_Y + (BODY_H - blockH) / 2;
        const fontSize = n <= 3 ? 16 : 14;

        bullets.forEach((text, i) => {
          const y = startY + i * (rowH + gap);
          // Alternating tints, straight from the orange reference: it gives a
          // list rhythm without needing a bullet glyph at all.
          edgedCard(s, MARGIN, y, W - MARGIN * 2, rowH, i % 2 === 0 ? T.tintMid : T.tintSoft);
          s.addText(clamp(text, MAX_BULLET_CHARS), {
            x: MARGIN + EDGE_W + 0.34,
            y,
            w: W - MARGIN * 2 - EDGE_W - 0.7,
            h: rowH,
            fontSize,
            color: T.ink,
            valign: 'middle',
            lineSpacingMultiple: 1.05,
            fontFace,
          });
        });
        drawFooter(s, index);
      }
    }

    attachNotes(s, slide);
  });

  const output = await pptx.write({ outputType: 'nodebuffer' });
  return new Uint8Array(output as Buffer);
}
