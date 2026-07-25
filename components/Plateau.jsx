import { useMemo } from 'react';
import * as THREE from 'three';
import {
  getPlateauAlphaMap,
  getStoneNormalMap,
  getStoneRoughnessMap,
} from './proceduralTextures';

/**
 * The ground the board stands on.
 *
 * Without it the board hangs in the void and the scene reads as a model in a
 * viewer rather than a place. With it there are three planes instead of two:
 * board -> plateau -> fog -> painting.
 *
 * Set SHOW_PLATEAU to false to roll the whole section back.
 */
export const SHOW_PLATEAU = true;

/*
 * 10.5, derived from where the frame actually lands on the ground plane rather
 * than picked for looks. Two constraints, and they very nearly conflict:
 *
 *  - Toward the camera it has to reach the bottom of the frame. The bottom
 *    centre ray hits y=-0.3 at radius 4.7 from the board's centre and the
 *    bottom corners at 6.8 (8.7 on a 21:9 viewport), so the opaque core has to
 *    survive out to ~7.
 *  - Away from the camera it has to be gone before it eats the painting. The
 *    background is only the band from -16 degrees (frame top) to -28 (the
 *    board's far edge); radius 10.5 sits at -20.8, which leaves the skyline at
 *    -19 in clear air.
 *
 * A first pass at 15 put the far rim at -16.8 — right on the frame top — and
 * the mountains disappeared behind a grey shelf.
 */
const RADIUS = 10.5;
// Just under the board slab (which spans y -0.31 .. -0.01) so the board sits on
// the plateau rather than intersecting it.
const Y = -0.315;
const COLOR = '#6B665C';
// 128 segments: the rim is displaced per-vertex, and at 64 the displacement
// reads as a polygon rather than a shoreline.
const SEGMENTS = 128;
// How far the rim wanders in and out, as a fraction of RADIUS.
const RIM_WOBBLE = 0.14;

/**
 * A circle whose rim is pushed in and out so the silhouette is an irregular
 * shelf of rock, not a dinner plate. UVs are left at their original values on
 * purpose: the alpha map's fade then follows the displaced edge instead of
 * cutting across it.
 */
function makePlateauGeometry() {
  const geometry = new THREE.CircleGeometry(RADIUS, SEGMENTS);
  const pos = geometry.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.hypot(x, y);
    if (r < 1e-6) continue;
    const angle = Math.atan2(y, x);
    // Two turns of a sine sum keyed off the angle: cheap, deterministic, and
    // seamless at the wrap because every term is a whole number of periods.
    const wobble =
      Math.sin(angle * 3 + 0.7) * 0.55 +
      Math.sin(angle * 5 - 1.9) * 0.28 +
      Math.sin(angle * 11 + 2.4) * 0.17;
    const scale = 1 + wobble * RIM_WOBBLE * (r / RADIUS);
    pos.setXY(i, x * scale, y * scale);
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export default function Plateau() {
  const geometry = useMemo(makePlateauGeometry, []);
  const maps = useMemo(
    () => ({
      roughnessMap: getStoneRoughnessMap(),
      normalMap: getStoneNormalMap(),
      alphaMap: getPlateauAlphaMap(),
    }),
    [],
  );

  return (
    <mesh
      geometry={geometry}
      position={[0, Y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      // Behind the board and the pieces in the transparent pass, so its rim
      // never sorts in front of them.
      renderOrder={-1}
    >
      <meshStandardMaterial
        color={COLOR}
        roughness={0.95}
        metalness={0}
        {...maps}
        normalScale={new THREE.Vector2(0.6, 0.6)}
        transparent
        // The rim fades to nothing and the fogged painting takes over. Writing
        // depth from a mesh whose edge is 90% transparent would punch a hole in
        // the backdrop behind it.
        depthWrite={false}
      />
    </mesh>
  );
}
