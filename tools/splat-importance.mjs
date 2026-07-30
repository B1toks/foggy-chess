/*
 * Per-splat significance, computed against the camera positions this project
 * can actually reach.
 *
 * LightGaussian (arxiv 2311.17245) scores a Gaussian by
 *   sum over training rays of [ ray hits it ] * opacity * normalized volume,
 * i.e. "how much of the rendered image does this Gaussian actually account
 * for". The hit-count term is why it works and why a plain opacity threshold
 * doesn't: a wide, faint splat covering a thousand pixels matters more than a
 * tiny opaque one covering four.
 *
 * We have something a training-view pipeline doesn't: the exact set of camera
 * placements this scene permits. OrbitControls is clamped to distance 8..14,
 * polar 0.38..1.25 rad, azimuth unclamped (GameCanvas.jsx), always targeting
 * the origin, fov 42. So instead of approximating hit count from a handful of
 * captured views, the projected screen area is computed analytically over a
 * ring of placements spanning that whole reachable range:
 *
 *   contribution(splat, view) = opacity * PI * (projected radius in px)^2
 *   score(splat)              = mean over views, 0 for views that cull it
 *
 * That is the same quantity LightGaussian estimates, evaluated exactly rather
 * than sampled, for the only viewpoints that will ever exist here.
 *
 * The projected radius uses the geometric mean of the two LARGEST axes of the
 * Gaussian. 3DGS fits surfaces with flattened, disc-like Gaussians, so the two
 * large axes are the disc and the third is its thickness; a viewer near
 * face-on sees the disc. This over-estimates edge-on splats, which is the safe
 * direction for a pruner (it keeps them).
 */
import { decodeCenters, decodeAlpha, decodeScales } from './spz-io.mjs';

/** GameCanvas.jsx's own OrbitControls clamps and camera fov. */
export const CAMERA = {
  minDistance: 8,
  maxDistance: 14,
  minPolarAngle: 0.38,
  maxPolarAngle: 1.25,
  fovDeg: 42,
  // A 1280x800 frame; only the ratio between focal length and this height
  // matters, and the score is used as a ranking, so the exact frame size only
  // sets the units the reported pixel radii are in.
  frameWidth: 1280,
  frameHeight: 800,
};

/**
 * Splat placements as they ship in lib/themes.js (backdrop.splat). Keep these
 * in step with that file — `--theme=` weighting is placement-locked, so a stale
 * entry here silently scores a transform nothing renders.
 *
 * Крок 24: ocean's entry is no longer the broken scale-12-at-the-origin one
 * this comment used to warn about; it is the derived placement that ships, and
 * ocean is the only theme currently on `mode: 'splat'`.
 */
export const THEME_PLACEMENTS = {
  mist: { scale: 0.42, rotation: [0, -196.6, 0], position: [-22.8, -38.7, 55.5] },
  ocean: { scale: 1.847, rotation: [0, 135, 0], position: [-17.33, -45.17, 53.25] },
  snow: { scale: 1.2, rotation: [-90, 0, 0], position: [-20.7, -21.3, 62.4] },
};

/**
 * A ring of camera placements covering the reachable orbit. Coarse on purpose
 * — this produces a ranking, not a physical measurement, and the cost is
 * numSplats * views.
 */
export function cameraRing({ azimuths = 6, polars = 3, distances = 2 } = {}) {
  const views = [];
  for (let di = 0; di < distances; di++) {
    const d =
      distances === 1
        ? (CAMERA.minDistance + CAMERA.maxDistance) / 2
        : CAMERA.minDistance +
          ((CAMERA.maxDistance - CAMERA.minDistance) * di) / (distances - 1);
    for (let pi = 0; pi < polars; pi++) {
      const phi =
        polars === 1
          ? (CAMERA.minPolarAngle + CAMERA.maxPolarAngle) / 2
          : CAMERA.minPolarAngle +
            ((CAMERA.maxPolarAngle - CAMERA.minPolarAngle) * pi) / (polars - 1);
      for (let ai = 0; ai < azimuths; ai++) {
        const theta = (2 * Math.PI * ai) / azimuths;
        views.push({
          position: [
            d * Math.sin(phi) * Math.sin(theta),
            d * Math.cos(phi),
            d * Math.sin(phi) * Math.cos(theta),
          ],
          target: [0, 0, 0],
        });
      }
    }
  }
  return views;
}

/** three.js Matrix4.makeRotationFromEuler, 'XYZ' order, as a 3x3 row-major array. */
export function eulerXyzMatrix([xDeg, yDeg, zDeg]) {
  const x = (xDeg * Math.PI) / 180;
  const y = (yDeg * Math.PI) / 180;
  const z = (zDeg * Math.PI) / 180;
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;
  return [
    [c * e, -c * f, d],
    [af + be * d, ae - bf * d, -b * c],
    [bf - ae * d, be + af * d, a * c],
  ];
}

/**
 * Capture-local centers -> world positions, and local std devs -> world radii.
 * mesh.scale is a uniform scalar (SplatBackdrop.jsx uses setScalar), so a
 * single multiplier covers the radius too.
 */
export function toWorld(spz, placement) {
  const centers = decodeCenters(spz);
  const scales = decodeScales(spz);
  const n = spz.numSplats;
  const R = eulerXyzMatrix(placement.rotation ?? [0, 0, 0]);
  const s = placement.scale ?? 1;
  const [ox, oy, oz] = placement.position ?? [0, 0, 0];

  const world = new Float32Array(n * 3);
  const radius = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    const lx = centers[i3];
    const ly = centers[i3 + 1];
    const lz = centers[i3 + 2];
    world[i3] = s * (R[0][0] * lx + R[0][1] * ly + R[0][2] * lz) + ox;
    world[i3 + 1] = s * (R[1][0] * lx + R[1][1] * ly + R[1][2] * lz) + oy;
    world[i3 + 2] = s * (R[2][0] * lx + R[2][1] * ly + R[2][2] * lz) + oz;

    // Geometric mean of the two largest axes — see this file's header.
    let a = scales[i3];
    let b = scales[i3 + 1];
    let c = scales[i3 + 2];
    if (a < b) { const t = a; a = b; b = t; }
    if (b < c) { const t = b; b = c; c = t; }
    if (a < b) { const t = a; a = b; b = t; }
    radius[i] = s * Math.sqrt(a * b);
  }
  return { world, radius };
}

/**
 * score[i]      mean opacity-weighted projected pixel area over the view ring
 * projectedArea[i]  mean projected radius in px (diagnostic, not the score)
 * visibleCount  how many splats land in frustum for at least one view
 */
export function importanceScores(spz, placement, views = cameraRing()) {
  const n = spz.numSplats;
  const alpha = decodeAlpha(spz);
  const { world, radius } = toWorld(spz, placement);

  const halfH = Math.tan((CAMERA.fovDeg * Math.PI) / 360);
  const focalPx = CAMERA.frameHeight / 2 / halfH;
  const aspect = CAMERA.frameWidth / CAMERA.frameHeight;
  const halfW = halfH * aspect;

  const score = new Float64Array(n);
  const radiusPx = new Float64Array(n);
  const seen = new Uint8Array(n);

  for (const view of views) {
    const [cx, cy, cz] = view.position;
    // Camera basis: forward = target - position, up = +Y (OrbitControls).
    let fx = view.target[0] - cx;
    let fy = view.target[1] - cy;
    let fz = view.target[2] - cz;
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl; fy /= fl; fz /= fl;
    // right = normalize(cross(forward, worldUp)), worldUp = (0,1,0)
    let rx = -fz;
    let ry = 0;
    let rz = fx;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    // up = cross(right, forward)
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;

    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const dx = world[i3] - cx;
      const dy = world[i3 + 1] - cy;
      const dz = world[i3 + 2] - cz;

      const depth = dx * fx + dy * fy + dz * fz;
      if (depth <= 0.05) continue; // behind the camera

      const r = radius[i];
      const px = dx * rx + dy * ry + dz * rz;
      const py = dx * ux + dy * uy + dz * uz;
      // Frustum test with the splat's own extent allowed to poke in.
      const limX = halfW * depth + r;
      const limY = halfH * depth + r;
      if (px < -limX || px > limX || py < -limY || py > limY) continue;

      const rp = (focalPx * r) / depth;
      seen[i] = 1;
      radiusPx[i] += rp;
      score[i] += alpha[i] * Math.PI * rp * rp;
    }
  }

  const inv = 1 / views.length;
  let visibleCount = 0;
  for (let i = 0; i < n; i++) {
    score[i] *= inv;
    radiusPx[i] *= inv;
    if (seen[i]) visibleCount++;
  }
  return { score, projectedArea: radiusPx, visibleCount, world, radius, alpha };
}
