import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

// Framed so the board dominates, with a band of mountains above it and some
// air around — not pressed against the edges.
export const BASE_POSITION = [3.5, 7, -8.5];

/** Below ~1.0 the limiting dimension is width, so back off proportionally. */
export function pullbackFor(aspect) {
  return aspect >= 1.3 ? 1 : 1 + (1.3 - Math.max(aspect, 0.45)) * 0.72;
}

/**
 * Where the camera rests for a given viewport, before the player orbits.
 *
 * Backdrop.jsx solves its framing against this rather than against the live
 * camera: the live camera moves as the player orbits and zooms, and a backdrop
 * that re-derived its height from that would slide around under them.
 */
export function basePositionFor(aspect) {
  const pullback = pullbackFor(aspect);
  return BASE_POSITION.map((v) => v * pullback);
}

/**
 * Pulls the camera back on narrow/portrait viewports. A single fixed position
 * framed for a landscape window crops the board badly on a phone, which is
 * exactly what production showed on a 390x844 screen.
 *
 * `minDistance`/`maxDistance` are the *landscape* (aspect >= 1.3) zoom bounds;
 * this scales them by the same pullback factor as the resting position and
 * writes them straight onto the controls object, rather than declaring them
 * as OrbitControls props. GameCanvas.jsx picks those bounds so the board fills
 * a set fraction of frame at each end, but that derivation assumes the
 * landscape framing — on a phone (pullback ~1.6x) an unscaled minDistance
 * pulled the camera closer, relative to the pulled-back default, than the
 * same bound reads on desktop, letting a portrait screen zoom in tight enough
 * to crop pieces at the frame edges. This keeps the *relative* zoom range
 * identical across aspect ratios instead. Owning them here exclusively (never
 * also passing them to <OrbitControls>) avoids drei re-applying the
 * unscaled prop over this on some later re-render.
 */
export default function CameraRig({ controlsRef, minDistance, maxDistance }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  useEffect(() => {
    const aspect = size.width / size.height;
    const pullback = pullbackFor(aspect);
    const [x, y, z] = BASE_POSITION.map((v) => v * pullback);
    camera.position.set(x, y, z);
    camera.updateProjectionMatrix();

    const controls = controlsRef.current;
    if (controls) {
      controls.minDistance = minDistance * pullback;
      controls.maxDistance = maxDistance * pullback;
      controls.update();
    }
  }, [camera, size.width, size.height, controlsRef, minDistance, maxDistance]);

  return null;
}
