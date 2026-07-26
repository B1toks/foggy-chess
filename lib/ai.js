// Pure greedy opponent. No three.js imports allowed in this file.

import { extraKingCaptureTargets, findKingSquare } from './kingCapture';

// Крок 14: k went from 0 to Infinity. A king is never a legal capture target
// under normal chess.js play, so the old value of 0 never mattered — but
// lib/kingCapture.js's king-captures-a-defended-piece rule means an enemy
// king can now genuinely be `m.captured`, and at 0 it would rank behind
// every other capture (even a pawn), so the AI would routinely pass up a
// king it was actually offered. Infinity means an available king capture
// always wins the sort below.
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: Infinity };

export const AI_MOVE_DELAY_MS = 400;

// Picks a move for whichever color chess.js currently has to move.
// Prefers the highest-value capture available; otherwise a random legal move.
export function pickGreedyMove(game) {
  const moves = game.moves({ verbose: true });
  const captures = moves.filter((m) => m.captured);

  /*
   * Крок 14: the king's own extra capture targets (a defended piece,
   * normally illegal — see lib/kingCapture.js) never appear in chess.js's
   * own `moves()` output, so they're synthesized here as lightweight
   * {from, to, captured} descriptors and folded into the same candidate
   * pool the sort below already ranks. This is the only place a capturing
   * move needs synthesizing: the *other* direction (some other piece
   * capturing an already-exposed enemy king) is a fully ordinary, already-
   * legal chess.js move once that board state exists.
   */
  const kingSquare = findKingSquare(game, game.turn());
  if (kingSquare) {
    for (const to of extraKingCaptureTargets(game, kingSquare)) {
      const target = game.get(to);
      if (target) captures.push({ from: kingSquare, to, captured: target.type });
    }
  }

  if (captures.length > 0) {
    captures.sort((a, b) => PIECE_VALUES[b.captured] - PIECE_VALUES[a.captured]);
    return captures[0];
  }

  if (moves.length === 0) return null;
  return moves[Math.floor(Math.random() * moves.length)];
}
