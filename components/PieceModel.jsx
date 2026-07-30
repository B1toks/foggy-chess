import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { PIECE_HEIGHTS, PIECE_SCALE } from '../lib/pieces';
import { THEMES, DEFAULT_THEME, themeKeyFromUrl, pieceModelPath } from '../lib/themes';

// Крок 19: was read once at module load into a frozen constant — see git
// history for the original comment. Live mid-game theme switching (see
// GameCanvas.jsx's `themeKey` state) needs every themed module to react to a
// changing theme instead of freezing it at import time, so PieceModel now
// takes `themeKey` as a prop and this only supplies the very first render's
// value for callers that don't pass one (DevPieceRow.jsx's dev-only usage).
const INITIAL_THEME_KEY = themeKeyFromUrl();

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
  color: THEMES[INITIAL_THEME_KEY].pieceWhiteColor,
  roughness: 0.58,
  metalness: 0,
  clearcoat: 0.8,
  clearcoatRoughness: 0.08,
  flatShading: true,
});

/*
 * Крок 14 — EXPERIMENTAL. Black still reads as visually stronger than white
 * even after the clearcoat pass above. This is a code-only knob, not a site
 * feature: no HUD control, nothing in the intro, nothing documented as part
 * of the game. `?bone=`/`?boneRough=`/`?boneMetal=`/`?boneClear=`/
 * `?boneClearRough=` override BONE's properties in place for local sweeping
 * only, the same `URLSearchParams`-read-once pattern every other tuning hook
 * in this codebase already uses (see GameCanvas.jsx's `tuningFromUrl`,
 * Backdrop.jsx's `readTuning`). Delete this block and the five `if`s below it
 * to revert — nothing else in the file depends on it.
 */
function boneTuningFromUrl() {
  if (typeof window === 'undefined') return {};
  const q = new URLSearchParams(window.location.search);
  const num = (k) => (q.has(k) ? Number(q.get(k)) : undefined);
  return {
    color: q.get('bone') ?? undefined,
    roughness: num('boneRough'),
    metalness: num('boneMetal'),
    clearcoat: num('boneClear'),
    clearcoatRoughness: num('boneClearRough'),
  };
}
const BONE_OVERRIDE = boneTuningFromUrl();
// `?bone=` still wins over any theme, initial or switched-to — a local
// sweeping knob overriding the colour is the whole point of it.
if (BONE_OVERRIDE.color) BONE.color = new THREE.Color(`#${BONE_OVERRIDE.color}`);
if (BONE_OVERRIDE.roughness !== undefined) BONE.roughness = BONE_OVERRIDE.roughness;
if (BONE_OVERRIDE.metalness !== undefined) BONE.metalness = BONE_OVERRIDE.metalness;
if (BONE_OVERRIDE.clearcoat !== undefined) BONE.clearcoat = BONE_OVERRIDE.clearcoat;
if (BONE_OVERRIDE.clearcoatRoughness !== undefined) BONE.clearcoatRoughness = BONE_OVERRIDE.clearcoatRoughness;

/*
 * Крок 19: BONE is a shared singleton — every white piece on the board
 * points at this exact material object (see applyMaterial below), so
 * mutating its `.color` in place is all a live theme switch needs to
 * recolour every white piece already on screen, with no per-piece work and
 * no material recreation. `?bone=` still wins if present, matching the
 * priority the module-load code above already established.
 */
function syncBoneColorToTheme(themeKey) {
  if (BONE_OVERRIDE.color) return;
  const theme = THEMES[themeKey] ?? THEMES[DEFAULT_THEME];
  BONE.color.set(theme.pieceWhiteColor);
}

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

export default function PieceModel({ type, color, fade = false, themeKey = INITIAL_THEME_KEY, ...groupProps }) {
  const targetHeight = PIECE_HEIGHTS[type];
  const modelPath = pieceModelPath(themeKey, type);
  // useGLTF is keyed by URL in drei's own loader cache — when `modelPath`
  // changes (a theme switch), this suspends again for the new theme's model
  // and re-renders with a different `scene` once it resolves, the same
  // Suspense flow that already handles the very first mount. No manual
  // cache invalidation needed.
  const { scene } = useGLTF(modelPath);

  // Крок 19: keeps the shared BONE material's colour in step with the
  // active theme. Runs once per mounted piece on a theme change (up to 32
  // times) rather than once globally, but the assignment itself is a cheap
  // in-place THREE.Color.set — not worth hoisting to a single shared effect
  // for this.
  useEffect(() => {
    syncBoneColorToTheme(themeKey);
  }, [themeKey]);

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    normalizeHeight(clone, targetHeight);
    applyMaterial(clone, color === 'w', fade);
    return clone;
  }, [scene, targetHeight, color, fade]);

  // The instance's own transform (scale + base-at-y=0 offset from
  // normalizeHeight) must stay untouched by the outer board-position — so
  // that goes on a wrapping group instead of directly on <primitive>.
  return (
    <group {...groupProps}>
      <primitive object={instance} />
    </group>
  );
}

Object.keys(PIECE_HEIGHTS).forEach((type) => useGLTF.preload(pieceModelPath(INITIAL_THEME_KEY, type)));

// Крок 19: exported so the theme switcher (HUD.jsx) can preload a theme's
// models the instant its menu opens — by the time the player actually clicks
// an option, the GLBs are already warm in drei's loader cache and the live
// switch resolves near-instantly instead of visibly re-suspending.
export function preloadThemeModels(themeKey) {
  Object.keys(PIECE_HEIGHTS).forEach((type) => useGLTF.preload(pieceModelPath(themeKey, type)));
}
