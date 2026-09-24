/**
 * Renders a video package to MP4 through /api/export, so the real pipeline
 * produces the file: provider TTS, our own frames, ffmpeg compositing.
 *
 *   node scripts/render-video.mjs <out.mp4> [baseUrl]
 *
 * Consumes TTS quota: one request per scene.
 */
import fs from 'node:fs';

const OUT = process.argv[2] ?? 'video-check.mp4';
const BASE = process.argv[3] ?? 'http://localhost:3000';

const content = {
  title: 'Rainwater Harvesting Pilot',
  objective: 'Explain what the pilot found, and what it did not',
  scenes: [
    {
      index: 1,
      heading: 'A three-month pilot',
      estimatedSeconds: 12,
      narration:
        'Between October and December 2025, the Riverside Municipal Water Board ran a household rainwater harvesting pilot across four wards. Two hundred and fifty households took part.',
      onScreenText: '250 households · four wards · Oct–Dec 2025',
      visualRecommendation: 'Wide shot of a residential street.',
      evidence: [],
    },
    {
      index: 2,
      heading: 'Water use fell 18 percent',
      estimatedSeconds: 12,
      narration:
        'Average household water consumption fell by eighteen percent against the same quarter a year earlier. Daily use dropped from four hundred and twelve litres to three hundred and thirty-eight.',
      onScreenText: '412 L → 338 L per household per day',
      visualRecommendation: 'Animated bar chart.',
      evidence: [],
    },
    {
      index: 3,
      heading: 'What it does not show',
      estimatedSeconds: 14,
      narration:
        'These results describe the pilot population only. Participation was voluntary, rainfall was well above average, and no control group was used. The Board recommends a larger trial before any city-wide rollout.',
      onScreenText: 'Pilot population only · no control group',
      visualRecommendation: 'Text on a plain background.',
      evidence: [],
    },
  ],
  fullScript: '',
};
content.fullScript = content.scenes.map((s) => s.narration).join(' ');

console.log(`rendering ${content.scenes.length} scenes…`);
const started = Date.now();

const res = await fetch(`${BASE}/api/export`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    format: 'video_package',
    kind: 'mp4',
    content,
    sourceTitle: 'rainwater-pilot-report.pdf',
  }),
});

if (!res.ok) {
  console.error('failed:', res.status, (await res.text()).slice(0, 400));
  process.exit(1);
}

fs.writeFileSync(OUT, Buffer.from(await res.arrayBuffer()));
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
console.log('reported duration:', res.headers.get('X-Video-Seconds'), 'seconds');
console.log('voice:', res.headers.get('X-Video-Voice'));
console.log('elapsed:', ((Date.now() - started) / 1000).toFixed(1), 's');
