// QA: open the promotion modal via two programmatic canvas clicks (a7 -> a8),
// per CLAUDE.md's documented method (project world coords with the known
// camera, dispatch synthetic events rather than page.mouse.click — a real
// mouse click can freeze the r3f render loop dead in this headless
// environment for no visible error).
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const FEN = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
const url = `${BASE}/?debug=1&fen=${encodeURIComponent(FEN)}`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshare'.replace('e-swiftshare', 'e-swiftshader')] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => sessionStorage.setItem('dead-reckoning:intro-seen', '1'));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__phase === 'playing', { timeout: 120000 });
await page.waitForTimeout(3000);

// Steep near-overhead angle: every square reads at roughly the same size, so
// small projection-math error matters much less than at the default shallow
// resting angle (where a7/a8, being far from a camera sitting behind rank 1,
// are only a few screen pixels across).
await page.evaluate(() => {
  window.__camera.position.set(0.01, 11.5, -2.4);
  window.__controls.update();
});
await page.waitForTimeout(1000);

async function clickSquare(square) {
  const result = await page.evaluate((sq) => {
    const FILES = 'abcdefgh';
    function squareToWorld(s) {
      const file = FILES.indexOf(s[0]);
      const rank = Number(s[1]) - 1;
      return [file - 3.5, 0, rank - 3.5];
    }
    function project(camera, x, y, z) {
      const e = camera.matrixWorldInverse.elements;
      const vx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const vy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const vz = e[2] * x + e[6] * y + e[10] * z + e[14];
      const vw = e[3] * x + e[7] * y + e[11] * z + e[15];
      const p = camera.projectionMatrix.elements;
      const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12] * vw;
      const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13] * vw;
      const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15] * vw;
      return { x: cx / cw, y: cy / cw };
    }
    const [x, y, z] = squareToWorld(sq);
    const camera = window.__camera;
    const ndc = project(camera, x, y, z);
    const canvas = window.__gl.domElement;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.left + ((ndc.x + 1) / 2) * rect.width;
    const sy = rect.top + ((1 - ndc.y) / 2) * rect.height;
    const target = document.elementFromPoint(sx, sy);
    if (!target) return { ok: false, sx, sy, reason: 'no element at point' };
    // r3f's click handler only fires on an object present in `internal.initialHits`
    // (dist/events: "click events... must use the initial target"), which is only
    // populated on a real 'pointerdown'. pointermove alone (or pointermove+click)
    // silently does nothing — needs the full down/up/click sequence.
    const opts = {
      bubbles: true,
      cancelable: true,
      clientX: sx,
      clientY: sy,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
    };
    target.dispatchEvent(new PointerEvent('pointermove', opts));
    target.dispatchEvent(new PointerEvent('pointerdown', opts));
    target.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
    target.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0 }),
    );
    return { ok: true, sx, sy, tag: target.tagName, cls: target.className, ndc };
  }, square);
  return result;
}

console.log('click a7:', await clickSquare('a7'));
await page.waitForTimeout(1500);
await page.screenshot({ path: 'tools/shots/promotion-after-a7.png', timeout: 60000 });
console.log('click a8:', await clickSquare('a8'));
await page.waitForTimeout(1500);

const hasModal = await page.evaluate(() => !!document.querySelector('[aria-label="Choose promotion"]'));
console.log('modal open:', hasModal);

fs.mkdirSync('tools/shots', { recursive: true });
await page.screenshot({ path: 'tools/shots/promotion-modal.png', timeout: 60000 });
console.log('wrote tools/shots/promotion-modal.png');

await browser.close();
