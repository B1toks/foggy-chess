/*
 * Offline .spz reducer: importance-ranked, spatially stratified, with coverage
 * compensation. Replaces the fixed-stride version this file used to hold.
 *
 * ---------------------------------------------------------------------------
 * Why the old fixed-stride policy could not work
 * ---------------------------------------------------------------------------
 * Keeping every Nth splat treats a splat that covers 400 pixels and one that
 * covers a quarter of a pixel as equally worth keeping. Measured on
 * public/ink-wash-sea-canyon-*.spz with tools/analyze-spz.mjs, the top 15% of
 * splats by contribution carry 92.7% of the rendered image; a 15% stride keeps
 * 15% of it. Same file size, same splat count, ~6x the image content.
 *
 * The second, subtler failure is coverage. A 3DGS surface is opaque because
 * many Gaussians overlap. Remove 85% of them uniformly and the surface stops
 * being opaque — background bleeds through and the whole capture washes out.
 * That is what "destroys visual coherence at high compression ratios" is: not
 * missing detail, missing *opacity*.
 *
 * ---------------------------------------------------------------------------
 * What this does instead — three mechanisms
 * ---------------------------------------------------------------------------
 * 1. IMPORTANCE RANKING (LightGaussian, arxiv 2311.17245). That paper scores a
 *    Gaussian by (rays that hit it) x opacity x volume. The hit-count term is
 *    proportional to the splat's projected area, so the view-independent form
 *    is opacity x cross-sectional area, where the cross-section is the two
 *    largest axes (3DGS fits surfaces with flattened, disc-shaped Gaussians —
 *    the third axis is disc thickness, not extent).
 *
 *      importance = opacity * s_largest * s_second
 *
 *    With --theme=<key> this is additionally weighted by the real projected
 *    pixel area over the camera positions this project can actually reach.
 *    That is stronger but PLACEMENT-LOCKED — see --theme below.
 *
 * 2. SPATIAL STRATIFICATION (Mini-Splatting's "intersection preserving +
 *    sampling", arxiv 2403.14166). Importance ranking is a global threshold,
 *    so on its own it will empty an entire low-contrast region (haze, a
 *    distant wall) to spend the budget on one high-contrast ridge — a
 *    different way to destroy coherence. The cloud is bucketed into a voxel
 *    grid and EVERY OCCUPIED CELL IS GUARANTEED AT LEAST ONE SURVIVOR, chosen
 *    by that cell's own local importance ranking, before the rest of the
 *    budget is filled globally.
 *
 *    That min-one-per-cell rule is the whole guarantee; --floor (an additional
 *    fraction of each cell) was measured and is NOT worth having above ~0.03.
 *    At a 25% floor quality fell 35.9 -> 27.5 dB at a fixed budget, because
 *    forcing 25% of every cell of tiny junk splats spends budget the global
 *    ranking would have spent on splats that actually paint pixels. Default 0.
 *
 * 3. COVERAGE COMPENSATION. Per cell, the kept splats' total cross-sectional
 *    area is compared against what was there before, and survivors are grown
 *    by sqrt(areaBefore / areaKept) to put the lost coverage back — capped by
 *    --maxgain, because growing a splat also blurs it AND costs fragment/
 *    overdraw time on the GPU.
 *
 *    Measured worth: +0.24 dB, saturating by 1.25x. Deliberately small, and
 *    the reason it is small is itself the proof of the diagnosis — importance
 *    ranking keeps the big splats, so it retains most of the area for free and
 *    has almost nothing to put back. A stride retains area in proportion to
 *    count, so at 15% it would need a 2.6x gain to restore coverage: a stride
 *    is not losing detail, it is losing the overlap that made the surface
 *    opaque, and no post-hoc growth fixes that without turning it to mush.
 *    Because the gain costs fragments, --maxgain=1.0 is the right choice when
 *    the scene is GPU-bound (it gives up ~1 dB).
 *
 * Scale gain is applied in the quantized domain (scale is log-encoded, so a
 * gain is an integer add on the byte — see tools/spz-io.mjs). Centers, colour
 * and rotation are copied byte-for-byte, so every kept splat keeps exactly the
 * precision it had in the source.
 *
 * ---------------------------------------------------------------------------
 *   node tools/shrink-spz.mjs <in.spz> <out.spz> [options]
 *
 *     --keep=0.15        fraction of splats to keep (of those Spark would draw)
 *     --count=250000     absolute target instead of --keep
 *     --floor=0          EXTRA fraction of each occupied voxel to retain, on
 *                        top of the min-one-per-cell guarantee. Measured: hurts
 *                        above ~0.03, leave at 0 unless you know why.
 *     --occupancy=0.65   auto-sizes the voxel grid so occupied cells land at
 *                        this fraction of the budget (flat 0.4..0.85)
 *     --cells=N          pin the grid instead of auto-sizing it
 *     --maxgain=1.25     cap on the coverage-compensation scale gain; 1.0 to
 *                        spend nothing on fragment cost
 *     --minalpha=0.02    drop splats below this opacity (Spark skips them too)
 *     --declutter=N      drop splats whose voxel cell holds fewer than N
 *                        others — removes the detached specks every Mint
 *                        capture carries. NOTE this LOWERS PSNR against the
 *                        source on purpose (it deletes content that is really
 *                        there); judge it by eye, not by the number. Off by
 *                        default; snow ships at 100, ocean at 0.
 *     --theme=ocean      ALSO weight by real projected area at that theme's
 *                        shipped placement. Placement-locked: re-run if
 *                        lib/themes.js's backdrop.splat transform changes.
 *     --stride           baseline mode: the old every-Nth policy, for A/B
 * ---------------------------------------------------------------------------
 */
import { readSpz, decodeAlpha, decodeScales, decodeCenters, writeSpz } from './spz-io.mjs';
import { importanceScores, THEME_PLACEMENTS, cameraRing } from './splat-importance.mjs';

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.split('=').slice(1).join('=');
};
const has = (name) => argv.includes(`--${name}`);

const [srcPath, outPath] = positional;
if (!srcPath || !outPath) {
  console.error('usage: node tools/shrink-spz.mjs <in.spz> <out.spz> [--keep=0.15] [--count=N] [--floor=0.25] [--cells=48] [--maxgain=1.5] [--theme=ocean] [--stride]');
  process.exit(1);
}

const keepFraction = Number(flag('keep', '0.15'));
const targetCount = flag('count', null) === null ? null : Number(flag('count'));
const floorFrac = Number(flag('floor', '0'));
const cellsAlongLongest = Number(flag('cells', '48'));
const maxGain = Number(flag('maxgain', '1.25'));
const minAlpha = Number(flag('minalpha', '0.02'));
const themeKey = flag('theme', null);
const strideMode = has('stride');

const spz = readSpz(srcPath);
const n = spz.numSplats;
const alpha = decodeAlpha(spz);
const scales = decodeScales(spz);
const centers = decodeCenters(spz);

console.log(`\n${srcPath}: ${n} splats, shDegree ${spz.shDegree}, ${(spz.gzBytes / 1e6).toFixed(2)} MB`);

/* ------------------------------------------------------------------ *
 * Stride baseline — kept so the A/B in tools/splat-compare.mjs is real
 * ------------------------------------------------------------------ */
if (strideMode) {
  const keepCount = targetCount ?? Math.max(1, Math.floor(n * keepFraction));
  const stride = n / keepCount;
  const indices = new Uint32Array(keepCount);
  for (let i = 0; i < keepCount; i++) indices[i] = Math.min(n - 1, Math.floor(i * stride));
  const res = writeSpz(outPath, spz, indices);
  console.log('mode: STRIDE (baseline)', {
    keepCount: res.keepCount,
    outMB: (res.outBytes / 1e6).toFixed(2),
    splatRatio: (res.keepCount / n).toFixed(3),
  });
  process.exit(0);
}

/* ------------------------------------------------------------------ *
 * 0. Drop what the renderer would skip anyway
 * ------------------------------------------------------------------ */
let candidates = [];
for (let i = 0; i < n; i++) if (alpha[i] >= minAlpha) candidates.push(i);
console.log(`below minAlpha ${minAlpha}: ${n - candidates.length} dropped (${(((n - candidates.length) / n) * 100).toFixed(1)}%) — SparkRenderer skips these at render time regardless`);

/* ------------------------------------------------------------------ *
 * 0b. Declutter — drop isolated floating specks
 * ------------------------------------------------------------------ *
 * Every Mint capture in this project carries a tail of detached splats flung
 * well clear of the body: visible as isolated blobs in tools/shots/wide-*.png,
 * and the same phenomenon CLAUDE.md already records for the mist capture's
 * tree cell ("the origin sits inside a 374,160-point clutter cell").
 *
 * Importance ranking makes these WORSE, not better, and that is not obvious:
 * clutter splats are typically large and opaque, which is exactly what the
 * score rewards, so they survive preferentially while genuine fine surface
 * detail is culled around them. They are also what a placement search trips
 * over — a single stray speck near the board sets the "nearest splat"
 * distance and reads as dirt floating over the play space.
 *
 * The test is local density, not distance from a centroid: a real surface is
 * a cell with many neighbours, a speck is a cell with almost none. That keeps
 * genuinely distant-but-solid geometry (a far ridge) while dropping specks
 * wherever they sit, including ones close in.
 */
const declutterMin = Number(flag('declutter', '0'));
if (declutterMin > 0) {
  const before = candidates.length;
  const rr = (off) => {
    const v = new Float64Array(candidates.length);
    for (let k = 0; k < candidates.length; k++) v[k] = centers[candidates[k] * 3 + off];
    v.sort();
    return [v[Math.floor(v.length * 0.005)], v[Math.min(v.length - 1, Math.floor(v.length * 0.995))]];
  };
  const [ax0, ax1] = rr(0);
  const [ay0, ay1] = rr(1);
  const [az0, az1] = rr(2);
  const span = Math.max(ax1 - ax0, ay1 - ay0, az1 - az0) || 1;
  const cs = span / 64;
  const gxx = Math.max(1, Math.ceil((ax1 - ax0) / cs));
  const gyy = Math.max(1, Math.ceil((ay1 - ay0) / cs));
  const counts = new Map();
  const keyOf = (i) => {
    const i3 = i * 3;
    const a = Math.max(0, Math.min(gxx - 1, Math.floor((centers[i3] - ax0) / cs)));
    const b = Math.max(0, Math.min(gyy - 1, Math.floor((centers[i3 + 1] - ay0) / cs)));
    const c = Math.floor((centers[i3 + 2] - az0) / cs);
    return (c * gyy + b) * gxx + a;
  };
  for (const i of candidates) {
    const k = keyOf(i);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  candidates = candidates.filter((i) => counts.get(keyOf(i)) >= declutterMin);
  console.log(`declutter (cells of ${cs.toFixed(3)} units holding < ${declutterMin} splats): ${before - candidates.length} dropped (${(((before - candidates.length) / before) * 100).toFixed(1)}%)`);
}

/* ------------------------------------------------------------------ *
 * 1. Importance
 * ------------------------------------------------------------------ */
// Cross-sectional area: the two largest axes. area[] is also what the coverage
// compensation in step 3 conserves, so it is computed once for both.
const area = new Float64Array(n);
for (let i = 0; i < n; i++) {
  const i3 = i * 3;
  let a = scales[i3], b = scales[i3 + 1], c = scales[i3 + 2];
  if (a < b) { const t = a; a = b; b = t; }
  if (b < c) { const t = b; b = c; c = t; }
  if (a < b) { const t = a; a = b; b = t; }
  area[i] = a * b;
}

const importance = new Float64Array(n);
for (let i = 0; i < n; i++) importance[i] = alpha[i] * area[i];

if (themeKey) {
  const placement = THEME_PLACEMENTS[themeKey];
  if (!placement) throw new Error(`unknown theme "${themeKey}"`);
  console.log(`view-aware weighting for theme "${themeKey}":`, placement);
  console.warn('  ! the output is placement-locked — re-run if backdrop.splat changes');
  const { score } = importanceScores(spz, placement, cameraRing());
  // Multiply rather than replace: the view term is a ranking refinement, and a
  // splat that is out of frustum at TODAY's placement keeps a small residual
  // importance instead of dropping to exactly zero, so a later placement tweak
  // degrades gracefully instead of exposing a hole.
  let maxScore = 0;
  for (let i = 0; i < n; i++) if (score[i] > maxScore) maxScore = score[i];
  const eps = 0.02;
  for (let i = 0; i < n; i++) importance[i] *= eps + (1 - eps) * (score[i] / maxScore);
}

/* ------------------------------------------------------------------ *
 * 2. Voxel grid + stratified selection
 * ------------------------------------------------------------------ */
/*
 * Bounds are percentile-based, not min/max. These captures carry a long tail of
 * detached "clutter" splats flung far from the body (visible as isolated blobs
 * in tools/shots/wide-*.png, and the same phenomenon CLAUDE.md already records
 * for the mist capture's tree cell). A true min/max bounding box is ~7x the
 * body's own extent, which collapses the grid to a few hundred huge cells and
 * makes the stratification meaningless. p0.5..p99.5 tracks the actual body;
 * outliers clamp into the edge cells, so they are still stratified, just not
 * allowed to define the scale.
 */
function robustRange(offset) {
  const vals = new Float64Array(candidates.length);
  for (let k = 0; k < candidates.length; k++) vals[k] = centers[candidates[k] * 3 + offset];
  vals.sort();
  const lo = vals[Math.floor(vals.length * 0.005)];
  const hi = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.995))];
  return [lo, hi];
}
const [minX, maxX] = robustRange(0);
const [minY, maxY] = robustRange(1);
const [minZ, maxZ] = robustRange(2);
const longest = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
const budget = targetCount ?? Math.max(1, Math.floor(candidates.length * keepFraction));

function buildGrid(cellsLongest) {
  const cellSize = longest / cellsLongest;
  const gx = Math.max(1, Math.ceil((maxX - minX) / cellSize));
  const gy = Math.max(1, Math.ceil((maxY - minY) / cellSize));
  const gz = Math.max(1, Math.ceil((maxZ - minZ) / cellSize));
  const map = new Map();
  for (const i of candidates) {
    const i3 = i * 3;
    const cxi = Math.max(0, Math.min(gx - 1, Math.floor((centers[i3] - minX) / cellSize)));
    const cyi = Math.max(0, Math.min(gy - 1, Math.floor((centers[i3 + 1] - minY) / cellSize)));
    const czi = Math.max(0, Math.min(gz - 1, Math.floor((centers[i3 + 2] - minZ) / cellSize)));
    const key = (czi * gy + cyi) * gx + cxi;
    let bucket = map.get(key);
    if (!bucket) { bucket = []; map.set(key, bucket); }
    bucket.push(i);
  }
  return { map, cellSize, gx, gy, gz };
}

/*
 * The grid resolution is calibrated to the budget rather than hardcoded, and
 * that turned out to matter more than any other parameter here.
 *
 * Every occupied cell is guaranteed at least one survivor (step 2a), which is
 * what actually prevents a region from being deleted wholesale. So the number
 * of occupied cells is a floor on the output count, and the two failure modes
 * sit either side of the budget:
 *
 *   too coarse -> few guarantees, selection is nearly pure global importance,
 *                 and thin/low-contrast regions thin out unevenly.
 *   too fine   -> occupied cells approach or exceed the budget, every cell
 *                 keeps exactly its one splat, and the importance ranking stops
 *                 having any budget left to express itself. Measured: at 256
 *                 cells the grid had 337,577 occupied cells against a 261,215
 *                 budget, the output overshot to 337,577 splats AND quality
 *                 dropped to 32.9 dB — worse than the 192-cell grid at 35.1 dB
 *                 with 29% fewer splats.
 *
 * So the grid is binary-searched to put the occupied-cell count at
 * --occupancy of the budget (0.65 default, measured flat between ~0.4 and
 * ~0.85), which keeps both mechanisms funded on any capture at any target.
 */
const occupancyTarget = Number(flag('occupancy', '0.65'));
let grid;
if (flag('cells', null) !== null) {
  grid = buildGrid(cellsAlongLongest);
  console.log(`voxel grid ${grid.gx}x${grid.gy}x${grid.gz} (explicit --cells=${cellsAlongLongest})`);
} else {
  let lo = 8;
  let hi = 512;
  const want = occupancyTarget * budget;
  for (let iter = 0; iter < 12 && hi - lo > 1; iter++) {
    const mid = Math.round((lo + hi) / 2);
    const trial = buildGrid(mid);
    if (trial.map.size > want) hi = mid; else lo = mid;
    grid = trial;
  }
  grid = buildGrid(lo);
  console.log(`voxel grid ${grid.gx}x${grid.gy}x${grid.gz} (auto: ${lo} cells along longest axis, targeting ${(occupancyTarget * 100).toFixed(0)}% occupancy of budget)`);
}
const cellOf = grid.map;
console.log(`cell ${grid.cellSize.toFixed(4)} local units, ${cellOf.size} occupied cells (${((cellOf.size / budget) * 100).toFixed(0)}% of budget guaranteed by the min-one-per-cell rule)`);
const kept = new Uint8Array(n);
let keptTotal = 0;

// 2a. Per-cell floor: every occupied cell keeps its own top splats, so no
//     region of the capture can be emptied by a global threshold.
for (const bucket of cellOf.values()) {
  bucket.sort((a, b) => importance[b] - importance[a]);
  const take = Math.min(bucket.length, Math.max(1, Math.ceil(bucket.length * floorFrac)));
  for (let k = 0; k < take; k++) {
    if (!kept[bucket[k]]) { kept[bucket[k]] = 1; keptTotal++; }
  }
}
console.log(`per-cell floor (${(floorFrac * 100).toFixed(0)}% of each cell): ${keptTotal} kept`);

// 2b. Fill the rest globally by importance. If the floor already overshot the
//     budget, trim the globally weakest of the floor picks back down instead —
//     but never below one splat per occupied cell.
if (keptTotal < budget) {
  const rest = candidates.filter((i) => !kept[i]).sort((a, b) => importance[b] - importance[a]);
  for (let k = 0; k < rest.length && keptTotal < budget; k++) {
    kept[rest[k]] = 1;
    keptTotal++;
  }
} else if (keptTotal > budget) {
  const protectedIdx = new Uint8Array(n);
  for (const bucket of cellOf.values()) protectedIdx[bucket[0]] = 1;
  const droppable = [];
  for (const i of candidates) if (kept[i] && !protectedIdx[i]) droppable.push(i);
  droppable.sort((a, b) => importance[a] - importance[b]);
  for (let k = 0; k < droppable.length && keptTotal > budget; k++) {
    kept[droppable[k]] = 0;
    keptTotal--;
  }
}

const indices = [];
for (let i = 0; i < n; i++) if (kept[i]) indices.push(i);

/* ------------------------------------------------------------------ *
 * 3. Coverage compensation
 * ------------------------------------------------------------------ */
const gainForIndex = new Map();
let gainSum = 0;
let gainMaxSeen = 1;
for (const bucket of cellOf.values()) {
  let areaBefore = 0;
  let areaKept = 0;
  for (const i of bucket) {
    areaBefore += area[i] * alpha[i];
    if (kept[i]) areaKept += area[i] * alpha[i];
  }
  if (areaKept <= 0) continue;
  const gain = Math.min(maxGain, Math.max(1, Math.sqrt(areaBefore / areaKept)));
  if (gain > gainMaxSeen) gainMaxSeen = gain;
  for (const i of bucket) if (kept[i]) { gainForIndex.set(i, gain); gainSum += gain; }
}
const scaleGain = new Float64Array(indices.length);
for (let k = 0; k < indices.length; k++) scaleGain[k] = gainForIndex.get(indices[k]) ?? 1;

/* ------------------------------------------------------------------ *
 * Write
 * ------------------------------------------------------------------ */
let areaAll = 0;
let areaSel = 0;
for (const i of candidates) areaAll += area[i] * alpha[i];
for (const i of indices) areaSel += area[i] * alpha[i];

const res = writeSpz(outPath, spz, Uint32Array.from(indices), { scaleGain });
console.log('\nmode: IMPORTANCE + STRATIFIED + COMPENSATED');
console.log({
  keptSplats: res.keepCount,
  ofOriginal: `${((res.keepCount / n) * 100).toFixed(2)}%`,
  outMB: (res.outBytes / 1e6).toFixed(2),
  sizeRatio: (res.outBytes / spz.gzBytes).toFixed(3),
  opacityWeightedAreaRetained: `${((areaSel / areaAll) * 100).toFixed(1)}%`,
  meanScaleGain: (gainSum / Math.max(1, indices.length)).toFixed(3),
  maxScaleGainApplied: gainMaxSeen.toFixed(3),
});
console.log(
  `\n  ^ "area retained" is the headline: a uniform stride at this count would retain ~${((res.keepCount / candidates.length) * 100).toFixed(1)}%\n`,
);
