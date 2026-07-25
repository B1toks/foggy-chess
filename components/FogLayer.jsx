import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { squareToWorld } from '../lib/coords';
import { ALL_SQUARES, FOG_COLOR, FOG_HEIGHT, FOG_LERP_SPEED, FOG_OPACITY } from '../lib/fog';

/**
 * Tier 1 fog: one flat plane per fogged square, opacity lerped imperatively.
 * Kept as the known-good fallback for FOG_MODE === 'tier1' — plain geometry,
 * no shader, no float-texture support required.
 */
export default function FogLayer({ visibility }) {
  const meshRefs = useRef([]);
  const current = useRef(new Float32Array(64).fill(1));
  const target = useRef(new Float32Array(64).fill(1));

  useFrame((_, delta) => {
    const step = Math.min(delta * FOG_LERP_SPEED, 1);

    for (let i = 0; i < 64; i++) {
      target.current[i] = visibility.has(ALL_SQUARES[i]) ? 0 : 1;
      current.current[i] += (target.current[i] - current.current[i]) * step;

      const mesh = meshRefs.current[i];
      if (!mesh) continue;
      const amount = current.current[i];
      mesh.material.opacity = amount * FOG_OPACITY;
      mesh.visible = amount > 0.003;
    }
  });

  return (
    <group>
      {ALL_SQUARES.map((square, i) => {
        const [x, , z] = squareToWorld(square);
        return (
          <mesh
            key={square}
            ref={(el) => (meshRefs.current[i] = el)}
            position={[x, FOG_HEIGHT, z]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={2}
          >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial color={FOG_COLOR} transparent depthWrite={false} opacity={1} />
          </mesh>
        );
      })}
    </group>
  );
}
