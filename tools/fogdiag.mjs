/*
 * Reads the fog material's compiled state and samples real pixels out of the
 * framebuffer, so "is the fog actually opaque over a fogged square" is answered
 * by numbers instead of by squinting at a PNG.
 *
 *   node tools/fogdiag.mjs
 *
 * Uses gl.readPixels rather than a screenshot on purpose (same method Крок 11
 * Section D used): it bypasses PNG encoding entirely and reads the exact values
 * the shader wrote.
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const url = `${BASE}/?debug=1`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => sessionStorage.setItem('dead-reckoning:intro-seen', '1'));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__phase === 'playing' && window.__fogMaterials, {
  timeout: 120000,
});
await page.waitForTimeout(14000);

const diag = await page.evaluate(() => {
  const out = {};
  const gl = window.__gl.getContext();
  const mat = window.__fogMaterials.material;
  out.materialUuid = mat.uuid;
  out.transparent = mat.transparent;
  out.depthWrite = mat.depthWrite;
  out.uniformKeys = Object.keys(mat.uniforms);

  // three keeps a WebGLProgram wrapper per material on the renderer's cache.
  const programs = window.__gl.info.programs ?? [];
  out.programCount = programs.length;
  out.badPrograms = [];
  for (const p of programs) {
    const prog = p.program;
    if (!prog) continue;
    const linked = gl.getProgramParameter(prog, gl.LINK_STATUS);
    gl.validateProgram(prog);
    const valid = gl.getProgramParameter(prog, gl.VALIDATE_STATUS);
    if (!linked || !valid) {
      out.badPrograms.push({
        name: p.name,
        linked,
        valid,
        programLog: gl.getProgramInfoLog(prog),
        vertexLog: p.vertexShader ? gl.getShaderInfoLog(p.vertexShader) : null,
        fragmentLog: p.fragmentShader ? gl.getShaderInfoLog(p.fragmentShader) : null,
      });
    }
  }

  // The fog material's own generated fragment source, for offline inspection.
  out.fragmentSource = mat.fragmentShader;

  // Live mask state: R = eased visibility per square.
  const data = window.__fogMaterials.mask.image.data;
  const r = [];
  for (let i = 0; i < 64; i++) r.push(+data[i * 4].toFixed(3));
  out.maskR = r;
  return out;
});

console.log('fog material uniforms:', diag.uniformKeys.join(', '));
console.log('transparent:', diag.transparent, ' depthWrite:', diag.depthWrite);
console.log('programs:', diag.programCount, ' bad:', diag.badPrograms.length);
for (const b of diag.badPrograms) {
  console.log('\n--- BAD PROGRAM ---');
  console.log('name:', b.name, 'linked:', b.linked, 'valid:', b.valid);
  console.log('programLog:', JSON.stringify(b.programLog));
  console.log('vertexLog:', JSON.stringify(b.vertexLog));
  console.log('fragmentLog:', JSON.stringify(b.fragmentLog));
}

fs.writeFileSync('tools/shots/fog.frag.glsl', diag.fragmentSource);
console.log('\nwrote tools/shots/fog.frag.glsl');

console.log('\nmask R channel, 8 rows (row 0 = rank 8, col 0 = file a):');
for (let row = 0; row < 8; row++) {
  console.log('  ' + diag.maskR.slice(row * 8, row * 8 + 8).map((v) => v.toFixed(2)).join(' '));
}

/*
 * Pixel test. Squares are sampled at their own centres, projected through the
 * live camera, so this measures the composited fog exactly where the mask says
 * a cell is fully fogged or fully clear.
 */
const pixels = await page.evaluate(() => {
  const gl = window.__gl.getContext();
  const cam = window.__camera;
  const canvas = window.__gl.domElement;

  /*
   * Force a render immediately before reading, in the SAME task.
   * The context has no preserveDrawingBuffer, so by the time an ordinary
   * evaluate() runs the back buffer has already been presented and cleared —
   * reading it gives all zeros, which is the same trap CLAUDE.md notes for
   * drawImage. Rendering synchronously here refills the buffer, and nothing
   * yields before readPixels, so the values below are the real composited frame.
   */
  window.__gl.render(window.__scene, cam);

  function squareToWorld(sq) {
    const file = 'abcdefgh'.indexOf(sq[0]);
    const rank = Number(sq[1]);
    return [file - 3.5, 0, rank - 1 - 3.5];
  }

  // 5x5 patch per square rather than a single pixel: one pixel can land on a
  // grid line or a piece edge, and the spread statistic needs more than one
  // sample per cell to mean anything.
  const P = 5;
  const buf = new Uint8Array(4 * P * P);
  function sample(sq) {
    const [wx, wy, wz] = squareToWorld(sq);
    const v = new (cam.position.constructor)(wx, wy, wz);
    v.project(cam);
    const px = Math.round(((v.x + 1) / 2) * canvas.width) - (P >> 1);
    // readPixels' origin is bottom-left, which already matches NDC's +Y up.
    const py = Math.round(((v.y + 1) / 2) * canvas.height) - (P >> 1);
    if (px < 0 || py < 0 || px + P > canvas.width || py + P > canvas.height) return null;
    gl.readPixels(px, py, P, P, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const lumas = [];
    for (let i = 0; i < P * P; i++) {
      lumas.push(0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2]);
    }
    const mean = lumas.reduce((a, b) => a + b, 0) / lumas.length;
    return {
      sq,
      luma: +mean.toFixed(1),
      localMin: +Math.min(...lumas).toFixed(1),
      localMax: +Math.max(...lumas).toFixed(1),
    };
  }

  const files = 'abcdefgh';
  const out = { fogged: [], clear: [] };
  for (const f of files) {
    for (const rank of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const sq = `${f}${rank}`;
      const idx = (8 - rank) * 8 + files.indexOf(f);
      const vis = window.__fogMaterials.mask.image.data[idx * 4];
      const isDark = (files.indexOf(f) + (rank - 1)) % 2 === 0;
      const hit = sample(sq);
      if (!hit) continue;
      const s = { ...hit, isDark };
      if (vis < 0.01) out.fogged.push(s);
      else if (vis > 0.99) out.clear.push(s);
    }
  }
  return out;
});

/*
 * THE AUTHORITATIVE OCCLUSION TEST.
 *
 * The light-vs-dark mean comparison above is a useful signal but it is not a
 * clean measurement, because the fog's own colour varies with board position:
 * any spatial correlation between the noise field and square parity shows up in
 * that statistic and looks exactly like a tile leak. (It is what caught the
 * lattice resonance documented in lib/fog.js — mean delta 19.1 luma with
 * accum.a verified at 0.94-0.96, i.e. a leak of at most ~1.9 luma. The statistic
 * was measuring the wrong thing.)
 *
 * This measures the right thing directly: render once normally, then repaint
 * EVERY tile a single flat colour and render again, without touching the fog or
 * the camera. Whatever the fog hides cannot change between the two frames. So
 * for each fogged square, |luma_before - luma_after| IS the leak, in luma, with
 * no dependence on where the noise happens to sit.
 *
 * A clear square is the control: it must change a lot, because there the tile is
 * exactly what you are looking at.
 */
const occlusion = await page.evaluate(() => {
  const gl = window.__gl.getContext();
  const cam = window.__camera;
  const canvas = window.__gl.domElement;
  const files = 'abcdefgh';

  function project(sq) {
    const file = files.indexOf(sq[0]);
    const rank = Number(sq[1]);
    const v = new (cam.position.constructor)(file - 3.5, 0, rank - 1 - 3.5);
    v.project(cam);
    return [
      Math.round(((v.x + 1) / 2) * canvas.width),
      Math.round(((v.y + 1) / 2) * canvas.height),
    ];
  }

  const P = 5;
  const buf = new Uint8Array(4 * P * P);
  function read(px, py) {
    if (px - 2 < 0 || py - 2 < 0 || px + 3 > canvas.width || py + 3 > canvas.height) return null;
    gl.readPixels(px - 2, py - 2, P, P, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let sum = 0;
    for (let i = 0; i < P * P; i++) {
      sum += 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
    }
    return sum / (P * P);
  }

  // Collect the tile meshes: small plane geometries lying flat on the board.
  const tiles = [];
  window.__scene.traverse((o) => {
    if (!o.isMesh || !o.material || !o.geometry) return;
    const n = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
    if (n === 2 && o.material.roughnessMap) tiles.push(o);
  });

  const squares = [];
  for (const f of files) {
    for (const rank of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const sq = `${f}${rank}`;
      const idx = (8 - rank) * 8 + files.indexOf(f);
      squares.push({ sq, vis: window.__fogMaterials.mask.image.data[idx * 4], xy: project(sq) });
    }
  }

  window.__gl.render(window.__scene, cam);
  for (const s of squares) s.before = read(s.xy[0], s.xy[1]);

  // Repaint every tile flat mid-grey. Nothing else in the scene is touched.
  const saved = tiles.map((t) => t.material.color.clone());
  for (const t of tiles) t.material.color.setStyle('#808080');
  window.__gl.render(window.__scene, cam);
  for (const s of squares) s.after = read(s.xy[0], s.xy[1]);
  tiles.forEach((t, i) => t.material.color.copy(saved[i]));
  window.__gl.render(window.__scene, cam);

  return { tileCount: tiles.length, squares };
});

console.log(`\n=== OCCLUSION TEST (repainted ${occlusion.tileCount} tiles flat #808080) ===`);
for (const group of ['fogged', 'clear']) {
  const list = occlusion.squares.filter(
    (s) => s.before != null && s.after != null && (group === 'fogged' ? s.vis < 0.01 : s.vis > 0.99),
  );
  const deltas = list.map((s) => Math.abs(s.before - s.after));
  const mean = deltas.reduce((a, b) => a + b, 0) / (deltas.length || 1);
  console.log(
    `  ${group.padEnd(7)} n=${String(list.length).padStart(2)}  ` +
      `mean |change| = ${mean.toFixed(2)} luma   max = ${Math.max(...deltas).toFixed(2)}`,
  );
  if (group === 'fogged') {
    const worst = list.slice().sort((a, b) => Math.abs(b.before - b.after) - Math.abs(a.before - a.after))[0];
    console.log(
      `           worst square: ${worst.sq}  ${worst.before.toFixed(1)} -> ${worst.after.toFixed(1)}`,
    );
    console.log('           this IS the tile leak. Budget: < 6 luma (FOG_MAX_ALPHA 0.94 => <=6%).');
  } else {
    console.log('           control: must be LARGE, the tile is what you are looking at.');
  }
}

function stats(list) {
  const dark = list.filter((s) => s.isDark).map((s) => s.luma);
  const light = list.filter((s) => !s.isDark).map((s) => s.luma);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const sd = (a) => {
    const m = mean(a);
    return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
  };
  return {
    n: list.length,
    darkMean: +mean(dark).toFixed(2),
    lightMean: +mean(light).toFixed(2),
    delta: +(mean(light) - mean(dark)).toFixed(2),
    spread: +sd(list.map((s) => s.luma)).toFixed(2),
    min: Math.min(...list.map((s) => s.luma)),
    max: Math.max(...list.map((s) => s.luma)),
  };
}

console.log('\n=== FOGGED squares (mask R < 0.01) ===');
console.log(JSON.stringify(stats(pixels.fogged)));
console.log('  light/dark MEAN delta is the tile-leak measure: it must stay small.');
console.log('  spread is the fog\'s own structure: it SHOULD be large now (Крок 12 C).');
console.log('\n=== CLEAR squares (mask R > 0.99) ===');
console.log(JSON.stringify(stats(pixels.clear)));
console.log('  delta here should be LARGE — a visible board must read as a chessboard.');

await browser.close();
