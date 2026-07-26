// One-off measurement: triangle/draw-call/material counts at the opening
// position, following the same method CLAUDE.md's "Asset budget" section
// used (window.__scene traversal + gl.info), so the Крок 14 perf pass is
// evidence-based rather than a guess.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const url = `${BASE}/?debug=1`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => sessionStorage.setItem('dead-reckoning:intro-seen', '1'));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__phase === 'playing', { timeout: 120000 });
await page.waitForTimeout(2000);

const report = await page.evaluate(() => {
  const scene = window.__scene;
  const gl = window.__gl;
  let triangles = 0;
  let meshCount = 0;
  const materials = new Set();
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    meshCount++;
    const n = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
    triangles += n;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if (m) materials.add(m.uuid);
  });
  // Force a render so gl.info reflects the frame just drawn (render loop is
  // continuous via useFrame, but read it right after our own explicit render
  // for a stable, reproducible number).
  gl.render(scene, window.__camera);
  return {
    triangles,
    meshCount,
    uniqueMaterials: materials.size,
    drawCalls: gl.info.render.calls,
    glTriangles: gl.info.render.triangles,
    programs: gl.info.programs?.length ?? null,
  };
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
