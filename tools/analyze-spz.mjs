/*
 * Reports what a .spz capture is actually made of, so a pruning policy can be
 * chosen from data instead of guessed.
 *
 * The headline number is the "contribution concentration" table at the end:
 * what fraction of total screen-space contribution (opacity x projected area,
 * summed over the camera positions this project can actually reach) the top N%
 * of splats by importance carry. If that curve is steep, a uniform-stride keep
 * (the old tools/shrink-spz.mjs policy) is throwing away most of the image
 * while keeping most of the file, and importance ranking is worth the work.
 *
 *   node tools/analyze-spz.mjs <file.spz> [--theme=ocean]
 */
import { readSpz, decodeCenters, decodeAlpha, decodeScales } from './spz-io.mjs';
import { importanceScores, THEME_PLACEMENTS, cameraRing } from './splat-importance.mjs';

const args = process.argv.slice(2);
const srcPath = args.find((a) => !a.startsWith('--'));
const themeArg = (args.find((a) => a.startsWith('--theme=')) ?? '--theme=ocean').split('=')[1];
if (!srcPath) {
  console.error('usage: node tools/analyze-spz.mjs <file.spz> [--theme=ocean]');
  process.exit(1);
}

const spz = readSpz(srcPath);
const n = spz.numSplats;
console.log(`\n=== ${srcPath} ===`);
console.log({
  numSplats: n,
  shDegree: spz.shDegree,
  fractionalBits: spz.fractionalBits,
  antiAliased: (spz.flags & 1) !== 0,
  gzMB: (spz.gzBytes / 1e6).toFixed(2),
  rawMB: (spz.rawBytes / 1e6).toFixed(2),
});

const alpha = decodeAlpha(spz);
const scales = decodeScales(spz);
const centers = decodeCenters(spz);

function percentiles(values, ps) {
  const sorted = Float64Array.from(values).sort();
  return ps.map((p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]);
}

const PS = [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99];
console.log('\n--- opacity (alpha byte / 255) ---');
const aP = percentiles(alpha, PS);
console.log(Object.fromEntries(PS.map((p, i) => [`p${p * 100}`, aP[i].toFixed(4)])));
let nearZero = 0;
for (let i = 0; i < n; i++) if (alpha[i] < 0.02) nearZero++;
let underMinAlpha = 0;
for (let i = 0; i < n; i++) if (alpha[i] < 0.02) underMinAlpha++;
console.log({
  meanAlpha: (alpha.reduce((s, v) => s + v, 0) / n).toFixed(4),
  belowSparkMinAlpha_0p02: `${underMinAlpha} (${((underMinAlpha / n) * 100).toFixed(1)}%)`,
  nearZero,
});

console.log('\n--- per-splat scale (geometric mean of 3 axes, capture-local units) ---');
const gscale = new Float32Array(n);
const maxAxis = new Float32Array(n);
for (let i = 0; i < n; i++) {
  const a = scales[i * 3];
  const b = scales[i * 3 + 1];
  const c = scales[i * 3 + 2];
  gscale[i] = Math.cbrt(a * b * c);
  maxAxis[i] = Math.max(a, b, c);
}
const sP = percentiles(gscale, PS);
console.log(Object.fromEntries(PS.map((p, i) => [`p${p * 100}`, sP[i].toFixed(5)])));
const mP = percentiles(maxAxis, PS);
console.log('largest axis:', Object.fromEntries(PS.map((p, i) => [`p${p * 100}`, mP[i].toFixed(5)])));

console.log('\n--- spatial extent (capture-local, p01..p99) ---');
for (const [axis, off] of [['x', 0], ['y', 1], ['z', 2]]) {
  const vals = new Float32Array(n);
  for (let i = 0; i < n; i++) vals[i] = centers[i * 3 + off];
  const [p01, , , p50, , , p99] = percentiles(vals, PS);
  console.log(`  ${axis}: p01=${p01.toFixed(2)} p50=${p50.toFixed(2)} p99=${p99.toFixed(2)} extent=${(p99 - p01).toFixed(2)}`);
}

const placement = THEME_PLACEMENTS[themeArg];
if (!placement) {
  console.log(`\n(no placement known for theme "${themeArg}" — skipping view-dependent stats)`);
  process.exit(0);
}
console.log(`\n--- importance, as seen from this project's real camera range (theme=${themeArg}) ---`);
console.log('placement:', placement);
const views = cameraRing();
console.log(`sampling ${views.length} camera placements inside the project's own orbit clamps`);

const { score, projectedArea, visibleCount } = importanceScores(spz, placement, views);
console.log({
  everVisibleInFrustum: `${visibleCount} (${((visibleCount / n) * 100).toFixed(1)}%)`,
});

const iP = percentiles(score, PS);
console.log('score:', Object.fromEntries(PS.map((p, i) => [`p${p * 100}`, iP[i].toExponential(2)])));
const pxP = percentiles(projectedArea, PS);
console.log('mean projected radius (px, 1280-wide frame):',
  Object.fromEntries(PS.map((p, i) => [`p${p * 100}`, pxP[i].toFixed(3)])));

let subPixel = 0;
for (let i = 0; i < n; i++) if (projectedArea[i] < 1.0) subPixel++;
console.log(`below Spark's minPixelRadius=1.0 on average: ${subPixel} (${((subPixel / n) * 100).toFixed(1)}%)`);

console.log('\n--- contribution concentration (the reason importance ranking is worth it) ---');
const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => score[b] - score[a]);
let total = 0;
for (let i = 0; i < n; i++) total += score[i];
const marks = [0.05, 0.1, 0.15, 0.25, 0.35, 0.5, 0.75];
let acc = 0;
let cursor = 0;
console.log('  keep%   contribution kept by top-N%   vs uniform stride');
for (const m of marks) {
  const upto = Math.floor(n * m);
  for (; cursor < upto; cursor++) acc += score[order[cursor]];
  console.log(
    `   ${(m * 100).toFixed(0).padStart(3)}%   ${((acc / total) * 100).toFixed(1).padStart(21)}%   ${(m * 100).toFixed(1).padStart(15)}%`,
  );
}
