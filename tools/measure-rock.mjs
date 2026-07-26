/*
 * Measures the rock's basin floor, which is what RockIsland.jsx's ROCK_SCALE_X
 * / ROCK_SCALE_Z / ROCK_Y_OFFSET are derived from. Re-run it if the rock export
 * is ever regenerated:
 *
 *   node tools/measure-rock.mjs [file.glb]
 *
 * WHY NOT A Box3, AND WHY NOT VERTEX BINNING
 *
 * A Box3 is useless here: the model's usable surface is not its bounding-box
 * max, because a raised rim sits above a flat inner basin and the board has to
 * land inside that basin, not on the rim.
 *
 * Binning *vertices* into a heightfield (the obvious first attempt, and what an
 * earlier session's throwaway raycast grid effectively did) is also wrong in a
 * way that produces confident nonsense: a grid cell that happens to contain no
 * vertex from the top surface reports whatever lower vertex it did catch, so
 * narrow cracks in the floor show up as ~1-unit-deep holes and the "spread"
 * over any footprint is dominated by that artifact. This rasterises the actual
 * TRIANGLES into the heightfield instead (max Y over every triangle covering a
 * cell centre), which is the true top surface.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const FILE = process.argv[2] ?? 'public/models/granite-pine-aerie-optimized.glb';
const N = 128; // heightfield resolution

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});

const doc = await io.read(FILE);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const pos = prim.getAttribute('POSITION');
const idx = prim.getIndices();
const triCount = idx ? idx.getCount() / 3 : pos.getCount() / 3;

let minX = Infinity;
let maxX = -Infinity;
let minZ = Infinity;
let maxZ = -Infinity;
let minY = Infinity;
let maxY = -Infinity;
const tmp = [0, 0, 0];
for (let i = 0; i < pos.getCount(); i++) {
  pos.getElement(i, tmp);
  if (tmp[0] < minX) minX = tmp[0];
  if (tmp[0] > maxX) maxX = tmp[0];
  if (tmp[2] < minZ) minZ = tmp[2];
  if (tmp[2] > maxZ) maxZ = tmp[2];
  if (tmp[1] < minY) minY = tmp[1];
  if (tmp[1] > maxY) maxY = tmp[1];
}

console.log(`${FILE}\ntris ${triCount}  verts ${pos.getCount()}`);
console.log(
  `bounds  X ${minX.toFixed(3)}..${maxX.toFixed(3)}  Y ${minY.toFixed(3)}..${maxY.toFixed(3)}  Z ${minZ.toFixed(3)}..${maxZ.toFixed(3)}`,
);
console.log(
  `footprint half-extents: X ${Math.max(-minX, maxX).toFixed(3)}  Z ${Math.max(-minZ, maxZ).toFixed(3)}  ` +
    `(X/Z aspect ${(Math.max(-minX, maxX) / Math.max(-minZ, maxZ)).toFixed(3)})`,
);

// --- rasterise triangles into a top-surface heightfield -----------------------
const H = new Float32Array(N * N).fill(-Infinity);
const cellX = (cx) => minX + ((cx + 0.5) / N) * (maxX - minX);
const cellZ = (cz) => minZ + ((cz + 0.5) / N) * (maxZ - minZ);
const toCX = (x) => ((x - minX) / (maxX - minX)) * N - 0.5;
const toCZ = (z) => ((z - minZ) / (maxZ - minZ)) * N - 0.5;

const a = [0, 0, 0];
const b = [0, 0, 0];
const c = [0, 0, 0];
for (let t = 0; t < triCount; t++) {
  const ia = idx ? idx.getScalar(t * 3) : t * 3;
  const ib = idx ? idx.getScalar(t * 3 + 1) : t * 3 + 1;
  const ic = idx ? idx.getScalar(t * 3 + 2) : t * 3 + 2;
  pos.getElement(ia, a);
  pos.getElement(ib, b);
  pos.getElement(ic, c);

  const ax = toCX(a[0]);
  const az = toCZ(a[2]);
  const bx = toCX(b[0]);
  const bz = toCZ(b[2]);
  const cx2 = toCX(c[0]);
  const cz2 = toCZ(c[2]);

  const lo0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx2)));
  const hi0 = Math.min(N - 1, Math.floor(Math.max(ax, bx, cx2)));
  const lo1 = Math.max(0, Math.ceil(Math.min(az, bz, cz2)));
  const hi1 = Math.min(N - 1, Math.floor(Math.max(az, bz, cz2)));
  if (hi0 < lo0 || hi1 < lo1) continue;

  const den = (bz - cz2) * (ax - cx2) + (cx2 - bx) * (az - cz2);
  if (Math.abs(den) < 1e-12) continue;

  for (let gz = lo1; gz <= hi1; gz++) {
    for (let gx = lo0; gx <= hi0; gx++) {
      const w0 = ((bz - cz2) * (gx - cx2) + (cx2 - bx) * (gz - cz2)) / den;
      const w1 = ((cz2 - az) * (gx - cx2) + (ax - cx2) * (gz - cz2)) / den;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const y = w0 * a[1] + w1 * b[1] + w2 * c[1];
      const k = gz * N + gx;
      if (y > H[k]) H[k] = y;
    }
  }
}

const covered = H.reduce((n, h) => n + (Number.isFinite(h) ? 1 : 0), 0);
console.log(`heightfield ${N}x${N}: ${covered} of ${N * N} cells covered`);

// --- what is the basin floor height? -----------------------------------------
// The floor is by far the most common top-surface height, so a histogram mode
// finds it without needing to know where the basin is.
const hist = new Map();
for (const h of H) {
  if (!Number.isFinite(h)) continue;
  const bucket = Math.round(h * 200) / 200;
  hist.set(bucket, (hist.get(bucket) ?? 0) + 1);
}
const [floorY, floorCount] = [...hist.entries()].sort((p, q) => q[1] - p[1])[0];
console.log(`basin floor (histogram mode): Y = ${floorY}  (${floorCount} cells, ${((floorCount / covered) * 100).toFixed(1)}% of surface)`);

const ramp = ' .:-=+*#%@';
console.log('\ntop-down max-Y heightfield (row 0 = min Z, blank = no geometry):');
for (let gz = 0; gz < N; gz += 2) {
  let line = '';
  for (let gx = 0; gx < N; gx++) {
    const h = H[gz * N + gx];
    if (!Number.isFinite(h)) {
      line += ' ';
      continue;
    }
    const t = (h - minY) / (maxY - minY);
    line += ramp[Math.min(9, Math.max(0, Math.round(t * 9)))];
  }
  console.log(line);
}

/*
 * THE TABLE THAT MATTERS.
 *
 * The board is a SQUARE, and "flat out to radius r" is not the same constraint:
 * a square of half-width s reaches s*sqrt(2) at its corners, so a basin that is
 * flat out to radius s still leaves the four corners hanging over whatever sits
 * between s and s*1.414. And because this rock's footprint is elliptical (see
 * the X/Z aspect above), the X and Z half-extents have to be checked
 * separately — a single uniform scale seats the corners unevenly, which is
 * exactly the reported symptom.
 *
 * `above floor` counts cells whose top surface pokes more than 0.01 local units
 * above the basin floor: those are the cells that would push rock up through
 * the board.
 */
function footprintReport(sx, sz) {
  let maxIn = -Infinity;
  let above = 0;
  let cells = 0;
  for (let gz = 0; gz < N; gz++) {
    for (let gx = 0; gx < N; gx++) {
      const h = H[gz * N + gx];
      if (!Number.isFinite(h)) continue;
      if (Math.abs(cellX(gx)) > sx || Math.abs(cellZ(gz)) > sz) continue;
      cells++;
      if (h > maxIn) maxIn = h;
      if (h > floorY + 0.01) above++;
    }
  }
  return { cells, maxIn, above };
}

console.log('\nSQUARE footprint, uniform scale (sx = sz):');
console.log('    s   cells   maxTopY  cells above floor');
for (let s = 0.3; s <= 0.8001; s += 0.025) {
  const r = footprintReport(s, s);
  if (!r.cells) continue;
  console.log(
    `  ${s.toFixed(3)}  ${String(r.cells).padStart(6)}   ${r.maxIn.toFixed(3).padStart(7)}  ${String(r.above).padStart(6)}`,
  );
}

/*
 * Per-axis: how far can the footprint go along X alone, and along Z alone,
 * before the rim intrudes? The ratio of those two answers is the non-uniform
 * scale correction the elliptical footprint needs.
 */
console.log('\nper-axis reach (other axis held at a safe 0.40):');
console.log('  axis      s   maxTopY  cells above floor');
for (let s = 0.35; s <= 0.85001; s += 0.025) {
  const rx = footprintReport(s, 0.4);
  const rz = footprintReport(0.4, s);
  console.log(
    `     X  ${s.toFixed(3)}   ${rx.maxIn.toFixed(3).padStart(7)}  ${String(rx.above).padStart(6)}` +
      `      Z  ${s.toFixed(3)}   ${rz.maxIn.toFixed(3).padStart(7)}  ${String(rz.above).padStart(6)}`,
  );
}
