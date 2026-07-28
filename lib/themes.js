// Pure data + URL theme selection. No three.js imports allowed in this file —
// components turn these hex strings into THREE.Color instances themselves.

export const DEFAULT_THEME = 'mist';

/*
 * Крок 13: the fog shader only has three LIVE color uniforms left after Крок
 * 12's rework (see FogShader.jsx — FOG_DEPTH_COLOR_LOW/HIGH/MID are dead
 * constants, superseded and unread since the deep-field-is-a-constant fix).
 * The real knobs are uColorShadow/uColorLit/uTint (FOG_SHADOW_COLOR/
 * FOG_LIT_COLOR/FOG_TINT_COLOR), plus FOG_COLOR for the tier-1 rollback plane.
 *
 * Rather than hand-picking four new hex values per theme (and risking
 * breaking the luma relationships tools/fogdiag.mjs verifies — SHADOW must
 * stay darker than LIT, etc.), `retint()` below takes Mist's own set, keeps
 * each constant's LIGHTNESS exactly as Мist tuned it, and replaces only hue
 * and saturation with the theme's own. fogdiag's occlusion/leak checks are
 * alpha-driven and measure luma, not hue, so this is safe by construction —
 * verified after wiring with tools/fogdiag.mjs (see CLAUDE.md).
 */
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h, s, l) {
  h /= 360;
  s /= 100;
  l /= 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

function hexToHsl(hex) {
  return rgbToHsl(...hexToRgb(hex));
}

// Recolors `hex` to `hue`/`sat`, keeping its own lightness untouched.
function retint(hex, hue, sat) {
  const [, , l] = hexToHsl(hex);
  return rgbToHex(...hslToRgb(hue, sat, l));
}

const MIST_FOG = {
  color: '#EDEBE3',
  shadow: '#A3AAAF',
  lit: '#E6E9E5',
  tint: '#B8BDC2',
};

// Mist's own rock tint (see RockIsland.jsx's applyRockMaterial) — a light
// warm grey multiplied over Mint's baked granite/pine albedo so it doesn't
// read as pale paper against this scene's light key.
const MIST_ROCK_TINT = '#B9B4A8';

function fogPaletteFor(anchorHex) {
  const [hue, sat] = hexToHsl(anchorHex);
  return {
    color: retint(MIST_FOG.color, hue, sat),
    shadow: retint(MIST_FOG.shadow, hue, sat),
    lit: retint(MIST_FOG.lit, hue, sat),
    tint: retint(MIST_FOG.tint, hue, sat),
  };
}

/*
 * Крок 17: the plain retint (hue/sat from the anchor, Mist's own tint's
 * LIGHTNESS untouched) reads as barely-there on the rock specifically —
 * unlike the fog constants this same retint() is used for, Mist's rock tint
 * (`MIST_ROCK_TINT`, #B9B4A8) is already a light, fairly desaturated warm
 * grey, so keeping that same high lightness on a re-hued copy produces a
 * pale, washed-out pastel that a multiply pass barely shifts against the
 * baked granite texture underneath. Boosting saturation (capped at 100) and
 * pulling lightness down a little makes the multiply actually move the
 * rock's perceived colour toward the theme instead of just toward "slightly
 * less grey."
 */
function rockTintFor(anchorHex) {
  const [hue, sat, lightness] = hexToHsl(anchorHex);
  const boostedSat = Math.min(100, sat * 1.5);
  const [, , baseLightness] = hexToHsl(MIST_ROCK_TINT);
  const targetLightness = baseLightness * 0.8 + lightness * 0.2;
  return rgbToHex(...hslToRgb(hue, boostedSat, targetLightness));
}

export const THEMES = {
  mist: {
    label: 'Mist',
    modelDir: '/models/mist',
    board: { light: '#E0D6C0', dark: '#8B7F6A' },
    accent: '#C1440E',
    // Live BONE value as of Крок 14 (components/PieceModel.jsx) — CLAUDE.md's
    // palette table still says #DDD3BE; that discrepancy is tracked
    // separately (see Крок 13 CLAUDE.md notes) and deliberately left alone
    // here, this registry just mirrors the code that actually ships.
    pieceWhiteColor: '#a08c55',
    rockTint: MIST_ROCK_TINT,
    fog: MIST_FOG,
    // Backdrop.jsx's own BACKDROP_MODE constant is still the rollback switch
    // for mist's specific painted-valley content (procedural/image/splat);
    // this splatUrl is only consulted when that constant is 'splat'.
    //
    // Крок 16, Section B: `splat` is this capture's own placement — kept here
    // rather than only as SplatBackdrop.jsx's old module-level DEFAULTS, so
    // every theme's splat transform lives next to its own URL and the
    // component itself can stay theme-agnostic. Values unchanged from before
    // this pass (still the ones tuned live against this specific capture).
    // Крок 17: tried enabling this, twice, with two different reasoned
    // scale/position pairs (this capture's own measured extent — see
    // CLAUDE.md's Gaussian splat backdrop section — is already Y-up, unlike
    // snow's, so rotX -90 was the WRONG correction to copy over; that's what
    // produced the "wall standing next to the island" symptom this pass was
    // trying to fix in the first place). Both reasoned attempts still read
    // as cluttered/buried rather than a clean vista under the island —
    // consistent with this project's own pre-theme-system history for this
    // exact file ("What was tried and rejected": scale 12, 2, and 1 all
    // failed the same way). Reverted to `mode: 'image'`. `splat` below is
    // left as a starting point for a future live-browser attempt, not a
    // verified value — rotation in particular should NOT be copied from
    // snow's fix without re-deriving this capture's own up-axis first.
    backdrop: {
      mode: 'image',
      image: '/textures/mountains.jpg',
      splatUrl: '/sumi-e-mountain-valley-6472fa791839e183.spz',
      splat: { scale: 3, rotation: [0, 0, 0], position: [-48, -5.9, 36] },
    },
  },
  ocean: {
    label: 'Ocean Depths',
    modelDir: '/models/ocean',
    board: { light: '#B8CCC8', dark: '#3C5A56' },
    // Not cinnabar here on purpose — a pale cyan bioluminescent flash reads
    // better against this theme's cold palette than the warm ember Mist/Snow
    // share.
    accent: '#4FD0C4',
    pieceWhiteColor: '#B8CCC8',
    rockTint: rockTintFor('#3C5A56'),
    fog: fogPaletteFor('#2A4A48'),
    // Крок 17: briefly turned this on (splat downsampling to 35% of splats
    // kept the render clean in this environment's headless test — see
    // components/SplatBackdrop.jsx's downsampleSplats), but reverted back to
    // 'image' alongside mist and snow: a 1.9M-point Gaussian splat is still a
    // real per-device VRAM/fps cost this environment cannot fully measure
    // (see CLAUDE.md's "Headless browser"), and the user's own hardware
    // reported 20fps/90% VRAM before the downsample was even added. Not
    // worth shipping three unverified-on-real-hardware splats under time
    // pressure when the procedural fallback (Mountains.jsx, ~160K triangles
    // total scene) already renders correctly and fast. `splat` below is left
    // as a starting placement for a future attempt, not verified — it mirrors
    // snow's own corrected up-axis fix but was never independently checked
    // against this specific capture.
    // Крок 18: a real painted panorama (Mint-generated, matching Mist's own
    // sumi-e style) — see Backdrop.jsx's USES_PAINTING, now theme-generic
    // rather than mist-only.
    backdrop: {
      mode: 'image',
      image: '/textures/ocean-valley.png',
      splatUrl: '/ink-wash-sea-canyon-4b924cffda141b26.spz',
      splat: { scale: 12, rotation: [-90, 0, 0], position: [0, 0, 0] },
    },
  },
  snow: {
    label: 'Snow Blizzard',
    modelDir: '/models/snow',
    board: { light: '#E8EEF0', dark: '#7A8A94' },
    // Same ember as Mist: warm against a cold world reads as a strong,
    // deliberate contrast rather than a mismatch.
    accent: '#C1440E',
    pieceWhiteColor: '#E8EEF0',
    rockTint: rockTintFor('#7A8A94'),
    fog: fogPaletteFor('#DDE6E8'),
    // Крок 17: reverted from 'splat' back to 'image' alongside mist/ocean —
    // see ocean's own backdrop comment above for why (real device perf
    // report of 20fps/90% VRAM, unverifiable further from this headless
    // environment). Snow's splat was the one capture in this project that
    // WAS successfully placed (Крок 16, Section B) — this is a performance
    // call, not a placement failure like mist's.
    backdrop: {
      mode: 'image',
      // Крок 18: Mint-generated sumi-e panorama, matching Mist's own style —
      // see Backdrop.jsx's USES_PAINTING.
      image: '/textures/snow-valley.png',
      // Delivered filename, not renamed to match the brief's assumed
      // public/world/snow.spz — see CLAUDE.md's Крок 13 notes. Kept at the
      // public/ root next to the existing mountain-valley splat for the same
      // reason that one lives there.
      splatUrl: '/ink-wash-snow-plateau-f20dac755e66664b.spz',
      // Falls back to the procedural Mountains shells (Backdrop.jsx) rather
      // than a bespoke painted snow frame — no tooling in this pass to
      // extract a still frame from the .spz. See CLAUDE.md.
      fallbackMode: 'procedural',
      /*
       * Крок 16, Section B: this capture rendered as a giant pale wall
       * filling most of the frame — "перевернутий сніговий сплат" — with
       * Mist's own splat rotation (rotX 180) reused verbatim. Diagnosed by
       * sweeping `?sprotX=` against the live scene: SPZ captures commonly
       * store Z as "up" (a photogrammetry/COLMAP convention) rather than
       * three.js's Y-up, and rotX -90 (rotate the Z-up capture down onto
       * three's Y-up) turns it into a recognisable snowy rock plateau from
       * both a corner shot and a shallow near-level one (see git history /
       * tools/shots for the before/after screenshots this was verified
       * against). Scale/position are still Mist's own numbers, unverified
       * beyond "doesn't look broken" — real placement tuning needs a real
       * GPU and an eye per CLAUDE.md's splat section, not this headless
       * environment.
       */
      splat: { scale: 12, rotation: [-90, 0, 0], position: [0, 0, 0] },
    },
  },
};

export function themeKeyFromUrl() {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const q = new URLSearchParams(window.location.search);
  const key = q.get('theme');
  return THEMES[key] ? key : DEFAULT_THEME;
}

export function pieceModelPath(themeKey, type) {
  return `${THEMES[themeKey].modelDir}/${type}.glb`;
}

export function rockModelPath(themeKey) {
  return `${THEMES[themeKey].modelDir}/rock-island.glb`;
}
