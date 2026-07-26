/*
 * Reads real world-space geometry out of the live scene via the ?debug=1 hooks,
 * so "does the board actually fit the rock's basin" is answered by measurement
 * rather than by eyeballing a screenshot.
 *
 *   node tools/probe.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const url = `${BASE}/?debug=1`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => sessionStorage.setItem('dead-reckoning:intro-seen', '1'));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__phase === 'playing', { timeout: 120000 });
await page.waitForTimeout
  ? await page.waitForTimeout(14000)
  : null;

const report = await page.evaluate(async () => {
  const THREE = window.__three ?? null;
  const out = { meshes: [] };
  const scene = window.__scene;

  // Minimal world-space AABB, computed by hand so this does not depend on a
  // THREE reference being exposed on window.
  function worldBox(obj) {
    obj.updateWorldMatrix(true, false);
    const g = obj.geometry;
    const pos = g.attributes.position;
    const m = obj.matrixWorld.elements;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const step = Math.max(1, Math.floor(pos.count / 40000));
    for (let i = 0; i < pos.count; i += step) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
      if (wx < lo[0]) lo[0] = wx;
      if (wy < lo[1]) lo[1] = wy;
      if (wz < lo[2]) lo[2] = wz;
      if (wx > hi[0]) hi[0] = wx;
      if (wy > hi[1]) hi[1] = wy;
      if (wz > hi[2]) hi[2] = wz;
    }
    return { lo, hi };
  }

  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const n = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
    if (n < 400) return; // skip tiles/fog/highlight quads
    const b = worldBox(o);
    out.meshes.push({
      name: o.name || '(unnamed)',
      tris: n,
      lo: b.lo.map((v) => +v.toFixed(3)),
      hi: b.hi.map((v) => +v.toFixed(3)),
      scale: [o.scale.x, o.scale.y, o.scale.z].map((v) => +v.toFixed(4)),
      matWorldScale: +Math.hypot(o.matrixWorld.elements[0], o.matrixWorld.elements[1], o.matrixWorld.elements[2]).toFixed(4),
    });
  });
  return out;
});

console.log('--- big meshes in world space ---');
for (const m of report.meshes) {
  const rx = Math.max(Math.abs(m.lo[0]), Math.abs(m.hi[0]));
  const rz = Math.max(Math.abs(m.lo[2]), Math.abs(m.hi[2]));
  console.log(
    `${m.name.padEnd(30)} tris=${String(m.tris).padStart(7)} ` +
      `X ${String(m.lo[0]).padStart(8)}..${String(m.hi[0]).padStart(7)} ` +
      `Y ${String(m.lo[1]).padStart(8)}..${String(m.hi[1]).padStart(7)} ` +
      `Z ${String(m.lo[2]).padStart(8)}..${String(m.hi[2]).padStart(7)}  ` +
      `worldScale=${m.matWorldScale}  maxR(XZ)=${Math.max(rx, rz).toFixed(2)}`,
  );
}
console.log(`\nboard slab is 8.6 x 8.6 -> half-width 4.30, half-DIAGONAL ${(4.3 * Math.SQRT2).toFixed(3)}`);

await browser.close();
