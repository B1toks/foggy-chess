/*
 * Sweeps SparkRenderer's three cost levers against measured quality.
 *
 * components/SplatBackdrop.jsx sets minAlpha 0.02, minPixelRadius 1.0 and
 * maxStdDev sqrt(5). Крок 16 Section B picked those by reading Spark's source
 * for what was available and reasoning about what a backdrop can afford — they
 * were never measured against an actual quality number, because at the time
 * there was no way to get one (a browser splat frame costs 100+ seconds here).
 * tools/splat-raster.mjs models all three, so they can be swept.
 *
 * Two cost columns, because the levers do not act on the same thing:
 *   drawn      splats surviving cull -> sort cost and per-splat setup (CPU)
 *   fragments  pixel evaluations -> rasterisation and overdraw cost (GPU)
 * maxStdDev barely changes `drawn` but scales `fragments` quadratically;
 * minPixelRadius and minAlpha do the reverse.
 *
 *   node tools/spark-levers.mjs <file.spz> [--views=6] [--width=320]
 */
import { loadSplats, render, makeView, psnr, lumaMAE, SPARK_DEFAULTS } from './splat-raster.mjs';
import { CAMERA } from './splat-importance.mjs';

const argv = process.argv.slice(2);
const srcPath = argv.find((a) => !a.startsWith('--'));
const flag = (name, fb) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fb : hit.split('=')[1];
};
const viewCount = Number(flag('views', '6'));
const width = Number(flag('width', '320'));
const height = Math.round((width * 5) / 8);
if (!srcPath) {
  console.error('usage: node tools/spark-levers.mjs <file.spz> [--views=6] [--width=320]');
  process.exit(1);
}

const splats = loadSplats(srcPath, { scale: 1, rotation: [0, 0, 0], position: [0, 0, 0] });

// Frame the capture body from outside, same convention as splat-compare.mjs.
const axis = (off) => {
  const v = new Float64Array(splats.count);
  for (let i = 0; i < splats.count; i++) v[i] = splats.world[i * 3 + off];
  v.sort();
  return [v[Math.floor(v.length * 0.01)], v[Math.floor(v.length * 0.99)]];
};
const [x0, x1] = axis(0);
const [y0, y1] = axis(1);
const [z0, z1] = axis(2);
const center = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
const radius = Math.max(x1 - x0, y1 - y0, z1 - z0) / 2;

const views = [];
for (let i = 0; i < viewCount; i++) {
  const theta = (2 * Math.PI * (i + 0.37)) / viewCount;
  const phi = 0.6 + 0.75 * ((i * 0.618) % 1);
  const d = radius * 2.4;
  views.push(
    makeView(
      [
        center[0] + d * Math.sin(phi) * Math.sin(theta),
        center[1] + d * Math.cos(phi),
        center[2] + d * Math.sin(phi) * Math.cos(theta),
      ],
      center,
    ),
  );
}

// Ground truth: every lever off (nothing culled, full Gaussian footprint).
const OFF = { minAlpha: 0, minPixelRadius: 0, maxStdDev: Math.sqrt(8) };
console.log(`\n${srcPath}: ${splats.count} splats, ${views.length} views @ ${width}x${height}`);
console.log('ground truth = all levers off (minAlpha 0, minPixelRadius 0, maxStdDev sqrt(8) = Spark default)\n');
const truth = views.map((v) => render(splats, v, { width, height, spark: OFF }));
const truthFrag = truth.reduce((s, f) => s + f.fragments, 0) / views.length;
const truthDrawn = truth.reduce((s, f) => s + f.drawn, 0) / views.length;

function evaluate(label, spark) {
  let p = 0;
  let m = 0;
  let frag = 0;
  let drawn = 0;
  for (let i = 0; i < views.length; i++) {
    const img = render(splats, views[i], { width, height, spark });
    p += psnr(truth[i].rgb, img.rgb);
    m += lumaMAE(truth[i].rgb, img.rgb, width, height);
    frag += img.fragments;
    drawn += img.drawn;
  }
  return {
    setting: label,
    PSNR_dB: (p / views.length).toFixed(2),
    lumaMAE: (m / views.length).toFixed(2),
    drawn: Math.round(drawn / views.length),
    'drawn%': `${((drawn / views.length / truthDrawn) * 100).toFixed(1)}%`,
    fragments: Math.round(frag / views.length),
    'frag%': `${((frag / views.length / truthFrag) * 100).toFixed(1)}%`,
  };
}

const rows = [];
rows.push(evaluate('ALL OFF (truth)', OFF));
rows.push(evaluate('SHIPPING (Крок 16 B)', SPARK_DEFAULTS));

for (const v of [0.005, 0.02, 0.05, 0.1]) {
  rows.push(evaluate(`minAlpha=${v}`, { ...OFF, minAlpha: v }));
}
for (const v of [0.5, 1.0, 1.5, 2.0]) {
  rows.push(evaluate(`minPixelRadius=${v}`, { ...OFF, minPixelRadius: v }));
}
for (const [lbl, v] of [['sqrt(8)=2.83', Math.sqrt(8)], ['sqrt(5)=2.24', Math.sqrt(5)], ['sqrt(3)=1.73', Math.sqrt(3)], ['sqrt(2)=1.41', Math.SQRT2]]) {
  rows.push(evaluate(`maxStdDev=${lbl}`, { ...OFF, maxStdDev: v }));
}

console.table(rows);
console.log('\nRead this as: how much quality does each lever cost, and what does it buy.');
console.log('A lever is well set if frag%/drawn% drops a lot while PSNR stays high.');
