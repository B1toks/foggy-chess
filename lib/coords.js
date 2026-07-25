// Pure coordinate math. No three.js imports allowed in this file.

const FILES = 'abcdefgh';

// Board is centered at the origin, one unit per cell, a1 in the corner.
export function squareToWorld(square) {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  const x = file - 3.5;
  const z = rank - 3.5;
  return [x, 0, z];
}

export function worldToSquare(x, z) {
  const file = Math.round(x + 3.5);
  const rank = Math.round(z + 3.5);
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return FILES[file] + (rank + 1);
}
