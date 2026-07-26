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
/*
 * Deliberately darker and warmer than the #EDE7D9 background. When bone and
 * backdrop share a value the white pieces dissolve into the scene.
 *
 * Крок 13: was MeshStandardMaterial at roughness 0.78 / metalness 0 — the
 * only piece material with nothing worth reflecting. Lowering roughness alone
 * (tried first, down to 0.34) barely reads: a specular highlight is only
 * visually loud where it contrasts against a dark diffuse base, which is most
 * of why LACQUER (near-black, 0.32 roughness) looks "finished" next to a
 * light bone base at any roughness — the highlight is there but it blends
 * into the already-light colour underneath it instead of popping.
 *
 * Switched to MeshPhysicalMaterial for a thin clearcoat layer instead of
 * relying on the base layer's own specular. A clearcoat is a second,
 * independent Fresnel reflection sitting on top of the diffuse/roughness
 * response — it reads as a polished-ivory skin (a tight, bright highlight
 * that moves with the camera) regardless of how light the material under it
 * is, which is exactly the "finished, not raw" quality LACQUER already has
 * for a different (dark, glossier) reason. `roughness` stays fairly high
 * (0.58) so the BODY of the material still reads as matte bone/stone, not
 * plastic; `clearcoatRoughness` is much lower (0.08) so the coat itself
 * stays a tight, crisp highlight instead of a second soft sheen. `metalness`
 * stays at 0 — bone is a dielectric, not a metal, and clearcoat is what's
 * doing the work now.
 *
 * flatShading stays TRUE — also tried false (smooth shading via the model's
 * own imported normals) on the theory that BONE's visible facet edges read as
 * "unfinished" more than LACQUER's do. Screenshot proved the opposite: the
 * decimated mesh is exactly as non-manifold as "Asset budget" in CLAUDE.md
 * documents (the knight alone has 38,146 disconnected components), so its
 * imported normals are not consistent enough for smooth shading — every
 * piece came out mottled with dark blotches, worse than flat. Keep
 * flatShading true for both materials; it isn't the source of the
 * raw-vs-finished gap.
 */
const BONE = new THREE.MeshPhysicalMaterial({
  color: '#DDD3BE',
  roughness: 0.58,
  metalness: 0,
  clearcoat: 0.8,
  clearcoatRoughness: 0.08,
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

/*
 * `fade`: every live piece on the board shares one of the two materials
 * above (BONE/LACQUER) — a single GPU upload's worth of state for 32 pieces.
 * A capture's fade-out (see Pieces.jsx's CaptureGhost) needs to animate one
 * piece's opacity independent of every other piece of that colour, which a
 * shared material can't do — so `fade` clones it once per ghost instead.
 * Ghosts are short-lived (one fade, then unmounted), so the extra material
 * instance never accumulates.
 */
function applyMaterial(object3d, isWhite, fade) {
  object3d.traverse((node) => {
    if (node.isMesh) {
      const shared = isWhite ? BONE : LACQUER;
      if (fade) {
        node.material = shared.clone();
        node.material.transparent = true;
      } else {
        node.material = shared;
      }
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
}

export default function PieceModel({ type, color, fade = false, ...groupProps }) {
  const config = PIECE_CONFIG[type];
  const { scene } = useGLTF(config.model);

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    normalizeHeight(clone, config.targetHeight);
    applyMaterial(clone, color === 'w', fade);
    return clone;
  }, [scene, config, color, fade]);

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
