import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import Mountains from './Mountains';
import SkyDome, { DOME_HORIZON_COLOR } from './SkyDome';
import { getBackdropEdgeAlphaMap } from './proceduralTextures';
import { basePositionFor } from './CameraRig';

/*
 * Lazy, not a static import. @sparkjsdev/spark is 482 KB in the client bundle —
 * more than the painting it would replace — and BACKDROP_MODE is not 'splat'.
 * A static import ships all of it to every player for a disabled feature; a
 * dynamic one makes webpack emit it as an async chunk that is only ever
 * fetched if something actually renders it.
 */
const SplatBackdrop = lazy(() => import('./SplatBackdrop'));

/**
 * 'procedural' — the canvas-generated ridge shells in Mountains.jsx.
 * 'image'      — the panoramic sumi-e painting wrapped behind the scene.
 * 'splat'      — the Gaussian-splat capture of the valley, with 'image'
 *                underneath it as the instant-loading floor.
 *
 * This one constant is the rollback for the whole section. All three
 * implementations stay in the codebase and stay working.
 *
 * 'splat' is wired up, loads, and renders — but it is NOT the default, because
 * the capture has not been *placed* yet and unplaced it looks worse than the
 * painting. See "Gaussian splat backdrop" in CLAUDE.md for the numbers already
 * measured off the file and the URL knobs for dialling it in live. Flip this to
 * 'splat' and tune it in a real browser; it needs a GPU and an eye, not a
 * headless screenshot.
 */
export const BACKDROP_MODE = 'image';

/** True for any mode that puts the painted cylinder in the scene. */
const USES_PAINTING = BACKDROP_MODE === 'image' || BACKDROP_MODE === 'splat';

export const BACKDROP_IMAGE = '/textures/mountains.jpg';

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
 */
const IMAGE_ASPECT = 2560 / 1429;
const RADIUS = 46;
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
export const BACKDROP_FOG = USES_PAINTING
  ? { color: DOME_HORIZON_COLOR, near: 44, far: 96 }
  : { color: DOME_HORIZON_COLOR, near: 26, far: 72 };

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

function ImageBackdrop({ src, tuning }) {
  const texture = useTexture(src);

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
    const arc = THREE.MathUtils.degToRad(tuning.arcDeg ?? ARC_DEG);
    const height = (radius * arc) / IMAGE_ASPECT;
    const elevation = THREE.MathUtils.degToRad(tuning.elevation ?? SKYLINE_ELEVATION_DEG);
    const skylineY = eyeY - (radius + eyeRadius) * Math.tan(elevation);
    const topY = tuning.topY ?? skylineY + SKYLINE_FRACTION * height;
    // The segment is centred on the direction the camera looks, i.e. opposite
    // its home azimuth. thetaStart is the segment's leading edge.
    const center = HOME_AZIMUTH - Math.PI;
    return { radius, arc, height, centerY: topY - height / 2, thetaStart: center - arc / 2 };
  }, [tuning, eyeY, eyeRadius]);

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    // No repetition: the painting is mapped exactly once across the segment.
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    // Seen from BackSide the cylinder's u axis runs right-to-left on screen,
    // which mirrors the painting. Flipping u puts it back the way it was
    // painted (pines on the left, the big cliff on the right).
    if (tuning.flip ?? true) {
      texture.repeat.x = -1;
      texture.offset.x = 1;
    }
    texture.needsUpdate = true;
  }, [texture, tuning.flip]);

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
          SkyDome — on all four sides: both azimuth edges and the bottom, so
          there is no seam at any camera position, not just inside the old
          azimuth clamp. transparent has to be explicit; alphaMap does nothing
          without it. */}
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

export default function Backdrop() {
  // Probe for the file before mounting the texture loader: useTexture suspends
  // forever on a 404, which would hang the whole canvas behind Suspense.
  const [imageReady, setImageReady] = useState(false);
  const tuning = useMemo(readTuning, []);

  useEffect(() => {
    if (!USES_PAINTING) return undefined;
    let cancelled = false;
    fetch(BACKDROP_IMAGE, { method: 'HEAD' })
      .then((r) => !cancelled && setImageReady(r.ok))
      .catch(() => !cancelled && setImageReady(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!USES_PAINTING) {
    return (
      <>
        <SkyDome />
        <Mountains />
      </>
    );
  }

  return (
    <>
      {/* Mounted first and unconditionally: it is what closes the scene on
          every azimuth, so the painted segment (one frame, not a panorama) has
          somewhere to dissolve into instead of an edge or open canvas. Ordinary
          depth testing puts it behind everything else without any renderOrder
          bookkeeping — it is opaque and by far the largest thing in the
          scene. */}
      <SkyDome />
      {imageReady ? <ImageBackdrop src={BACKDROP_IMAGE} tuning={tuning} /> : <Mountains />}
      {/* Mounted on top of the painting, not instead of it. 32 MB takes a while
          and may not arrive at all; the painted cylinder is the floor under it
          and costs 434 KB. */}
      {BACKDROP_MODE === 'splat' && (
        <Suspense fallback={null}>
          <SplatBackdrop />
        </Suspense>
      )}
    </>
  );
}
