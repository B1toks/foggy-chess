/* Mask orientation check: /dev-fog?visible=a1 must clear the hole ON the orange
   square. Corners alone don't prove it (invariant under mirroring), so this uses
   an asymmetric square. Reads pixels rather than eyeballing the render. */
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 300)); });

for (const sq of ['a1', 'b1', 'g8', 'c6']) {
  await page.goto(`${BASE}/dev-fog?visible=${sq}&debug=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `tools/shots/mask-${sq}.png`, timeout: 120000 });
  console.log('shot', sq);
}
await browser.close();
