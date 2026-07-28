// Pure data. No three.js imports allowed in this file.

// The single knob for fitting pieces to a 1-unit board square. Tune this,
// never the individual targetHeights — the table below is the locked-in
// proportion ladder between pieces.
export const PIECE_SCALE = 1.45;

/*
 * Крок 13: model paths moved to lib/themes.js (one set per theme — mist/
 * ocean/snow, see THEMES). This ladder is the proportion table Mist's models
 * were measured against (see CLAUDE.md's "3D models" section for the
 * per-piece footprint/clearance derivation) and is deliberately reused
 * as-is for the new sets rather than re-derived per theme — same targetHeight
 * table, per Крок 13's own brief.
 */
export const PIECE_HEIGHTS = {
  king: 1.0,
  queen: 0.92,
  rook: 0.68,
  bishop: 0.8,
  // Deliberately below the rook: the knight's footprint is ~2x the king's
  // (0.617 vs 0.325 deep), so matching it on height alone made it read as the
  // biggest piece on the board. Shorter height balances its visual mass.
  knight: 0.7,
  pawn: 0.55,
};

// chess.js board cells use single-letter type codes.
export const CODE_TO_PIECE = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
};
