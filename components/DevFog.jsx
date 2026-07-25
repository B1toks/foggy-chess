import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { squareToWorld } from '../lib/coords';
import { ALL_SQUARES } from '../lib/fog';
import FogShader from './FogShader';

/**
 * Dev-only fog alignment harness. Renders the board with ONLY the squares in
 * ?visible=a1,h8 cleared, so a mirrored or rotated mask texture is obvious:
 * the clear hole must land on the square whose label is painted next to it.
 */
export default function DevFog() {
  const visible = useMemo(() => {
    if (typeof window === 'undefined') return new Set();
    const raw = new URLSearchParams(window.location.search).get('visible') ?? 'a1';
    return new Set(raw.split(',').filter(Boolean));
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas shadows camera={{ position: [0, 11, 0.001], fov: 50 }}>
        <color attach="background" args={['#EDE7D9']} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[4, 6, 3]} intensity={0.9} />

        {ALL_SQUARES.map((square) => {
          const [x, y, z] = squareToWorld(square);
          const file = square.charCodeAt(0) - 97;
          const rank = Number(square[1]) - 1;
          const isDark = (file + rank) % 2 === 0;
          const isTarget = visible.has(square);
          return (
            <mesh key={square} position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[1, 1]} />
              <meshBasicMaterial color={isTarget ? '#C1440E' : isDark ? '#D6CDBA' : '#EDE7D9'} />
            </mesh>
          );
        })}

        <FogShader visibility={visible} />
      </Canvas>

      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          fontFamily: 'system-ui, sans-serif',
          fontSize: 13,
          color: '#1A1A18',
          background: 'rgba(237,231,217,0.92)',
          padding: '8px 12px',
          borderRadius: 6,
        }}
      >
        top-down. cleared: {[...visible].join(', ') || '(none)'} — the clear hole must sit on the
        orange square(s)
      </div>
    </div>
  );
}
