/**
 * Deterministic scene visuals for the rendered video.
 *
 * Every frame is drawn by this module, never by an image model. That is what
 * keeps figures exact: a generative model asked to render "18%" will sometimes
 * produce "180%" or illegible glyphs, and in a video the viewer has no way to
 * check it. Here the text is the text.
 */

import type { VideoPackage } from '../schemas';
import { detectScript, svgFontStack, widthFactor } from './fonts';

/** 1920x1080 keeps the output at a standard broadcast size. */
export const FRAME_WIDTH = 1920;
export const FRAME_HEIGHT = 1080;

const COLORS = {
  ink: '#0b1220',
  muted: '#cbd5e1',
  accent: '#0f766e',
  accentLight: '#5eead4',
  page: '#0e1116',
} as const;

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const n = (value: number) => Number(value.toFixed(1));

function wrap(text: string, charsPerLine: number, maxLines: number, factor = 1): string[] {
  charsPerLine = Math.max(8, Math.floor(charsPerLine * factor));

  // A single token longer than the line budget (a URL, an identifier, or a
  // script that does not use spaces) has to be broken, or it runs off the frame.
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

  if (lines.length === maxLines && lines.length > 0) {
    const consumed = lines.join(' ').split(/\s+/).length;
    if (consumed < words.length) {
      const last = lines[lines.length - 1];
      lines[lines.length - 1] = `${last.slice(0, Math.max(0, charsPerLine - 1))}…`;
    }
  }
  return lines;
}

export interface SceneCardOptions {
  /** Shown small in the corner, e.g. "Scene 2 of 6". */
  position?: string;
  /** Footer attribution, usually the source document. */
  footer?: string;
}

/**
 * A single video frame as SVG.
 *
 * The on-screen text is the headline; the narration is spoken, not printed, so
 * the frame stays readable rather than becoming a wall of words.
 */
export function renderSceneCardSvg(
  scene: VideoPackage['scenes'][number],
  options: SceneCardOptions = {},
): string {
  const script = detectScript(`${scene.heading} ${scene.onScreenText ?? ''}`);
  const fontStack = svgFontStack(script);
  const factor = widthFactor(script);

  const parts: string[] = [];

  // Background with a broad accent wash, so frames are not flat black.
  parts.push(`<rect width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" fill="${COLORS.page}"/>`);
  parts.push(
    `<rect x="0" y="0" width="18" height="${FRAME_HEIGHT}" fill="${COLORS.accent}"/>`,
  );
  parts.push(
    `<circle cx="${FRAME_WIDTH - 180}" cy="${FRAME_HEIGHT - 150}" r="420" fill="${COLORS.accent}" opacity="0.14"/>`,
  );

  const left = 150;
  let y = 400;

  // Scene heading.
  const headingLines = wrap(scene.heading, 30, 2, factor);
  headingLines.forEach((line, i) => {
    parts.push(
      `<text x="${left}" y="${n(y + i * 92)}" font-size="76" font-weight="700" ` +
        `fill="#ffffff">${esc(line)}</text>`,
    );
  });
  y += headingLines.length * 92;

  // Accent rule.
  parts.push(`<rect x="${left}" y="${n(y + 18)}" width="120" height="8" rx="4" fill="${COLORS.accentLight}"/>`);
  y += 74;

  // On-screen text, when the scene has any.
  if (scene.onScreenText?.trim()) {
    const lines = wrap(scene.onScreenText, 44, 3, factor);
    lines.forEach((line, i) => {
      parts.push(
        `<text x="${left}" y="${n(y + i * 56)}" font-size="42" fill="${COLORS.muted}">${esc(line)}</text>`,
      );
    });
  }

  if (options.position) {
    parts.push(
      `<text x="${left}" y="180" font-size="30" font-weight="700" fill="${COLORS.accentLight}" ` +
        `letter-spacing="4">${esc(options.position.toUpperCase())}</text>`,
    );
  }

  if (options.footer) {
    parts.push(
      `<text x="${left}" y="${FRAME_HEIGHT - 90}" font-size="26" fill="#64748b">${esc(options.footer)}</text>`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" viewBox="0 0 ${FRAME_WIDTH} ${FRAME_HEIGHT}">
<g font-family="${esc(fontStack)}">
${parts.join('\n')}
</g>
</svg>`;
}

/** The opening frame: title and objective. */
export function renderTitleCardSvg(content: VideoPackage, footer?: string): string {
  const script = detectScript(`${content.title} ${content.objective}`);
  const fontStack = svgFontStack(script);
  const factor = widthFactor(script);

  const titleLines = wrap(content.title, 26, 3, factor);
  const parts: string[] = [
    `<rect width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" fill="${COLORS.accent}"/>`,
    `<circle cx="${FRAME_WIDTH - 140}" cy="140" r="360" fill="#ffffff" opacity="0.07"/>`,
  ];

  let y = 480 - (titleLines.length - 1) * 50;
  titleLines.forEach((line, i) => {
    parts.push(
      `<text x="150" y="${n(y + i * 100)}" font-size="86" font-weight="700" fill="#ffffff">${esc(line)}</text>`,
    );
  });
  y += titleLines.length * 100;

  wrap(content.objective, 56, 2, factor).forEach((line, i) => {
    parts.push(`<text x="150" y="${n(y + 30 + i * 52)}" font-size="38" fill="${COLORS.accentLight}">${esc(line)}</text>`);
  });

  if (footer) {
    parts.push(`<text x="150" y="${FRAME_HEIGHT - 90}" font-size="26" fill="#a7f3d0">${esc(footer)}</text>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" viewBox="0 0 ${FRAME_WIDTH} ${FRAME_HEIGHT}">
<g font-family="${esc(fontStack)}">
${parts.join('\n')}
</g>
</svg>`;
}
