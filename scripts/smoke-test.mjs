/** End-to-end workflow check against the running dev server. */
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3000';
const OUT = process.argv[2];
const PDF = process.argv[3];

const post = async (route, body, isForm = false) => {
  const res = await fetch(`${BASE}${route}`, {
    method: 'POST',
    ...(isForm ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

// --- 1. Extract ------------------------------------------------------------
console.log('=== 1. EXTRACT ===');
const form = new FormData();
form.append('file', new File([fs.readFileSync(PDF)], 'rainwater-pilot-report.pdf', { type: 'application/pdf' }));
const ex = await post('/api/extract', form, true);
if (ex.status !== 200) { console.error('extract failed', ex.json); process.exit(1); }
const source = ex.json.source;
console.log(`pages=${source.pageCount} segments=${source.segments.length} chars=${source.charCount}`);

// --- 2. Analyze ------------------------------------------------------------
console.log('\n=== 2. ANALYZE (fact ledger) ===');
const t0 = Date.now();
const an = await post('/api/analyze', { source });
if (an.status !== 200) { console.error('analyze failed', an.json); process.exit(1); }
const ledger = an.json.ledger;
console.log(`latency=${Date.now() - t0}ms  facts=${ledger.facts.length}  caveats=${ledger.caveats.length}`);
console.log(`topic: ${ledger.topic}`);
const validIds = new Set(source.segments.map((s) => s.id));
let cited = 0, bad = 0;
for (const f of ledger.facts) for (const id of f.evidence) { cited++; if (!validIds.has(id)) bad++; }
console.log(`evidence refs: ${cited} total, ${bad} invalid`);
console.log('numbers captured:', ledger.facts.flatMap((f) => f.numbers.map((n) => n.value + (n.unit || ''))).join(', '));
console.log('caveats:');
for (const c of ledger.caveats) console.log('  -', c);
if (ledger.warnings.length) console.log('warnings:', ledger.warnings);

// --- 3. Generate all seven -------------------------------------------------
const FORMATS = ['exec_summary', 'linkedin', 'x_thread', 'advisory', 'presentation', 'infographic', 'video_package'];
const brief = {
  mode: 'grounded', audience: 'General public', objective: 'Inform', tone: 'Accessible',
  language: 'English', detail: 'Standard', formats: FORMATS,
};

console.log('\n=== 3. GENERATE (concurrency 2) ===');
const results = {};
const queue = [...FORMATS];
const worker = async () => {
  for (;;) {
    const format = queue.shift();
    if (!format) return;
    const start = Date.now();
    const r = await post('/api/generate', { format, brief, source, ledger });
    const ms = Date.now() - start;
    if (r.status === 200) {
      results[format] = r.json;
      const sev = r.json.findings.map((f) => f.severity[0]).join('');
      console.log(`  OK   ${format.padEnd(15)} ${String(ms).padStart(6)}ms findings=${r.json.findings.length} [${sev}]`);
    } else {
      results[format] = { error: r.json?.error };
      console.log(`  FAIL ${format.padEnd(15)} ${String(ms).padStart(6)}ms ${r.json?.error}`);
    }
  }
};
await Promise.all([worker(), worker()]);

// --- 4. Fact fidelity across formats --------------------------------------
console.log('\n=== 4. FACT FIDELITY ACROSS FORMATS ===');
const KEY_FACTS = ['18', '250', '412', '338'];
for (const [format, res] of Object.entries(results)) {
  if (res.error) continue;
  const blob = JSON.stringify(res.content);
  const hits = KEY_FACTS.filter((k) => blob.includes(k));
  const caveat = /pilot population|do not generalise|does not generalise|not generalise|control group|pilot only|above average/i.test(blob);
  console.log(`  ${format.padEnd(15)} figures:[${hits.join(',')}] caveat-carried:${caveat ? 'YES' : 'no'}`);
}

// --- 5. Evidence validity --------------------------------------------------
console.log('\n=== 5. EVIDENCE VALIDITY ===');
const collect = (node, acc = []) => {
  if (Array.isArray(node)) { node.forEach((n) => collect(n, acc)); return acc; }
  if (!node || typeof node !== 'object') return acc;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'evidence' && Array.isArray(v)) acc.push(...v.filter((x) => typeof x === 'string'));
    else collect(v, acc);
  }
  return acc;
};
for (const [format, res] of Object.entries(results)) {
  if (res.error) continue;
  const refs = collect(res.content);
  const invalid = refs.filter((id) => !validIds.has(id));
  console.log(`  ${format.padEnd(15)} refs=${String(refs.length).padStart(3)} invalid=${invalid.length}${invalid.length ? ' ' + invalid.slice(0, 3).join(',') : ''}`);
}

// --- 6. Findings -----------------------------------------------------------
console.log('\n=== 6. VALIDATION FINDINGS ===');
for (const [format, res] of Object.entries(results)) {
  if (res.error) continue;
  for (const f of res.findings) console.log(`  [${f.severity}] ${format}: ${f.message.slice(0, 150)}`);
}

fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify({ source, ledger, results }, null, 2));
console.log('\nSaved full output to e2e-results.json');
