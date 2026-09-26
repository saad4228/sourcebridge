import { chromium } from 'playwright-core';
const SP=process.argv[2];
const browser=await chromium.launch({channel:'msedge'});
const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:2});
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,100)));

await page.goto('http://localhost:3000',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1200);
await page.getByRole('button',{name:/sample incident report/i}).click();
const gen=page.getByRole('button',{name:/^Generate/}).first();
for(let i=0;i<90&&!(await gen.isEnabled().catch(()=>false));i++) await page.waitForTimeout(2000);

// Presentation + Infographic only.
for (const n of ['Executive summary','LinkedIn post']) {
  const cb=page.locator('label',{hasText:n}).locator('input[type=checkbox]').first();
  if (await cb.isChecked().catch(()=>false)) await cb.click();
}
for (const n of ['Presentation','Infographic']) {
  const cb=page.locator('label',{hasText:n}).locator('input[type=checkbox]').first();
  if (!(await cb.isChecked().catch(()=>false))) await cb.click();
}
await gen.click();
console.log('generating presentation + infographic…');
for(let i=0;i<150;i++){
  const t=(await page.locator('text=/formats? complete/i').first().innerText().catch(()=>'')).trim();
  const m=t.match(/^(\d+) of (\d+)/); if(m&&m[1]===m[2]) break;
  await page.waitForTimeout(2500);
}
await page.waitForTimeout(2000);

const probe = async (tabName, addLabels) => {
  await page.getByRole('tab',{name:new RegExp(tabName,'i')}).first().click().catch(()=>{});
  await page.waitForTimeout(800);
  await page.getByRole('button',{name:/^Edit$/}).first().click();
  await page.waitForTimeout(1200);
  const found = {};
  for (const l of addLabels) {
    found[l] = await page.getByRole('button',{name:new RegExp('\\+ Add '+l,'i')}).count();
  }
  const removes = await page.getByRole('button',{name:/^Remove /i}).count();
  console.log(`${tabName.padEnd(14)} add-buttons=${JSON.stringify(found)}  remove-buttons=${removes}`);
  await page.screenshot({path:`${SP}/edit/${tabName.replace(/\W/g,'')}.png`});
  await page.getByRole('button',{name:/^Done$|^Save$|^Edit$/}).first().click().catch(()=>{});
  await page.waitForTimeout(500);
};

await probe('Presentation', ['bullet']);
await probe('Infographic', ['key message','statistic']);
console.log('errors:',errs.length?errs.slice(0,3):'none');
await browser.close();
