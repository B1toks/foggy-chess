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
 * ROCK_MODEL is not set — Mint is generating a rock formation with a flat,
 * round top sized for the board. Until it exists, `TemporaryPedestal` stands
 * in: a small, sharp-edged, dark disc directly under the board. The brief is
 * explicit that this should look unfinished rather than trying to be pretty
 * on its own ("дошка на постаменті — некрасиво, але чесно") — an honest
 * placeholder reads as "more to come," a polished wrong shape reads as
 * finished and wrong.
 */
export const SHOW_ROCK_ISLAND = true;

// Set to the model path once Mint delivers it, e.g. '/models/rock-island.glb'.
const ROCK_MODEL = null;

// Board slab is 8.6x8.6 (see Board.jsx's boxGeometry) — that footprint, not
// the 8x8 playing surface inside it, is what the pedestal has to clear.
const BOARD_HALF_WIDTH = 4.3;
const PEDESTAL_RADIUS = BOARD_HALF_WIDTH * 1.1;
// Just under the board slab (which spans y -0.31 .. -0.01), same height the
// old plateau used — the board sits on this rather than intersecting it.
const Y = -0.315;
const PEDESTAL_COLOR = '#241F19';

const ROCK_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#6E6A62',
  roughness: 0.95,
  metalness: 0,
  flatShading: true,
});

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
 * Loads and normalizes the future GLB rock formation. Mirrors
 * PieceModel.jsx's own pipeline: Mint's own materials/textures are discarded
 * for one procedural granite material, matching how every piece on the board
 * is treated, and the flat top is what the board actually sits on.
 */
function RockModel() {
  const { scene } = useGLTF(ROCK_MODEL);

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    // TODO(when the model exists): normalize scale/position the way
    // normalizeHeight() in PieceModel.jsx fits a piece to its target height —
    // measure the model's own flat-top width and Y via Box3 and scale/offset
    // to it (flat top a little wider than BOARD_HALF_WIDTH*2, sitting at Y)
    // rather than guessing constants that only happen to fit one export.
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
    return clone;
  }, [scene]);

  return <primitive object={instance} />;
}

export default function RockIsland() {
  if (!SHOW_ROCK_ISLAND) return null;
  return ROCK_MODEL ? <RockModel /> : <TemporaryPedestal />;
}
