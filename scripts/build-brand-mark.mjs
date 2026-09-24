/**
 * Crops the transparent margin off public/icon.png and regenerates every
 * derived asset. The supplied artwork sits inside a wide transparent border, so
 * rendering it untouched wastes about 40% of the box and makes the mark look
 * smaller than the space it occupies.
 */
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';

// Measured content bounds of the artwork within its 500x500 canvas.
const [minX, minY, maxX, maxY] = process.argv.slice(2, 6).map(Number);
const contentW = maxX - minX + 1;
const contentH = maxY - minY + 1;

const src = fs.readFileSync('public/icon.png').toString('base64');

/** Render a crop of the artwork, given a viewBox over the original canvas. */
function render(viewBox, width, height) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">` +
    `<image href="data:image/png;base64,${src}" width="500" height="500"/></svg>`;
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: 'rgba(0,0,0,0)',
  })
    .render()
    .asPng();
}

// --- Square assets: content centred, with a small breathing margin ---------
const side = Math.max(contentW, contentH) * 1.08;
const cx = minX + contentW / 2;
const cy = minY + contentH / 2;
const squareBox = `${cx - side / 2} ${cy - side / 2} ${side} ${side}`;

fs.writeFileSync('public/favicon.png', render(squareBox, 64, 64));
fs.writeFileSync('public/apple-icon.png', render(squareBox, 180, 180));
console.log('favicon.png   ', fs.statSync('public/favicon.png').size, 'bytes');
console.log('apple-icon.png', fs.statSync('public/apple-icon.png').size, 'bytes');

// --- Header mark: the artwork's own proportions, tightly cropped ------------
const tightBox = `${minX} ${minY} ${contentW} ${contentH}`;
const markHeight = 96;
const markWidth = Math.round((contentW / contentH) * markHeight);
const mark = render(tightBox, markWidth, markHeight);

fs.writeFileSync(
  'components/brandMark.ts',
  `/**
 * The SourceBridge mark, inlined as a data URI.
 *
 * Inlined rather than served from /public because endpoint-security software on
 * some Windows machines silently blocks binary subresource loads from
 * localhost: the raw file fetches fine, but the <img> element never completes,
 * leaving the header wordless with no error. A data URI makes no request at
 * all, so the mark always renders.
 *
 * Cropped to the artwork: the source PNG carries a wide transparent margin,
 * which would otherwise shrink the mark inside its own box.
 *
 * Regenerate with scripts/build-brand-mark.mjs if the artwork changes.
 */

/** Natural aspect ratio of the cropped artwork, for sizing without distortion. */
export const BRAND_MARK_RATIO = ${(contentW / contentH).toFixed(4)};

export const BRAND_MARK = 'data:image/png;base64,${mark.toString('base64')}';
`,
);
console.log('brandMark.ts  ', mark.length, 'bytes |', markWidth + 'x' + markHeight);
