// Pure greedy opponent. No three.js imports allowed in this file.

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const AI_MOVE_DELAY_MS = 400;

// Picks a move for whichever color chess.js currently has to move.
// Prefers the highest-value capture available; otherwise a random legal move.
export function pickGreedyMove(game) {
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return null;

  const captures = moves.filter((m) => m.captured);
  if (captures.length > 0) {
    captures.sort((a, b) => PIECE_VALUES[b.captured] - PIECE_VALUES[a.captured]);
    return captures[0];
  }

  return moves[Math.floor(Math.random() * moves.length)];
}
