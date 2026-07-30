/*
 * Objective A/B for splat reduction policies.
 *
 * Renders the FULL source cloud as ground truth with tools/splat-raster.mjs,
 * then renders each candidate .spz from the same camera placements and reports
 * PSNR and mean luma error against it. This is the measurement CLAUDE.md's
 * "Headless browser" section says a screenshot cannot give: the browser here
 * needs 100+ seconds per splat frame and renders ink-wash splat noise
 * chaotically enough that Крок 20 could not tell a correctly-oriented capture
 * from a broken one by eye. A CPU render is deterministic and ~1.5s a frame.
 *
 *   node tools/splat-compare.mjs <reference.spz> <candidate.spz>... [--theme=ocean]
 *                                [--views=8] [--width=320] [--png]
 */
import { loadSplats, render, makeView, psnr, lumaMAE, writePng, SPARK_DEFAULTS } from './splat-raster.mjs';
import { THEME_PLACEMENTS, CAMERA } from './splat-importance.mjs';
import path from 'node:path';

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.split('=')[1];
};
const wantPng = argv.includes('--png');
const themeKey = flag('theme', 'ocean');
const viewCount = Number(flag('views', '8'));
const width = Number(flag('width', '320'));
const height = Math.round((width * 5) / 8);

if (files.length < 2) {
  console.error('usage: node tools/splat-compare.mjs <reference.spz> <candidate.spz>... [--theme=ocean] [--views=8] [--png]');
  process.exit(1);
}
const placement = THEME_PLACEMENTS[themeKey];
if (!placement) throw new Error(`unknown theme "${themeKey}"`);

/*
 * Two view modes.
 *
 *   --mode=outside (default) orbits the capture's own body at a framing
 *     distance, using an identity placement. This measures the REDUCTION
 *     POLICY and nothing else: how faithfully does a pruned cloud reproduce
 *     the full cloud's own appearance. It is deliberately independent of where
 *     the capture ends up in the scene, because placement is an unsettled
 *     art-direction question here (tools/place-splat.mjs) and a degenerate
 *     placement makes every candidate score identically well — at ocean's
 *     shipped transform the reference frame is a flat wall, so a pruner that
 *     deleted 99% of the cloud would still "match" it.
 *
 *   --mode=theme orbits the board the way a player does, at the theme's own
 *     shipped placement — the in-scene check, once a placement is settled.
 */
const mode = flag('mode', 'outside');
const [refPath, ...candidates] = files;

/*
 * The reference is rendered with the SAME Spark levers as the candidates, so
 * the reported PSNR is "how well does this reduced cloud reproduce the full
 * cloud drawn the same way" — not confounded by the levers themselves. Sweep
 * the levers against quality with tools/spark-levers.mjs instead.
 */
const spark = { ...SPARK_DEFAULTS };
if (flag('maxstddev', null) !== null) spark.maxStdDev = Number(flag('maxstddev'));
if (flag('minpixelradius', null) !== null) spark.minPixelRadius = Number(flag('minpixelradius'));

function themeViews(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const theta = (2 * Math.PI * (i + 0.37)) / count;
    const phi =
      CAMERA.minPolarAngle +
      ((CAMERA.maxPolarAngle - CAMERA.minPolarAngle) * ((i * 0.618) % 1));
    const d =
      CAMERA.minDistance + (CAMERA.maxDistance - CAMERA.minDistance) * ((i * 0.382) % 1);
    out.push({
      name: `v${i}`,
      pos: [
        d * Math.sin(phi) * Math.sin(theta),
        d * Math.cos(phi),
        d * Math.sin(phi) * Math.cos(theta),
      ],
      target: [0, 0, 0],
    });
  }
  return out;
}

/** Orbits the capture body itself, framed from outside. */
function outsideViews(count, body) {
  const out = [];
  const d = body.radius * 2.4;
  for (let i = 0; i < count; i++) {
    const theta = (2 * Math.PI * (i + 0.37)) / count;
    const phi = 0.6 + 0.75 * ((i * 0.618) % 1); // varied elevation, never straight down
    out.push({
      name: `v${i}`,
      pos: [
        body.center[0] + d * Math.sin(phi) * Math.sin(theta),
        body.center[1] + d * Math.cos(phi),
        body.center[2] + d * Math.sin(phi) * Math.cos(theta),
      ],
      target: body.center,
    });
  }
  return out;
}

/** Robust centre/radius of the capture body, ignoring the detached clutter tail. */
function measureBody(splats) {
  const axis = (off) => {
    const v = new Float64Array(splats.count);
    for (let i = 0; i < splats.count; i++) v[i] = splats.world[i * 3 + off];
    v.sort();
    return [v[Math.floor(v.length * 0.01)], v[Math.floor(v.length * 0.99)]];
  };
  const [x0, x1] = axis(0);
  const [y0, y1] = axis(1);
  const [z0, z1] = axis(2);
  return {
    center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
    radius: Math.max(x1 - x0, y1 - y0, z1 - z0) / 2,
  };
}

const activePlacement =
  mode === 'theme' ? placement : { scale: 1, rotation: [0, 0, 0], position: [0, 0, 0] };

console.log(`\nreference: ${refPath}`);
console.log(`mode: ${mode}${mode === 'theme' ? ` (${themeKey} placement ${JSON.stringify(placement)})` : ' (orbiting the capture body — policy-only, placement-independent)'}`);

const refSplats = loadSplats(refPath, activePlacement);
const viewList =
  mode === 'theme' ? themeViews(viewCount) : outsideViews(viewCount, measureBody(refSplats));
console.log(`${viewList.length} views, ${width}x${height}\n`);

const refFrames = viewList.map((v) => render(refSplats, makeView(v.pos, v.target), { width, height, spark }));
console.log(`reference: ${refSplats.count} splats, mean drawn/frame ${Math.round(refFrames.reduce((s, f) => s + f.drawn, 0) / refFrames.length)}`);
if (wantPng) {
  refFrames.forEach((f, i) => writePng(`tools/shots/cmp-ref-${viewList[i].name}.png`, f.rgb, width, height));
}

const rows = [];
for (const candPath of candidates) {
  const cand = loadSplats(candPath, activePlacement);
  let psnrSum = 0;
  let maeSum = 0;
  let drawnSum = 0;
  let fragSum = 0;
  const frames = [];
  for (let i = 0; i < viewList.length; i++) {
    const img = render(cand, makeView(viewList[i].pos, viewList[i].target), { width, height, spark });
    psnrSum += psnr(refFrames[i].rgb, img.rgb);
    maeSum += lumaMAE(refFrames[i].rgb, img.rgb, width, height);
    drawnSum += img.drawn;
    fragSum += img.fragments;
    frames.push(img);
  }
  if (wantPng) {
    const tag = path.basename(candPath, '.spz');
    frames.forEach((f, i) => writePng(`tools/shots/cmp-${tag}-${viewList[i].name}.png`, f.rgb, width, height));
  }
  rows.push({
    file: path.basename(candPath),
    splats: cand.count,
    pctOfRef: `${((cand.count / refSplats.count) * 100).toFixed(1)}%`,
    drawnPerFrame: Math.round(drawnSum / viewList.length),
    fragPerFrame: Math.round(fragSum / viewList.length),
    PSNR_dB: (psnrSum / viewList.length).toFixed(2),
    lumaMAE_255: (maeSum / viewList.length).toFixed(2),
  });
}

console.log('\n--- vs full-cloud ground truth (higher PSNR / lower MAE is better) ---');
console.table(rows);
