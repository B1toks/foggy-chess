// Pure fog config + mask math. No three.js imports allowed in this file.

// Switch to 'tier1' to fall back to the plain per-square planes in
// components/FogLayer.jsx if the shader ever misbehaves. Both implementations
// are kept working on purpose.
export const FOG_MODE = 'tier2';

export const FOG_COLOR = '#EDEBE3';
export const FOG_OPACITY = 0.85;
export const FOG_LERP_SPEED = 3;

/*
 * Крок 10, Section A: the Крок 9.5 fix (FOG_TINT_COLOR multiplying the
 * framebuffer, FOG_STRAND_COLOR painted over it) made fog *visible* on every
 * tile — measured -54/-28 luma at the time — but visible is not the same as
 * blind. Multiply blending can only ever scale what's underneath; it cannot
 * reach true opacity, so even the deepest fog still let a player tell light
 * tiles from dark ones by eye. In fog of war, deep fog has to be a wall:
 * looking at a square 3+ ranks away, a player should not be able to tell its
 * colour at all.
 *
 * The fix drops multiply blending as the *primary* mechanism entirely and
 * goes back to plain alpha — but this time actually reaching near-total
 * opacity in the deep field (FOG_MAX_ALPHA = 0.94) instead of stopping at
 * FOG_OPACITY's old 0.85 with a colour too pale to matter. At 0.94 alpha,
 * whatever tile colour is underneath contributes at most 6% of the final
 * pixel — that 6% ceiling is where the "< 6 luma difference" verification
 * criterion actually comes from, not a number picked to sound precise.
 *
 * FOG_ALPHA_KNEE (0.38) is where the smoothstep ramp saturates: below it,
 * alpha rises smoothly from 0 (this is what still tells the "a boundary is
 * here" story); at and above it, alpha sits flat at FOG_MAX_ALPHA. A knee
 * this low means most of the fogged field is already at full opacity, not
 * just its deepest interior — "deep" starts close to the frontier, which is
 * the point: half-fogged is not a state this game wants to spend much visual
 * area on.
 *
 * FOG_DEPTH_COLOR_LOW/HIGH replace the old FOG_STRAND_COLOR: a cool grey pair
 * (not the old pale near-white) that the noise field mixes between for
 * texture. They matter far less than they used to, precisely because alpha
 * is now doing the readability work on its own — colour is texture, not the
 * mechanism, which is the "math, not tricks" the brief asked for.
 *
 * FOG_TINT_COLOR survives, demoted: it's now only the *edge*-band multiply
 * pass (density 0.15-0.5, see FogShader.jsx) that adds a little extra depth
 * right at the frontier, on top of what the primary alpha layer already
 * carries — not the thing making fog visible at all anymore.
 *
 * Tier 1 (FogLayer.jsx) is unaffected and keeps using plain FOG_COLOR — it's
 * the rollback path, deliberately kept simple.
 */
export const FOG_MAX_ALPHA = 0.94;
export const FOG_ALPHA_KNEE = 0.38;
export const FOG_DEPTH_COLOR_LOW = '#B4B9BA';
export const FOG_DEPTH_COLOR_HIGH = '#DCDEDB';
// The flat tone the deep interior converges to as the noise-driven mix
// between LOW/HIGH above fades out with depth (see FogShader.jsx's
// `colorVariance`) — verification caught that mixing the full LOW-HIGH
// range at every density let two adjacent deep-fog pixels differ by more
// luma from noise phase alone than the "< 6" readability bar allows. #C4C8C7
// is the brief's own reference fog colour.
export const FOG_DEPTH_COLOR_MID = '#C4C8C7';
export const FOG_TINT_COLOR = '#B8BDC2';

/*
 * Крок 10, Section B: fog gets height instead of being a single sheet.
 * FOG_LAYERS is the master count — drop it 5 -> 4 -> 3 -> 2 as the first
 * performance lever if frame rate falls under 50 (see the perf ladder in
 * FogShader.jsx's own comment). FOG_LAYER_HEIGHTS/FOG_LAYER_ALPHA_MULT are
 * indexed in step with it; only the first FOG_LAYERS entries of each are
 * ever read, so dropping the count is a one-line change, not a re-tune.
 *
 * The base layer (index 0, y=0.02) is what FOG_MAX_ALPHA/FOG_ALPHA_KNEE
 * above are tuned against — it carries readability on its own, alpha
 * multiplier 1.0. Every layer above it is silhouette, not occlusion: alpha
 * multipliers fall off fast (0.55/0.35/0.2/0.1) specifically so a shallow
 * camera looking across several raised sheets at once can't stack them into
 * something opaque enough to wash out a square that should read as clear —
 * see "milkiness" in FogShader.jsx.
 */
export const FOG_LAYERS = 5;
export const FOG_LAYER_HEIGHTS = [0.02, 0.07, 0.14, 0.23, 0.34];
export const FOG_LAYER_ALPHA_MULT = [1.0, 0.55, 0.35, 0.2, 0.1];

// Ridged-noise octave counts for the wisp shader (FogShader.jsx). Higher is
// more detailed and more expensive — three fbm/ridged evaluations at 5
// octaves each, per pixel, per layer. If frame rate drops below 50, in
// order: drop FOG_LAYERS, then FOG_DETAIL_OCTAVES to 3, then
// FOG_ENABLE_DETAIL to false (removes the third noise scale entirely).
// Don't trade frame rate for fog detail — a simpler wisp shader at 60fps
// beats a fancier one at 30.
export const FOG_WISP_OCTAVES = 5;
export const FOG_DETAIL_OCTAVES = 5;
export const FOG_ENABLE_DETAIL = true;

// The fog's base sits just above the tiles, NOT above the pieces. Floating it
// over the pieces means a shallow camera looks through every fogged square
// between it and a distant piece, washing the whole board out. Nothing ever
// pokes through at this height either: a square holding one of your own
// pieces is always visible (so never fogged), and enemy pieces inside the fog
// are not rendered at all.
export const FOG_HEIGHT = FOG_LAYER_HEIGHTS[0];
// Highlights ride just above the *tallest* fog layer so legal-move markers
// stay crisp even when the target square is still unexplored.
export const HIGHLIGHT_HEIGHT = FOG_LAYER_HEIGHTS[FOG_LAYER_HEIGHTS.length - 1] + 0.02;

const FILES = 'abcdefgh';

export const ALL_SQUARES = FILES.split('').flatMap((file) =>
  [1, 2, 3, 4, 5, 6, 7, 8].map((rank) => `${file}${rank}`),
);

/**
 * Index into the 8x8 fog mask texture for a square.
 *
 * Derivation: the fog plane is a PlaneGeometry rotated -90deg about X, which
 * maps local (x, y) -> world (x, -y). So world x = -4 + 8*uv.x and world
 * z = 4 - 8*uv.y. Matching those against squareToWorld (x = file - 3.5,
 * z = rank - 1 - 3.5) gives column = file and row = 8 - rank. DataTexture
 * keeps flipY false, so data row 0 is v = 0.
 */
export function squareToMaskIndex(square) {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return (8 - rank) * 8 + file;
}
