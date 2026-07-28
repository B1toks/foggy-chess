import { Suspense, useEffect, useMemo as useReactMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import PieceModel from './PieceModel';
import Lighting, { ENV_INTENSITY } from './Lighting';
import { PIECE_HEIGHTS, PIECE_SCALE } from '../lib/pieces';

// Ordered tallest -> shortest so the height gradation is easy to eyeball.
const TYPES = ['king', 'queen', 'bishop', 'knight', 'rook', 'pawn'];
// Exactly one board square, so this row doubles as the adjacent-square
// clearance test: if neighbours touch here, they touch on the real board.
const SPACING = 1.0;
const BACKGROUND = '#EDE7D9';

function buildSlots() {
  const slots = [];
  for (const type of TYPES) {
    for (const color of ['w', 'b']) slots.push({ type, color });
  }
  const total = (slots.length - 1) * SPACING;
  return slots.map((slot, i) => ({ ...slot, x: i * SPACING - total / 2, index: i }));
}

const SLOTS = buildSlots();

// Measures every rendered piece in world space and parks the result on
// `window` so a headless browser run can read real numbers instead of
// guessing height from pixels.
function Measurer() {
  const { scene } = useThree();

  useEffect(() => {
    const timer = setTimeout(() => {
      const rows = [];
      scene.traverse((object) => {
        const label = object.userData?.pieceLabel;
        if (!label) return;

        const box = new THREE.Box3().setFromObject(object);
        const finalHeight = box.max.y - box.min.y;
        const appliedScale = object.children[0]?.scale?.x ?? 1;
        const type = label.split('-')[0];

        rows.push({
          label,
          effectiveTarget: +(PIECE_HEIGHTS[type] * PIECE_SCALE).toFixed(4),
          rawHeight: +(finalHeight / appliedScale).toFixed(4),
          finalHeight: +finalHeight.toFixed(4),
          baseY: +box.min.y.toFixed(4),
          footprintX: +(box.max.x - box.min.x).toFixed(4),
          footprintZ: +(box.max.z - box.min.z).toFixed(4),
          // Distance from this piece's own square centre to its widest edge.
          // Must stay under 0.5 or neighbouring squares overlap.
          halfWidth: +(Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2).toFixed(4),
        });
      });
      window.__pieceMeasurements = rows;
    }, 400);

    return () => clearTimeout(timer);
  }, [scene]);

  return null;
}

export default function DevPieceRow() {
  // ?env=<preset> to compare environment maps, ?focus=1 to zoom onto the black
  // king and knight where specular highlights are easiest to judge.
  const { preset, envIntensity, focus } = useReactMemo(() => {
    if (typeof window === 'undefined') {
      return { preset: undefined, envIntensity: ENV_INTENSITY, focus: false };
    }
    const q = new URLSearchParams(window.location.search);
    return {
      // Absent -> Lighting falls back to the self-hosted HDR the game ships.
      preset: q.get('env') ?? undefined,
      envIntensity: q.has('envi') ? Number(q.get('envi')) : ENV_INTENSITY,
      focus: q.has('focus'),
    };
  }, []);

  const slots = focus ? SLOTS.filter((s) => s.color === 'b' && (s.type === 'king' || s.type === 'knight')) : SLOTS;
  const camera = focus
    ? { position: [0.6, 1.0, 4.2], fov: 30 }
    : { position: [0, 0.7, 16], fov: 12 };

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {/* Long lens from far away ~= orthographic, so equal heights read as
          equal on screen regardless of a piece's distance from the camera. */}
      <Canvas shadows camera={camera}>
        <color attach="background" args={[BACKGROUND]} />
        <Lighting preset={preset} envIntensity={envIntensity} />

        {/* One real board square under each piece, so the gap between
            neighbours is measurable by eye against the tile edges. */}
        {SLOTS.map((slot) => (
          <mesh
            key={`tile-${slot.index}`}
            position={[slot.x, 0, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            receiveShadow
          >
            <planeGeometry args={[1, 1]} />
            <meshStandardMaterial
              color={slot.index % 2 === 0 ? '#EDE7D9' : '#D6CDBA'}
              roughness={0.9}
              metalness={0}
            />
          </mesh>
        ))}

        <Suspense fallback={null}>
          {slots.map((slot) => (
            <PieceModel
              key={`${slot.type}-${slot.color}`}
              type={slot.type}
              color={slot.color}
              position={[focus ? (slot.type === 'king' ? -0.55 : 0.55) : slot.x, 0, 0]}
              userData={{ pieceLabel: `${slot.type}-${slot.color}` }}
            />
          ))}
          <Measurer />
        </Suspense>

        <OrbitControls target={[0, focus ? 0.6 : 0.5, 0]} enableDamping />
      </Canvas>
    </div>
  );
}
