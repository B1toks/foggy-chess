// Pure visibility calculation. No three.js imports allowed in this file.

import { SQUARES } from 'chess.js';

function pawnAttackSquares(square, color) {
  const file = square.charCodeAt(0) - 97; // 'a' -> 0
  const rank = Number(square[1]);
  const dir = color === 'w' ? 1 : -1;
  const targets = [];
  for (const deltaFile of [-1, 1]) {
    const f = file + deltaFile;
    const r = rank + dir;
    if (f < 0 || f > 7 || r < 1 || r > 8) continue;
    targets.push(String.fromCharCode(97 + f) + r);
  }
  return targets;
}

// Fallback for chess.js versions without attackers(): legal moves plus
// pawn diagonals (pawns attack diagonally regardless of what they can push to).
function attackedSquaresFallback(game, color) {
  const attacked = new Set();
  for (const row of game.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== color) continue;
      if (cell.type === 'p') {
        for (const square of pawnAttackSquares(cell.square, color)) attacked.add(square);
        continue;
      }
      for (const move of game.moves({ square: cell.square, verbose: true })) {
        attacked.add(move.to);
      }
    }
  }
  return attacked;
}

export function computeVisibility(game, color) {
  const visible = new Set();

  for (const row of game.board()) {
    for (const cell of row) {
      if (cell && cell.color === color) visible.add(cell.square);
    }
  }

  if (typeof game.attackers === 'function') {
    for (const square of SQUARES) {
      if (game.attackers(square, color).length > 0) visible.add(square);
    }
  } else {
    for (const square of attackedSquaresFallback(game, color)) visible.add(square);
  }

  return visible;
}
