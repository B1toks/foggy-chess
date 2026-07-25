// Pure game-state hook wrapping chess.js. No three.js imports allowed in this file.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { AI_MOVE_DELAY_MS, pickGreedyMove } from './ai';

function computeStatus(game) {
  if (game.isCheckmate()) return 'checkmate';
  if (game.isDraw()) return 'draw';
  if (game.isCheck()) return 'check';
  return 'playing';
}

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

  const legalMovesFrom = useCallback(
    (square) => {
      if (!square) return [];
      return game.moves({ square, verbose: true }).map((m) => m.to);
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
   * choice comes from PromotionPicker; the AI always takes the queen.
   */
  const makeMove = useCallback(
    (from, to, promotion = 'q') => {
      try {
        const move = game.move({ from, to, promotion });
        setVersion((v) => v + 1);
        return move;
      } catch {
        return null;
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
    if (turn !== 'b' || status === 'checkmate' || status === 'draw') return;

    const timer = setTimeout(() => {
      const move = pickGreedyMove(game);
      if (move) makeMove(move.from, move.to);
    }, AI_MOVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [game, turn, status, makeMove]);

  return { game, board, turn, status, history, legalMovesFrom, isPromotion, makeMove, reset };
}
