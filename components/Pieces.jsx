import { Suspense, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { squareToWorld } from '../lib/coords';
import { CODE_TO_PIECE } from '../lib/pieces';
import { easeInOutCubic } from '../lib/easing';
import PieceModel from './PieceModel';

const PLAYER_COLOR = 'w';

// Крок 8, Section C: move/lift/fade tuning. All three read as "a piece is a
// physical object, not a UI sprite" — a move arcs and takes a beat, a hover
// lifts by a hair and settles back, a capture fades rather than vanishing.
const MOVE_DURATION = 0.35;
const MOVE_ARC_HEIGHT = 0.32;
const HOVER_LIFT = 0.03;
const HOVER_LERP_SPEED = 10; // 1/e time constant-ish, per second
const CAPTURE_FADE_DURATION = 0.4;

// The only move chess.js's Move object gives us for a castle is the king's
// own from/to — the rook's silent second hop has to be filled in from the
// standard squares.
const CASTLE_ROOK_HOPS = {
  e1g1: ['h1', 'f1'],
  e1c1: ['a1', 'd1'],
  e8g8: ['h8', 'f8'],
  e8c8: ['a8', 'd8'],
};

let nextId = 0;

function cellsFromBoard(board) {
  const map = new Map();
  for (const row of board) {
    for (const cell of row) {
      if (cell) map.set(cell.square, cell);
    }
  }
  return map;
}

function freshInstances(board) {
  const list = [];
  for (const [square, cell] of cellsFromBoard(board)) {
    list.push({ id: nextId++, type: CODE_TO_PIECE[cell.type], color: cell.color, square });
  }
  return list;
}

/**
 * Reconciles chess.js's square-indexed board into piece instances with an id
 * that survives a move, so the *same* <AnimatedPieceGroup> can animate from
 * its old square to its new one — keying the JSX list off `square` instead
 * would unmount/remount a fresh instance already in place, which is what
 * "teleports" instead of moves.
 *
 * Driven by the actual move object rather than a generic board diff: chess.js
 * already tells us exactly which square moved to which, and the two cases a
 * plain from/to can't cover on its own — en passant's captured pawn (behind
 * `to`, not on it) and castling's second, silent rook hop — are resolved with
 * the standard chess rules for them. A defensive sync pass against the real
 * board follows, so a missed edge case just snaps a piece into place instead
 * of ever rendering the wrong thing.
 *
 * Captured pieces don't just disappear from state — they move into `ghosts`
 * for a fade-out (see CaptureGhost) before being dropped for good.
 */
function useAnimatedInstances(board, lastMove, historyLength, visibility) {
  const [instances, setInstances] = useState(() => freshInstances(board));
  const [ghosts, setGhosts] = useState([]);
  const prevHistoryLen = useRef(historyLength);
  const lastMoveRef = useRef(lastMove);

  useEffect(() => {
    const wasReset = historyLength === 0 && prevHistoryLen.current !== 0;
    const isNewMove = historyLength > 0 && lastMove && lastMove !== lastMoveRef.current;
    prevHistoryLen.current = historyLength;
    lastMoveRef.current = lastMove;

    if (wasReset) {
      setInstances(freshInstances(board));
      setGhosts([]);
      return;
    }
    if (!isNewMove) return;

    const next = new Map();
    const bySquare = new Map();
    for (const inst of instances) {
      next.set(inst.id, inst);
      bySquare.set(inst.square, inst.id);
    }
    const newGhosts = [];

    const capture = (square, exceptId) => {
      const id = bySquare.get(square);
      if (id == null || id === exceptId) return;
      const inst = next.get(id);
      next.delete(id);
      bySquare.delete(square);
      if (inst) newGhosts.push({ ...inst, key: `ghost-${inst.id}-${historyLength}` });
    };

    const move = (from, to, promotionType) => {
      const id = bySquare.get(from);
      if (id == null) return;
      capture(to, id);
      const inst = next.get(id);
      bySquare.delete(from);
      const moved = promotionType ? { ...inst, square: to, type: promotionType } : { ...inst, square: to };
      next.set(id, moved);
      bySquare.set(to, id);
    };

    const { from, to, flags = '', promotion } = lastMove;
    if (flags.includes('e')) {
      // En passant: the captured pawn sits behind `to`, not on it.
      capture(to[0] + from[1], null);
      move(from, to, null);
    } else {
      move(from, to, promotion ? CODE_TO_PIECE[promotion] : null);
    }
    const rookHop = CASTLE_ROOK_HOPS[from + to];
    if (rookHop) move(rookHop[0], rookHop[1], null);

    // Defensive sync against the real board — see the function comment.
    const cells = cellsFromBoard(board);
    for (const [square, cell] of cells) {
      if (!bySquare.has(square)) {
        const id = nextId++;
        next.set(id, { id, type: CODE_TO_PIECE[cell.type], color: cell.color, square });
        bySquare.set(square, id);
      }
    }
    for (const [square, id] of Array.from(bySquare)) {
      if (!cells.has(square)) capture(square, null);
    }

    setInstances(Array.from(next.values()));
    if (newGhosts.length) {
      // Only fade-out a capture that was actually on screen a moment ago —
      // White's own pieces always are, an enemy piece only if it was inside
      // `visibility`. A capture on a square the player never saw shouldn't
      // suddenly flash a piece into view just to fade it back out.
      const visibleGhosts = newGhosts.filter(
        (g) => g.color === PLAYER_COLOR || visibility.has(g.square),
      );
      if (visibleGhosts.length) setGhosts((g) => [...g, ...visibleGhosts]);
    }
    // `instances` and `visibility` are deliberately not in this list: both
    // are read for their value at the moment a new move arrives, not
    // watched for their own changes — including them would make this effect
    // re-run (and mis-fire `isNewMove`'s guard) on renders where neither the
    // move nor the board actually changed.
  }, [lastMove, historyLength, board]);

  const removeGhost = (key) => setGhosts((g) => g.filter((gh) => gh.key !== key));
  return { instances, ghosts, removeGhost };
}

/**
 * One piece, with a stable identity across moves. The outer group is the
 * piece's world position, driven imperatively (never through React state/
 * props after the first mount — see CameraRig/FogLayer for the same
 * convention elsewhere): when `square` changes, an effect records an arc from
 * the old position to the new one, and useFrame walks it forward. The inner
 * group is a separate, much smaller offset for the hover/selected lift, so
 * the two animations don't fight over one Vector3.
 */
function AnimatedPieceGroup({ type, color, square, lifted }) {
  const outerRef = useRef(null);
  const liftRef = useRef(null);
  const currentSquare = useRef(square);
  const anim = useRef(null);
  const liftAmount = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    const outer = outerRef.current;
    if (!mounted.current) {
      // First mount (including "just became visible again" — see Pieces
      // below): snap straight there, nothing to animate from.
      const [x, y, z] = squareToWorld(square);
      outer.position.set(x, y, z);
      mounted.current = true;
      currentSquare.current = square;
      return;
    }
    if (square === currentSquare.current) return;
    const [fx, fy, fz] = squareToWorld(currentSquare.current);
    const [tx, ty, tz] = squareToWorld(square);
    anim.current = {
      from: new THREE.Vector3(fx, fy, fz),
      to: new THREE.Vector3(tx, ty, tz),
      elapsed: 0,
    };
    currentSquare.current = square;
  }, [square]);

  useFrame((_, delta) => {
    const outer = outerRef.current;
    if (outer && anim.current) {
      const a = anim.current;
      a.elapsed += delta;
      const p = Math.min(1, a.elapsed / MOVE_DURATION);
      const eased = easeInOutCubic(p);
      outer.position.lerpVectors(a.from, a.to, eased);
      // A small rise-and-fall so the piece arcs across instead of sliding
      // flat along the board.
      outer.position.y += Math.sin(p * Math.PI) * MOVE_ARC_HEIGHT;
      if (p >= 1) anim.current = null;
    }

    const lift = liftRef.current;
    if (lift) {
      const target = lifted ? HOVER_LIFT : 0;
      const t = 1 - Math.exp(-HOVER_LERP_SPEED * delta);
      liftAmount.current += (target - liftAmount.current) * t;
      lift.position.y = liftAmount.current;
    }
  });

  return (
    <group ref={outerRef}>
      <group ref={liftRef}>
        <PieceModel type={type} color={color} />
      </group>
    </group>
  );
}

/** A captured piece, fading out in place rather than vanishing on the spot. */
function CaptureGhost({ type, color, square, onDone }) {
  const groupRef = useRef(null);
  const elapsed = useRef(0);
  const [x, y, z] = squareToWorld(square);

  useFrame((_, delta) => {
    elapsed.current += delta;
    const p = Math.min(1, elapsed.current / CAPTURE_FADE_DURATION);
    const group = groupRef.current;
    if (group) {
      const opacity = 1 - p;
      group.traverse((node) => {
        if (node.isMesh && node.material) node.material.opacity = opacity;
      });
    }
    if (p >= 1) onDone();
  });

  return (
    <group ref={groupRef} position={[x, y, z]}>
      {/* `fade` gives this instance its own cloned, transparent material
          instead of the shared BONE/LACQUER singletons every live piece
          uses — those are shared across every piece of that colour, so
          animating opacity on one would fade all of them. */}
      <PieceModel type={type} color={color} fade />
    </group>
  );
}

export default function Pieces({
  board,
  visibility,
  lastMove,
  historyLength,
  selectedSquare,
  hoveredSquare,
}) {
  const { instances, ghosts, removeGhost } = useAnimatedInstances(
    board,
    lastMove,
    historyLength,
    visibility,
  );

  return (
    <Suspense fallback={null}>
      <group>
        {instances.map((inst) => {
          if (inst.color !== PLAYER_COLOR && !visibility.has(inst.square)) return null;
          const lifted =
            inst.color === PLAYER_COLOR &&
            (inst.square === selectedSquare || inst.square === hoveredSquare);
          return (
            <AnimatedPieceGroup
              key={inst.id}
              type={inst.type}
              color={inst.color}
              square={inst.square}
              lifted={lifted}
            />
          );
        })}

        {ghosts.map((ghost) => (
          <CaptureGhost
            key={ghost.key}
            type={ghost.type}
            color={ghost.color}
            square={ghost.square}
            onDone={() => removeGhost(ghost.key)}
          />
        ))}
      </group>
    </Suspense>
  );
}
