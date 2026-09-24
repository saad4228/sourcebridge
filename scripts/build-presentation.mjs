/**
 * Builds the five-slide technical presentation through SourceBridge's own
 * /api/export endpoint. Every figure here was measured, not estimated.
 */
import fs from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3100';
const OUT = process.argv[3] ?? 'docs/SourceBridge-technical-presentation.pptx';

const deck = {
  title: 'SourceBridge',
  subtitle: 'One source. Multiple formats. Traceable facts. — SIH 2026, PS 26154',
  slides: [
    {
      title: 'The problem, and who has it',
      mainMessage: 'The same information is rewritten repeatedly, and the versions drift apart.',
      bullets: [
        'Comms teams rewrite one report for press, leadership, social and training',
        'Each rewrite is a fresh chance to round a figure or drop a caveat',
        'Users: communications officers, analysts, leadership support, training teams',
        'Cost is not just time — it is contradictory numbers across published channels',
      ],
      speakerNotes:
        'Lead with the drift problem, not with AI. The pain is that four versions of the same finding disagree, and nobody notices until after publication.',
      visualType: 'icon',
      evidence: [],
    },
    {
      title: 'What SourceBridge does',
      mainMessage: 'Understand the source once; generate every format from one shared foundation.',
      bullets: [
        'Extract text with page numbers, split into passages with stable IDs',
        'Build a shared fact ledger: claims, figures with units, dates, caveats',
        'Generate 7 formats from that same ledger, each with its own schema',
        'Every claim links back to the passage it came from — click to read it',
        'Edit any output inline; downloads contain your edits',
      ],
      speakerNotes:
        'The demo moment: the wording changes completely per format, while the figures and the qualifications stay identical.',
      visualType: 'diagram',
      evidence: [],
    },
    {
      title: 'Architecture',
      mainMessage: 'The model writes; the application renders.',
      bullets: [
        'Next.js 16 + TypeScript, server routes only — no separate backend',
        'One Zod schema per format drives both structured output and validation',
        'One request per format, bounded concurrency — partial success is structural',
        'Exports are deterministic renderers: PPTX, SVG, ZIP — no model call',
        'API key is server-side only; source text is fenced as data, never instructions',
      ],
      speakerNotes:
        'Stress that slides and SVG are rendered by our own code. No model-generated markup is ever executed, and an export cannot fail because of the provider.',
      visualType: 'diagram',
      evidence: [],
    },
    {
      title: 'What we observed',
      mainMessage: 'Measured on the sample report — one run, not a benchmark.',
      bullets: [
        'All 7 formats generated successfully from one 3-page source',
        '49 evidence references produced, 0 failed to resolve to a real passage',
        'The pilot-population caveat carried into all 7 outputs',
        '49 automated tests cover extraction, validation, exports, prompt boundary',
        'Validation caught 2 genuine bugs in our own numeric checking',
      ],
      speakerNotes:
        'Be precise: this is one run on one document, not a benchmark. Do not claim accuracy rates. The evidence-resolution figure is the one worth stating, because it is objectively checkable.',
      visualType: 'chart',
      evidence: [],
    },
    {
      title: 'Limits and what comes next',
      mainMessage: 'Honest scope now; the interesting work is source-change tracking.',
      bullets: [
        'No OCR, no rendered video, no persistence — and the UI says so',
        'Checks are structural: they do not verify that content is true',
        'Next: OCR and DOCX, section-level regeneration with locked sections',
        'Then: source-change impact tracking — mark affected sections stale',
        'Then: tested Indian-language output with glossaries and numeric fidelity',
      ],
      speakerNotes:
        'Closing point: the product promise is not that AI gets everything right. It is one source becoming a coordinated package, with visible evidence and human control.',
      visualType: 'none',
      evidence: [],
    },
  ],
};

const response = await fetch(`${BASE}/api/export`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    format: 'presentation',
    kind: 'pptx',
    content: deck,
    sourceTitle: 'SourceBridge technical presentation',
  }),
});

if (!response.ok) {
  console.error('export failed', response.status, await response.text());
  process.exit(1);
}

fs.writeFileSync(OUT, Buffer.from(await response.arrayBuffer()));
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes');
