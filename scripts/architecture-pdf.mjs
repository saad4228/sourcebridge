/**
 * Render docs/ARCHITECTURE.md to an A4 PDF and report its page count.
 *
 * The submission caps the document at two pages, and a word count does not
 * predict that: the pipeline diagram and the tables take far more vertical
 * space per word than prose. This renders the real thing and counts, so the
 * limit is checked rather than estimated.
 *
 *   node scripts/architecture-pdf.mjs [out.pdf]
 *
 * Needs Microsoft Edge, which the screenshot scripts already rely on.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const SOURCE = 'docs/ARCHITECTURE.md';
const OUT = process.argv[2] ?? 'docs/ARCHITECTURE.pdf';

const md = fs.readFileSync(SOURCE, 'utf8').split('\r\n').join('\n');
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Enough Markdown for this document: headings, tables, fences, lists, quotes. */
function toHtml(src) {
  const out = [];
  const lines = src.split('\n');
  let i = 0;
  const inline = (t) =>
    esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      out.push(`<pre>${esc(body.join('\n'))}</pre>`);
      continue;
    }

    if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.split('|').slice(1, -1).map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push(
        `<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>` +
          `<tbody>${body
            .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(body.join(' '))}</blockquote>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && (/^[-*]\s+/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        if (/^[-*]\s+/.test(lines[i])) items.push(lines[i].replace(/^[-*]\s+/, ''));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
      continue;
    }

    if (/^---+$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !/^[#>|`-]/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

const html = `<!doctype html><meta charset="utf-8"><style>
  @page { size: A4; margin: 14mm; }
  body { font: 10pt/1.42 "Segoe UI", system-ui, sans-serif; color: #111; }
  h1 { font-size: 17pt; margin: 0 0 2pt; }
  h2 { font-size: 11.5pt; margin: 11pt 0 4pt; }
  p, li { margin: 3.5pt 0; }
  ul { margin: 3pt 0; padding-left: 15pt; }
  pre { font: 7pt/1.18 Consolas, monospace; background: #f6f6f6; padding: 6pt; margin: 6pt 0; }
  table { border-collapse: collapse; width: 100%; font-size: 8.5pt; margin: 5pt 0; }
  th, td { border: 1px solid #ccc; padding: 2.5pt 4pt; text-align: left; vertical-align: top; }
  blockquote { margin: 5pt 0; padding-left: 8pt; border-left: 2px solid #888; font-size: 9pt; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 8pt 0; }
  code { font: 8.5pt Consolas, monospace; background: #f2f2f2; padding: 0 2px; }
</style>${toHtml(md)}`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.pdf({
  path: OUT,
  format: 'A4',
  margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' },
});
await browser.close();

// Count the page objects rather than trusting a word count.
const pdf = fs.readFileSync(OUT).toString('latin1');
const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
const words = md.split(/\s+/).filter(Boolean).length;

console.log(`wrote ${OUT}`);
console.log(`${words} words · ${pages} A4 page${pages === 1 ? '' : 's'}`);
console.log(pages <= 2 ? 'within the two-page limit' : `OVER the limit by ${pages - 2}`);
process.exitCode = pages <= 2 ? 0 : 1;
