import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { THEMES, themeKeyFromUrl, rockModelPath } from '../lib/themes';

// Крок 13: same read-once-at-module-load convention as PieceModel.jsx.
const ACTIVE_THEME_KEY = themeKeyFromUrl();
const ACTIVE_THEME = THEMES[ACTIVE_THEME_KEY];

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

const ROCK_MODEL = rockModelPath(ACTIVE_THEME_KEY);

// Board slab is 8.6x8.6 (see Board.jsx's boxGeometry) — that footprint, not
// the 8x8 playing surface inside it, is what the rock's flat top has to clear.
const BOARD_HALF_WIDTH = 4.3;
const PEDESTAL_RADIUS = BOARD_HALF_WIDTH * 1.1;
// Just under the board slab (which spans y -0.31 .. -0.01), same height the
// old plateau used — the board sits on this rather than intersecting it.
const Y = -0.315;
const PEDESTAL_COLOR = '#241F19';

/*
 * Крок 12, Section D: the rock wears Mint's own baked textures.
 *
 * Крок 11, Section C replaced Mint's material with a procedural granite grey
 * plus a *geometric* foliage guess — "green where radius > 0.6..0.8 * maxRadius
 * AND height > 0.5..0.65". That guess was wrong in the most visible way
 * possible: the basin's raised rim is, by construction, both high and at large
 * radius, so the mask fired across the entire rim and the whole formation
 * rendered as one flat green bowl. The stone gradient underneath it was never
 * visible at all.
 *
 * There was never a need to guess. Reading the .glb's own JSON chunk shows the
 * material carries three baked textures Mint painted and the old code threw
 * away:
 *
 *   baseColorTexture         (webp, via EXT_texture_webp) - grey granite,
 *                            GREEN foliage on the pine canopies, BROWN bark on
 *                            the trunks. Exactly the "листя зеленим, стовбур
 *                            коричневим" the brief asks for, already authored.
 *   normalTexture            (jpeg) - the surface detail
 *   metallicRoughnessTexture (webp)
 *
 * So this now keeps the loaded material's maps and only overrides the
 * *response* (roughness/metalness/side). The brief's fallback — "якщо не бачиш
 * контурів, тоді просто закрась все в сірий" — is not needed, because the
 * contours are in the texture rather than in the geometry.
 *
 * Two consequences worth knowing:
 * - flatShading must be OFF. It was on to make the untextured grey read as
 *   faceted stone; with a real normal map it fights the map and destroys the
 *   baked detail.
 * - `side` is forced to FrontSide. Mint marks the material doubleSided, which
 *   for a closed rock means every covered pixel is shaded twice for no visual
 *   difference — and this is the largest object on screen by area.
 */
const ROCK_ROUGHNESS = 0.92;

/*
 * Крок 16, Section C: the island rendered fully black on Ocean specifically
 * — not "wrong tint", genuinely black. Diagnosed with tools/measure-rock-
 * albedo.mjs (decodes each theme's baked baseColorTexture exactly as the
 * browser does and reads back mean/max luma via canvas):
 *
 *   theme   mean luma   max luma
 *   mist       103          169
 *   ocean       15           71
 *   snow       121          241
 *
 * Ocean's "Basalt Kelp Ledge" texture is authentically dark basalt — that's
 * correct art direction, not a bug in the asset. The bug is downstream:
 * MeshStandardMaterial's `color` only ever MULTIPLIES the sampled texture
 * (max effective factor is white, i.e. no darkening at all), so no tint,
 * however light, can lift a 15/255-mean texture into a visibly blue-green
 * rock. It can only push it further toward literal (0,0,0), which is what
 * "the island is solid black" actually was — confirmed by forcing
 * `material.side = DoubleSide` live (ruling out a backface/winding issue,
 * which would have shown SOMETHING lit) and finding the fix made no visual
 * difference at all.
 *
 * The fix is a themed, additive EMISSIVE floor — not a brighter multiply,
 * which doesn't exist. Emissive stacks on top of the diffuse/specular
 * response instead of replacing it, so the baked texture's own contours
 * (Крок 12 Section D's whole point — "the contours are in the texture, not
 * the geometry") still read as relative light/dark variation above the
 * floor; only the absolute minimum ever gets lifted. Sized per-theme from
 * the measured mean luma above, so it's a no-op for Mist/Snow (already well
 * above the floor) and only Ocean's authentically-dark basalt gets lifted.
 */
const ROCK_ALBEDO_MEAN_LUMA = { mist: 103, ocean: 15, snow: 121 };
const ROCK_ALBEDO_FLOOR_LUMA = 55;
/*
 * Крок 17: the luma-floor fix above exists purely to rescue Ocean's rock
 * from reading as literally black — it computes 0 for Snow (already well
 * above the floor) by design, which is correct for "not black" but leaves
 * Snow's rock with no deliberate colour identity at all beyond the (now
 * stronger, see lib/themes.js's rockTintFor) multiply tint. A small
 * guaranteed emissive floor per theme, independent of the black-rescue
 * maths, gives Ocean/Snow's rock a visible colour note that survives
 * regardless of ambient lighting — Mist gets 0 (unchanged; its own bone/
 * granite look was already tuned without this and doesn't need a colour
 * "identity" boost the way the two newer themes do).
 */
const ROCK_THEME_EMISSIVE_FLOOR = { mist: 0, ocean: 0.12, snow: 0.12 };
const ROCK_EMISSIVE_INTENSITY = Math.max(
  ROCK_THEME_EMISSIVE_FLOOR[ACTIVE_THEME_KEY] ?? 0,
  (ROCK_ALBEDO_FLOOR_LUMA - (ROCK_ALBEDO_MEAN_LUMA[ACTIVE_THEME_KEY] ?? 255)) / 255,
);

function applyRockMaterial(material) {
  material.roughness = ROCK_ROUGHNESS;
  material.metalness = 0;
  material.flatShading = false;
  material.side = THREE.FrontSide;
  // Mint bakes lighting-neutral albedo, but the map comes in a touch pale
  // against this scene's light key; a mild multiply keeps the granite from
  // reading as white paper without desaturating the green and brown.
  // Крок 13: per-theme tint (lib/themes.js's rockTint) instead of a single
  // hardcoded value — ocean/snow retint Mist's own tone toward each theme's
  // dark-square hue/saturation, keeping Mist's lightness.
  material.color = new THREE.Color(ACTIVE_THEME.rockTint);
  // Крок 16, Section C: additive floor, themed the same as the multiply tint
  // above so a lifted-black pixel still reads as this theme's own hue rather
  // than a neutral grey glow.
  material.emissive = new THREE.Color(ACTIVE_THEME.rockTint);
  material.emissiveIntensity = ROCK_EMISSIVE_INTENSITY;
  material.needsUpdate = true;
  return material;
}

/*
 * THE FIT. Measured with tools/measure-rock.mjs (kept in the repo — re-run it
 * if the export is regenerated), which rasterises the model's triangles into a
 * 128x128 top-surface heightfield rather than binning vertices or trusting a
 * Box3. Two things that method establishes and the previous derivation got
 * wrong:
 *
 * 1. The basin floor is at local Y = 0.417 and covers 68% of the top surface —
 *    that part was right.
 * 2. The old code fitted a *radius*: it put the floor's "flat radius" (0.65) at
 *    BOARD_HALF_WIDTH * 1.1. But the board is a SQUARE, and a square of
 *    half-width s reaches s*sqrt(2) at its corners. Fitting the half-width to a
 *    radius leaves the four corners hanging over whatever lies between s and
 *    1.414*s — which is where the rim is. That is the reported symptom: the
 *    corners did not sit evenly in the basin.
 *
 * The table that actually answers it, counting cells whose top surface pokes
 * more than 0.01 above the floor inside a square footprint of half-width s:
 *
 *     s      maxTopY   cells above floor
 *   0.450     0.417            0
 *   0.475     0.417            0     <- last fully clean footprint
 *   0.500     0.460            2
 *   0.591     0.469         ~380     <- what the old ROCK_SCALE produced
 *   0.675     0.718         1125
 *
 * At the old effective s of 0.591 roughly 380 cells of rock stood above the
 * basin floor inside the board's own footprint, up to 0.052 local units — which
 * at the old scale is 0.38 world units, more than the board slab's 0.30
 * thickness, so rock genuinely pushed up past the playing surface at the edges.
 *
 * ROCK_FIT_HALF_WIDTH is therefore 0.46, just inside the last clean value, and
 * it is fitted to the board's HALF-WIDTH in both X and Z (the footprint check
 * above is a square, so the corners are already accounted for).
 */
/*
 * Крок 13: ocean and snow each shipped their own rock/ledge model
 * (basalt-kelp-ledge, frosted-granite-ledge) with completely different basin
 * geometry from Mist's granite-pine-aerie — none of Mist's specific numbers
 * transfer. Each theme's (halfWidth, floorY) pair below is measured the exact
 * same way, per-model, via `node tools/measure-rock.mjs
 * public/models/<theme>/rock-island.glb` (see that file for the "why not a
 * Box3, why not vertex binning" reasoning) — halfWidth is the last square
 * footprint with 0 cells poking through the basin floor, floorY is the
 * histogram-mode top-surface height.
 *
 *   theme   halfWidth  floorY   notes
 *   mist    0.460      0.417    original derivation, granite-pine-aerie
 *   ocean   0.370      0.271    basalt-kelp-ledge — a much shallower, wider
 *                               ledge than mist's basin (raw rim only 0.073
 *                               above floor vs mist's ~0.25+), reads as flat
 *                               kelp-covered shelf rather than a deep bowl
 *   snow    0.410      0.577    frosted-granite-ledge — closer to mist's own
 *                               proportions (X/Z aspect 1.161 vs mist 1.164)
 */
const ROCK_FIT = {
  mist: { halfWidth: 0.46, floorY: 0.417 },
  ocean: { halfWidth: 0.37, floorY: 0.271 },
  snow: { halfWidth: 0.41, floorY: 0.577 },
};
const ROCK_FIT_HALF_WIDTH = ROCK_FIT[ACTIVE_THEME_KEY].halfWidth;
const ROCK_FLOOR_Y_RAW = ROCK_FIT[ACTIVE_THEME_KEY].floorY;
const ROCK_SCALE_XZ = BOARD_HALF_WIDTH / ROCK_FIT_HALF_WIDTH;

/*
 * Y is scaled SEPARATELY, and deliberately not by ROCK_SCALE_XZ.
 *
 * Widening the footprint 28% to seat the board would have raised the rim and
 * the pines by the same 28%, taking the rim's top from y=+2.85 to y=+3.75 world.
 * The camera at MAX_POLAR_ANGLE (1.25 rad) and CameraRig's resting distance
 * sits at y = 11.55*cos(72 deg) = 3.57 — i.e. the shallowest legal camera would
 * have ended up *below* the rim, looking into the outside of the bowl instead of
 * across the board. Holding Y at the previous scale keeps every height in the
 * scene exactly where the existing camera clamps were verified against, so this
 * change cannot reopen that question: the rock simply becomes a wider, shallower
 * bowl. On an irregular rock formation the anisotropy is not readable as one.
 *
 * Ocean/snow reuse Mist's own Y/XZ anisotropy RATIO (7.277/9.3478 = 0.7785)
 * rather than Mist's raw ROCK_SCALE_Y — their basins sit at a different raw
 * scale (ROCK_SCALE_XZ above differs per theme), so copying the absolute
 * number would not preserve the same "wide, shallow bowl" proportions Mist's
 * derivation solved for. This has not been re-verified against the camera
 * clamps the way Mist's was (see CLAUDE.md); it is a proportionate default,
 * not a re-derivation — flag before relying on it if the rim reads wrong at a
 * shallow camera angle in either new theme.
 */
const MIST_Y_XZ_RATIO = 7.277 / (4.3 / 0.46);
const ROCK_SCALE_Y = ACTIVE_THEME_KEY === 'mist' ? 7.277 : ROCK_SCALE_XZ * MIST_Y_XZ_RATIO;
const ROCK_Y_OFFSET = Y - ROCK_FLOOR_Y_RAW * ROCK_SCALE_Y;

/*
 * Крок 14: a smooth, uniform platform directly under the board.
 *
 * The rock's flat basin floor (ROCK_FIT_HALF_WIDTH above) is one continuous
 * mesh sharing the baked granite/pine material everywhere — there is no
 * surface distinct from the rest of the formation right where the board
 * actually sits, so a thin sliver of textured, faceted rock showed at the
 * board's own edge. This sits on top of that floor, flush with the board's
 * resting height (Y), with a plain material carrying no baked maps at all —
 * that absence of texture is the point, a deliberately worked/polished patch
 * against the raw stone around it.
 *
 * A box, not a circle: the board's own footprint is square (Board.jsx's slab
 * is a boxGeometry), and TemporaryPedestal's circular disc below is sized to
 * be "a little wider than the board" for a fallback ground plane, not to
 * hug a square's corners — at PEDESTAL_RADIUS a circle doesn't even reach
 * the square footprint's own corners (half-diagonal BOARD_HALF_WIDTH*sqrt(2)
 * is bigger than PEDESTAL_RADIUS). A box avoids that gap entirely.
 */
export const SHOW_BOARD_PLATFORM = true;
const PLATFORM_HALF_WIDTH = BOARD_HALF_WIDTH * 1.06;
const PLATFORM_THICKNESS = 0.02;
// The rock's own flat basin floor sits at EXACTLY y = Y (RockModel's scale/
// offset is solved so ROCK_FLOOR_Y_RAW * ROCK_SCALE_Y + ROCK_Y_OFFSET = Y) —
// a platform top face placed at that same Y would be coplanar with the rock's
// own surface there and z-fight with it. Lifted a couple millimeters proud of
// it instead, comfortably clear of the board slab's own bottom (~Y + 0.005
// per the "board slab spans y -0.31..-0.01" note above) so it never pokes
// into the board either.
const PLATFORM_TOP_Y = Y + 0.003;
// A quiet warm grey sitting between the rock's own tint (#B9B4A8) and the
// board frame's near-black (#2A241C) — smoother (lower roughness) than the
// surrounding granite so it reads as worked stone, not more raw rock.
const PLATFORM_COLOR = '#8C8577';
const PLATFORM_ROUGHNESS = 0.4;

function BoardPlatform() {
  return (
    <mesh position={[0, PLATFORM_TOP_Y - PLATFORM_THICKNESS / 2, 0]} receiveShadow>
      <boxGeometry args={[PLATFORM_HALF_WIDTH * 2, PLATFORM_THICKNESS, PLATFORM_HALF_WIDTH * 2]} />
      <meshStandardMaterial color={PLATFORM_COLOR} roughness={PLATFORM_ROUGHNESS} metalness={0} />
    </mesh>
  );
}

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
 * Loads and fits the real GLB rock formation.
 *
 * Unlike PieceModel.jsx — which replaces Mint's materials outright, because the
 * bone/lacquer palette is load-bearing for reading the board — this KEEPS the
 * loaded material and its three baked maps, and only adjusts the surface
 * response. See applyRockMaterial above for why.
 *
 * Scale/position come from the constants above, measured once with
 * tools/measure-rock.mjs. This is a single static asset, so nothing here is
 * recomputed at runtime.
 */
function RockModel() {
  const { scene } = useGLTF(ROCK_MODEL);

  const instance = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((node) => {
      if (!node.isMesh) return;
      /*
       * scene.clone(true) shares materials with the cached useGLTF scene, so
       * mutating in place would edit drei's cache entry — harmless today (one
       * instance) but it would silently leak into any future second use of the
       * same model. Clone the material, then adjust the clone.
       */
      node.material = applyRockMaterial(node.material.clone());
      // It's the lowest thing in the scene — nothing below it to shadow.
      node.castShadow = false;
      // Catches the board's own shadow, same job TemporaryPedestal's
      // receiveShadow does.
      node.receiveShadow = true;
    });
    // Non-uniform on purpose — see ROCK_SCALE_Y's comment. three derives the
    // normal matrix as the inverse-transpose of this, so lighting stays correct.
    clone.scale.set(ROCK_SCALE_XZ, ROCK_SCALE_Y, ROCK_SCALE_XZ);
    clone.position.y = ROCK_Y_OFFSET;
    return clone;
  }, [scene]);

  return <primitive object={instance} />;
}

export default function RockIsland() {
  if (!SHOW_ROCK_ISLAND) return null;
  return (
    <>
      {ROCK_MODEL ? <RockModel /> : <TemporaryPedestal />}
      {SHOW_BOARD_PLATFORM && <BoardPlatform />}
    </>
  );
}
