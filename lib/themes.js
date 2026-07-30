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
    // `backdrop.mode` alone decides this now — Backdrop.jsx's old mist-only
    // BACKDROP_MODE constant is gone as of Крок 18, and `usesThemeSplat` is a
    // uniform per-theme check. `splatUrl` is consulted when mode is 'splat'.
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
    // failed the same way). Reverted to `mode: 'image'`.
    /*
     * Крок 23: OFF. All three themes ship on the painted panorama — the one
     * backdrop path with a real-device fps/VRAM signal behind it (Крок 17/18)
     * — and splat work is stopped. The whole derivation below is kept verbatim
     * because it is still the best-measured placement this capture has ever
     * had; re-enabling is `mode: 'image'` -> `'splat'` on this one field.
     *
     * Крок 22: the placement is solved rather than swept, against an
     * importance-pruned asset (see CLAUDE.md's Крок 22 for the full account).
     *
     * The scale/position/rotation below all come out of one derivation. This
     * capture is a panorama shot from INSIDE — local radius ~116 with no open
     * interior (nearest splat 0.1..1.5 local at every candidate clearing
     * centre), which is why every previous attempt to sit the camera in it
     * reported "buried in a hillside", and why placing it as an external body
     * is the only option left. So:
     *
     *   - rotY -196.6 swings the capture's own densest region (body centroid
     *     local [10, 35, -98], azimuth 174.2 deg) round to the direction the
     *     resting camera looks, which is the painted main segment's own
     *     azimuth (Backdrop.jsx: HOME_AZIMUTH - PI = -22.4 deg).
     *   - position is 60 world units out along that same azimuth, sunk so the
     *     capture's ridge tops (local y ~ +60) land 19 deg below horizontal as
     *     seen from the resting camera at y=7 — i.e. inside the band the
     *     resting camera actually frames, the same derivation Backdrop.jsx's
     *     own TOP_Y uses for the painting. A placement that misses that band
     *     is INVISIBLE at rest while still scoring well on a shallow-biased
     *     orbit scan; that trap cost a candidate this pass (rest coverage
     *     0.000 at posY 0).
     *   - scale 0.42 sets the range's own height to 45% of its distance.
     *     Appearance is invariant under a rigid scale-and-push (only s/D
     *     matters), so this pair is one point on a line; a farther, larger
     *     twin looks identical.
     *
     * Measured against snow's shipped placement (tools/place-splat.mjs, same
     * settings): rest-view frame coverage 0.410 vs snow's 0.418, fragments per
     * frame 2.7M vs snow's 5.5M, nearest in-frame splat 45.5 vs 35.6. Mist's
     * own old s3 transform above measured 31.6M fragments — 12x this — which
     * is the Ocean cost profile a real device already rejected at 20fps.
     * Coverage 180 deg away is exactly 0, so the painted segments still carry
     * the rest of the orbit.
     */
    backdrop: {
      mode: 'image',
      image: '/textures/mountains.jpg',
      // Крок 22: importance-pruned by tools/shrink-spz.mjs (60,000 splats,
      // 1.08 MB, from 1,920,000 / 33.26 MB). 26.43 dB against the full cloud
      // where the old fixed-stride policy measured 16.94 dB at the same count.
      // Shipped WITHOUT --declutter, unlike snow: this capture's content is
      // mostly diffuse ink-wash haze rather than solid surface, so decluttering
      // it strips the backdrop to two small rock clumps at 2-4% frame coverage.
      splatUrl: '/sumi-e-mountain-valley-opt.spz',
      splat: { scale: 0.42, rotation: [0, -196.6, 0], position: [-22.8, -38.7, 55.5] },
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
    // Крок 23: back to 'image' for good alongside mist and snow — see mist's
    // own backdrop comment. This capture is additionally the one this project
    // has measured as genuinely badly placed (shipped transform scales it 12x
    // around the board's own origin, putting the camera INSIDE it: ~880
    // fragment evaluations per pixel, CLAUDE.md's Крок 21), so it is the last
    // of the three anyone should reach for if splats are ever revisited.
    /*
     * Крок 24: ON — and the "last of the three anyone should reach for" note
     * above is answered rather than ignored. What made this capture the worst
     * of the three was never the asset, it was that one transform: scale 12
     * about the board's own origin puts the camera INSIDE the cloud. That is
     * fixed here, by the same derivation Крок 22 used for mist, so the reason
     * to rank it last no longer holds.
     *
     * The asset is unchanged from Крок 21 — importance-ranked, no --declutter,
     * 60,000 splats. A side-by-side splat-lab A/B against the full 1.92M cloud
     * found it near-indistinguishable at that count, which is what licenses
     * enabling it; --declutter stays OFF for this capture on that evidence.
     *
     * The placement is derived, not swept:
     *
     *   - rotation is Y-only. tools/probe-splat-axes.mjs re-confirms this
     *     capture is already Y-up (p01-p99 spread 14.89 on Y vs 27.58/27.71 on
     *     X/Z), so snow's rotX -90 correction stays off it — copying that onto
     *     an already-Y-up capture is exactly the bug Крок 20 records. rotY 135
     *     is chosen by measurement, not by eye: of the eight rotations scored
     *     it gives the highest rest-view coverage (0.440) at essentially the
     *     best nearest-splat distance, with zero coverage 180 deg away.
     *   - position is 60 world units out along the painted main segment's own
     *     azimuth (Backdrop.jsx: HOME_AZIMUTH - PI = -22.4 deg), sunk so the
     *     body's own p01..p99 height lands in the band between 21 and 38 deg
     *     below horizontal as seen from the resting camera at y=7 — the same
     *     visible-band derivation Backdrop.jsx's TOP_Y uses for the painting.
     *     Крок 22's trap applies here too and was avoided the same way: the
     *     candidates were scored against the RESTING camera explicitly, not
     *     just tools/place-splat.mjs's shallow-biased ring, because a
     *     placement can score well on that ring and sit entirely above the
     *     resting frame.
     *   - scale falls out of that band fit. Appearance is invariant under a
     *     rigid scale-and-push (only s/D matters) — confirmed here, D=45/60/75
     *     scored identical coverage and detail — so this is one point on a line.
     *
     * One derivation detail worth not re-deriving: the band must be fitted to
     * the body's UNWEIGHTED positional p01..p99 (height 14.89). Fitting it to
     * an importance-weighted extent instead reports height 51 and collapses
     * the island to 2% frame coverage, because importance ranking favours this
     * capture's detached-clutter tail (those splats are large and opaque —
     * the same property that makes --declutter matter for snow).
     *
     * Measured (CPU raster, 320x200, unoccluded) against the two placements
     * this project already accepts:
     *
     *   placement       nearest  restCov  restDetail  restMfrag  behindCov
     *   mist SHIPPED      45.5    0.410     0.100        2.7        0.000
     *   snow SHIPPED      35.6    0.418     0.108        5.5        —
     *   ocean (this)      50.5    0.440     0.216        3.0        0.000
     *   ocean OLD (s12)   ~15     —         —           ~36000M     —
     *
     * i.e. it frames like the other two, carries twice their luma structure,
     * costs about what mist costs, and sits farther from the camera than
     * either — against an old transform measured at four orders of magnitude
     * more fragment work. Coverage 180 deg away is exactly 0, so the painted
     * segments still carry the rest of the orbit unaided; the painting renders
     * underneath regardless (Backdrop.jsx's usesPainting is true whenever
     * `image` is set and mode is not 'procedural'), so this is a horizon band
     * layered on a proven-fast floor, never a replacement for it.
     *
     * Real fps/VRAM is unmeasured here as always (CLAUDE.md's "Headless
     * browser"). `?debug=1`'s FpsCounter on real hardware is the check;
     * `?spstddev=` / `?spkeep=` tune it without a rebuild, and `mode` back to
     * 'image' is the one-line revert onto a floor already proven fast.
     *
     * Крок 25: reverted to 'image', taking that one-line revert. Real-device
     * testing of this exact placement (165fps per the on-screen counter, but
     * 95% GPU and visible stutter) is the reason — see CLAUDE.md's Крок 25 for
     * the fuller account, including why the FPS counter and the actual
     * experience disagreed here. Everything above is kept because the
     * horizon-band placement itself is correctly derived and cheap (33
     * frag/px) — this revert is about the LATER enclosing-placement
     * experiments (also in CLAUDE.md), not about undoing this placement.
     * `splatUrl`/`splat` stay wired so `mode: 'image' -> 'splat'` is still a
     * one-line re-enable, same convention as mist/snow.
     */
    backdrop: {
      mode: 'image',
      image: '/textures/ocean-valley.png',
      // Крок 21: regenerated by tools/shrink-spz.mjs's importance-ranked
      // reducer (60,000 splats, 1.05 MB) replacing the fixed-stride
      // -shrunk.spz (288,000 splats, 4.88 MB). Fewer splats, ~4.6x smaller,
      // and +11.9 dB PSNR against the full cloud — see CLAUDE.md's Крок 21.
      splatUrl: '/ink-wash-sea-canyon-opt.spz',
      splat: { scale: 1.847, rotation: [0, 135, 0], position: [-17.33, -45.17, 53.25] },
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
    /*
     * Крок 23: OFF, with mist and ocean — see mist's own backdrop comment. The
     * Крок 21 derivation below is kept as the best-measured placement this
     * capture has.
     *
     * Крок 21: the placement is derived rather than inherited.
     *
     * Крок 16 Section B's claim that this capture "WAS successfully placed"
     * does not survive measurement. At its old transform (scale 12 at the
     * origin) tools/place-splat.mjs scores the camera's nearest in-frame splat
     * at 2.1 world units — INSIDE the board, whose half-width is 4.3 — with
     * frame coverage 0.998 and ~3,690 fragment evaluations per pixel. That is
     * the 20fps/90%-VRAM report's actual source, and it was judged fine from
     * two screenshots in an environment CLAUDE.md now documents as unable to
     * tell a good splat placement from a broken one.
     *
     * The transform below is solved, not swept by eye: the capture body's own
     * centroid is put at world [4, -32, 60], which is the elevation band the
     * resting camera actually frames (it pitches 37.3 degrees down, so the
     * visible band at that distance is world y -10.5 .. -25.3 — the same
     * derivation the painted backdrop's own TOP_Y uses, see Backdrop.jsx), and
     * scaled so the body reads as a distant massif rather than a wall the
     * camera stands inside. Measured against the old transform: nearest splat
     * 2.1 -> 32.0, fragments per frame 151M -> 5.4M (28x less overdraw).
     *
     * rotX -90 is KEPT and is independently confirmed correct — this capture
     * really is Z-up (tools/probe-splat-axes.mjs: p01-p99 spread 86.6 on Z vs
     * 104.1 / 118.5 on Y / X), unlike mist's, whose own comment records that
     * copying this correction was the bug rather than the fix.
     */
    backdrop: {
      mode: 'image',
      // Крок 18: Mint-generated sumi-e panorama, matching Mist's own style —
      // see Backdrop.jsx's usesPainting. As of Крок 23 this is what ships, not
      // a fallback under a splat.
      image: '/textures/snow-valley.png',
      // Крок 21: importance-pruned by tools/shrink-spz.mjs (60,000 splats,
      // 1.04 MB, from 1,920,000 / 31.8 MB). The raw delivered capture is kept
      // in public/ as the source the tool re-runs against.
      splatUrl: '/ink-wash-snow-plateau-opt.spz',
      // (A `fallbackMode: 'procedural'` field sat here from Крок 13, when snow
      // had no painting of its own. Крок 18 gave it one, and nothing ever read
      // the field — Backdrop.jsx keys purely off `image` + `mode`. Removed in
      // Крок 23 so it can't be misread as "snow ships the procedural ridges".)
      /*
       * Scale/position solved against the pruned asset's own body extent (the
       * declutter pass changes it, so these are not transferable to the raw
       * capture — regenerate and re-solve together). Every field is still
       * overridable live: `?spscale=` `?spposX/Y/Z=` `?sprotX/Y/Z=`, which is
       * the right way to make the final art call on a real screen.
       */
      splat: { scale: 1.2, rotation: [-90, 0, 0], position: [-20.7, -21.3, 62.4] },
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
