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
const SPARK_MIN_ALPHA = 0.02;
const SPARK_MIN_PIXEL_RADIUS = 1.0;
const SPARK_MAX_STD_DEV = Math.sqrt(5);

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
 * A plain fixed-stride pick (every Nth splat) rather than a random or
 * quality-ranked one: it's a single linear pass, doesn't need a second
 * allocation to sort by size/opacity first, and thins a dense point cloud
 * roughly evenly in every region rather than biasing toward wherever the
 * data happens to be ordered by scan order. For a background element seen
 * out of focus behind fog/haze — the same reasoning that already justified
 * SparkRenderer's minAlpha/minPixelRadius/maxStdDev cuts above — a uniformly
 * thinned cloud reads as softer/hazier, not as missing detail; the user
 * asked for exactly this trade ("trochu rozmyty" — a bit soft/blurred is an
 * acceptable price for real performance headroom).
 *
 * 0.35 is a starting point, not a measured optimum — this environment can't
 * produce a real before/after fps number (see CLAUDE.md's "Headless
 * browser"). `?spkeep=` overrides it live for tuning against a real device
 * without a rebuild.
 */
const SPLAT_KEEP_FRACTION = 0.35;
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

export default function SplatBackdrop({ url = SPLAT_URL, defaults = FALLBACK_DEFAULTS, onReady }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const [mesh, setMesh] = useState(null);
  const tuning = useMemo(() => readSplatTuning(defaults), [defaults]);
  const sparkRendererRef = useRef(null);

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
      renderer.maxStdDev = SPARK_MAX_STD_DEV;
    }

    const distance = camera.position.length();
    const cosPolar = camera.position.y / distance;
    mesh.visible = !(distance < HIDE_DISTANCE && cosPolar > Math.cos(HIDE_MAX_POLAR_ANGLE));
  });

  if (!mesh) return null;
  return <primitive object={mesh} />;
}
