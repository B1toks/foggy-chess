import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { computeVisibility } from './visibility.js';

test('starting position: white sees exactly 24 squares (16 occupied + 8 in front)', () => {
  const game = new Chess();
  const visible = computeVisibility(game, 'w');

  assert.equal(visible.size, 24);

  for (const square of ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1']) {
    assert.ok(visible.has(square), `expected own piece square ${square} to be visible`);
  }
  for (const square of ['a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2']) {
    assert.ok(visible.has(square), `expected own pawn square ${square} to be visible`);
  }
  for (const square of ['a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3']) {
    assert.ok(visible.has(square), `expected pawn-attacked square ${square} to be visible`);
  }
  for (const square of ['a4', 'e4', 'd5', 'a8', 'e8']) {
    assert.ok(!visible.has(square), `expected far square ${square} to be hidden`);
  }
});

test('starting position: black sees a mirrored 24 squares', () => {
  const game = new Chess();
  const visible = computeVisibility(game, 'b');
  assert.equal(visible.size, 24);
  for (const square of ['a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6']) {
    assert.ok(visible.has(square), `expected pawn-attacked square ${square} to be visible`);
  }
});

test('pawns attack diagonally forward, not the file they push on', () => {
  // White pawn parked on d4 with nothing to its front-diagonals should still
  // "see" c5 and e5 even though it cannot move there.
  const game = new Chess();
  game.load('8/8/8/8/3P4/8/8/4k2K w - - 0 1');
  const visible = computeVisibility(game, 'w');
  assert.ok(visible.has('c5'), 'pawn should see diagonal attack square c5');
  assert.ok(visible.has('e5'), 'pawn should see diagonal attack square e5');
  assert.ok(!visible.has('d5'), 'pawn should not "see" the square it merely pushes to');
});
