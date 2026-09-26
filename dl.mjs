import { chromium } from 'playwright-core';
const SP=process.argv[2];
const browser=await chromium.launch({channel:'msedge'});
const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const page=await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,100)));

await page.goto('http://localhost:3000',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1200);
console.log('1. loading sample…');
await page.getByRole('button',{name:/sample incident report/i}).click();

// Select only the video package to keep the run short.
const gen=page.getByRole('button',{name:/^Generate/}).first();
for(let i=0;i<90&&!(await gen.isEnabled().catch(()=>false));i++) await page.waitForTimeout(2000);
console.log('2. ledger ready — selecting Video production package only');
for (const name of ['Executive summary','LinkedIn post','Presentation']) {
  const cb=page.locator('label',{hasText:name}).locator('input[type=checkbox]').first();
  if (await cb.isChecked().catch(()=>false)) await cb.click();
}
const vid=page.locator('label',{hasText:'Video production package'}).locator('input[type=checkbox]').first();
if(!(await vid.isChecked().catch(()=>false))) await vid.click();

await gen.click();
console.log('3. generating video package…');
for(let i=0;i<120;i++){
  const t=(await page.locator('text=/formats? complete/i').first().innerText().catch(()=>'')).trim();
  const m=t.match(/^(\d+) of (\d+)/); if(m&&m[1]===m[2]) break;
  await page.waitForTimeout(2500);
}
await page.waitForTimeout(2000);

// Find the MP4 download control.
const mp4=page.getByRole('button',{name:/mp4/i}).first();
await mp4.waitFor({timeout:30000});
console.log('4. clicking the MP4 control — this speaks every scene then encodes');
const [download]=await Promise.all([
  page.waitForEvent('download',{timeout:420000}),
  mp4.click(),
]);
const dest=`${SP}/dl/${download.suggestedFilename()}`;
await download.saveAs(dest);
console.log(`5. downloaded: ${download.suggestedFilename()}`);
console.log('errors:',errs.length?errs.slice(0,3):'none');
await browser.close();
