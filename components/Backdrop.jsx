import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import Mountains from './Mountains';
import SkyDome, { DOME_HORIZON_COLOR } from './SkyDome';
import { getBackdropEdgeAlphaMap } from './proceduralTextures';
import { basePositionFor } from './CameraRig';
import { THEMES, DEFAULT_THEME, themeKeyFromUrl } from '../lib/themes';

// Крок 19: was a frozen ACTIVE_THEME_KEY/ACTIVE_THEME read once at module
// load — see git history. Live mid-game theme switching means every value
// below that used to close over those frozen constants is now derived from
// a `themeKey` prop instead (see deriveBackdropConfig), recomputed whenever
// it changes. INITIAL_THEME_KEY only supplies Backdrop's default prop value.
const INITIAL_THEME_KEY = themeKeyFromUrl();

/*
 * Lazy, not a static import. @sparkjsdev/spark is 482 KB in the client bundle —
 * more than any of the current painted panoramas — and no theme currently
 * sets `backdrop.mode: 'splat'` (see deriveBackdropConfig's usesThemeSplat
 * below). A static import
 * ships all of it to every player for a disabled feature; a dynamic one makes
 * webpack emit it as an async chunk that is only ever fetched if something
 * actually renders it.
 */
const SplatBackdrop = lazy(() => import('./SplatBackdrop'));

/*
 * Крок 17: a backdrop splat is a 1.9M-splat point cloud sorted every frame in
 * WASM plus a heavy fragment cost — the exact kind of workload mobile GPUs
 * and their thinner memory/bandwidth budgets are worst at, and this
 * environment has no way to measure that directly (see CLAUDE.md's "Headless
 * browser" section — a single splat frame costs 100+ seconds here regardless
 * of viewport size, so it cannot stand in for a real device). Rather than
 * ship an unverified guess at "will this hit 60fps on a phone", narrow-
 * viewport/coarse-pointer devices skip the splat entirely and always get
 * whatever fast fallback is already mounted underneath (the painted cylinder
 * for Mist, the procedural Mountains shells for Ocean/Snow) — both already
 * proven cheap (~160K triangles total scene, see "Asset budget" in
 * CLAUDE.md). Same matchMedia check as GameCanvas.jsx's isLowPowerDevice/
 * FogShader.jsx's marchStepsForDevice/Lighting.jsx's own copy; duplicated
 * locally per this codebase's established convention rather than shared.
 */
function isLowPowerDevice() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
}

/**
 * 'procedural' — the canvas-generated ridge shells in Mountains.jsx.
 * 'image'      — a panoramic sumi-e painting wrapped behind the scene.
 * 'splat'      — a Gaussian-splat capture of the valley, with 'image'
 *                underneath it as the instant-loading floor.
 *
 * Крок 13 originally scoped painting to Mist alone — ocean/snow had no
 * painted panorama of their own, so they always fell back to the procedural
 * Mountains shells regardless of their own `backdrop.mode`. Крок 18 gives
 * every theme its own Mint-generated panorama (`lib/themes.js`'s
 * `backdrop.image`, matching Mist's sumi-e style), so painting is now
 * theme-generic: any theme with an `image` set uses it, the same way any
 * theme with `mode: 'splat'` layers its own splat on top (see
 * deriveBackdropConfig's `usesThemeSplat`). A theme with no `image` still
 * falls back to Mountains, so that rollback path stays live even though
 * nothing currently exercises it.
 */
// Крок 17: computed once at module load (this file is only ever imported
// client-side) — a phone/coarse-pointer device never mounts a backdrop
// splat for any theme, full stop. A device doesn't change tier mid-session,
// so unlike the theme-derived values below this one is fine to stay frozen.
const IS_LOW_POWER = isLowPowerDevice();

/*
 * Крок 25: `?spforce=1` mounts a theme's splat regardless of its own
 * `backdrop.mode` — the missing piece for keeping a splat placement reachable
 * as a bookmarkable test link after its theme reverts to `mode: 'image'`.
 * Without this, every other `?sp*=` knob (`spurl`, `spscale`, `spstddev`, …)
 * is inert whenever `mode !== 'splat'`, because `usesThemeSplat` below never
 * mounts `SplatBackdrop` in the first place for those knobs to reach — a
 * URL that worked while Крок 24 shipped `mode: 'splat'` would silently stop
 * doing anything the moment the default reverted, which defeats the point of
 * a saved link. Same read-once-at-module-load convention as `IS_LOW_POWER`
 * right above it. Still gated by `IS_LOW_POWER` — a forced splat is still an
 * explicit, deliberate test, not a reason to skip the mobile/coarse-pointer
 * safety net.
 */
function splatForceFromUrl() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('spforce') === '1';
}
const SPLAT_FORCE = splatForceFromUrl();

/*
 * Крок 19: the single source every render-time value in this file used to
 * read from a frozen ACTIVE_THEME. Called from within the component and
 * memoized on `themeKey`, so a live switch recomputes exactly this and
 * nothing else needs its own parallel derivation.
 */
function deriveBackdropConfig(themeKey) {
  const theme = THEMES[themeKey] ?? THEMES[DEFAULT_THEME];
  const usesPainting = Boolean(theme.backdrop.image) && theme.backdrop.mode !== 'procedural';
  const usesThemeSplat = (theme.backdrop.mode === 'splat' || SPLAT_FORCE) && !IS_LOW_POWER;
  return { theme, usesPainting, usesThemeSplat };
}

/*
 * The painting is a single 2560x1429 frame, NOT a seamless 360 panorama, so it
 * is mapped onto a cylinder *segment* and the camera's azimuth is clamped to a
 * sector where the open ends stay off screen. A narrow sector with a good frame
 * beats a full orbit with a visible seam.
 *
 * Geometry is derived, not eyeballed — same method as Mountains.jsx. With the
 * camera at [3.5, 7, -8.5] (fov 42) looking at the origin, the view direction
 * is pitched 37.3 degrees down, so the top of the frame is already 16.3 degrees
 * *below* horizontal and the board's far edge sits at -28.3 degrees. The whole
 * background is that ~12-degree band in between. Placing the painting's skyline
 * at -19 degrees puts it inside that band with a strip of sky above it.
 *
 * At radius R the eye-to-wall distance is ~R + 9.2, so:
 *   y_skyline = 7 - (R + 9.2) * tan(19deg)
 * and the skyline sits 20% down the image (measured off the luminance profile:
 * rows 0-10% are flat sky at ~227, the far ridges break in around 20%), so
 *   TOP_Y = y_skyline + 0.20 * HEIGHT
 *
 * Крок 18: no longer one hardcoded aspect ratio. Each theme now brings its
 * own image at its own native size (Mist 2560x1429, Ocean 1584x672, Snow
 * 1376x768 — Mint doesn't guarantee a common aspect across separate
 * generations), so ImageBackdropSegment derives it from the loaded
 * texture's own `image.width`/`image.height` instead of a module constant.
 */
// Exported for anything else that needs to reason about the segment's own
// radius without a second, driftable copy of the number (Крок 8/9's ground
// extension used to be that caller; it's gone as of Крок 9.6, Section C —
// see RockIsland.jsx).
export const RADIUS = 46;
/*
 * 200, not the ~150 that first framed well. The camera subtends up to ~50deg of
 * the wall on an ultrawide viewport (63deg of horizontal fov at 16:10, 85 at
 * 21:9, widened again by the eye sitting 9 units off centre), and the player
 * may swing 30 either side of home. 50 + 30 needs 80deg of half-arc; at 75 the
 * open end of the segment walked into frame at both swing limits.
 */
const ARC_DEG = 200;
// Height follows from the arc so the painting keeps its own proportions —
// the parts that fall outside the frame simply are not seen.
const SKYLINE_FRACTION = 0.2;
const SKYLINE_ELEVATION_DEG = 19;

// Home azimuth of the camera: atan2(x, z) for [3.5, _, -8.5]. OrbitControls
// measures azimuth the same way, and so does CylinderGeometry's theta.
export const HOME_AZIMUTH = Math.atan2(3.5, -8.5);
// How far the player may orbit either side of home before an open end of the
// segment would come into view. Half the arc minus the ~43-degree half-width
// the camera actually subtends on the wall, with a little margin.
export const AZIMUTH_SWING = THREE.MathUtils.degToRad(30);

/*
 * Крок 9.5, Section B: the painting only ever covered ~200 of 360 degrees
 * (see ARC_DEG above); the rest of a full orbit showed open SkyDome with
 * nothing painted in it. Azimuth has been unclamped since SkyDome shipped
 * (see "Camera and environment" in CLAUDE.md), so a full orbit was always
 * reachable — it just wasn't always dressed.
 *
 * BACKDROP_SEGMENTS is the fix: one entry per painted cylinder segment, each
 * independently placed by its own `azimuth` (segment centre) and `arcDeg`,
 * each fading into SkyDome at its own edges through the same edge-alpha
 * mechanism the original single segment already had (getBackdropEdgeAlphaMap
 * in proceduralTextures.js). Segments are ordinary alpha-blended transparent
 * meshes, so where two overlap it's just two fading edges compositing on top
 * of each other — not a seam to solve for, per the brief.
 *
 * Two segments today, both the *same* painting (the active theme's own
 * `backdrop.image`) — one at its natural azimuth, one rotated 180 degrees
 * and mirrored the other way — are the stand-in every theme uses while each
 * only has one Mint frame. It already fully closes the circle: each arc is
 * 200 degrees (+/-100 from its own centre), the two centres are 180 degrees
 * apart, so segment A's far edge (its centre +100) lands 20 degrees past
 * segment B's near edge (its centre -100) — every azimuth falls inside at
 * least one of the two, with two ~20-degree bands (near each pair of edges)
 * inside both. Heavy fog and the edge fades on both sides make the repeated,
 * mirrored painting hard to spot in practice.
 *
 * The real fix is generating two more Mint frames of the same valley per
 * theme and moving ARC_DEG-per-segment toward the brief's ~140 degrees each
 * with the same overlap logic — nothing about this array's *shape* needs to
 * change for that, only its contents (see the TODO comment on the second
 * entry below).
 *
 * Крок 19: this is a function now, not a frozen array — `src` depends on
 * which theme is active, and that's live now instead of fixed at module
 * load. Called from inside Backdrop() and memoized on `themeKey`.
 */
function backdropSegmentsFor(image) {
  return [
    {
      id: 'valley-main',
      src: image,
      // The direction the camera looks at rest (see ImageBackdropSegment's
      // old `center` derivation, now per-segment) — unchanged from before
      // this section existed, so the default view is pixel-identical to
      // Крок 8.
      azimuth: HOME_AZIMUTH - Math.PI,
      arcDeg: ARC_DEG,
      flip: true,
    },
    {
      // TODO(when a second Mint frame exists per theme): replace `src` with
      // it, and retune `azimuth`/`arcDeg` (and a third segment alongside it)
      // toward three ~140-degree arcs with overlap, per the brief. Until
      // then this is not a placeholder for any *specific* future segment —
      // just enough cover that a full orbit never shows open dome.
      id: 'valley-mirror-placeholder',
      src: image,
      azimuth: HOME_AZIMUTH,
      arcDeg: ARC_DEG,
      // Opposite of the main segment's flip: combined with the 180-degree
      // azimuth offset above, this is "rotated and mirrored" per the brief,
      // not just "the same frame pasted on the other side."
      flip: false,
    },
  ];
}

/*
 * Fog ranges are mode-dependent: the procedural shells live at r<=36 and are
 * built to be eaten by fog, the painting sits at r=46 and must survive it.
 * In image mode the range starts past the board (so pieces stay crisp) and
 * ends far enough out that only the lower, more distant part of the painting
 * dissolves — the top of the wall lands ~57 units from the eye, the bottom of
 * the visible band ~63, so [44, 96] fades that band from 0.28 to 0.41 and the
 * seam where the painting meets the plateau never reads as an edge.
 */
/*
 * Fog color is the dome's own horizon stop (DOME_HORIZON_COLOR), not a
 * separately-picked tone. The painting fades out (both from its own alphaMap
 * and from distance fog) into open dome behind it, and the specific elevation
 * band where that happens sits close to the dome's horizon stop (see
 * SkyDome.jsx) — matching the fog color to it exactly removes what would
 * otherwise be a visible tone seam right where the painting dissolves.
 */
// Крок 19: a function of `themeKey` now (every current theme uses painting,
// so this returns the same value for all three today, but a live switch to
// a hypothetical theme without its own image should still get the right
// range instead of an inherited, frozen one). GameCanvas.jsx calls this with
// its own live `themeKey` state each render — cheap, and correct either way.
export function backdropFogForTheme(themeKey) {
  const { usesPainting } = deriveBackdropConfig(themeKey);
  return usesPainting
    ? { color: DOME_HORIZON_COLOR, near: 44, far: 96 }
    : { color: DOME_HORIZON_COLOR, near: 26, far: 72 };
}

function readTuning() {
  if (typeof window === 'undefined') return {};
  const q = new URLSearchParams(window.location.search);
  const num = (k) => (q.has(k) ? Number(q.get(k)) : undefined);
  return {
    radius: num('bdr'),
    arcDeg: num('bda'),
    topY: num('bdt'),
    elevation: num('bde'),
    flip: q.has('bdflip') ? q.get('bdflip') !== '0' : undefined,
  };
}

/**
 * One painted cylinder segment. `segment` is one entry from
 * BACKDROP_SEGMENTS; `tuning` is the shared `?bdr=`/`?bda=`/etc URL overrides
 * (see readTuning below), applied on top of every segment alike so a single
 * URL can still sweep radius/arc/skyline across all of them at once.
 */
function ImageBackdropSegment({ segment, tuning }) {
  const rawTexture = useTexture(segment.src);
  /*
   * Every segment that shares a `src` (both do today — see BACKDROP_SEGMENTS)
   * gets back the *same* Texture instance from useTexture: r3f's loader cache
   * is keyed by URL, not by call site. Mutating .repeat/.offset on that
   * shared object per-segment would make each segment's flip setting stomp
   * the others' — whichever segment's effect ran last would win for all of
   * them. Cloning gives this segment its own wrapS/wrapT/repeat/offset while
   * still sharing the decoded image data (no second network fetch, no second
   * decode).
   */
  const texture = useMemo(() => rawTexture.clone(), [rawTexture]);
  // Крок 18: per-theme images no longer share one aspect ratio — read it off
  // the loaded texture itself (useTexture/useMemo above already guarantee
  // rawTexture.image is populated by the time this runs) instead of a
  // hardcoded module constant.
  const imageAspect = rawTexture.image.width / rawTexture.image.height;

  /*
   * The eye the framing is solved against is CameraRig's *resting* position for
   * this viewport, not the live camera — the live one moves as the player
   * orbits and zooms, and a backdrop re-deriving its height from that would
   * slide around under them.
   *
   * It has to track the viewport, though. CameraRig pulls the camera back up to
   * 1.6x on a phone, and solving against the hardcoded landscape eye left the
   * skyline ~2.3 units too low at 390x844 — the ridges washed out into the haze
   * near the top of the frame instead of reading as a horizon.
   */
  const size = useThree((s) => s.size);
  const [baseX, eyeY, baseZ] = basePositionFor(size.width / size.height);
  const eyeRadius = Math.hypot(baseX, baseZ);

  const geo = useMemo(() => {
    const radius = tuning.radius ?? RADIUS;
    const arc = THREE.MathUtils.degToRad(tuning.arcDeg ?? segment.arcDeg);
    const height = (radius * arc) / imageAspect;
    const elevation = THREE.MathUtils.degToRad(tuning.elevation ?? SKYLINE_ELEVATION_DEG);
    const skylineY = eyeY - (radius + eyeRadius) * Math.tan(elevation);
    const topY = tuning.topY ?? skylineY + SKYLINE_FRACTION * height;
    // thetaStart is the segment's leading edge, derived from its own centre
    // azimuth rather than always the camera's home direction — this is what
    // lets segments sit anywhere around the circle, not just opposite the
    // player's resting view.
    return {
      radius,
      arc,
      height,
      centerY: topY - height / 2,
      thetaStart: segment.azimuth - arc / 2,
    };
  }, [tuning, eyeY, eyeRadius, segment.arcDeg, segment.azimuth, imageAspect]);

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    // No repetition: the painting is mapped exactly once across the segment.
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    // Seen from BackSide the cylinder's u axis runs right-to-left on screen,
    // which mirrors the painting. Flipping u puts it back the way it was
    // painted (pines on the left, the big cliff on the right) — each segment
    // picks its own default via `segment.flip`, since the temporary mirrored
    // placeholder segment deliberately wants the *other* orientation.
    const flip = tuning.flip ?? segment.flip;
    texture.repeat.x = flip ? -1 : 1;
    texture.offset.x = flip ? 1 : 0;
    texture.needsUpdate = true;
  }, [texture, tuning.flip, segment.flip]);

  // Disposing the clone releases only this segment's own GPU texture object;
  // the decoded image data and the cached original stay alive for the other
  // segment (or a future remount) to clone again.
  useEffect(() => () => texture.dispose(), [texture]);

  const edgeAlpha = useMemo(getBackdropEdgeAlphaMap, []);

  return (
    <mesh position={[0, geo.centerY, 0]} renderOrder={-1}>
      <cylinderGeometry
        args={[geo.radius, geo.radius, geo.height, 128, 1, true, geo.thetaStart, geo.arc]}
      />
      {/* Basic, not standard: a painted backdrop must not be re-lit by the
          scene's key/rim, or it picks up highlights that make it read as a
          curved wall rather than distance. Scene fog stays enabled so the
          lower edge dissolves further with distance on top of the alphaMap's
          fixed-shape fade below.

          alphaMap dissolves the painting into whatever is now behind it — the
          SkyDome, or another overlapping segment — on all four sides: both
          azimuth edges and the bottom, so there is no seam at any camera
          position and overlapping segments simply composite. transparent has
          to be explicit; alphaMap does nothing without it. */}
      <meshBasicMaterial
        map={texture}
        alphaMap={edgeAlpha}
        transparent
        side={THREE.BackSide}
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  );
}

/*
 * Крок 13: the brief's own budget for a theme splat — 4 seconds from mount to
 * first ready frame, measured on production with a cold cache. Not met here:
 * this environment's headless renderer cannot produce a real timing (see
 * CLAUDE.md's "Headless browser" section — it runs at ~1fps regardless of
 * payload), so this is the mechanism, unverified against a real device. If
 * `window.__splat` never reaches `state: 'ready'` within this window, the
 * splat is abandoned and the procedural Mountains floor (already mounted
 * underneath — see the non-painting branch below) is what stays on screen.
 */
const SPLAT_LOAD_BUDGET_MS = 4000;

/*
 * `?spbudget=` (milliseconds) raises that window for a deliberate experiment.
 * A heavier capture loaded via SplatBackdrop.jsx's own `?spurl=` can easily
 * need more than 4s to fetch and decode, and without this the budget silently
 * unmounts it — which reads as "the splat is broken" rather than "the guard
 * fired". Both this and `?spurl=` exist for the same reason: the fps/VRAM
 * question can only be answered on a real device, and it should be answerable
 * without a rebuild or a committed default.
 */
function splatLoadBudgetMs() {
  if (typeof window === 'undefined') return SPLAT_LOAD_BUDGET_MS;
  const raw = new URLSearchParams(window.location.search).get('spbudget');
  const n = raw !== null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : SPLAT_LOAD_BUDGET_MS;
}

function ThemedSplatBackdrop({ url, defaults }) {
  const [timedOut, setTimedOut] = useState(false);
  const readyRef = useRef(false);
  const budgetRef = useRef(null);
  if (budgetRef.current === null) budgetRef.current = splatLoadBudgetMs();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!readyRef.current) setTimedOut(true);
    }, budgetRef.current);
    return () => clearTimeout(timer);
  }, []);

  if (timedOut) return null;
  return (
    <Suspense fallback={null}>
      <SplatBackdrop
        url={url}
        defaults={defaults}
        onReady={() => {
          readyRef.current = true;
        }}
      />
    </Suspense>
  );
}

export default function Backdrop({ themeKey = INITIAL_THEME_KEY }) {
  const { theme, usesPainting, usesThemeSplat } = useMemo(() => deriveBackdropConfig(themeKey), [themeKey]);
  const segments = useMemo(() => backdropSegmentsFor(theme.backdrop.image), [theme]);

  // Probe for every distinct image the segments reference before mounting
  // any texture loader: useTexture suspends forever on a 404, which would
  // hang the whole canvas behind Suspense. Both segments share one `src`
  // today, so this is one request, but it's written against the general
  // case (Set of unique srcs) so a future segment with its own Mint frame
  // doesn't need this rewritten too.
  //
  // Gated all-or-nothing: if any segment's image isn't ready, every segment
  // falls back to Mountains together rather than mixing a painted arc with
  // procedural ridges elsewhere in the same 360 — those two read as
  // different worlds, so a partial mix would look more broken than a full
  // fallback.
  //
  // Крок 19: reset to false whenever the theme changes (not just at mount)
  // and re-probe that theme's own segments — a live switch must not keep
  // showing the PREVIOUS theme's painting while treating it as "ready" for
  // the new one, and must not skip the fallback-to-Mountains window either.
  const [imagesReady, setImagesReady] = useState(false);
  const tuning = useMemo(readTuning, []);

  useEffect(() => {
    setImagesReady(false);
    if (!usesPainting) return undefined;
    let cancelled = false;
    const srcs = [...new Set(segments.map((s) => s.src))];
    Promise.all(srcs.map((src) => fetch(src, { method: 'HEAD' }).then((r) => r.ok)))
      .then((oks) => !cancelled && setImagesReady(oks.every(Boolean)))
      .catch(() => !cancelled && setImagesReady(false));
    return () => {
      cancelled = true;
    };
  }, [usesPainting, segments]);

  if (!usesPainting) {
    return (
      <>
        <SkyDome />
        <Mountains />
        {/* A theme's own splat (THEMES[key].backdrop.mode === 'splat' — none
            currently, see Крок 17/18 in CLAUDE.md for why) renders in
            addition to the procedural floor above, never instead of it. */}
        {usesThemeSplat && (
          <ThemedSplatBackdrop url={theme.backdrop.splatUrl} defaults={theme.backdrop.splat} />
        )}
      </>
    );
  }

  return (
    <>
      {/* Mounted first and unconditionally: it is what closes the scene on
          every azimuth, so every painted segment (each one frame, not a
          panorama) has somewhere to dissolve into instead of an edge or open
          canvas. Ordinary depth testing puts it behind everything else
          without any renderOrder bookkeeping — it is opaque and by far the
          largest thing in the scene. */}
      <SkyDome />
      {imagesReady ? (
        segments.map((segment) => (
          <ImageBackdropSegment key={segment.id} segment={segment} tuning={tuning} />
        ))
      ) : (
        <Mountains />
      )}
      {/* Mounted on top of the painting, not instead of it. Tens of MB takes a
          while and may not arrive at all; the painted cylinder is the floor
          under it and costs well under a MB. */}
      {usesThemeSplat && (
        <ThemedSplatBackdrop url={theme.backdrop.splatUrl} defaults={theme.backdrop.splat} />
      )}
    </>
  );
}
