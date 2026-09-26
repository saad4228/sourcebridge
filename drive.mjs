import { chromium } from 'playwright-core';
const SP = process.argv[2];
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0,110)));
page.on('console', m => { if (m.type()==='error') errs.push('console: '+m.text().slice(0,110)); });

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
console.log('1. loading sample…');
await page.getByRole('button', { name: /sample incident report/i }).click();

const gen = page.getByRole('button', { name: /^Generate/ }).first();
for (let i = 0; i < 90 && !(await gen.isEnabled().catch(()=>false)); i++) await page.waitForTimeout(2000);
console.log('2. ledger built, Generate enabled');

const t0 = Date.now();
await gen.click();
for (let i = 0; i < 150; i++) {
  const txt = (await page.locator('text=/formats? complete/i').first().innerText().catch(()=>'')).trim();
  const m = txt.match(/^(\d+) of (\d+)/);
  if (m && m[1] === m[2]) break;
  await page.waitForTimeout(2500);
}
console.log(`3. generation finished in ${Math.round((Date.now()-t0)/1000)}s`);

await page.waitForTimeout(2500);
await page.locator('text=/^Outputs$/').first().scrollIntoViewIfNeeded().catch(()=>{});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SP}/run2/outputs.png` });

const tabs = (await page.locator('[role=tab]').allInnerTexts().catch(()=>[])).map(t=>t.replace(/\s+/g,' ').trim());
console.log('   tabs:', tabs.join(' | ') || '(n/a)');
const dl = await page.getByRole('button', { name: /Download all/i }).count();
console.log('   "Download all" present:', dl > 0);
console.log('\nerrors:', errs.length ? errs.slice(0,3) : 'none');
await browser.close();
