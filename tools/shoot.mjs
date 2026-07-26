/*
 * Screenshot harness for this project's specific QA hooks. See CLAUDE.md's
 * "Headless browser" section for why this is shaped the way it is — the
 * software rasteriser here renders at ~1 fps, so every wait is in seconds and
 * `locator.click()` is unusable.
 *
 *   node tools/shoot.mjs <outPrefix> [shot=...] [url-params...]
 *
 * Examples:
 *   node tools/shoot.mjs before
 *   node tools/shoot.mjs intro --intro
 *   node tools/shoot.mjs shallow shot=shallow
 *   node tools/shoot.mjs fogonly "fen=4k3/8/8/8/8/8/8/4K3 w - - 0 1"
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const OUT = process.env.SHOT_DIR ?? 'tools/shots';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const prefix = process.argv[2] ?? 'shot';
const args = process.argv.slice(3);
const keepIntro = args.includes('--intro');
const params = args.filter((a) => !a.startsWith('--'));

// Camera placements, in the spherical terms OrbitControls actually clamps:
// [x, y, z] world position, target is always the origin.
const SHOTS = {
  default: null, // whatever CameraRig rests at
  shallow: [0, 4.2, -10.8], // near MAX_POLAR_ANGLE, grazing across the board
  overhead: [0.01, 11.5, -2.4], // near MIN_POLAR_ANGLE, steep
  far: [7.5, 8.5, -8.5], // corner, to see the rock's own silhouette
  behind: [3.0, 6.0, 9.0], // from Black's side, over the rock's far rim
  corner: [8.0, 3.2, -8.0], // low + diagonal: board corners against the rim
};

fs.mkdirSync(OUT, { recursive: true });

const shotName = params.find((p) => p.startsWith('shot='))?.slice(5) ?? 'default';
const urlParams = params.filter((p) => !p.startsWith('shot='));

const query = ['debug=1', ...urlParams].join('&');
const url = `${BASE}/?${query}`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text());
});

console.log(`-> ${url}   shot=${shotName}  intro=${keepIntro}`);

if (!keepIntro) {
  // A plain in-page write does not retroactively change the phase this render
  // already committed to, so the session flag has to be set and THEN reloaded.
  // See CLAUDE.md's QA hooks section.
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => sessionStorage.setItem('dead-reckoning:intro-seen', '1'));
}
await page.goto(url, { waitUntil: 'domcontentloaded' });

// Frame-gated: the scene needs seconds, not milliseconds, to get anywhere.
await page.waitForFunction(() => window.__phase !== undefined, { timeout: 120000 });
await page.waitForTimeout(keepIntro ? 9000 : 14000);

const phase = await page.evaluate(() => window.__phase);
console.log('   phase:', phase);

const place = SHOTS[shotName];
if (place && !keepIntro) {
  const ok = await page.evaluate(([x, y, z]) => {
    if (!window.__controls) return false;
    window.__camera.position.set(x, y, z);
    window.__controls.update();
    return {
      d: +window.__controls.getDistance().toFixed(3),
      polar: +window.__controls.getPolarAngle().toFixed(3),
      azim: +window.__controls.getAzimuthalAngle().toFixed(3),
    };
  }, place);
  console.log('   camera:', JSON.stringify(ok));
  await page.waitForTimeout(7000);
}

const file = `${OUT}/${prefix}.png`;
await page.screenshot({ path: file, timeout: 180000 });
console.log('   wrote', file);

const info = await page.evaluate(() => {
  const out = { meshes: 0, tris: 0, fogMeshes: 0, programs: null };
  if (window.__scene) {
    window.__scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      out.meshes++;
      const g = o.geometry;
      const n = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
      out.tris += n / 3;
    });
  }
  if (window.__gl) {
    out.programs = window.__gl.info.programs?.length ?? null;
    out.render = { ...window.__gl.info.render };
  }
  return out;
});
console.log('   scene:', JSON.stringify(info));

await browser.close();
