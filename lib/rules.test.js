import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { computeVisibility } from './visibility.js';
import { CODE_TO_PIECE } from './pieces.js';

// These cover the special moves where the board state changes on squares the
// player did not click — the cases most likely to leave a stale model behind.

test('promotion: pawn reaching the back rank becomes a queen', () => {
  const game = new Chess('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  const move = game.move({ from: 'a7', to: 'a8', promotion: 'q' });

  assert.ok(move.isPromotion(), 'move should be flagged as a promotion');
  const piece = game.get('a8');
  assert.equal(piece.type, 'q');
  assert.equal(piece.color, 'w');
  // The renderer maps chess.js codes through this table, so a queen model is
  // what actually appears.
  assert.equal(CODE_TO_PIECE[piece.type], 'queen');
});

// The two facts the promotion modal is built on. Board asks isPromotion() before
// it commits a move, and isPromotion() reads `flags` — if either of these drifts
// in a future chess.js, the modal silently stops appearing and every promotion
// goes back to being a queen.
test('promotion: the move is flagged with p before it is played', () => {
  const game = new Chess('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  const promoting = game.moves({ square: 'a7', verbose: true });

  assert.ok(promoting.length > 0, 'a7 must have moves to offer');
  assert.ok(
    promoting.every((m) => m.flags.includes('p')),
    'every move off the 7th rank here is a promotion',
  );

  // A quiet pawn push must NOT be flagged, or the picker would open on it.
  const quiet = new Chess('4k3/8/P7/8/8/8/8/4K3 w - - 0 1');
  assert.ok(
    quiet.moves({ square: 'a6', verbose: true }).every((m) => !m.flags.includes('p')),
  );
});

test('promotion: the chosen piece is what lands on the square', () => {
  for (const [code, name] of [
    ['q', 'queen'],
    ['r', 'rook'],
    ['b', 'bishop'],
    ['n', 'knight'],
  ]) {
    const game = new Chess('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    game.move({ from: 'a7', to: 'a8', promotion: code });
    assert.equal(game.get('a8').type, code, `promotion=${code} must produce a ${code}`);
    assert.equal(CODE_TO_PIECE[game.get('a8').type], name);
  }
});

test('kingside castling: rook relocates with the king', () => {
  const game = new Chess('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
  game.move({ from: 'e1', to: 'g1' });

  assert.equal(game.get('g1').type, 'k');
  assert.equal(game.get('f1').type, 'r', 'rook must have jumped to f1');
  assert.equal(game.get('h1'), undefined, 'rook must not be left on h1');
  assert.equal(game.get('e1'), undefined);
});

test('queenside castling: rook relocates with the king', () => {
  const game = new Chess('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1');
  game.move({ from: 'e1', to: 'c1' });

  assert.equal(game.get('c1').type, 'k');
  assert.equal(game.get('d1').type, 'r');
  assert.equal(game.get('a1'), undefined);
});

test('en passant: the captured pawn leaves a square the mover never touched', () => {
  const game = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2');
  const move = game.move({ from: 'e5', to: 'd6' });

  assert.ok(move.isEnPassant());
  assert.equal(game.get('d6').type, 'p', 'capturing pawn lands on d6');
  assert.equal(game.get('d5'), undefined, 'captured pawn must vanish from d5');
});

test('game over: checkmate leaves no legal moves', () => {
  const game = new Chess('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
  assert.ok(game.isCheckmate());
  assert.ok(game.isGameOver());
  assert.equal(game.moves().length, 0, 'no legal moves means no square can be selected');
});

test('new game restores the opening position and the 24-square vision', () => {
  const game = new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  assert.notEqual(computeVisibility(game, 'w').size, 24);

  game.reset();
  assert.equal(computeVisibility(game, 'w').size, 24, 'fog must reset with the board');
});
