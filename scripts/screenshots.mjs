/** Drives the real UI in Edge and captures screenshots at each stage. */
import { chromium } from 'playwright-core';
import path from 'node:path';

const OUT = process.argv[2];
const STAGE = process.argv[3] ?? 'all';
const WIDTH = Number(process.argv[4] ?? 1440);

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 2 });

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log('captured', name);
};

page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [browser error]', m.text().slice(0, 160));
});
page.on('pageerror', (e) => console.log('  [page error]', String(e).slice(0, 160)));

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await shot(`01-empty-${WIDTH}`);

if (STAGE === 'empty') {
  await browser.close();
  process.exit(0);
}

// Load the sample document through the real UI control.
await page.getByRole('button', { name: 'Try the sample report' }).click();
console.log('clicked Load sample; waiting for extraction…');
await page.waitForSelector('text=rainwater-pilot-report.pdf', { timeout: 60000 });
await page.waitForTimeout(800);
await shot(`02-source-loaded-${WIDTH}`);

// The fact ledger runs automatically after extraction.
console.log('waiting for fact ledger…');
await page.waitForSelector('h2:has-text("Shared fact ledger")', { timeout: 180000 });
await page.waitForFunction(
  () => !document.body.innerText.includes('Extracting facts, figures and caveats'),
  null,
  { timeout: 240000 },
);
await page.waitForTimeout(800);
await shot(`03-fact-ledger-${WIDTH}`);

if (STAGE === 'ledger') {
  await browser.close();
  process.exit(0);
}

// Select every format so all seven previews are captured.
const boxes = await page.locator('input[type="checkbox"]').all();
for (const box of boxes) {
  if (!(await box.isChecked())) await box.check();
}
await page.waitForTimeout(400);

// Generate.
console.log('generating…');
await page.getByRole('button', { name: 'Generate', exact: true }).click();
await page.waitForTimeout(2500);
await shot(`04-generating-${WIDTH}`);

await page.waitForFunction(
  () => !document.body.innerText.includes('formats complete'),
  null,
  { timeout: 600000 },
);
await page.waitForTimeout(1200);
await shot(`05-outputs-${WIDTH}`);

// Walk each generated tab.
const tabs = await page.getByRole('tab').all();
for (const tab of tabs) {
  const label = (await tab.textContent())?.trim().replace(/[^a-zA-Z ]/g, '').trim() ?? 'tab';
  await tab.click();
  await page.waitForTimeout(700);
  await shot(`06-${label.replace(/\s+/g, '-').toLowerCase()}-${WIDTH}`);
}

// Evidence drawer.
const chip = page.locator('button[title="Show the supporting source passage"]').first();
if (await chip.count()) {
  await chip.click();
  await page.waitForTimeout(700);
  await shot(`07-evidence-${WIDTH}`);
}

await browser.close();
console.log('done');
