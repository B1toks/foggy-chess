import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import PieceModel from './PieceModel';
import { squareToWorld } from '../lib/coords';

/**
 * The four choices for a promoting pawn, floating just above the square the
 * pawn is moving to.
 *
 * Shown as the actual 3D models rather than lettered buttons: they are the same
 * pieces the player has been looking at all game, so the panel belongs to the
 * scene instead of sitting on top of it as UI.
 *
 * The row yaws to face the camera every frame. A fixed row along world X would
 * foreshorten into a single overlapping clump as soon as the player orbits.
 */

const OPTIONS = [
  { code: 'q', type: 'queen' },
  { code: 'r', type: 'rook' },
  { code: 'b', type: 'bishop' },
  { code: 'n', type: 'knight' },
];

/*
 * Geometry of the panel, all derived from where the frame actually is.
 *
 * Promotion happens on the 8th rank — the far edge of the board, which sits at
 * -28 degrees elevation with the top of the frame only 12 degrees above it.
 * A first pass put full-size models 1.7 units straight up and the row was cut
 * off by the top of the viewport.
 *
 * Three things fix it together: shrink the row so it reads as a panel rather
 * than four more pieces on the board, lift it less, and pull it toward the
 * camera — a point at a fixed height moves *down* the frame as it gets nearer,
 * so the pull buys vertical room as well as putting the choice closer to hand.
 */
const SCALE = 0.72;
const SPACING = 1.35;
const LIFT = 0.95;
// Along the group's local +Z, which the yaw below points straight at the camera.
const PULL = 1.5;
const PLATE_RADIUS = 0.52;
const PLATE_COLOR = '#F2EDE1';
const RING_COLOR = '#C1440E';

function Option({ option, index, selected, onPick, onHover }) {
  const hovered = selected === option.code;
  const scale = hovered ? 1.12 : 1;

  return (
    <group
      position={[(index - (OPTIONS.length - 1) / 2) * SPACING, 0, PULL]}
      scale={scale}
      onClick={(event) => {
        event.stopPropagation();
        onPick(option.code);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        onHover(option.code);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        onHover(null);
        document.body.style.cursor = 'default';
      }}
    >
      {/* Lit plate behind each model. Without it the bone pieces sit against
          the painted valley and lose their silhouette entirely. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[PLATE_RADIUS, 40]} />
        <meshBasicMaterial
          color={PLATE_COLOR}
          transparent
          opacity={hovered ? 0.96 : 0.82}
          depthWrite={false}
        />
      </mesh>

      {hovered && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
          <ringGeometry args={[PLATE_RADIUS * 0.92, PLATE_RADIUS, 40]} />
          <meshBasicMaterial color={RING_COLOR} transparent opacity={0.9} depthWrite={false} />
        </mesh>
      )}

      <PieceModel type={option.type} color="w" />
    </group>
  );
}

export default function PromotionPicker({ square, onPick, onCancel }) {
  const groupRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  const [x, , z] = squareToWorld(square);

  // Seed the yaw at render time. useFrame does not run until after the first
  // frame is committed, and without this the panel appears once unrotated —
  // pointing away from the camera, with the row foreshortened into a clump.
  const camera = useThree((s) => s.camera);
  const initialYaw = Math.atan2(camera.position.x - x, camera.position.z - z);

  // Esc cancels. The pawn has not moved yet — cancelling simply drops the
  // pending move and leaves the position untouched.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.cursor = 'default';
    };
  }, [onCancel]);

  useFrame(({ camera }) => {
    const group = groupRef.current;
    if (!group) return;
    // Yaw only: the pieces stay upright, the row swings to lie across the
    // player's view. atan2(dx, dz) is the same azimuth convention OrbitControls
    // and the backdrop cylinder use, and yawing by exactly that angle puts the
    // group's local +Z on the camera and its local X across the view.
    group.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z);
  });

  return (
    <group
      ref={groupRef}
      position={[x, LIFT, z]}
      rotation={[0, initialYaw, 0]}
      scale={SCALE}
      // Fires when a click hits nothing in the scene at all. Clicks that land
      // on a board square are cancelled by Board's own handler instead.
      onPointerMissed={onCancel}
    >
      {OPTIONS.map((option, index) => (
        <Option
          key={option.code}
          option={option}
          index={index}
          selected={hovered}
          onPick={onPick}
          onHover={setHovered}
        />
      ))}
    </group>
  );
}
