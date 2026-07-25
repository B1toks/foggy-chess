// Pure fog config + mask math. No three.js imports allowed in this file.

// Switch to 'tier1' to fall back to the plain per-square planes in
// components/FogLayer.jsx if the shader ever misbehaves. Both implementations
// are kept working on purpose.
export const FOG_MODE = 'tier2';

export const FOG_COLOR = '#EDEBE3';
export const FOG_OPACITY = 0.85;
export const FOG_LERP_SPEED = 3;

// Second, raised sheet (Tier 2 only). Kept faint and low on purpose — see the
// FOG_HEIGHT note: anything above the board occludes far squares at shallow
// camera angles. If the board ever looks milky from a low angle, drop this to
// 0 and the effect degrades cleanly to the single ground sheet.
export const FOG_DRIFT_OPACITY = 0.2;
export const FOG_DRIFT_HEIGHT = 0.1;

// The fog sits just above the tiles, NOT above the pieces. Floating it over
// the pieces means a shallow camera looks through every fogged square between
// it and a distant piece, washing the whole board out. Nothing ever pokes
// through at this height either: a square holding one of your own pieces is
// always visible (so never fogged), and enemy pieces inside the fog are not
// rendered at all.
export const FOG_HEIGHT = 0.05;
// Highlights ride just above the fog so legal-move markers stay crisp even
// when the target square is still unexplored.
export const HIGHLIGHT_HEIGHT = 0.07;

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
