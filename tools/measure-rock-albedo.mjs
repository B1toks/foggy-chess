/*
 * Крок 16, Section C: measures each theme's rock model's own baked
 * baseColorTexture mean/max luma, decoded exactly as the browser decodes it
 * (via a live page + canvas readback, not an offline webp decode — this
 * project's other measurement tools (measure-rock.mjs, fogdiag.mjs) already
 * use a live headless page for the same "measure what actually renders"
 * reason).
 *
 *   node tools/measure-rock-albedo.mjs [theme]   # defaults to all three
 *
 * Needs the dev server running (BASE_URL, default http://localhost:3000).
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const themes = process.argv[2] ? [process.argv[2]] : ['mist', 'ocean', 'snow'];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });

for (const theme of themes) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const url = `${BASE}/?debug=1&theme=${theme}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => sessionStorage.setItem('dead-reckoning:intro-seen', '1'));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__phase !== undefined, { timeout: 120000 });
  await page.waitForTimeout(6000);

  const stats = await page.evaluate(() => {
    let rockMesh = null;
    window.__scene.traverse((o) => {
      if (o.isMesh && o.geometry?.attributes?.position?.count > 10000 && o.geometry.attributes.position.count < 100000) {
        rockMesh = o;
      }
    });
    if (!rockMesh?.material?.map?.image) return null;
    const img = rockMesh.material.map.image;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    let max = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      sum += lum;
      if (lum > max) max = lum;
      n++;
    }
    return { meanLuma: sum / n, maxLuma: max, width: img.width, height: img.height };
  });

  console.log(theme.padEnd(6), stats ? `mean=${stats.meanLuma.toFixed(1)}  max=${stats.maxLuma.toFixed(1)}  (${stats.width}x${stats.height})` : 'NOT FOUND');
  await page.close();
}

await browser.close();
