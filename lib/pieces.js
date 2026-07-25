// Pure data. No three.js imports allowed in this file.

// The single knob for fitting pieces to a 1-unit board square. Tune this,
// never the individual targetHeights — the table below is the locked-in
// proportion ladder between pieces.
export const PIECE_SCALE = 1.45;

export const PIECE_CONFIG = {
  king: { model: '/models/king.glb', targetHeight: 1.0 },
  queen: { model: '/models/queen.glb', targetHeight: 0.92 },
  rook: { model: '/models/rook.glb', targetHeight: 0.68 },
  bishop: { model: '/models/bishop.glb', targetHeight: 0.8 },
  // Deliberately below the rook: the knight's footprint is ~2x the king's
  // (0.617 vs 0.325 deep), so matching it on height alone made it read as the
  // biggest piece on the board. Shorter height balances its visual mass.
  knight: { model: '/models/knight.glb', targetHeight: 0.7 },
  pawn: { model: '/models/pawn.glb', targetHeight: 0.55 },
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
