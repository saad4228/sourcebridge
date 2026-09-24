/**
 * Deterministic SVG infographic renderer.
 *
 * The model supplies content and nothing else. Layout, colour and typography
 * are fixed here, so the output cannot be broken by an unexpected response and
 * no model-generated markup is ever rendered. All text is XML-escaped.
 *
 * The canvas grows to fit its content rather than using a fixed height: a
 * qualitative piece is far shorter than a chart-led one, and padding the
 * difference with blank space made every infographic look unfinished.
 */

import type { Infographic } from '../schemas';
import { detectScript, svgFontStack, widthFactor } from './fonts';
import { resolveInfographicLayout, type InfographicLayout } from './infographicLayout';

const WIDTH = 800;
const PAD = 56;
const INNER = WIDTH - PAD * 2;

const COLORS = {
  ink: '#111827',
  muted: '#4b5563',
  faint: '#9ca3af',
  accent: '#0f766e',
  accentMid: '#14b8a6',
  accentLight: '#5eead4',
  accentSoft: '#ccfbf1',
  accentTint: '#f0fdfa',
  rule: '#e5e7eb',
  panel: '#f9fafb',
  page: '#ffffff',
} as const;

/** Series colours, darkest first so a two-bar chart reads as before/after. */
const SERIES = [COLORS.accent, COLORS.accentMid, COLORS.accentLight, '#99f6e4', '#134e4a'];

/** Escape text for XML content. Never interpolate raw model output. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Round to one decimal so the output stays stable and diffable. */
const n = (value: number) => Number(value.toFixed(1));

/**
 * Wrap text to a character budget. Approximate by design: the renderer controls
 * the font size, and the schema caps field lengths, so this stays within the
 * intended box for realistic content.
 */
function wrap(text: string, charsPerLine: number, maxLines: number, factor = 1): string[] {
  charsPerLine = Math.max(8, Math.floor(charsPerLine * factor));

  // A single token longer than the line budget (a URL, an identifier, or a
  // script that does not use spaces) has to be broken, or it overflows its box.
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) =>
      word.length <= charsPerLine
        ? [word]
        : (word.match(new RegExp(`.{1,${charsPerLine}}`, 'g')) ?? [word]),
    );

  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= charsPerLine) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);

  // Signal truncation rather than silently dropping content.
  if (lines.length === maxLines && lines.length > 0) {
    const consumed = lines.join(' ').split(/\s+/).length;
    if (consumed < words.length) {
      const last = lines[lines.length - 1];
      lines[lines.length - 1] = `${last.slice(0, Math.max(0, charsPerLine - 1))}…`;
    }
  }
  return lines;
}

interface TextOpts {
  size: number;
  weight?: number;
  fill?: string;
  lineHeight?: number;
  anchor?: string;
}

function textBlock(lines: string[], x: number, y: number, opts: TextOpts): { svg: string; height: number } {
  const lineHeight = opts.lineHeight ?? opts.size * 1.35;
  const svg = lines
    .map(
      (line, i) =>
        `<text x="${n(x)}" y="${n(y + i * lineHeight)}" font-size="${opts.size}" ` +
        `font-weight="${opts.weight ?? 400}" fill="${opts.fill ?? COLORS.ink}" ` +
        `${opts.anchor ? `text-anchor="${opts.anchor}" ` : ''}>${esc(line)}</text>`,
    )
    .join('\n');
  return { svg, height: lines.length * lineHeight };
}

/** Shrink a figure so it stays inside the space allowed for it. */
function figureSize(text: string, budget: number): number {
  if (text.length > 12) return Math.round(budget * 0.42);
  if (text.length > 9) return Math.round(budget * 0.55);
  if (text.length > 6) return Math.round(budget * 0.7);
  return budget;
}

/** A donut slice, drawn as an arc path between two angles. */
function donutSlice(cx: number, cy: number, outer: number, inner: number, from: number, to: number, fill: string): string {
  // A full circle cannot be expressed as a single arc; draw two rings instead.
  if (to - from >= 359.999) {
    return (
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n((outer + inner) / 2)}" fill="none" ` +
      `stroke="${fill}" stroke-width="${n(outer - inner)}"/>`
    );
  }
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const large = to - from > 180 ? 1 : 0;
  const p = (r: number, deg: number) => `${n(cx + r * Math.cos(rad(deg)))} ${n(cy + r * Math.sin(rad(deg)))}`;

  return (
    `<path d="M ${p(outer, from)} A ${n(outer)} ${n(outer)} 0 ${large} 1 ${p(outer, to)} ` +
    `L ${p(inner, to)} A ${n(inner)} ${n(inner)} 0 ${large} 0 ${p(inner, from)} Z" fill="${fill}"/>`
  );
}

interface Ctx {
  factor: number;
  parts: string[];
}

/** Stat cards: two or three headline figures side by side. */
function drawStats(content: Infographic, y: number, ctx: Ctx): number {
  const shown = (content.statistics ?? []).slice(0, 3);
  const gap = 20;
  const cardWidth = (INNER - gap * (shown.length - 1)) / shown.length;
  const height = 150;

  shown.forEach((stat, i) => {
    const x = PAD + i * (cardWidth + gap);
    ctx.parts.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(cardWidth)}" height="${height}" rx="12" ` +
        `fill="${COLORS.panel}" stroke="${COLORS.rule}"/>`,
    );

    const figure = `${stat.value}${stat.unit ?? ''}`;
    ctx.parts.push(
      `<text x="${n(x + cardWidth / 2)}" y="${n(y + 70)}" font-size="${figureSize(figure, 46)}" ` +
        `font-weight="700" fill="${COLORS.accent}" text-anchor="middle">${esc(figure)}</text>`,
    );

    const caption = textBlock(
      wrap(stat.caption, Math.floor(cardWidth / 7), 3, ctx.factor),
      x + cardWidth / 2,
      y + 100,
      { size: 13, fill: COLORS.muted, lineHeight: 17, anchor: 'middle' },
    );
    ctx.parts.push(caption.svg);
  });

  return y + height + 48;
}

/** A bar or donut chart drawn from the source values. */
function drawChart(content: Infographic, y: number, ctx: Ctx): number {
  const chart = content.chart!;
  const values = chart.values;
  const categories = chart.categories;

  const titleLines = wrap(chart.seriesName, 60, 1, ctx.factor);
  if (chart.seriesName.trim()) {
    ctx.parts.push(
      textBlock(titleLines, PAD, y + 4, { size: 14, weight: 700, fill: COLORS.muted }).svg,
    );
    y += 26;
  }

  if (chart.kind === 'donut') {
    const total = values.reduce((sum, v) => sum + Math.max(v, 0), 0) || 1;
    const cx = PAD + 110;
    const cy = y + 110;

    // Cumulative shares, so no running mutation is needed.
    const ends = values.map(
      (_, i) => (values.slice(0, i + 1).reduce((sum, v) => sum + Math.max(v, 0), 0) / total) * 360,
    );
    values.forEach((_, i) => {
      ctx.parts.push(donutSlice(cx, cy, 100, 62, i === 0 ? 0 : ends[i - 1], ends[i], SERIES[i % SERIES.length]));
    });

    // Legend beside the ring.
    let legendY = y + 44;
    categories.forEach((category, i) => {
      const share = Math.round((Math.max(values[i], 0) / total) * 100);
      ctx.parts.push(
        `<rect x="${PAD + 244}" y="${n(legendY - 11)}" width="14" height="14" rx="3" fill="${SERIES[i % SERIES.length]}"/>`,
      );
      ctx.parts.push(
        textBlock(wrap(category, 30, 1, ctx.factor), PAD + 268, legendY, { size: 14, fill: COLORS.ink }).svg,
      );
      ctx.parts.push(
        `<text x="${WIDTH - PAD}" y="${n(legendY)}" font-size="14" font-weight="700" ` +
          `fill="${COLORS.accent}" text-anchor="end">${esc(String(values[i]))} (${share}%)</text>`,
      );
      legendY += 30;
    });

    return Math.max(y + 220, legendY + 8) + 40;
  }

  // Vertical bars.
  const max = Math.max(...values.map((v) => Math.abs(v)), 1);
  const plotHeight = 180;
  const slot = INNER / values.length;
  const barWidth = Math.min(slot - 24, 110);
  const baseline = y + plotHeight + 26;

  ctx.parts.push(
    `<line x1="${PAD}" y1="${n(baseline)}" x2="${WIDTH - PAD}" y2="${n(baseline)}" ` +
      `stroke="${COLORS.rule}" stroke-width="1"/>`,
  );

  values.forEach((value, i) => {
    const barHeight = Math.max((Math.abs(value) / max) * plotHeight, 3);
    const x = PAD + i * slot + (slot - barWidth) / 2;
    const top = baseline - barHeight;

    ctx.parts.push(
      `<rect x="${n(x)}" y="${n(top)}" width="${n(barWidth)}" height="${n(barHeight)}" rx="6" ` +
        `fill="${SERIES[i % SERIES.length]}"/>`,
    );
    ctx.parts.push(
      `<text x="${n(x + barWidth / 2)}" y="${n(top - 10)}" font-size="20" font-weight="700" ` +
        `fill="${COLORS.ink}" text-anchor="middle">${esc(String(value))}</text>`,
    );

    const label = textBlock(
      wrap(categories[i] ?? '', Math.floor(slot / 8), 2, ctx.factor),
      x + barWidth / 2,
      baseline + 24,
      { size: 13, fill: COLORS.muted, lineHeight: 17, anchor: 'middle' },
    );
    ctx.parts.push(label.svg);
  });

  return baseline + 62;
}

/** Two panels set against each other. */
function drawComparison(content: Infographic, y: number, ctx: Ctx): number {
  const c = content.comparison!;
  const gap = 20;
  const colWidth = (INNER - gap) / 2;

  const sides = [
    { label: c.leftLabel, value: c.leftValue, points: c.leftPoints, x: PAD, fill: COLORS.accent },
    { label: c.rightLabel, value: c.rightValue, points: c.rightPoints, x: PAD + colWidth + gap, fill: COLORS.accentMid },
  ];

  // Measure first so both panels share a height.
  const bodies = sides.map((side) => {
    const points = side.points.slice(0, 3);
    return points.map((point) => wrap(point, Math.floor(colWidth / 7.4), 2, ctx.factor));
  });
  const maxLines = Math.max(...bodies.map((b) => b.reduce((sum, lines) => sum + lines.length, 0)), 0);
  const height = 96 + Math.max(maxLines * 19 + bodies[0].length * 8, 24);

  sides.forEach((side, i) => {
    ctx.parts.push(
      `<rect x="${n(side.x)}" y="${n(y)}" width="${n(colWidth)}" height="${n(height)}" rx="12" ` +
        `fill="${COLORS.accentTint}" stroke="${COLORS.accentSoft}"/>`,
    );
    ctx.parts.push(`<rect x="${n(side.x)}" y="${n(y)}" width="${n(colWidth)}" height="5" rx="2.5" fill="${side.fill}"/>`);

    ctx.parts.push(
      textBlock(wrap(side.label, Math.floor(colWidth / 8), 1, ctx.factor), side.x + 20, y + 32, {
        size: 14,
        weight: 700,
        fill: COLORS.muted,
      }).svg,
    );

    if (side.value.trim()) {
      ctx.parts.push(
        `<text x="${n(side.x + 20)}" y="${n(y + 78)}" font-size="${figureSize(side.value, 38)}" ` +
          `font-weight="700" fill="${side.fill}">${esc(side.value)}</text>`,
      );
    }

    let pointY = y + (side.value.trim() ? 104 : 64);
    bodies[i].forEach((lines) => {
      ctx.parts.push(`<circle cx="${n(side.x + 24)}" cy="${n(pointY - 5)}" r="3" fill="${side.fill}"/>`);
      const block = textBlock(lines, side.x + 36, pointY, { size: 14, fill: COLORS.ink, lineHeight: 19 });
      ctx.parts.push(block.svg);
      pointY += block.height + 8;
    });
  });

  return y + height + 44;
}

/** The key messages list, shared by every layout. */
function drawMessages(content: Infographic, y: number, ctx: Ctx, emphasis: boolean): number {
  const messages = (content.keyMessages ?? []).slice(0, 5);

  for (const message of messages) {
    ctx.parts.push(`<circle cx="${PAD + 16}" cy="${n(y + 8)}" r="6" fill="${COLORS.accent}"/>`);

    const label = textBlock(wrap(message.label, emphasis ? 40 : 46, 2, ctx.factor), PAD + 40, y + 14, {
      size: emphasis ? 21 : 19,
      weight: 700,
    });
    ctx.parts.push(label.svg);
    let blockHeight = label.height;

    if (message.detail?.trim()) {
      const detail = textBlock(
        wrap(message.detail, emphasis ? 54 : 62, 3, ctx.factor),
        PAD + 40,
        y + 14 + blockHeight + 6,
        { size: emphasis ? 16 : 15, fill: COLORS.muted, lineHeight: emphasis ? 23 : 21 },
      );
      ctx.parts.push(detail.svg);
      blockHeight += detail.height + 6;
    }

    y += blockHeight + (emphasis ? 38 : 34);
  }

  return y;
}

/**
 * Render an infographic.
 *
 * When the content carries no usable figures the qualitative layout is used,
 * rather than inventing numbers to fill a template.
 */
export function renderInfographicSvg(content: Infographic): string {
  const layout: InfographicLayout = resolveInfographicLayout(content);

  // Font and wrapping depend on the script actually present in the content.
  const script = detectScript(
    [content.headline, content.subheadline, ...(content.keyMessages ?? []).map((m) => m.label + m.detail)].join(' '),
  );
  const fontStack = svgFontStack(script);
  const ctx: Ctx = { factor: widthFactor(script), parts: [] };

  // --- Header band ---------------------------------------------------------
  const headlineLines = wrap(content.headline, 34, 3, ctx.factor);
  const hasSub = Boolean(content.subheadline?.trim());
  const headerHeight = 96 + headlineLines.length * 42 + (hasSub ? 42 : 0);

  ctx.parts.push(`<rect x="0" y="0" width="${WIDTH}" height="${n(headerHeight)}" fill="${COLORS.accent}"/>`);
  const headline = textBlock(headlineLines, PAD, 92, {
    size: 34,
    weight: 700,
    fill: '#ffffff',
    lineHeight: 42,
  });
  ctx.parts.push(headline.svg);

  if (hasSub) {
    ctx.parts.push(
      textBlock(wrap(content.subheadline, 58, 2, ctx.factor), PAD, 92 + headline.height + 10, {
        size: 17,
        fill: COLORS.accentSoft,
        lineHeight: 24,
      }).svg,
    );
  }

  // --- Centrepiece ---------------------------------------------------------
  let y = headerHeight + 52;

  if (layout === 'stats') {
    y = drawStats(content, y, ctx);
  } else if (layout === 'chart') {
    y = drawChart(content, y, ctx);
  } else if (layout === 'comparison') {
    y = drawComparison(content, y, ctx);
  } else {
    // Qualitative: a rule stands in for the missing figures.
    ctx.parts.push(`<rect x="${PAD}" y="${n(y)}" width="${INNER}" height="4" rx="2" fill="${COLORS.accent}"/>`);
    y += 44;
  }

  // --- Key messages --------------------------------------------------------
  y = drawMessages(content, y, ctx, layout === 'qualitative');

  // --- Footer --------------------------------------------------------------
  const footerY = y + 34;
  ctx.parts.push(
    `<line x1="${PAD}" y1="${n(footerY - 26)}" x2="${WIDTH - PAD}" y2="${n(footerY - 26)}" ` +
      `stroke="${COLORS.rule}" stroke-width="1"/>`,
  );
  const footer = textBlock(wrap(content.sourceFooter || 'Source unspecified', 62, 2, ctx.factor), PAD, footerY, {
    size: 13,
    fill: COLORS.faint,
    lineHeight: 18,
  });
  ctx.parts.push(footer.svg);
  ctx.parts.push(
    `<text x="${WIDTH - PAD}" y="${n(footerY)}" font-size="12" fill="${COLORS.faint}" ` +
      `text-anchor="end">Generated with SourceBridge</text>`,
  );

  // The canvas fits the content, with a floor so a sparse piece still reads as a poster.
  const height = Math.max(Math.round(footerY + footer.height + 30), 620);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${esc(content.headline)}</title>
<desc id="desc">${esc(content.altText || content.headline)}</desc>
<rect width="${WIDTH}" height="${height}" fill="${COLORS.page}"/>
<g font-family="${esc(fontStack)}">
${ctx.parts.join('\n')}
</g>
</svg>`;
}
