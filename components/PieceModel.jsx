import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { PIECE_CONFIG, PIECE_SCALE } from '../lib/pieces';

// A little metalness is what lets the environment map put highlights on the
// facets — without it the lacquer reads as matte plaster.
const LACQUER = new THREE.MeshStandardMaterial({
  color: '#0E0E10',
  roughness: 0.32,
  metalness: 0.15,
  flatShading: true,
});
// Deliberately darker and warmer than the #EDE7D9 background. When bone and
// backdrop share a value the white pieces dissolve into the scene.
const BONE = new THREE.MeshStandardMaterial({
  color: '#DDD3BE',
  roughness: 0.78,
  metalness: 0.0,
  flatShading: true,
});

function normalizeHeight(object3d, targetHeight) {
  const box = new THREE.Box3().setFromObject(object3d);
  const currentHeight = box.max.y - box.min.y;
  const scale = (targetHeight * PIECE_SCALE) / currentHeight;
  object3d.scale.setScalar(scale);

  // Re-measure after scaling and drop the model so its base sits at y=0 —
  // otherwise pieces float at whatever height their own model origin used.
  const newBox = new THREE.Box3().setFromObject(object3d);
  object3d.position.y -= newBox.min.y;
}

function applyMaterial(object3d, isWhite) {
  object3d.traverse((node) => {
    if (node.isMesh) {
      node.material = isWhite ? BONE : LACQUER;
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
}

export default function PieceModel({ type, color, ...groupProps }) {
  const config = PIECE_CONFIG[type];
  const { scene } = useGLTF(config.model);

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    normalizeHeight(clone, config.targetHeight);
    applyMaterial(clone, color === 'w');
    return clone;
  }, [scene, config, color]);

  // The instance's own transform (scale + base-at-y=0 offset from
  // normalizeHeight) must stay untouched by the outer board-position — so
  // that goes on a wrapping group instead of directly on <primitive>.
  return (
    <group {...groupProps}>
      <primitive object={instance} />
    </group>
  );
}

Object.values(PIECE_CONFIG).forEach((config) => useGLTF.preload(config.model));
