// Крок 14: the king may capture an adjacent defended piece.
//
// Standard chess forbids this: chess.js's own legality filter (`_moves()`,
// see node_modules/chess.js/dist/esm/chess.js ~2354-2489) generates every
// pseudo-legal move for every piece identically, then drops whichever ones
// leave the mover's own king attacked afterward. For a king move, that check
// runs against the king's OWN new square — so a king "capturing" a defended
// piece is filtered out because the defender still attacks that square the
// instant the capture lands. There is no king-specific rule in chess.js at
// all; it falls out entirely of the generic "does this leave my king
// attacked" filter, which happens to be evaluated at the king's own
// destination when the king itself is the piece that moved.
//
// This module selectively bypasses exactly that one case — a king's own
// capturing move — by asking chess.js's own pseudo-legal generator
// (`_moves({legal:false})`, the same generator the legal filter above
// already runs its check against) for the king's candidate moves, and
// committing the accepted one through chess.js's own commit path
// (`_makeMove` + `_incPositionCount`, the exact two calls the public `move()`
// wrapper makes after its own legality check passes — see chess.js
// ~2541-2544). That keeps `history()`, `fen()`, threefold-repetition
// counting, and turn bookkeeping all consistent, because it IS chess.js's
// own move-commit code, just reached without going through the legality
// gate that would otherwise reject this one case.
//
// `_moves`/`_makeMove`/`_incPositionCount` are ordinary (non-`#private`)
// instance methods, not part of chess.js's documented public API — reachable
// today because JS's leading-underscore convention doesn't actually enforce
// privacy, but not a guaranteed-stable contract across chess.js versions.
// Confirmed against the pinned ^1.0.0 (resolves to 1.4.0); re-check this
// file against node_modules/chess.js if that version ever moves, per this
// project's usual chess.js rule (see CLAUDE.md's "Hard rules").
//
// No three.js in this file — lib/ stays pure game logic, testable with
// plain Node (see lib/rules.test.js).

// chess.js's own internal board index (0x88 board representation) is not
// exported, but the formula is standard and derivable independently: file
// a-h maps to 0-7, and each rank down from 8 adds 16 (not 8 — the upper
// nibble of the index is what `& 0x88` uses to detect off-board squares).
function squareToOx88(square) {
  const file = square.charCodeAt(0) - 97; // 'a' -> 0
  const rank = Number(square[1]); // 1-8
  return (8 - rank) * 16 + file;
}

function ox88ToSquare(index) {
  const file = index & 0xf;
  const rankRow = index >> 4; // 0 for rank 8, 7 for rank 1
  return String.fromCharCode(97 + file) + (8 - rankRow);
}

function isCurrentTurnKing(game, square) {
  const piece = game.get(square);
  return !!piece && piece.type === 'k' && piece.color === game.turn();
}

/**
 * Algebraic square of `color`'s king, or null if it's been captured (see
 * `kingIsCaptured` below — this is the same missing-king state, just
 * returning the square when there is one).
 */
export function findKingSquare(game, color) {
  const squares = game.findPiece({ type: 'k', color });
  return squares[0] ?? null;
}

/** True once a color's king has actually been captured off the board. */
export function kingIsCaptured(game, color) {
  return game.findPiece({ type: 'k', color }).length === 0;
}

/**
 * Extra capture targets for the king on `square`, beyond whatever
 * `game.moves({square, verbose:true})` already legally allows — i.e. exactly
 * the adjacent enemy-occupied squares chess.js's own legality filter rejects
 * only because the destination would still be attacked after the capture.
 *
 * Only meaningful (and only ever non-empty) when `square` holds the
 * currently-to-move side's own king: pseudo-legal generation is itself
 * restricted to the side to move (chess.js's `_moves()` only ever generates
 * moves for `this._turn`), and this function additionally guards against
 * being handed some other piece's square, where a pseudo-legal-vs-legal gap
 * would mean a genuine pin or discovered check — something this feature must
 * never relax.
 */
export function extraKingCaptureTargets(game, square) {
  if (!isCurrentTurnKing(game, square)) return [];

  const pseudoLegal = game._moves({ square, legal: false });
  const alreadyLegal = new Set(game.moves({ square, verbose: true }).map((m) => m.to));

  const extra = [];
  for (const move of pseudoLegal) {
    if (!move.captured) continue;
    const to = ox88ToSquare(move.to);
    if (alreadyLegal.has(to)) continue;
    extra.push(to);
  }
  return extra;
}

/**
 * True when the side to move's king has an escape via
 * `extraKingCaptureTargets` — capturing an adjacent defended piece.
 *
 * `useChessGame`'s `computeStatus` needs this: chess.js's own
 * `isCheckmate()`/`isDraw()` (which folds in stalemate) are computed from
 * `_moves()`'s regular legal-move list, which has no idea this rule exists.
 * A position chess.js calls checkmate specifically because the only escape
 * was capturing a defended checking piece — the exact scenario this whole
 * feature is for — would otherwise end the game one move before the player
 * (or the AI) ever gets to use the ability that was supposed to save them.
 * Same reasoning for stalemate: a legal king capture chess.js's generator
 * doesn't see means the position isn't actually dead.
 */
export function hasKingCaptureEscape(game) {
  const kingSquare = findKingSquare(game, game.turn());
  return !!kingSquare && extraKingCaptureTargets(game, kingSquare).length > 0;
}

/**
 * True when the side to move can, right now, capture the opponent's king
 * through a completely ordinary, unmodified chess.js legal move — reachable
 * only once a king is sitting adjacent to (or otherwise attacked by) the
 * enemy, which normal play never produces but this rule deliberately can.
 *
 * `useChessGame`'s `computeStatus` needs this for the same reason as
 * `hasKingCaptureEscape`, but for a different chess.js quirk: once a king's
 * own capture leaves it standing next to the enemy king, chess.js's
 * `isDraw()` sees two lone kings and calls it insufficient-material draw —
 * correct for a position that could truly never resolve, wrong here, since
 * the very next move can simply end the game by taking the exposed king.
 * "Two kings left" is not the same as "nothing left to decide" once kings
 * can stand next to each other at all.
 */
export function canCaptureEnemyKing(game) {
  return game.moves({ verbose: true }).some((move) => move.captured === 'k');
}

/**
 * Commits a king's capture of a defended piece — one of `extraKingCaptureTargets`'
 * own results — bypassing chess.js's public `move()` (which would throw,
 * since this move is absent from its legal-moves list by design).
 *
 * Returns the ugly chess.js move object on success (same shape `_moves()`
 * produces: {color, from, to, piece, captured, flags}, numeric from/to) or
 * null if `to` isn't actually one of this king's pseudo-legal captures.
 */
export function tryKingCapture(game, from, to) {
  if (!isCurrentTurnKing(game, from)) return null;

  const pseudoLegal = game._moves({ square: from, legal: false });
  const targetIndex = squareToOx88(to);
  const match = pseudoLegal.find((move) => move.captured && move.to === targetIndex);
  if (!match) return null;

  game._makeMove(match);
  game._incPositionCount();
  return match;
}
