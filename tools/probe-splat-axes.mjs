/*
 * Determines a .spz capture's true up-axis from its own raw point data,
 * instead of eyeballing a screenshot (this project's headless renderer
 * software-rasterises busy ink-wash splat textures in a way that hides real
 * orientation problems — see CLAUDE.md's Крок 20 entry and the user report
 * that motivated this script).
 *
 * Decode logic mirrors @sparkjsdev/spark's own SpzReader (dist/spark.module.js,
 * class SpzReader) exactly: gzip container, 16-byte header (magic 1347635022,
 * version 1-3), then for version 2/3 a 24-bit fixed-point (3 bytes/axis,
 * signed, >> 8 sign-extend trick) center per splat, divided by 1<<fractionalBits.
 *
 * A landscape/canyon capture should have much smaller extent on its true "up"
 * axis than on the other two (a canyon is wide and long, not tall) — reports
 * range (max-min) and standard deviation per axis so the up-axis is a data
 * conclusion, not a guess.
 *
 *   node tools/probe-splat-axes.mjs <path-to.spz>
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const path = process.argv[2];
if (!path) {
  console.error('usage: node tools/probe-splat-axes.mjs <path-to.spz>');
  process.exit(1);
}

const gz = fs.readFileSync(path);
const raw = zlib.gunzipSync(gz);
const header = new DataView(raw.buffer, raw.byteOffset, 16);

const magic = header.getUint32(0, true);
if (magic !== 1347635022) throw new Error(`Invalid SPZ magic: ${magic}`);
const version = header.getUint32(4, true);
const numSplats = header.getUint32(8, true);
const shDegree = header.getUint8(12);
const fractionalBits = header.getUint8(13);
const flags = header.getUint8(14);

console.log({ path, version, numSplats, shDegree, fractionalBits, flags });
if (version !== 2 && version !== 3) throw new Error(`Unsupported version for this probe: ${version}`);

const fixed = 1 << fractionalBits;
const centerBytes = raw.subarray(16, 16 + numSplats * 9);

const xs = new Float64Array(numSplats);
const ys = new Float64Array(numSplats);
const zs = new Float64Array(numSplats);

for (let i = 0; i < numSplats; i++) {
  const i9 = i * 9;
  xs[i] = ((centerBytes[i9 + 2] << 24 | centerBytes[i9 + 1] << 16 | centerBytes[i9] << 8) >> 8) / fixed;
  ys[i] = ((centerBytes[i9 + 5] << 24 | centerBytes[i9 + 4] << 16 | centerBytes[i9 + 3] << 8) >> 8) / fixed;
  zs[i] = ((centerBytes[i9 + 8] << 24 | centerBytes[i9 + 7] << 16 | centerBytes[i9 + 6] << 8) >> 8) / fixed;
}

// p01-p99 extent — same method CLAUDE.md's own prior splat derivations use
// (see the mountain-valley capture's "World extent (p01-p99)" note) —
// specifically to avoid a handful of far-flung/clutter splats skewing a raw
// min/max the way they skewed this file's plain std (checked first, see git
// history on this script: X/Y/Z std came out within 8% of each other, too
// close to call — outlier-dominated, not a real signal).
function percentileExtent(label, arr) {
  const sorted = Float64Array.from(arr).sort();
  const p01 = sorted[Math.floor(numSplats * 0.01)];
  const p50 = sorted[Math.floor(numSplats * 0.5)];
  const p99 = sorted[Math.floor(numSplats * 0.99)];
  const range = p99 - p01;
  console.log(`${label}: p01=${p01.toFixed(2)} p50=${p50.toFixed(2)} p99=${p99.toFixed(2)} range=${range.toFixed(2)}`);
  return { p01, p50, p99, range };
}

const sx = percentileExtent('local X', xs);
const sy = percentileExtent('local Y', ys);
const sz = percentileExtent('local Z', zs);

const byRange = [['X', sx], ['Y', sy], ['Z', sz]].sort((a, b) => a[1].range - b[1].range);
console.log(`\nSmallest p01-p99 spread (likely the capture's own "up"): ${byRange[0][0]} (range ${byRange[0][1].range.toFixed(2)}, vs ${byRange[1][0]}=${byRange[1][1].range.toFixed(2)}, ${byRange[2][0]}=${byRange[2][1].range.toFixed(2)})`);
