import { Environment } from '@react-three/drei';

/*
 * Chosen by side-by-side comparison on /dev-pieces?focus=1&env=<preset>:
 * studio gave the crispest specular break-up on the kabuto facets and the
 * knight's mane, with a neutral cast. city was softer, warehouse nearly flat,
 * and dawn threw a blue-violet tint that fought the warm palette.
 *
 * Served from public/ rather than drei's `preset` prop on purpose: `preset`
 * pulls the HDR from raw.githack.com at runtime, which would put a
 * third-party CDN on the critical path of every page load in production.
 */
export const ENV_FILE = '/hdr/studio_small_03_1k.hdr';
/*
 * 0.2, not the 0.6 the brief suggested. Measured, not guessed: at 0.6 a dark
 * square rendered #cac7bb against its #8B7F6A material, i.e. ~1.5x too bright,
 * and the board lost its checker read entirely. Sweeping intensity against
 * sampled tile pixels gave:
 *   0.60 -> #cac7bb   0.35 -> #afaa9b   0.20 -> #8e8979   0.12 -> #726d5d
 * 0.2 lands essentially on the target. The environment map contributes diffuse
 * irradiance as well as the specular highlights it is here for, so it has to
 * be balanced against the directional rig rather than added on top of it.
 */
export const ENV_INTENSITY = 0.2;

/**
 * Shared rig. Used by both the game and /dev-pieces so what you approve in the
 * inspector is literally what ships on the board.
 *
 * Two things are load-bearing here:
 *
 * - The Environment map. MeshStandardMaterial with no environment has nothing
 *   to reflect, which is what made the pieces read as plaster. This is what
 *   puts specular highlights on the lacquer facets.
 * - The rim light. The lacquer is nearly black with flatShading, so without a
 *   contrasting light raking across it from behind, the kabuto facets and the
 *   knight's muzzle collapse into a flat silhouette.
 *
 * Fix black-piece legibility here, never by lightening the material.
 */
export default function Lighting({ preset, envIntensity = ENV_INTENSITY }) {
  // `preset` is only passed by the dev comparison page; the game always uses
  // the self-hosted file.
  const envProps = preset ? { preset } : { files: ENV_FILE };

  return (
    <>
      {/* background={false}: the environment is for reflections only, the
          scene keeps its own backdrop. */}
      <Environment {...envProps} background={false} environmentIntensity={envIntensity} />

      {/* Near-zero on purpose. The environment map already supplies the base
          irradiance; the directional rig below was originally balanced without
          it, and left unchanged the sum blows the board out to white. */}
      <ambientLight intensity={0.05} />

      {/* key — primary form and the only shadow caster. shadow-mapSize
          1024 (Крок 11, Section A3; was 2048) — halves the shadow pass's
          own render-target cost. Board/pieces are close-range and small
          (shadow-camera bounds are +/-6 units), so 1024 still resolves
          crisp piece-base contact shadows; verify by eye if a future piece
          set adds finer detail near the shadow's own resolution limit. */}
      <directionalLight
        position={[4, 6, 3]}
        intensity={0.85}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={0.5}
        shadow-camera-far={25}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />

      {/* rim — rakes from behind/side, carves the black pieces out of the dark */}
      <directionalLight position={[-5, 3, -4]} intensity={0.55} color="#C9D4E0" />

      {/* fill — lifts the dead undersides */}
      <directionalLight position={[0, 2, 6]} intensity={0.12} />
    </>
  );
}
