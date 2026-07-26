import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { computeVisibility } from './visibility.js';
import { CODE_TO_PIECE } from './pieces.js';
import {
  canCaptureEnemyKing,
  extraKingCaptureTargets,
  hasKingCaptureEscape,
  kingIsCaptured,
  tryKingCapture,
} from './kingCapture.js';

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

// Крок 14: the king may capture an adjacent defended piece — normally
// illegal in chess.js, since it leaves the king "in check" from the
// defender. lib/kingCapture.js bypasses exactly that one case; these tests
// pin the contract it relies on.

test('king capture: vanilla chess.js refuses to let a king capture a defended piece', () => {
  // White king e4, black rook e5 (adjacent, capturable), black king e6
  // (defends e5). Standard rule: capturing would leave the king attacked by
  // the defender, so chess.js must not offer it.
  const game = new Chess('8/8/4k3/4r3/4K3/8/8/8 w - - 0 1');
  const targets = game.moves({ square: 'e4', verbose: true }).map((m) => m.to);
  assert.ok(!targets.includes('e5'), 'vanilla chess.js must reject the defended capture');
});

test('king capture: extraKingCaptureTargets offers exactly the defended capture', () => {
  const game = new Chess('8/8/4k3/4r3/4K3/8/8/8 w - - 0 1');
  assert.deepEqual(extraKingCaptureTargets(game, 'e4'), ['e5']);
  // Guarded to the side to move's own king only — never offered for a piece
  // that's actually pinned/discovered-checked, which must stay illegal.
  assert.deepEqual(extraKingCaptureTargets(game, 'e6'), [], 'not this side\'s turn');
});

test('king capture: tryKingCapture commits the move and history reflects it normally', () => {
  const game = new Chess('8/8/4k3/4r3/4K3/8/8/8 w - - 0 1');
  const move = tryKingCapture(game, 'e4', 'e5');

  assert.ok(move, 'the capture must be accepted');
  assert.equal(game.get('e5').type, 'k', 'the king relocated to e5');
  assert.equal(game.get('e4'), undefined);
  assert.equal(game.turn(), 'b', 'turn must advance normally');

  // Pieces.jsx/GameCanvas.jsx both read history()'s last entry (for move
  // animation and the move/capture sound respectively) — this must be a
  // properly reconstructed Move, not a raw internal object.
  const last = game.history({ verbose: true }).at(-1);
  assert.equal(last.from, 'e4');
  assert.equal(last.to, 'e5');
  assert.equal(last.captured, 'r');
  assert.equal(last.piece, 'k');
});

test('king capture: the opponent can then capture the now-exposed king normally', () => {
  const game = new Chess('8/8/4k3/4r3/4K3/8/8/8 w - - 0 1');
  tryKingCapture(game, 'e4', 'e5');

  assert.equal(kingIsCaptured(game, 'w'), false);
  // No bypass needed for this direction: chess.js's own legality filter only
  // ever protects the MOVER's own king, so an ordinary piece (here, black's
  // own king) capturing an exposed enemy king is already a normal legal move.
  const capture = game.move({ from: 'e6', to: 'e5' });
  assert.equal(capture.captured, 'k');
  assert.equal(kingIsCaptured(game, 'w'), true, 'white has no king left on the board');
});

test('king capture: an escape via this rule pre-empts a false checkmate/stalemate', () => {
  // White king a1, black queen a2 (adjacent, check, and covers b1/b2 too),
  // black bishop b3 defends the queen. Every square but capturing the queen
  // is covered, so vanilla chess.js calls this checkmate — but the king can
  // capture its own attacker under this rule, so the position is not
  // actually over yet.
  const game = new Chess('4k3/8/8/8/8/1b6/q7/K7 w - - 0 1');
  assert.ok(game.isCheckmate(), 'vanilla chess.js must still call this checkmate');
  assert.ok(hasKingCaptureEscape(game), 'the king-capture escape must be detected');

  const move = tryKingCapture(game, 'a1', 'a2');
  assert.ok(move, 'the escape must actually be playable');
  assert.equal(game.isCheckmate(), false, 'capturing the checker resolves the check');
});

test('king capture: an exposed king pre-empts a false insufficient-material draw', () => {
  // Same position as above: after white's king captures the defended rook,
  // only two kings remain on the board — chess.js's own isDraw() calls that
  // insufficient material, which is correct for a position that could never
  // resolve. It is NOT correct here: white's king now stands next to black's,
  // so black can simply capture it outright on the very next move.
  const game = new Chess('8/8/4k3/4r3/4K3/8/8/8 w - - 0 1');
  tryKingCapture(game, 'e4', 'e5');

  assert.ok(game.isDraw(), 'vanilla chess.js must still see two bare kings as a draw');
  assert.ok(canCaptureEnemyKing(game), 'black must be able to simply take the exposed king');

  const capture = game.move({ from: 'e6', to: 'e5' });
  assert.equal(capture.captured, 'k');
  assert.equal(kingIsCaptured(game, 'w'), true);
});

test('new game restores the opening position and the 24-square vision', () => {
  const game = new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  assert.notEqual(computeVisibility(game, 'w').size, 24);

  game.reset();
  assert.equal(computeVisibility(game, 'w').size, 24, 'fog must reset with the board');
});
