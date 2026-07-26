// Pure game-state hook wrapping chess.js. No three.js imports allowed in this file.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { AI_MOVE_DELAY_MS, pickGreedyMove } from './ai';
import {
  canCaptureEnemyKing,
  extraKingCaptureTargets,
  hasKingCaptureEscape,
  kingIsCaptured,
  tryKingCapture,
} from './kingCapture';

/*
 * Крок 14: a captured king is checked FIRST, before any of chess.js's own
 * status methods. Those assume `_kings[color]` is a valid square — once a
 * king is actually gone from the board (only reachable via the king's-own-
 * capture bypass in lib/kingCapture.js; normal play never produces this
 * state), isCheckmate()/isCheck() stay well-behaved (verified directly: they
 * return false, not throw) but isDraw() reports true for the wrong reason
 * (insufficient material once one side has nothing left) — a real answer to
 * a different question. Checking the missing king first means that quirk
 * never has a chance to surface.
 *
 * hasKingCaptureEscape/canCaptureEnemyKing guard the checkmate/draw calls
 * themselves: chess.js computes both from its own legal-move list and its
 * own material count, neither of which knows this rule exists.
 *
 * - hasKingCaptureEscape: a position that's checkmate/stalemate
 *   *specifically because* the only way out was capturing a defended
 *   checking piece would otherwise end the game one move before the
 *   ability meant to save it ever gets used — exactly backwards from the
 *   point of this feature.
 * - canCaptureEnemyKing: once a king's own capture leaves it standing next
 *   to the enemy king (only reachable through this rule), chess.js's
 *   isDraw() sees two lone kings and calls it an insufficient-material
 *   draw — correct for a position that could truly never resolve, wrong
 *   here, since the very next move can simply end the game by taking the
 *   exposed king. Verified this actually fires in the browser, not just in
 *   theory: capturing a defended rook down to a bare king vs king reported
 *   'draw' on the very next status computation, before black ever got the
 *   chance to take the exposed white king.
 *
 * Both fall through to 'check'/'playing', already-existing states that
 * correctly mean "still playing."
 */
function computeStatus(game) {
  if (kingIsCaptured(game, 'w')) return 'whiteKingCaptured';
  if (kingIsCaptured(game, 'b')) return 'blackKingCaptured';
  const hasEscape = hasKingCaptureEscape(game) || canCaptureEnemyKing(game);
  if (game.isCheckmate()) return hasEscape ? 'check' : 'checkmate';
  if (game.isDraw()) return hasEscape ? 'playing' : 'draw';
  if (game.isCheck()) return 'check';
  return 'playing';
}

export const GAME_OVER_STATUSES = ['checkmate', 'draw', 'whiteKingCaptured', 'blackKingCaptured'];

/**
 * @param initialFen optional starting position. Only used to reach specific
 * states (mate, stalemate) for QA — a random-moving AI will not get there on
 * its own. `reset` always returns to the standard opening.
 */
export function useChessGame(initialFen) {
  const gameRef = useRef(null);
  if (gameRef.current === null) {
    const game = new Chess();
    if (initialFen) {
      try {
        game.load(initialFen);
      } catch {
        // Ignore a malformed FEN and just play a normal game.
      }
    }
    gameRef.current = game;
  }
  const game = gameRef.current;

  // Bumped after every mutation so React re-renders; chess.js mutates `game` in place.
  const [version, setVersion] = useState(0);

  const board = useMemo(() => game.board(), [game, version]);
  const turn = useMemo(() => game.turn(), [game, version]);
  const status = useMemo(() => computeStatus(game), [game, version]);
  const history = useMemo(() => game.history({ verbose: true }), [game, version]);

  /*
   * Крок 14: unions in the king's own extra capture targets (a defended
   * piece, normally illegal to capture — see lib/kingCapture.js) alongside
   * chess.js's own legal moves. extraKingCaptureTargets already guards that
   * `square` is the current turn's own king, so this is a no-op for every
   * other piece/square.
   */
  const legalMovesFrom = useCallback(
    (square) => {
      if (!square) return [];
      const legal = game.moves({ square, verbose: true }).map((m) => m.to);
      const extra = extraKingCaptureTargets(game, square);
      return extra.length ? [...legal, ...extra] : legal;
    },
    [game, version],
  );

  /**
   * True when moving from->to would promote a pawn. chess.js marks those moves
   * with 'p' in `flags`; deriving it from the destination rank instead would
   * also catch a rook or queen simply arriving on the back rank.
   */
  const isPromotion = useCallback(
    (from, to) =>
      game
        .moves({ square: from, verbose: true })
        .some((m) => m.to === to && m.flags.includes('p')),
    [game, version],
  );

  /**
   * @param promotion piece to promote to, 'q' | 'r' | 'b' | 'n'. Ignored by
   * chess.js on non-promoting moves, so the default is harmless. The player's
   * choice comes from the promotion modal; the AI always takes the queen.
   */
  const makeMove = useCallback(
    (from, to, promotion = 'q') => {
      try {
        const move = game.move({ from, to, promotion });
        setVersion((v) => v + 1);
        return move;
      } catch {
        // Крок 14: chess.js rejects this exact (from, to) as illegal — the
        // one case that's expected for is the king capturing a defended
        // piece, which legalMovesFrom above already offered as a target.
        // tryKingCapture re-derives and re-checks it independently rather
        // than trusting the caller, so it safely returns null for any other
        // illegal move.
        const move = tryKingCapture(game, from, to);
        if (move) setVersion((v) => v + 1);
        return move;
      }
    },
    [game],
  );

  const reset = useCallback(() => {
    game.reset();
    setVersion((v) => v + 1);
  }, [game]);

  // Player is white; black is played by the greedy AI.
  useEffect(() => {
    if (turn !== 'b' || GAME_OVER_STATUSES.includes(status)) return;

    const timer = setTimeout(() => {
      const move = pickGreedyMove(game);
      if (move) makeMove(move.from, move.to);
    }, AI_MOVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [game, turn, status, makeMove]);

  return { game, board, turn, status, history, legalMovesFrom, isPromotion, makeMove, reset };
}
