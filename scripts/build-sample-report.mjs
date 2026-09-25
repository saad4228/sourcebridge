/**
 * Generates the bundled sample source document.
 *
 * Written as a script rather than committed as an opaque binary so the sample
 * stays reviewable: the hedged language below is deliberate, and it is what
 * the meaning-drift checks are demonstrated against. A reader can see exactly
 * which qualifiers the document contains and why.
 *
 * A minimal PDF writer rather than a dependency: the file is plain text in one
 * of the standard fonts, which needs no font embedding and no library. Text is
 * positioned explicitly so it extracts cleanly, including the table.
 *
 *   node scripts/build-sample-report.mjs [out.pdf]
 */
import fs from 'node:fs';

const OUT = process.argv[2] ?? 'samples/cyber-incident-report.pdf';

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 62;
const TOP = PAGE_H - 60;
const LEADING = 15;
const WIDTH = 78; // characters per line at 11pt Helvetica in the text column

/** Escape the three characters that terminate or continue a PDF string. */
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Greedy wrap. The source is prose, so breaking on spaces is sufficient. */
function wrap(text, width = WIDTH) {
  const out = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

/** One page under construction: a list of absolutely positioned text runs. */
class Page {
  constructor() {
    this.runs = [];
    this.y = TOP;
  }
  at(x, y, text, { size = 11, font = 'F1' } = {}) {
    this.runs.push({ x, y, text, size, font });
    return this;
  }
  line(text, { size = 11, font = 'F1', gap = 0 } = {}) {
    this.y -= gap;
    this.at(MARGIN, this.y, text, { size, font });
    this.y -= LEADING;
    return this;
  }
  para(text, opts = {}) {
    for (const l of wrap(text, opts.width)) this.line(l, opts);
    return this;
  }
  /** A table row at fixed column positions, so columns actually align. */
  row(cells, { size = 10, font = 'F1', gap = 0 } = {}) {
    this.y -= gap;
    for (const [x, text] of cells) this.at(MARGIN + x, this.y, text, { size, font });
    this.y -= LEADING;
    return this;
  }
  stream() {
    const parts = this.runs.map(
      (r) => `BT /${r.font} ${r.size} Tf ${r.x} ${r.y} Td (${esc(r.text)}) Tj ET`,
    );
    return parts.join('\n');
  }
}

// ---------------------------------------------------------------------------
// The document.
//
// Every qualifier here is load-bearing. "Preliminary", "approximately",
// "estimated", "some", "may" and "remains unconfirmed" are the words a careless
// summary drops, turning an assessment into a finding. The figures are planted
// so that a generated output can be checked against them.
// ---------------------------------------------------------------------------

const p1 = new Page();
p1.line('Preliminary Incident Assessment: Coordinated Service Disruption', { size: 15 });
p1.line('Cyber Situational Awareness Unit', { size: 11, gap: 4 });
p1.line('Report reference CSA-2026-0418, issued 18 September 2026', { size: 10 });
p1.line('Distribution: official use. This assessment is preliminary.', { size: 10 });

p1.line('1. Summary', { size: 12, gap: 16 });
p1.para(
  'Between 02:14 and 09:47 IST on 12 September 2026, a coordinated distributed ' +
    'denial-of-service campaign caused sustained degradation of service availability ' +
    'across 37 systems operated by 4 public-sector entities. Preliminary analysis ' +
    'indicates that approximately 68% of the affected systems were restored within the ' +
    'first six hours of detection. The campaign is assessed as mitigated as of ' +
    '14 September 2026.',
  { gap: 6 },
);

p1.line('2. Background', { size: 12, gap: 16 });
p1.para(
  'The affected entities operate citizen-facing service portals hosted across two ' +
    'regional data centres. Baseline aggregate load across the monitored estate averages ' +
    '14,200 requests per second during business hours. Automated volumetric alerting was ' +
    'in place at 3 of the 4 entities at the time of the incident.',
  { gap: 6 },
);
p1.para(
  'An unrelated maintenance window was in progress at one entity between 01:00 and ' +
    '03:00 IST on 12 September 2026. Some telemetry from that window may be incomplete, ' +
    'and the assessment below treats it accordingly.',
  { gap: 10 },
);

const p2 = new Page();
p2.line('3. Observed impact', { size: 12 });
p2.row(
  [
    [0, 'Metric'],
    [250, 'Baseline'],
    [345, 'Incident peak'],
    [455, 'Change'],
  ],
  { size: 10, gap: 8 },
);
const rows = [
  ['Aggregate requests per second', '14,200', '186,400', '+1,212%'],
  ['Peak volumetric load (Gbps)', '2.1', '486', '+483.9'],
  ['Distinct source addresses', 'n/a', '12,400', 'n/a'],
  ['Systems degraded', '0', '37', '+37'],
  ['Mean time to restore (hours)', 'n/a', '6.2', 'n/a'],
];
for (const r of rows) {
  p2.row(
    [
      [0, r[0]],
      [250, r[1]],
      [345, r[2]],
      [455, r[3]],
    ],
    { size: 10 },
  );
}

p2.line('4. Attack characteristics', { size: 12, gap: 16 });
p2.para(
  'Traffic was predominantly UDP reflection with a smaller volume of application-layer ' +
    'requests against authentication endpoints. Peak volumetric load measured 486 Gbps. ' +
    'Traffic originated from approximately 12,400 distinct source addresses across ' +
    '31 countries. Attribution to any specific actor remains unconfirmed.',
  { gap: 6 },
);
p2.para(
  'Indicators of compromise have been circulated separately. No evidence of data ' +
    'exfiltration has been identified to date; this does not by itself establish that ' +
    'none occurred, as log retrieval at two entities is still in progress.',
  { gap: 10 },
);

p2.line('5. Estimated cost', { size: 12, gap: 16 });
p2.para(
  'The estimated financial impact is Rs 12.4 crore, comprising service unavailability, ' +
    'incident response effort and emergency mitigation capacity. This figure is an ' +
    'initial projection and has not been independently audited.',
  { gap: 6 },
);

const p3 = new Page();
p3.line('6. Limitations', { size: 12 });
p3.para(
  'This assessment is preliminary and is based on telemetry available as of ' +
    '17 September 2026. Some affected entities had not completed log retrieval at the ' +
    'time of writing, so the figures above may be revised.',
  { gap: 6 },
);
p3.para(
  'The restoration figure of approximately 68% is derived from entity self-reporting ' +
    'and has not been independently verified against system telemetry.',
  { gap: 10 },
);
p3.para(
  'Attribution remains unconfirmed. Source addresses observed in reflection traffic do ' +
    'not identify an originating actor, and no claim of responsibility has been assessed ' +
    'as credible.',
  { gap: 10 },
);
p3.para(
  'The count of 37 affected systems covers the monitored estate only. Systems outside ' +
    'central monitoring may have been affected without being recorded here.',
  { gap: 10 },
);

p3.line('7. Recommended actions', { size: 12, gap: 16 });
p3.para(
  'Extend automated volumetric alerting to the remaining entity. Complete log retrieval ' +
    'at the two outstanding entities before this assessment is finalised. Review upstream ' +
    'scrubbing capacity against the observed 486 Gbps peak.',
  { gap: 6 },
);

const pages = [p1, p2, p3];

// --- Assemble the PDF ------------------------------------------------------
// Object 1 catalog, 2 pages tree, 3 Helvetica, then one page and one content
// stream object per page.

const objects = [];
const add = (body) => {
  objects.push(body);
  return objects.length; // 1-based object number
};

const catalogNo = add(null); // reserved, filled once the pages tree number is known
const pagesNo = add(null);
const fontNo = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

const pageNos = [];
for (const page of pages) {
  const stream = page.stream();
  const contentNo = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  const pageNo = add(
    `<< /Type /Page /Parent ${pagesNo} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${fontNo} 0 R >> >> /Contents ${contentNo} 0 R >>`,
  );
  pageNos.push(pageNo);
}

objects[catalogNo - 1] = `<< /Type /Catalog /Pages ${pagesNo} 0 R >>`;
objects[pagesNo - 1] =
  `<< /Type /Pages /Count ${pageNos.length} /Kids [${pageNos.map((n) => `${n} 0 R`).join(' ')}] >>`;

let pdf = '%PDF-1.4\n';
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(pdf, 'latin1'));
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});

const xrefAt = Buffer.byteLength(pdf, 'latin1');
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNo} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

fs.writeFileSync(OUT, Buffer.from(pdf, 'latin1'));
console.log(`wrote ${OUT}  ${fs.statSync(OUT).size} bytes  ${pages.length} pages`);
