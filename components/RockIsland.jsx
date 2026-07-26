import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

/*
 * Крок 9.6, Section C: replaces Plateau.jsx and its whole "continuous ground"
 * concept. The old plateau tried to fake an unbroken horizon under the board
 * and, twice now, that attempt itself became the bug (a grey blob eating the
 * backdrop — see the Крок 9 and Крок 9.6 history in Plateau.jsx's last
 * revision before it was deleted). The brief's replacement concept is a
 * shan-shui one: the board sits on a small floating rock, and the emptiness
 * around and under it is the composition, not a gap to hide. Nothing needs
 * to fake a horizon anymore because nothing is pretending to be one.
 *
 * Крок 10, Section E: ROCK_MODEL now points at Mint's delivered export.
 * `TemporaryPedestal` stays in the file (unused unless ROCK_MODEL is cleared)
 * as the rollback the Крок 9.6 brief asked for — an honest placeholder is
 * better than a broken model, so keep the fallback path working.
 */
export const SHOW_ROCK_ISLAND = true;

const ROCK_MODEL = '/models/granite-pine-aerie-optimized.glb';

// Board slab is 8.6x8.6 (see Board.jsx's boxGeometry) — that footprint, not
// the 8x8 playing surface inside it, is what the rock's flat top has to clear.
const BOARD_HALF_WIDTH = 4.3;
const PEDESTAL_RADIUS = BOARD_HALF_WIDTH * 1.1;
// Just under the board slab (which spans y -0.31 .. -0.01), same height the
// old plateau used — the board sits on this rather than intersecting it.
const Y = -0.315;
const PEDESTAL_COLOR = '#241F19';

/*
 * Крок 11, Section C: the model was one flat granite grey (#6E6A62) with
 * pine silhouettes growing off its sides, per the export's own name
 * ("granite-pine-aerie"). Inspecting the glTF JSON directly (its `meshes`/
 * `materials` arrays — no need for a full loader) confirmed there is
 * exactly one mesh and one material: `meshes[0].primitives` has a single
 * primitive, `material: 0`, and `materials` has one entry. So this is the
 * "все одним мешем" case the brief anticipated — a geometry-based mask in
 * a custom shader, not a second material swap.
 *
 * The glTF's own POSITION accessor bounds (min/max, which the spec requires
 * to stay correct even under Draco compression) gave the raw model's local
 * extent directly, no runtime raycasting needed this time: X -0.946..0.949,
 * Y -0.851..0.852, Z -0.813..0.815. ROCK_MIN_Y/ROCK_HEIGHT/ROCK_MAX_RADIUS
 * below are those bounds — radius taken as the larger of the X/Z half-
 * extents, since the mask only needs "how far from the vertical axis," not
 * an exact footprint.
 */
const ROCK_MIN_Y = -0.851;
const ROCK_HEIGHT = 0.852 - ROCK_MIN_Y;
const ROCK_MAX_RADIUS = 0.949;

// Second accent after the ember (#C1440E, check/capture) — kept dark and
// muted on purpose so it doesn't compete: not lighter in value than the
// stone it grows out of. If the eye goes to the foliage before the board,
// desaturate further rather than brightening the stone to compensate.
const STONE_TOP = '#7C776C';
const STONE_DEEP = '#4A4740';
const FOLIAGE = '#55634E';

const ROCK_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#6E6A62',
  roughness: 0.95,
  metalness: 0,
  flatShading: true,
});

/*
 * Vertical stone gradient (STONE_DEEP low -> STONE_TOP high) plus a
 * geometry-driven foliage mask, injected via onBeforeCompile rather than a
 * standalone ShaderMaterial — this keeps MeshStandardMaterial's real PBR
 * lighting (the environment map, the rim light carving out silhouettes,
 * shadow receiving) and only overrides where the diffuse colour itself
 * comes from. `vLocalPos` is the raw, pre-scale/offset `position` attribute
 * (object space), so the radius/height thresholds below are stable
 * regardless of RockModel's own scale/position transform on the outer group.
 *
 * The mask is smoothstepped, not a hard boolean (`radius > 0.7*maxRadius &&
 * localY > 0.6*height`) — a binary cutoff on flat-shaded, low-poly geometry
 * reads as a jagged, faceted edge between stone and foliage; the soft band
 * (0.6..0.8 radius, 0.5..0.65 height) blends across a couple of facets
 * instead.
 */
ROCK_MATERIAL.onBeforeCompile = (shader) => {
  shader.uniforms.uMinY = { value: ROCK_MIN_Y };
  shader.uniforms.uHeight = { value: ROCK_HEIGHT };
  shader.uniforms.uMaxRadius = { value: ROCK_MAX_RADIUS };
  shader.uniforms.uStoneTop = { value: new THREE.Color(STONE_TOP) };
  shader.uniforms.uStoneDeep = { value: new THREE.Color(STONE_DEEP) };
  shader.uniforms.uFoliage = { value: new THREE.Color(FOLIAGE) };

  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vLocalPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalPos = position;');

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
      varying vec3 vLocalPos;
      uniform float uMinY;
      uniform float uHeight;
      uniform float uMaxRadius;
      uniform vec3 uStoneTop;
      uniform vec3 uStoneDeep;
      uniform vec3 uFoliage;`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        float heightFrac = clamp((vLocalPos.y - uMinY) / uHeight, 0.0, 1.0);
        float radius = length(vLocalPos.xz);
        float edgeRadius = smoothstep(0.6 * uMaxRadius, 0.8 * uMaxRadius, radius);
        float topHeight = smoothstep(0.5, 0.65, heightFrac);
        float foliageMask = edgeRadius * topHeight;
        vec3 stoneColor = mix(uStoneDeep, uStoneTop, heightFrac);
        diffuseColor.rgb = mix(stoneColor, uFoliage, foliageMask);
      }`,
    );
};

/*
 * Measured, not guessed — a one-time raycast grid (40 radii x 6 angles,
 * downward rays against the raw, unscaled model) rather than a plain Box3:
 * this model's usable top is NOT its bounding-box max, because a raised rim
 * sits above the flat inner area (exactly the thing the brief warned not to
 * let the board overlap). The scan found the flat plateau at local Y=0.417,
 * constant out to r=0.65 (every sample exactly 0.417); by r=0.70 some
 * samples had already climbed to 0.46-0.47 — the rim starting. 0.65 is the
 * last radius confirmed still flat in every direction sampled, so it's used
 * as-is rather than pushed closer to the actual break to leave margin.
 *
 * ROCK_SCALE puts that flat radius at BOARD_HALF_WIDTH * 1.1 (4.73) — the
 * exact same margin PEDESTAL_RADIUS already uses, so "a little wider than
 * the board" means the identical thing whether the rock is the real model or
 * the temporary disc. ROCK_Y_OFFSET then drops the scaled model so its flat
 * top lands exactly at Y, the same resting height the pedestal uses.
 */
const ROCK_FLAT_RADIUS_RAW = 0.65;
const ROCK_FLAT_Y_RAW = 0.417;
const ROCK_SCALE = (BOARD_HALF_WIDTH * 1.1) / ROCK_FLAT_RADIUS_RAW;
const ROCK_Y_OFFSET = Y - ROCK_FLAT_Y_RAW * ROCK_SCALE;

/**
 * Stand-in while ROCK_MODEL doesn't exist: a flat, sharp-edged disc (no rim
 * fade — the brief wants this to read as an honest pedestal, not a second
 * attempt at a dissolving shoreline) a little wider than the board,
 * receiving the board's own shadow so it doesn't read as flat-shaded paper.
 */
function TemporaryPedestal() {
  return (
    <mesh position={[0, Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[PEDESTAL_RADIUS, 64]} />
      <meshStandardMaterial color={PEDESTAL_COLOR} roughness={0.9} metalness={0} />
    </mesh>
  );
}

/**
 * Loads and normalizes the real GLB rock formation. Mirrors PieceModel.jsx's
 * own pipeline: Mint's own materials/textures are discarded for one
 * procedural granite material, matching how every piece on the board is
 * treated. Scale/position come from ROCK_SCALE/ROCK_Y_OFFSET above (measured
 * once via raycasting, not recomputed live — this is a single static asset,
 * not something that gets regenerated per-session the way pieces might be).
 */
function RockModel() {
  const { scene } = useGLTF(ROCK_MODEL);

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((node) => {
      if (node.isMesh) {
        node.material = ROCK_MATERIAL;
        // It's the lowest thing in the scene — nothing below it to shadow.
        node.castShadow = false;
        // Catches the board's own shadow, same job TemporaryPedestal's
        // receiveShadow does.
        node.receiveShadow = true;
      }
    });
    clone.scale.setScalar(ROCK_SCALE);
    clone.position.y = ROCK_Y_OFFSET;
    return clone;
  }, [scene]);

  return <primitive object={instance} />;
}

export default function RockIsland() {
  if (!SHOW_ROCK_ISLAND) return null;
  return ROCK_MODEL ? <RockModel /> : <TemporaryPedestal />;
}
