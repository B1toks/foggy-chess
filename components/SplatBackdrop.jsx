import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

/**
 * A Gaussian-splat capture, rendered as the actual world behind the board
 * rather than a painting of one. Theme-agnostic as of Крок 16, Section B —
 * every call site (Backdrop.jsx) passes its own `url` and `defaults`
 * (THEMES[key].backdrop.splat, see lib/themes.js) instead of this file
 * hardcoding one capture's placement.
 *
 * This is mounted *in addition to* whatever procedural/painted backdrop is
 * already under it, never instead of it: a splat capture is tens of MB and
 * may load slowly or fail outright. Until it arrives, the scene still has a
 * backdrop. That is the fallback, and it is why this component never throws
 * upward.
 *
 * Load state is mirrored onto `window.__splat` so a headless run can tell
 * "still downloading" apart from "failed".
 */

// Крок 13: kept for backward compatibility — Mist's own capture, used if a
// caller doesn't pass `url` explicitly. Backdrop.jsx always does now.
export const SPLAT_URL = '/sumi-e-mountain-valley-6472fa791839e183.spz';

// Fallback placement if a caller doesn't pass `defaults` (Mist's own, tuned
// live against that specific capture — see git history). Every field is also
// overridable from the URL so any theme's placement can be dialled in
// against a live frame instead of guessed — see readSplatTuning.
const FALLBACK_DEFAULTS = { scale: 12, rotation: [180, 0, 0], position: [0, 0, 0], opacity: 1 };

export function readSplatTuning(defaults = FALLBACK_DEFAULTS) {
  const [rotX, rotY, rotZ] = defaults.rotation ?? FALLBACK_DEFAULTS.rotation;
  const [posX, posY, posZ] = defaults.position ?? FALLBACK_DEFAULTS.position;
  const out = {
    scale: defaults.scale ?? FALLBACK_DEFAULTS.scale,
    rotX,
    rotY,
    rotZ,
    posX,
    posY,
    posZ,
    opacity: defaults.opacity ?? FALLBACK_DEFAULTS.opacity,
  };
  if (typeof window === 'undefined') return out;
  const q = new URLSearchParams(window.location.search);
  for (const key of Object.keys(out)) {
    const raw = q.get(`sp${key}`);
    if (raw !== null && raw !== '' && Number.isFinite(Number(raw))) out[key] = Number(raw);
  }
  return out;
}

/*
 * Крок 16, Section B: performance.
 *
 * A backdrop splat is seen out-of-focus, behind fog/haze, mostly at the edges
 * of the frame — it does not need the same per-splat fidelity a foreground
 * capture would. SparkRenderer (the shared renderer Spark auto-attaches to
 * the scene the first time any SplatMesh renders — see its own
 * createRendererDetectionMesh — one instance total, not one per SplatMesh)
 * exposes three real, documented cost levers:
 *
 *   - minAlpha: splats below this opacity are skipped entirely, before
 *     sorting or rasterising. Default ~0.002 (0.5/255); raised here to 0.02,
 *     which drops only near-invisible splats a backdrop was never going to
 *     read as detail anyway.
 *   - minPixelRadius: splats that would rasterise smaller than this are
 *     skipped. Default 0; raised to 1.0 so sub-pixel motes (the majority of
 *     a 1.9M-point cloud at backdrop distance) are never sorted or drawn.
 *   - maxStdDev: how many standard deviations of each Gaussian's falloff get
 *     rendered. Default sqrt(8) (~2.83); the library's own docs call out
 *     sqrt(5) (~2.24) as a documented, visually-safe lower value to trade for
 *     performance — smaller footprint per splat, less overdraw.
 *
 * These are set on the shared renderer once it exists (it doesn't yet on the
 * frame a SplatMesh first mounts — the detection-mesh trick above only
 * attaches it once something has actually tried to render), and are cheap to
 * set redundantly every frame until found, so no separate "found it" ref is
 * needed to avoid re-applying — assignment is idempotent.
 */
/*
 * Крок 21 measured all three of these instead of reasoning about them, using
 * tools/spark-levers.mjs (a CPU rasterisation of the same capture that models
 * each lever — see tools/splat-raster.mjs for why a CPU render is the only way
 * to get a quality number in this environment). Measured on the shipped
 * importance-pruned asset, against the same cloud drawn with every lever off:
 *
 *   setting                 PSNR      drawn    fragments
 *   all off (truth)         -         100.0%   100.0%
 *   minAlpha 0.02           Inf       100.0%   100.0%   <- inert
 *   minPixelRadius 1.0      Inf       100.0%   100.0%   <- inert
 *   maxStdDev sqrt(5)       37.8 dB    99.9%    69.5%
 *   maxStdDev sqrt(3)       28.5 dB    99.8%    47.5%
 *   maxStdDev sqrt(2)       23.9 dB    99.7%    35.8%
 *
 * Two things that changes about the previous understanding:
 *
 * 1. minAlpha and minPixelRadius are now COMPLETELY INERT — they cull nothing,
 *    because tools/shrink-spz.mjs already drops sub-minAlpha splats offline and
 *    its importance ranking already drops the sub-pixel ones. They cost nothing
 *    and are kept only as a guard for an unpruned capture (they culled 9.3% and
 *    94.8% of the RAW file respectively). They are no longer the perf story
 *    they were written up as in Крок 16 Section B.
 *
 * 2. maxStdDev is the only lever that does anything, and what it moves is
 *    fragment/overdraw cost, not splat count — which is exactly the cost that
 *    dominates here. A splat backdrop at close range stacks hundreds of
 *    Gaussians along every view ray (tools/place-splat.mjs measures ~880
 *    fragment evaluations per pixel at ocean's shipped placement), so
 *    rasterisation, not sorting, is what pins a GPU.
 *
 * Крок 21 lowered this to sqrt(3): 32% less fragment work for 1.6 dB, on a
 * backdrop that sits behind fog and haze at the edge of frame.
 *
 * Крок 24 puts it back to sqrt(5), the value the table above measures at
 * 37.8 dB. Two reasons the Крок 21 trade no longer applies as written:
 *
 *   - Its premise was ocean's shipped placement and its ~880 fragment
 *     evaluations per pixel. That placement is the "camera inside the cloud"
 *     one, and it is gone (see lib/themes.js's ocean.backdrop). At the derived
 *     placement the whole frame costs ~3.0M fragments, comparable to mist's
 *     2.7M — there is no longer a fragment budget crisis to buy 1.6 dB out of.
 *   - sqrt(5) is the setting the splat-lab A/B judged this exact capture on,
 *     and the one tools/splat-raster.mjs's own SPARK_DEFAULTS model, so the
 *     offline numbers throughout this project now describe what actually ships.
 *
 * `?spstddev=` still overrides it, so the trade can be re-judged on a real GPU
 * without a rebuild — sqrt(3) is the first lever to pull back if fps demands it.
 */
const SPARK_MIN_ALPHA = 0.02;
const SPARK_MIN_PIXEL_RADIUS = 1.0;
const SPARK_MAX_STD_DEV_DEFAULT = Math.sqrt(5);

function maxStdDevFromUrl() {
  if (typeof window === 'undefined') return SPARK_MAX_STD_DEV_DEFAULT;
  const raw = new URLSearchParams(window.location.search).get('spstddev');
  const n = raw !== null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : SPARK_MAX_STD_DEV_DEFAULT;
}

/*
 * Крок 17: the SparkRenderer levers above are per-frame rasterisation/sort
 * cost cuts — they do nothing about the fixed VRAM cost of having 1.9M
 * splats resident on the GPU at all, which is what a real device report (90%
 * VRAM used, 20fps) pointed at as the actual ceiling. There is no supported
 * "load at lower fidelity" option in this version of Spark — SplatMesh's own
 * `maxSplats` is a preallocation hint that grows to fit the file, it does not
 * downsample one (already checked and documented in CLAUDE.md's Крок 16
 * Section B). What IS available, and public/documented on PackedSplats
 * (dist/types/PackedSplats.d.ts): `packedArray`, `numSplats`, and
 * `needsUpdate` are all writable, and `ensureSplats(n)` allocates a properly
 * texture-size-aligned buffer for `n` splats — so a `constructSplats` hook
 * (SplatMeshOptions, called by Spark AFTER the full file has loaded into a
 * PackedSplats, confirmed by reading spark.module.js's own asyncInitialize)
 * can rewrite the loaded data down to a strided subset before it ever gets
 * uploaded to a GPU texture. The full file still has to be downloaded and
 * decoded — Spark loads via `url` before calling this hook, there is no way
 * around that without a second, pre-shrunk .spz asset — but the number that
 * actually sits in VRAM and gets sorted/rasterised every frame drops in
 * direct proportion to the fraction kept.
 *
 * Крок 21: THIS IS NOW OFF BY DEFAULT (keep fraction 1.0), and turning it back
 * on for a normal asset would actively undo the work.
 *
 * The fixed-stride pick below was the wrong policy and the measurement says so
 * plainly. Rendering the full cloud on the CPU as ground truth
 * (tools/splat-compare.mjs) and comparing reduced versions at an IDENTICAL
 * splat count of 100,800:
 *
 *   stride (what shipped)                      12.9 dB PSNR, luma error 37.5/255
 *   importance-ranked (tools/shrink-spz.mjs)   29.6 dB PSNR, luma error  4.0/255
 *
 * The reason is not subtle: a stride treats a splat covering 400 pixels and one
 * covering a quarter pixel as equally worth keeping, and a 3DGS surface is
 * opaque only because many Gaussians overlap — so thinning uniformly does not
 * soften the capture, it makes it TRANSPARENT and speckled. The top 15% of
 * splats by contribution carry 92.7% of the rendered image; a 15% stride keeps
 * 15% of it.
 *
 * The asset in public/ is now pre-reduced offline by importance, so every splat
 * that arrives is one that was chosen. Applying a stride on top of that would
 * discard the selected splats at the same rate as any others and put the
 * speckle straight back — the two policies do not compose.
 *
 * Kept wired, at 1.0, purely as an emergency runtime lever: `?spkeep=0.5` still
 * works for judging on a real device whether a given capture needs to come down
 * further, and the honest fix for that is a smaller --count when regenerating
 * the asset, not this.
 */
const SPLAT_KEEP_FRACTION = 1.0;
const WORDS_PER_SPLAT = 4;

function keepFractionFromUrl() {
  if (typeof window === 'undefined') return SPLAT_KEEP_FRACTION;
  const raw = new URLSearchParams(window.location.search).get('spkeep');
  const n = raw !== null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : SPLAT_KEEP_FRACTION;
}

function downsampleSplats(packed, keepFraction) {
  const total = packed.numSplats;
  const keepCount = Math.max(1, Math.min(total, Math.floor(total * keepFraction)));
  if (keepCount >= total) return;

  const source = packed.packedArray;
  const picked = new Uint32Array(keepCount * WORDS_PER_SPLAT);
  const stride = total / keepCount;
  for (let i = 0; i < keepCount; i++) {
    const srcIndex = Math.min(total - 1, Math.floor(i * stride));
    picked.set(
      source.subarray(srcIndex * WORDS_PER_SPLAT, srcIndex * WORDS_PER_SPLAT + WORDS_PER_SPLAT),
      i * WORDS_PER_SPLAT,
    );
  }

  // Reset before ensureSplats so it allocates fresh at the smaller (but
  // texture-size-aligned) capacity instead of reusing the larger original
  // buffer — packedArray would otherwise stay oversized and numSplats alone
  // would not shrink the uploaded texture.
  packed.packedArray = null;
  packed.maxSplats = 0;
  packed.ensureSplats(keepCount);
  packed.packedArray.set(picked);
  packed.numSplats = keepCount;
  packed.needsUpdate = true;
}

/*
 * Крок 16, Section B: skip rendering the backdrop splat entirely once the
 * board fills most of the frame — hiding the mesh (rather than just leaving
 * it transparent) drops it from the main draw call, not just from what's
 * visible. `mesh.visible = false` is checked BEFORE r3f's own render, so
 * Spark's per-frame sort/update for an invisible mesh is skipped too (Spark
 * gates its own per-mesh update on the object's visibility, the same
 * convention every three.js render pass follows).
 *
 * The frame-fraction test is "close AND steep/overhead", not "close alone":
 * polar angle is measured from straight up (three.js/OrbitControls
 * convention — small = overhead, large = level with the horizon, see
 * GameCanvas.jsx's own comment on MIN/MAX_POLAR_ANGLE). A close, STEEP view
 * (small polar angle, looking down at the board) is mostly board and has
 * little sky in frame; a close but SHALLOW/level view still looks straight
 * across the horizon at the backdrop even zoomed in, so that case is
 * deliberately excluded. Thresholds sit inside this project's own camera
 * clamps (MIN_DISTANCE 8, MIN_POLAR_ANGLE 0.38 rad) so the hide only
 * engages in the steepest, closest third or so of the reachable range.
 */
const HIDE_DISTANCE = 9.5;
const HIDE_MAX_POLAR_ANGLE = 0.65;

/*
 * Krok 25: the hide heuristic above is specifically about a DISTANT
 * backdrop -- "the board fills the frame, so the far sky contributes
 * little, skip it." An enclosing placement (reached via ?spforce=1, see
 * Backdrop.jsx) inverts that premise: the capture IS the nearby
 * surroundings, and MIN_DISTANCE/MIN_POLAR_ANGLE sit well inside this hide
 * zone, so ordinary orbiting crossed the boundary constantly and the mesh
 * toggled visible/invisible every frame -- reported as "hides and flickers
 * constantly." Forced splats skip this check entirely rather than needing
 * their own re-tuned thresholds: a caller that explicitly forced the splat
 * on outside its theme's own mode has already opted out of "this is being
 * used as a theme's default backdrop," which is the only case this
 * heuristic is for.
 */
function splatForceFromUrl() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('spforce') === '1';
}

/*
 * `?spurl=` swaps the capture itself, the same read-once-from-the-URL
 * convention every other `?sp*=` knob here uses. It exists so an alternative
 * asset can be A/B'd against the shipped one on real hardware without a
 * rebuild or a committed default — the one measurement this environment
 * genuinely cannot make (see CLAUDE.md's "Headless browser").
 *
 * Restricted to same-origin absolute paths on purpose: this value goes
 * straight into a fetch, and there is no reason a tuning knob should be able
 * to point the loader at another host.
 */
function splatUrlOverride() {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('spurl');
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

export default function SplatBackdrop({ url = SPLAT_URL, defaults = FALLBACK_DEFAULTS, onReady }) {
  const urlOverrideRef = useRef(undefined);
  if (urlOverrideRef.current === undefined) urlOverrideRef.current = splatUrlOverride();
  url = urlOverrideRef.current ?? url;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const [mesh, setMesh] = useState(null);
  const tuning = useMemo(() => readSplatTuning(defaults), [defaults]);
  const sparkRendererRef = useRef(null);
  const maxStdDevRef = useRef(null);
  if (maxStdDevRef.current === null) maxStdDevRef.current = maxStdDevFromUrl();
  const forceRef = useRef(undefined);
  if (forceRef.current === undefined) forceRef.current = splatForceFromUrl();

  useEffect(() => {
    let cancelled = false;
    let created = null;

    if (typeof window !== 'undefined') {
      window.__splat = { state: 'loading', error: null };
    }

    try {
      created = new SplatMesh({
        url,
        constructSplats: (packed) => downsampleSplats(packed, keepFractionFromUrl()),
      });
    } catch (error) {
      // Spark is built against a newer three than this project pins; if the
      // constructor cannot run at all, the fallback backdrop simply stays.
      window.__splat = { state: 'error', error: String(error?.message ?? error) };
      console.warn('[splat] could not construct SplatMesh:', error);
      return undefined;
    }

    // Spark exposes a promise that settles once the file is fetched and the
    // splats are uploaded. Older builds call it `initialized`.
    const ready = created.initialized ?? Promise.resolve();
    Promise.resolve(ready)
      .then(() => {
        if (cancelled) return;
        window.__splat = { state: 'ready', error: null, count: created.numSplats ?? null };
        onReady?.();
      })
      .catch((error) => {
        if (cancelled) return;
        window.__splat = { state: 'error', error: String(error?.message ?? error) };
        console.warn('[splat] failed to load:', error);
      });

    if (!cancelled) setMesh(created);

    return () => {
      cancelled = true;
      created?.dispose?.();
    };
  }, [gl, url, onReady]);

  useEffect(() => {
    if (!mesh) return;
    mesh.scale.setScalar(tuning.scale);
    mesh.rotation.set(
      THREE.MathUtils.degToRad(tuning.rotX),
      THREE.MathUtils.degToRad(tuning.rotY),
      THREE.MathUtils.degToRad(tuning.rotZ),
    );
    mesh.position.set(tuning.posX, tuning.posY, tuning.posZ);
    mesh.opacity = tuning.opacity;
    // Scene fog does not apply to splats, and a capture that reaches the board
    // would otherwise sit in front of the pieces.
    mesh.renderOrder = -2;
  }, [mesh, tuning]);

  useFrame(() => {
    if (!mesh) return;

    if (!sparkRendererRef.current) {
      let found = null;
      scene.traverse((obj) => {
        if (!found && obj instanceof SparkRenderer) found = obj;
      });
      sparkRendererRef.current = found;
    }
    const renderer = sparkRendererRef.current;
    if (renderer) {
      renderer.minAlpha = SPARK_MIN_ALPHA;
      renderer.minPixelRadius = SPARK_MIN_PIXEL_RADIUS;
      renderer.maxStdDev = maxStdDevRef.current;
    }

    if (forceRef.current) {
      mesh.visible = true;
    } else {
      const distance = camera.position.length();
      const cosPolar = camera.position.y / distance;
      mesh.visible = !(distance < HIDE_DISTANCE && cosPolar > Math.cos(HIDE_MAX_POLAR_ANGLE));
    }
  });

  if (!mesh) return null;
  return <primitive object={mesh} />;
}
