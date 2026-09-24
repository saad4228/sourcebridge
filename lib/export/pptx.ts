/**
 * Deterministic PPTX renderer.
 *
 * Fixed layouts with controlled text density. The model chooses the words and
 * says which layout suits each slide; this module decides where everything
 * sits, so a long response degrades to trimmed text rather than a broken deck.
 *
 * Charts are drawn by PowerPoint from real values, not pasted as pictures, so
 * they stay crisp and editable in the exported file.
 */

import PptxGenJS from 'pptxgenjs';
import type { Presentation } from '../schemas';
import { detectScript, pptxFontFace } from './fonts';
import { resolveLayout, type Slide } from './slideLayout';

const THEME = {
  ink: '111827',
  muted: '4B5563',
  accent: '0F766E',
  accentSoft: 'E6F4F2',
  faint: '9CA3AF',
  rule: 'E5E7EB',
  page: 'FFFFFF',
} as const;

/** Slide geometry for LAYOUT_16x9 (10 x 5.625 inches). */
const W = 10;
const H = 5.625;
const MARGIN = 0.6;

/**
 * The content region: everything between the title rule and the footer. Shared
 * so each layout fills the same box and the deck reads consistently.
 */
const BODY_Y = 1.6;
const BODY_H = 3.25;

/** Caps matched to the layouts below. Beyond these, text is trimmed. */
const MAX_TITLE_CHARS = 70;
const MAX_BULLET_CHARS = 130;
const MAX_BULLETS = 5;

function clamp(text: string, limit: number): string {
  const t = (text ?? '').trim();
  return t.length <= limit ? t : `${t.slice(0, limit - 1).trimEnd()}…`;
}

export interface PptxOptions {
  /** Shown on the title slide under the deck title. */
  sourceTitle?: string;
}

type PptxSlide = ReturnType<PptxGenJS['addSlide']>;

/** Title plus accent rule, shared by every content layout. */
function drawHeading(s: PptxSlide, slide: Slide, fontFace?: string) {
  s.addText(clamp(slide.title, MAX_TITLE_CHARS), {
    x: MARGIN,
    y: 0.42,
    w: W - MARGIN * 2,
    h: 0.75,
    fontSize: 26,
    bold: true,
    color: THEME.ink,
    fontFace,
  });
  s.addShape('rect', { x: MARGIN, y: 1.24, w: 1.1, h: 0.05, fill: { color: THEME.accent } });
}

function drawFooter(s: PptxSlide, slide: Slide, index: number) {
  if (slide.visualType && slide.visualType !== 'none') {
    // A recommendation, not a generated image -- labelled so no one mistakes it.
    s.addText(`Suggested visual: ${slide.visualType}`, {
      x: MARGIN,
      y: H - 0.55,
      w: 5,
      h: 0.3,
      fontSize: 10,
      italic: true,
      color: THEME.faint,
    });
  }
  s.addText(`${index + 1}`, {
    x: W - MARGIN - 0.4,
    y: H - 0.55,
    w: 0.4,
    h: 0.3,
    fontSize: 10,
    color: THEME.faint,
    align: 'right',
  });
}

function attachNotes(s: PptxSlide, slide: Slide) {
  const notes: string[] = [];
  if (slide.mainMessage?.trim()) notes.push(`Main message: ${slide.mainMessage.trim()}`);
  if (slide.speakerNotes?.trim()) notes.push(slide.speakerNotes.trim());
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
  title.addShape('rect', { x: 0, y: 0, w: 0.22, h: H, fill: { color: THEME.accent } });
  title.addShape('rect', { x: W - 2.6, y: H - 1.8, w: 2.6, h: 1.8, fill: { color: THEME.accentSoft } });

  title.addText(clamp(content.title, 90), {
    x: 0.8,
    y: 1.6,
    w: 8.4,
    h: 1.5,
    fontSize: 38,
    bold: true,
    color: THEME.ink,
    valign: 'bottom',
    fontFace,
  });
  if (content.subtitle?.trim()) {
    title.addText(clamp(content.subtitle, 120), {
      x: 0.8,
      y: 3.2,
      w: 8.4,
      h: 0.7,
      fontSize: 17,
      color: THEME.muted,
      fontFace,
    });
  }
  if (options.sourceTitle) {
    title.addText(`Source: ${clamp(options.sourceTitle, 80)}`, {
      x: 0.8,
      y: H - 0.85,
      w: 6,
      h: 0.4,
      fontSize: 11,
      color: THEME.faint,
    });
  }

  // --- Content slides ------------------------------------------------------
  content.slides.forEach((slide, index) => {
    const layout = resolveLayout(slide);
    const s = pptx.addSlide();
    s.background = { color: THEME.page };

    switch (layout) {
      case 'section': {
        // A divider: no heading rule, the title is the whole slide.
        s.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: THEME.accent } });
        s.addText(clamp(slide.title, 80), {
          x: MARGIN,
          y: H / 2 - 0.9,
          w: W - MARGIN * 2,
          h: 1,
          fontSize: 34,
          bold: true,
          color: 'FFFFFF',
          fontFace,
        });
        if (slide.mainMessage?.trim()) {
          s.addText(clamp(slide.mainMessage, 150), {
            x: MARGIN,
            y: H / 2 + 0.1,
            w: W - MARGIN * 2,
            h: 0.8,
            fontSize: 15,
            color: THEME.accentSoft,
            fontFace,
          });
        }
        break;
      }

      case 'statement': {
        drawHeading(s, slide, fontFace);
        // Centred in the content region: a short statement pinned to the top
        // leaves the lower half of the slide visibly empty.
        s.addText(clamp(slide.mainMessage, 240), {
          x: MARGIN + 0.15,
          y: BODY_Y,
          w: W - MARGIN * 2 - 0.3,
          h: BODY_H,
          fontSize: 22,
          color: THEME.ink,
          valign: 'middle',
          fontFace,
        });
        drawFooter(s, slide, index);
        break;
      }

      case 'stat': {
        drawHeading(s, slide, fontFace);
        // resolveLayout only returns 'stat' when keyStat carries a value.
        const stat = slide.keyStat!;
        const figure = `${stat.value}${stat.unit ?? ''}`;
        // Shrink rather than let a long figure collide with the caption.
        const size = figure.length > 10 ? 44 : figure.length > 6 ? 60 : 80;

        // Figure and caption form one centred block on the left.
        s.addText(figure, {
          x: MARGIN,
          y: BODY_Y + 0.45,
          w: 4.3,
          h: 1.4,
          fontSize: size,
          bold: true,
          color: THEME.accent,
          align: 'center',
          valign: 'bottom',
          fontFace,
        });
        s.addText(clamp(stat.caption, 80), {
          x: MARGIN,
          y: BODY_Y + 1.95,
          w: 4.3,
          h: 0.7,
          fontSize: 13,
          color: THEME.muted,
          align: 'center',
          valign: 'top',
          fontFace,
        });
        s.addText(clamp(slide.mainMessage, 220), {
          x: 5.3,
          y: BODY_Y,
          w: W - 5.3 - MARGIN,
          h: BODY_H,
          fontSize: 16,
          color: THEME.ink,
          valign: 'middle',
          fontFace,
        });
        drawFooter(s, slide, index);
        break;
      }

      case 'comparison': {
        drawHeading(s, slide, fontFace);
        // resolveLayout only returns 'comparison' when both sides have points.
        const comparison = slide.comparison!;
        const colW = (W - MARGIN * 2 - 0.4) / 2;
        const sides = [
          { label: comparison.leftLabel, points: comparison.leftPoints, x: MARGIN },
          {
            label: comparison.rightLabel,
            points: comparison.rightPoints,
            x: MARGIN + colW + 0.4,
          },
        ];

        for (const side of sides) {
          s.addShape('rect', {
            x: side.x,
            y: BODY_Y,
            w: colW,
            h: BODY_H,
            fill: { color: THEME.accentSoft },
            line: { color: THEME.rule, width: 1 },
          });
          s.addText(clamp(side.label || ' ', 40), {
            x: side.x + 0.2,
            y: BODY_Y + 0.18,
            w: colW - 0.4,
            h: 0.4,
            fontSize: 14,
            bold: true,
            color: THEME.accent,
            fontFace,
          });
          s.addText(
            side.points.slice(0, 4).map((text) => ({
              text: clamp(text, 90),
              options: {
                bullet: true,
                fontSize: 13,
                color: THEME.ink,
                breakLine: true,
                paraSpaceAfter: 8,
                fontFace,
              },
            })),
            { x: side.x + 0.25, y: BODY_Y + 0.68, w: colW - 0.5, h: BODY_H - 0.85, valign: 'top' },
          );
        }
        drawFooter(s, slide, index);
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

        // A real chart object, so it stays editable in PowerPoint.
        s.addChart(
          type,
          [{ name: chart.seriesName || 'Value', labels: chart.categories, values: chart.values }],
          {
            x: MARGIN,
            y: BODY_Y,
            w: 5.6,
            h: BODY_H,
            chartColors: ['0F766E', '2DD4BF', '5EEAD4', '99F6E4'],
            showLegend: chart.kind === 'pie',
            legendPos: 'b',
            showValue: chart.kind !== 'pie',
            dataLabelColor: THEME.muted,
            dataLabelFontSize: 10,
            catAxisLabelColor: THEME.muted,
            valAxisLabelColor: THEME.muted,
            catAxisLabelFontSize: 10,
            valAxisLabelFontSize: 10,
          },
        );

        s.addText(clamp(slide.mainMessage, 200), {
          x: 6.4,
          y: BODY_Y,
          w: W - 6.4 - MARGIN,
          h: BODY_H,
          fontSize: 14,
          color: THEME.ink,
          valign: 'middle',
          fontFace,
        });
        drawFooter(s, slide, index);
        break;
      }

      default: {
        drawHeading(s, slide, fontFace);
        const bullets = (slide.bullets ?? []).slice(0, MAX_BULLETS);
        s.addText(
          bullets.map((text) => ({
            text: clamp(text, MAX_BULLET_CHARS),
            options: {
              bullet: true,
              fontSize: 16,
              color: THEME.ink,
              breakLine: true,
              paraSpaceAfter: 10,
              fontFace,
            },
          })),
          { x: MARGIN + 0.15, y: BODY_Y, w: W - MARGIN * 2 - 0.3, h: BODY_H, valign: 'middle' },
        );
        drawFooter(s, slide, index);
      }
    }

    attachNotes(s, slide);
  });

  const output = await pptx.write({ outputType: 'nodebuffer' });
  return new Uint8Array(output as Buffer);
}
