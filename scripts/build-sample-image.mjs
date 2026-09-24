/**
 * Renders the synthetic news-clipping sample image used to demonstrate image
 * input. Content is fictional and generated for this project.
 */
import { chromium } from 'playwright-core';
import path from 'node:path';

const OUT = process.argv[2] ?? path.join(process.cwd(), 'samples', 'news-clipping.png');

const html = `
<div style="width:760px;padding:40px;font-family:Georgia,serif;background:#fffdf8;color:#14110d">
  <div style="border-bottom:3px solid #14110d;padding-bottom:8px;margin-bottom:18px">
    <div style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#6b6257">
      The Meridian Herald &nbsp;·&nbsp; Science &nbsp;·&nbsp; 14 March 2026
    </div>
  </div>

  <h1 style="font-size:31px;line-height:1.18;margin:0 0 10px">
    India launches satellite mission to track climate change
  </h1>
  <p style="font-size:14px;color:#6b6257;margin:0 0 20px;font-style:italic">
    By staff reporters, New Delhi
  </p>

  <p style="font-size:15px;line-height:1.65;margin:0 0 13px">
    India launched the <strong>Bhoomi-1</strong> earth observation satellite on 12 March 2026 from
    the Satish Dhawan Space Centre. The mission will monitor surface temperature, glacial retreat
    and coastal erosion across the subcontinent.
  </p>
  <p style="font-size:15px;line-height:1.65;margin:0 0 13px">
    The satellite carries four instruments and will operate in a sun-synchronous orbit at an
    altitude of <strong>705 km</strong>. Mission cost is reported at <strong>Rs 1,240 crore</strong>,
    with a planned operational life of <strong>7 years</strong>.
  </p>

  <table style="width:100%;border-collapse:collapse;font-size:13.5px;margin:18px 0">
    <tr style="background:#14110d;color:#fffdf8">
      <th style="text-align:left;padding:7px 10px">Instrument</th>
      <th style="text-align:left;padding:7px 10px">Measures</th>
      <th style="text-align:left;padding:7px 10px">Resolution</th>
    </tr>
    <tr><td style="padding:6px 10px;border-bottom:1px solid #ddd6c9">Thermal imager</td><td style="padding:6px 10px;border-bottom:1px solid #ddd6c9">Surface temperature</td><td style="padding:6px 10px;border-bottom:1px solid #ddd6c9">60 m</td></tr>
    <tr><td style="padding:6px 10px;border-bottom:1px solid #ddd6c9">Optical sensor</td><td style="padding:6px 10px;border-bottom:1px solid #ddd6c9">Glacial extent</td><td style="padding:6px 10px;border-bottom:1px solid #ddd6c9">5 m</td></tr>
    <tr><td style="padding:6px 10px;border-bottom:1px solid #ddd6c9">Radar altimeter</td><td style="padding:6px 10px;border-bottom:1px solid #ddd6c9">Sea level</td><td style="padding:6px 10px;border-bottom:1px solid #ddd6c9">2 cm</td></tr>
    <tr><td style="padding:6px 10px">Spectrometer</td><td style="padding:6px 10px">Aerosols</td><td style="padding:6px 10px">1 km</td></tr>
  </table>

  <p style="font-size:15px;line-height:1.65;margin:0 0 13px">
    Data will be released publicly within <strong>90 days</strong> of collection. Officials said
    early products would focus on the Himalayan glacier basins, where retreat rates have averaged
    <strong>14 metres per year</strong> over the past decade.
  </p>
  <p style="font-size:15px;line-height:1.65;margin:0">
    The agency cautioned that the first six months constitute a calibration phase and that
    measurements from this period should not be treated as final. A second satellite in the series
    is under review but has not been funded.
  </p>
</div>`;

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 840, height: 1200 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.locator('div').first().screenshot({ path: OUT });
await browser.close();
console.log('wrote', OUT);
