/** Captures the workspace in both themes by driving the real toggle. */
import { chromium } from 'playwright-core';
import path from 'node:path';

const OUT = process.argv[2];
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

page.on('pageerror', (e) => console.log('  [page error]', String(e).slice(0, 160)));

const themeOf = () =>
  page.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-theme'),
    bg: getComputedStyle(document.body).backgroundColor,
    ink: getComputedStyle(document.body).color,
  }));

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
console.log('initial  ', JSON.stringify(await themeOf()));
await page.screenshot({ path: path.join(OUT, 'theme-light-landing.png'), fullPage: true });

const toggle = page.getByRole('button', { name: /Switch to (dark|light) theme/ });
await toggle.click();
await page.waitForTimeout(500);
console.log('toggled  ', JSON.stringify(await themeOf()));
await page.screenshot({ path: path.join(OUT, 'theme-dark-landing.png'), fullPage: true });

// The choice must survive a reload without a flash of the wrong palette.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);
const afterReload = await themeOf();
console.log('reloaded ', JSON.stringify(afterReload));
console.log('persisted:', afterReload.attr === 'dark');

// Load the sample so the workspace itself can be inspected in dark.
await page.getByRole('button', { name: 'Try the sample report' }).click();
await page.waitForSelector('text=rainwater-pilot-report.pdf', { timeout: 60000 });
await page.waitForFunction(
  () => !document.body.innerText.includes('Extracting facts, figures and caveats'),
  null,
  { timeout: 240000 },
);
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, 'theme-dark-workspace.png'), fullPage: true });
console.log('captured dark workspace');

await browser.close();
