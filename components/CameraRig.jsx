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
 */
export default function CameraRig({ controlsRef }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  useEffect(() => {
    const [x, y, z] = basePositionFor(size.width / size.height);
    camera.position.set(x, y, z);
    camera.updateProjectionMatrix();
    controlsRef.current?.update();
  }, [camera, size.width, size.height, controlsRef]);

  return null;
}
