/**
 * Exports one infographic per layout through /api/export and tiles them into a
 * contact sheet, so the four templates can be compared side by side.
 *
 *   node scripts/render-infographics.mjs <outDir> [baseUrl]
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
const BASE = process.argv[3] ?? 'http://localhost:3000';
fs.mkdirSync(OUT, { recursive: true });

const base = {
  headline: 'A rainwater pilot cut household water use',
  subheadline: 'Riverside Municipal Water Board · October–December 2025',
  keyMessages: [
    { label: 'Lower demand', detail: 'Average household use fell across all four wards.', evidence: [] },
    { label: 'Pilot population only', detail: 'Results do not automatically generalise to the city.', evidence: [] },
    { label: 'Next step', detail: 'A larger trial with a matched control group is recommended.', evidence: [] },
  ],
  statistics: [],
  sourceFooter: 'Rainwater Harvesting Pilot: Final Report, RMWB-2026-014',
  altText: 'Average household water use fell 18% across 250 participating households.',
};

const variants = {
  stats: {
    ...base,
    layout: 'stats',
    statistics: [
      { value: '18', unit: '%', caption: 'Fall in average household use', evidence: [] },
      { value: '250', unit: '', caption: 'Households participating', evidence: [] },
      { value: '3', unit: ' months', caption: 'Pilot duration', evidence: [] },
    ],
  },
  chart: {
    ...base,
    layout: 'chart',
    chart: {
      kind: 'bar',
      categories: ['Baseline', 'Pilot period'],
      values: [412, 338],
      seriesName: 'Litres per household per day',
    },
  },
  donut: {
    ...base,
    headline: 'Most units needed no repair during the pilot',
    layout: 'chart',
    chart: {
      kind: 'donut',
      categories: ['Needed repair', 'No repair needed'],
      values: [14, 236],
      seriesName: 'Collection units, of 250',
    },
  },
  comparison: {
    ...base,
    layout: 'comparison',
    comparison: {
      leftLabel: 'Baseline',
      leftValue: '412 L',
      leftPoints: ['Per household, per day', 'Same quarter, previous year'],
      rightLabel: 'Pilot period',
      rightValue: '338 L',
      rightPoints: ['Per household, per day', 'With harvesting units installed'],
    },
  },
  qualitative: {
    ...base,
    headline: 'What the rainwater pilot told us',
    layout: 'qualitative',
  },
};

const svgs = {};
for (const [name, content] of Object.entries(variants)) {
  const res = await fetch(`${BASE}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'infographic', kind: 'svg', content, sourceTitle: 'layout-check' }),
  });
  if (!res.ok) {
    console.error(name, 'failed:', res.status, (await res.text()).slice(0, 200));
    continue;
  }
  const svg = await res.text();
  svgs[name] = svg;
  fs.writeFileSync(path.join(OUT, `${name}.svg`), svg);
  console.log(`${name.padEnd(11)} ${String(svg.length).padStart(5)} bytes  height=${svg.match(/height="(\d+)"/)[1]}`);
}

const cards = Object.entries(svgs)
  .map(([name, svg]) => `<figure><div class="frame">${svg}</div><figcaption>${name}</figcaption></figure>`)
  .join('');

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1.5 });
await page.setContent(
  `<style>
     body{margin:0;padding:18px;background:#2f3136;font:12px sans-serif;color:#ddd;
          display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:start}
     .frame{background:#fff;box-shadow:0 2px 10px #0008}
     svg{width:100%;height:auto;display:block}
     figure{margin:0} figcaption{padding-top:6px}
   </style>${cards}`,
);
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, 'infographic-layouts.png'), fullPage: true });
await browser.close();
console.log('sheet written');
