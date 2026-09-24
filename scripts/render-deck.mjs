/**
 * Exports a deck covering every slide layout through /api/export, so the real
 * renderer produces the file. Pair with scripts/pptx-to-png.ps1 to open that
 * file in PowerPoint and check it visually.
 *
 *   node scripts/render-deck.mjs <out.pptx> [baseUrl]
 */
import fs from 'node:fs';

const OUT = process.argv[2] ?? 'layout-check.pptx';
const BASE = process.argv[3] ?? 'http://localhost:3000';

const deck = {
  title: 'Rainwater Harvesting Pilot: What We Learned',
  subtitle: 'Riverside Municipal Water Board · October–December 2025',
  slides: [
    {
      title: 'A three-month pilot across four wards',
      layout: 'bullets',
      mainMessage: 'The Board tested household rainwater harvesting before any wider decision.',
      bullets: [
        '250 households took part across four wards',
        'Each received one 2,000 litre collection unit, installed free',
        'Pilot ran from 1 October to 31 December 2025',
        'Total programme cost was Rs 42,00,000',
      ],
      speakerNotes: 'Set the scene: this is a pilot, not a rollout.',
      visualType: 'photo',
      evidence: [],
    },
    {
      title: 'Household water use fell',
      layout: 'stat',
      mainMessage:
        'Average household consumption dropped by 18% against the same quarter in the previous year.',
      bullets: [],
      keyStat: { value: '18', unit: '%', caption: 'Fall in average household water use' },
      speakerNotes: 'This is the headline — but read the limitations slide before quoting it.',
      visualType: 'none',
      evidence: [],
    },
    {
      title: 'Before and after, per household',
      layout: 'chart',
      mainMessage: 'Daily use fell from 412 to 338 litres per household during the pilot.',
      bullets: [],
      chart: {
        kind: 'bar',
        categories: ['Baseline', 'Pilot period'],
        values: [412, 338],
        seriesName: 'Litres per household per day',
      },
      speakerNotes: 'Both figures come straight from the results table.',
      visualType: 'chart',
      evidence: [],
    },
    {
      title: 'Reading the results',
      layout: 'section',
      mainMessage: 'What the pilot shows, and what it cannot yet show.',
      bullets: [],
      speakerNotes: '',
      visualType: 'none',
      evidence: [],
    },
    {
      title: 'What we can and cannot conclude',
      layout: 'comparison',
      mainMessage: 'The reduction is real for this group; generalising it is not yet justified.',
      bullets: [],
      comparison: {
        leftLabel: 'Supported by the pilot',
        leftPoints: [
          'Use fell 18% among participants',
          'Reported shortages fell from 38% to 21%',
          'Units worked for 94% of homes',
        ],
        rightLabel: 'Not yet established',
        rightPoints: [
          'Whether results hold city-wide',
          'Effect in a drier season',
          'Impact without volunteer bias',
        ],
      },
      speakerNotes: 'Rainfall was 23% above average, and there was no control group.',
      visualType: 'none',
      evidence: [],
    },
    {
      title: 'The recommendation',
      layout: 'statement',
      mainMessage:
        'Extend the pilot to 1,000 households across eight wards, with a matched control group, before any city-wide rollout.',
      bullets: [],
      speakerNotes: 'This is the Board’s own recommendation, not ours.',
      visualType: 'none',
      evidence: [],
    },
  ],
};

const res = await fetch(`${BASE}/api/export`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ format: 'presentation', kind: 'pptx', content: deck, sourceTitle: 'rainwater-pilot-report.pdf' }),
});
if (!res.ok) {
  console.error('export failed', res.status, await res.text());
  process.exit(1);
}
fs.writeFileSync(OUT, Buffer.from(await res.arrayBuffer()));
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
