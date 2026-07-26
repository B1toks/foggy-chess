import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const FEN = '8/8/4k3/4r3/4K3/8/8/8 w - - 0 1';
const url = `${BASE}/?debug=1&fen=${encodeURIComponent(FEN)}`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => sessionStorage.setItem('dead-reckoning:intro-seen', '1'));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__phase === 'playing', { timeout: 120000 });
await page.waitForTimeout(2000);

await page.evaluate(() => {
  window.__camera.position.set(0.01, 11.5, -2.4);
  window.__controls.update();
});
await page.waitForTimeout(1000);

async function clickSquare(square) {
  return page.evaluate((sq) => {
    const FILES = 'abcdefgh';
    const file = FILES.indexOf(sq[0]);
    const rank = Number(sq[1]) - 1;
    const [x, y, z] = [file - 3.5, 0, rank - 3.5];
    const e = window.__camera.matrixWorldInverse.elements;
    const vx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const vy = e[1] * x + e[5] * y + e[9] * z + e[13];
    const vz = e[2] * x + e[6] * y + e[10] * z + e[14];
    const vw = e[3] * x + e[7] * y + e[11] * z + e[15];
    const p = window.__camera.projectionMatrix.elements;
    const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12] * vw;
    const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13] * vw;
    const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15] * vw;
    const ndc = { x: cx / cw, y: cy / cw };
    const canvas = window.__gl.domElement;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.left + ((ndc.x + 1) / 2) * rect.width;
    const sy = rect.top + ((1 - ndc.y) / 2) * rect.height;
    const target = document.elementFromPoint(sx, sy);
    const opts = {
      bubbles: true, cancelable: true, clientX: sx, clientY: sy,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
    };
    target.dispatchEvent(new PointerEvent('pointermove', opts));
    target.dispatchEvent(new PointerEvent('pointerdown', opts));
    target.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0 }));
    return { sx, sy };
  }, square);
}

fs.mkdirSync('tools/shots', { recursive: true });

console.log('click e4 (select king):', await clickSquare('e4'));
await page.waitForTimeout(1000);
await page.screenshot({ path: 'tools/shots/kc-1-selected.png', timeout: 60000 });

console.log('click e5 (capture defended rook):', await clickSquare('e5'));
await page.waitForTimeout(1500);
await page.screenshot({ path: 'tools/shots/kc-2-after-capture.png', timeout: 60000 });

const boardState = await page.evaluate(() => ({
  e4: window.__scene ? null : null,
}));
console.log('waiting for AI (black) reply...');
await page.waitForTimeout(3000);
await page.screenshot({ path: 'tools/shots/kc-3-after-ai.png', timeout: 60000 });

await browser.close();
