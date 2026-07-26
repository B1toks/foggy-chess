import { useMemo } from 'react';
import * as THREE from 'three';
import {
  getPlateauAlphaMap,
  getStoneNormalMap,
  getStoneRoughnessMap,
} from './proceduralTextures';
import { RADIUS as BACKDROP_RADIUS } from './Backdrop';
import { DOME_HORIZON_COLOR } from './SkyDome';

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

/*
 * Крок 8, Section A: the rocky plateau disc above (radius 10.5) used to be the
 * entire ground. Beyond it was a bare annulus all the way out to the painted
 * backdrop's radius (46) — invisible under the old flat CSS sky, but a
 * distinctly domed, wrong-toned bulge once SkyDome's directional gradient
 * replaced it, visible at shallow enough camera angles. This mesh closes that
 * gap with a second, larger disc — but see the Крок 9 correction just below
 * before touching the radius/gradient numbers again.
 *
 * It sits a hair below the rocky disc (Y - 0.002) so the two never z-fight
 * where they overlap — the rocky disc's own alpha fade (world radius 6.7 to
 * 10.5) reveals this one gradually, rather than cutting to bare ground colour.
 *
 * A single CircleGeometry can't carry the colour gradient below: its default
 * radial resolution is one ring (a triangle fan from the centre vertex
 * straight to the rim), which only has two colour samples to interpolate
 * between and can't hold a flat-then-ramp-then-flat curve. RingGeometry's
 * phiSegments gives real concentric rings of vertices to paint it onto.
 *
 * Крок 9 correction — this disc was blocking the painted backdrop, not just
 * closing the gap around it. It originally ran opaque all the way out to
 * FAR_RADIUS = BACKDROP_RADIUS (46) with only a *colour* fade (never an alpha
 * one), so it was a full, solid, walkable-looking floor for its entire
 * extent. A flat opaque disc that large unavoidably intercepts the sightline
 * to a wall 46 units away for any camera whose gaze dips even slightly below
 * horizontal — which is every allowed camera in this scene, the default
 * resting position included. Verified with three.js's own ray/plane math
 * (not eyeballed): the default camera's top-of-frame ray crosses this disc's
 * plane (y=-0.317) at radius ~15.85. Since the disc was opaque out to 46, it
 * physically sat in front of the backdrop along that ray — hence "the
 * painting" reading as this disc's own flat grey gradient instead.
 *
 * The fix is a real alpha fade, not just a colour one: GRADIENT_OUTER (15)
 * is where alpha reaches exactly 0, chosen with margin under that ~15.85
 * threshold. Swept the same ray-plane check across the full allowed camera
 * envelope (distance 8-14, polar 22-72 degrees) before picking it: every
 * polar angle in the range Крок 8 actually *added* (22-48 degrees, previously
 * unreachable) crosses this plane at radius 4.2-14.8 at the outside — inside
 * 15 with margin at every distance. The pre-existing 52-72 degree range
 * (unchanged by Крок 8) needs more radius than that at its shallowest to
 * fully close its own gap, and this fix does not chase that — it weighs
 * "never re-block the backdrop" above "close every last degree of gap," and
 * that range was already living with whatever its behaviour was before
 * Крок 8 touched anything. FAR_RADIUS is trimmed to 18 (a few units of margin
 * past where alpha already hits 0, purely so the fade has room to interpolate
 * smoothly instead of hitting a hard mesh edge) — there is no reason left for
 * it to reach anywhere near the backdrop's own radius.
 */
const FAR_RADIUS = 18;
const GRADIENT_INNER = RADIUS;
const GRADIENT_OUTER = 15;

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function makeGroundGeometry() {
  const geometry = new THREE.RingGeometry(0, FAR_RADIUS, 96, 48);
  const pos = geometry.attributes.position;
  // RGBA, not RGB: three.js reads a 4-component `color` attribute as
  // per-vertex alpha too (see WebGLPrograms' `vertexAlphas` check), which is
  // what lets this fade to genuine transparency instead of just a matching
  // colour — a colour-only fade stays just as opaque, and an opaque disc is
  // exactly what blocked the backdrop in the first place.
  const colors = new Float32Array(pos.count * 4);
  const stone = new THREE.Color(COLOR);
  const horizon = new THREE.Color(DOME_HORIZON_COLOR);
  const mixed = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.hypot(x, y);
    const t = smoothstep(GRADIENT_INNER, GRADIENT_OUTER, r);
    mixed.copy(stone).lerp(horizon, t);
    colors[i * 4] = mixed.r;
    colors[i * 4 + 1] = mixed.g;
    colors[i * 4 + 2] = mixed.b;
    colors[i * 4 + 3] = 1 - t;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  return geometry;
}

export default function Plateau() {
  const geometry = useMemo(makePlateauGeometry, []);
  const groundGeometry = useMemo(makeGroundGeometry, []);
  const maps = useMemo(
    () => ({
      roughnessMap: getStoneRoughnessMap(),
      normalMap: getStoneNormalMap(),
      alphaMap: getPlateauAlphaMap(),
    }),
    [],
  );

  return (
    <>
      {/* transparent + depthWrite=false for the same reason as the rocky
          disc just below: this one now genuinely fades to nothing (see the
          Крок 9 comment above `FAR_RADIUS`), and an opaque mesh that fades
          only in colour would still write depth across its whole extent,
          which is exactly the bug that blocked the backdrop. Not
          shadow-receiving — this is distant fill ground, not the surface
          under the pieces. The rocky disc below already owns shadow
          receiving out to its own radius. */}
      <mesh
        geometry={groundGeometry}
        position={[0, Y - 0.002, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={-2}
      >
        <meshStandardMaterial
          vertexColors
          roughness={0.95}
          metalness={0}
          transparent
          depthWrite={false}
        />
      </mesh>

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
          // The rim fades to nothing and the far ground disc takes over
          // underneath. Writing depth from a mesh whose edge is 90%
          // transparent would punch a hole in the ground behind it.
          depthWrite={false}
        />
      </mesh>
    </>
  );
}
