// Pure math. No three.js imports allowed in this file.

// Shared by the cinematic intro's camera moves (IntroCameraRig.jsx) and the
// board's piece-move animation (Pieces.jsx) — both want the same "slow,
// slow, fast middle, slow" shape, not a linear interpolation.
export function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

// Fast start, long tail. Крок 10, Section C's fog-dispersal wave and the
// enemy-piece reveal fade both want a burst that reads as movement passing
// through, not a linear crossfade.
export function easeOutCubic(x) {
  return 1 - (1 - x) ** 3;
}
