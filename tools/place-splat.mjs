/*
 * Scores candidate splat placements numerically, offline.
 *
 * CLAUDE.md's Gaussian-splat section says "Do not try to place this from a
 * headless screenshot" — a single browser splat frame costs 100+ seconds here,
 * and Крок 20 established that this environment's rasteriser cannot reliably
 * tell a correct orientation from a broken one by eye. Both limits are about
 * the BROWSER. tools/splat-raster.mjs renders the same capture on the CPU,
 * deterministically, in ~1.5s a frame, so placement can be swept and scored
 * instead of guessed.
 *
 * Three numbers per placement, over the reachable camera orbit:
 *
 *   nearestSplat  world distance from the camera to the closest splat centre
 *                 that is actually inside the frame. This is the "camera
 *                 buried in a hillside" test that this project has failed
 *                 three times (CLAUDE.md: "What was tried and rejected" —
 *                 scale 12, 2 and 1 all read as a close, muddy interior). It
 *                 should be comfortably larger than the board (half-width 4.3)
 *                 or the capture is inside the play space, not behind it.
 *
 *   coverage      fraction of the frame the splats paint over. A backdrop
 *                 wants a good deal but not all of it — 1.0 means the world is
 *                 a wall in front of the camera, near 0 means it is not there.
 *
 *   detail        std dev of frame luma. A flat wall of uniform colour and a
 *                 real vista both have high coverage; only the vista has
 *                 structure. This is the number that separates them, and it is
 *                 exactly what a screenshot in this environment cannot resolve.
 *
 *   node tools/place-splat.mjs <file.spz> [--views=6] [--width=256] [--png]
 *                             [--candidates=list.json]
 *
 * --candidates points at a JSON array of `{name, scale, rotation, position}`
 * to score instead of the built-in list below. The built-ins are motivated by
 * the sea-canyon capture's own shape (a compact island); a different capture
 * wants different candidates, and a JSON file keeps that scan reproducible
 * instead of a throwaway edit to this array.
 */
import fs from 'node:fs';
import { loadSplats, render, makeView, writePng } from './splat-raster.mjs';
import { CAMERA, THEME_PLACEMENTS } from './splat-importance.mjs';

const argv = process.argv.slice(2);
const srcPath = argv.find((a) => !a.startsWith('--'));
const flag = (name, fb) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fb : hit.split('=')[1];
};
const wantPng = argv.includes('--png');
const viewCount = Number(flag('views', '6'));
const width = Number(flag('width', '256'));
const height = Math.round((width * 5) / 8);
if (!srcPath) {
  console.error('usage: node tools/place-splat.mjs <file.spz> [--views=6] [--width=256] [--png]');
  process.exit(1);
}

/*
 * Candidates. Two families, both motivated by what the capture actually is —
 * tools/analyze-spz.mjs reports the sea-canyon body as a roughly circular
 * island ~25 local units across and ~14 tall, with its floor near local y=0.
 *
 *   "surround"  scale it far past the orbit radius and sink the floor well
 *               below the board, so the camera flies above a vast canyon and
 *               the walls are the horizon.
 *   "landmass"  keep it small and push it out sideways to backdrop distance,
 *               the way mist's own placement already does (scale 3 at
 *               [-48, -5.9, 36], ~60 units out).
 */
const BUILTIN_CANDIDATES = [
  { name: 'shipped (ocean)', ...THEME_PLACEMENTS.ocean },
  { name: 'shipped (mist-style)', ...THEME_PLACEMENTS.mist },
  { name: 'surround s12 y-40', scale: 12, rotation: [0, 0, 0], position: [0, -40, 0] },
  { name: 'surround s12 y-70', scale: 12, rotation: [0, 0, 0], position: [0, -70, 0] },
  { name: 'surround s20 y-90', scale: 20, rotation: [0, 0, 0], position: [0, -90, 0] },
  { name: 'surround s6 y-22', scale: 6, rotation: [0, 0, 0], position: [0, -22, 0] },
  { name: 'landmass s3 far', scale: 3, rotation: [0, 0, 0], position: [-48, -12, 36] },
  { name: 'landmass s5 far', scale: 5, rotation: [0, 0, 0], position: [-55, -18, 42] },
];

const candidatesPath = flag('candidates', null);
const CANDIDATES = candidatesPath
  ? JSON.parse(fs.readFileSync(candidatesPath, 'utf8'))
  : BUILTIN_CANDIDATES;

function viewRing(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const theta = (2 * Math.PI * i) / count;
    // Bias toward the shallow end: that is where a backdrop is most visible
    // and where every previous placement failure showed up first.
    const phi = CAMERA.maxPolarAngle - (i % 3) * 0.28;
    const d = 11;
    out.push([d * Math.sin(phi) * Math.sin(theta), d * Math.cos(phi), d * Math.sin(phi) * Math.cos(theta)]);
  }
  return out;
}
const ring = viewRing(viewCount);

const rows = [];
for (const cand of CANDIDATES) {
  const splats = loadSplats(srcPath, cand);
  let coverage = 0;
  let detail = 0;
  let nearest = Infinity;
  let fragments = 0;

  for (let vi = 0; vi < ring.length; vi++) {
    const view = makeView(ring[vi]);
    const img = render(splats, view, { width, height });
    fragments += img.fragments;

    // coverage = 1 - mean transmittance (how much of the frame splats painted)
    let tSum = 0;
    for (let p = 0; p < width * height; p++) tSum += img.transmittance[p];
    coverage += 1 - tSum / (width * height);

    let mean = 0;
    for (let p = 0; p < width * height; p++) {
      const p3 = p * 3;
      mean += 0.2126 * img.rgb[p3] + 0.7152 * img.rgb[p3 + 1] + 0.0722 * img.rgb[p3 + 2];
    }
    mean /= width * height;
    let varSum = 0;
    for (let p = 0; p < width * height; p++) {
      const p3 = p * 3;
      const l = 0.2126 * img.rgb[p3] + 0.7152 * img.rgb[p3 + 1] + 0.0722 * img.rgb[p3 + 2];
      varSum += (l - mean) * (l - mean);
    }
    detail += Math.sqrt(varSum / (width * height));

    // Nearest in-frame splat centre.
    const [cx, cy, cz] = ring[vi];
    const W = view.W;
    const halfH = Math.tan((CAMERA.fovDeg * Math.PI) / 360);
    const halfW = (halfH * width) / height;
    for (let i = 0; i < splats.count; i += 7) {
      if (splats.alpha[i] < 0.02) continue;
      const i3 = i * 3;
      const dx = splats.world[i3] - cx;
      const dy = splats.world[i3 + 1] - cy;
      const dz = splats.world[i3 + 2] - cz;
      const vz = W[2][0] * dx + W[2][1] * dy + W[2][2] * dz;
      if (vz <= 0.05 || vz >= nearest) continue;
      const vx = W[0][0] * dx + W[0][1] * dy + W[0][2] * dz;
      const vy = W[1][0] * dx + W[1][1] * dy + W[1][2] * dz;
      if (Math.abs(vx) > halfW * vz || Math.abs(vy) > halfH * vz) continue;
      nearest = vz;
    }

    if (wantPng && vi < 2) {
      const tag = cand.name.replace(/[^a-z0-9]+/gi, '-');
      writePng(`tools/shots/place-${tag}-v${vi}.png`, img.rgb, width, height);
    }
  }

  rows.push({
    placement: cand.name,
    scale: cand.scale,
    posY: cand.position[1],
    nearestSplat: nearest === Infinity ? '-' : nearest.toFixed(1),
    coverage: (coverage / ring.length).toFixed(3),
    detail: (detail / ring.length).toFixed(4),
    fragPerFrame: Math.round(fragments / ring.length),
  });
  console.log('done:', cand.name);
}

console.log('\n--- placement scan (board half-width is 4.3; nearestSplat below ~15 means the capture is in the play space) ---');
console.table(rows);
