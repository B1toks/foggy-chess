import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { basePositionFor } from './CameraRig';
import { easeInOutCubic } from '../lib/easing';

/*
 * Крок 8, Section B: the title screen becomes a short, looping cinematic
 * instead of a static painted-over dialog. This component is the camera half
 * of it — mounted inside <Canvas> only while GameCanvas's `phase` is
 * 'intro' or 'transitioning', and it drives `camera.position`/`lookAt`
 * directly every frame, the same imperative pattern CameraRig already uses
 * (never through React state — a per-frame setState would be one re-render
 * per frame for 14 seconds straight).
 *
 * It does NOT reuse OrbitControls for any of this: the three shots are
 * scripted cuts, not something a spherical orbit around one target could
 * produce (frame 2 orbits *around a piece*, not the board centre). Real
 * OrbitControls is only mounted once phase reaches 'playing' — see
 * GameCanvas.jsx.
 */

// Board is centred at the origin, 1 unit/square, y=0 at the tile surface (see
// lib/coords.js). g8 (a black knight's home square) is at x=2.5, z=3.5.
const KNIGHT_SQUARE = [2.5, 3.5];

/*
 * Three shots, each a straight lerp between `from` and `to` eased with
 * easeInOutCubic — a slow push, not a linear pan. The cut BETWEEN shots is a
 * crossfade (see CROSSFADE_BOUNDARIES below), not a camera move: shot 2 is a
 * close orbit around a piece, shot 3 is a bird's-eye pull-back, and panning
 * the camera smoothly between those would just be a fast, disorientating
 * swoop. A hard cut hidden by a 0.6s dip reads as intentional editing.
 */
export const FRAMES = [
  {
    // "Крізь туман" — low, near-level, pushing forward over the board with
    // the mountains on the horizon. This position sits outside the small
    // rock the board now stands on (Крок 9.6, Section C replaced the old
    // continuous ground plateau this shot originally needed) — currently
    // untested against that change; revisit if this shot reads as floating
    // in open void rather than pushing low across a landscape once the real
    // rock model (or its temporary pedestal) is checked from this angle.
    from: { position: [0, 0.62, -7.3], target: [0, 0.42, 6] },
    to: { position: [0, 0.52, -5.3], target: [0, 0.38, 6] },
    duration: 5,
  },
  {
    // "Фігура виринає" — close and side-on to the black knight on g8, a slow
    // lateral drift around it. The knight is deliberately the only square in
    // INTRO_REVEAL_VISIBILITY for this frame (see GameCanvas.jsx), so it's
    // the one enemy piece that renders, right at the fog mask's frontier —
    // which is exactly what gives it the "half in mist, half lit" edge the
    // brief asks for, for free, from the same shader that already thickens
    // the visible/fogged boundary.
    from: {
      position: [KNIGHT_SQUARE[0] + 2.1, 1.0, KNIGHT_SQUARE[1] - 0.9],
      target: [KNIGHT_SQUARE[0], 0.55, KNIGHT_SQUARE[1]],
    },
    to: {
      position: [KNIGHT_SQUARE[0] + 1.6, 1.05, KNIGHT_SQUARE[1] + 1.0],
      target: [KNIGHT_SQUARE[0], 0.55, KNIGHT_SQUARE[1]],
    },
    duration: 5,
  },
  {
    // "Дошка згори" — rise to a near-45-degree bird's-eye that reads the
    // whole board at once: near half (White's) clear, far half (Black's)
    // under fog. INTRO_REVEAL_VISIBILITY for this frame is the real starting
    // visibility (see GameCanvas.jsx) — the actual mechanic, not a mockup of
    // it.
    from: { position: [0, 5.4, -6.2], target: [0, 0, 0] },
    to: { position: [0, 8.2, -7.6], target: [0, 0, 0] },
    duration: 4,
  },
];

// Fixed so GameCanvas can seed the Canvas's initial camera prop with it —
// avoids a one-frame flash of the game's resting angle before this rig's
// first useFrame tick overrides it.
export const INTRO_START_POSITION = FRAMES[0].from.position;

export const LOOP_DURATION = FRAMES.reduce((sum, f) => sum + f.duration, 0);

// Cuts happen at the boundary between each frame, and the loop point (14
// back to 0) is a cut too.
const CROSSFADE_BOUNDARIES = (() => {
  const bounds = [0];
  let acc = 0;
  for (const f of FRAMES) {
    acc += f.duration;
    bounds.push(acc);
  }
  return bounds; // [0, 5, 10, 14]
})();
const CROSSFADE_HALF_WIDTH = 0.3; // 0.6s total dip, centred on the cut.

const TRANSITION_DURATION = 1.2;

function crossfadeAlpha(t) {
  let nearest = Infinity;
  for (const b of CROSSFADE_BOUNDARIES) {
    const d = Math.min(Math.abs(t - b), LOOP_DURATION - Math.abs(t - b));
    if (d < nearest) nearest = d;
  }
  return Math.max(0, 1 - nearest / CROSSFADE_HALF_WIDTH);
}

function frameAt(t) {
  let acc = 0;
  for (let i = 0; i < FRAMES.length; i++) {
    const end = acc + FRAMES[i].duration;
    if (t < end || i === FRAMES.length - 1) {
      return { index: i, localT: (t - acc) / FRAMES[i].duration };
    }
    acc = end;
  }
  return { index: 0, localT: 0 };
}

/**
 * @param phase 'intro' | 'transitioning' (not mounted at all once 'playing')
 * @param overlayRef DOM ref to the crossfade wash div, mutated imperatively
 * @param onFrameIndexChange(index) called only when the active shot changes
 * @param onTransitionComplete called once the hand-off to gameplay finishes
 */
export default function IntroCameraRig({
  phase,
  overlayRef,
  onFrameIndexChange,
  onTransitionComplete,
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const elapsed = useRef(0);
  const lastFrameIndex = useRef(-1);
  const currentTarget = useRef(new THREE.Vector3(...FRAMES[0].from.target));
  const posA = useRef(new THREE.Vector3());
  const posB = useRef(new THREE.Vector3());
  const tgtA = useRef(new THREE.Vector3());
  const tgtB = useRef(new THREE.Vector3());

  const transition = useRef(null);
  const prevPhase = useRef(phase);

  // Captures the hand-off the instant `phase` flips to 'transitioning':
  // wherever the intro camera happened to be, to the game's resting position
  // for this viewport. Runs as an effect (after the render that set the new
  // phase, before the next rAF) so `camera.position`/`currentTarget` already
  // hold last frame's intro values when it reads them.
  useEffect(() => {
    if (phase === 'transitioning' && prevPhase.current !== 'transitioning') {
      const aspect = size.width / size.height;
      const [ex, ey, ez] = basePositionFor(aspect);
      transition.current = {
        startPos: camera.position.clone(),
        startTarget: currentTarget.current.clone(),
        endPos: new THREE.Vector3(ex, ey, ez),
        endTarget: new THREE.Vector3(0, 0, 0),
        elapsed: 0,
      };
    }
    prevPhase.current = phase;
  }, [phase, camera, size]);

  useFrame((_, delta) => {
    if (phase === 'intro') {
      elapsed.current = (elapsed.current + delta) % LOOP_DURATION;
      const t = elapsed.current;
      const { index, localT } = frameAt(t);

      if (index !== lastFrameIndex.current) {
        lastFrameIndex.current = index;
        onFrameIndexChange(index);
      }

      const frame = FRAMES[index];
      const eased = easeInOutCubic(Math.min(1, Math.max(0, localT)));
      posA.current.set(...frame.from.position);
      posB.current.set(...frame.to.position);
      tgtA.current.set(...frame.from.target);
      tgtB.current.set(...frame.to.target);
      camera.position.lerpVectors(posA.current, posB.current, eased);
      currentTarget.current.lerpVectors(tgtA.current, tgtB.current, eased);
      camera.lookAt(currentTarget.current);

      if (overlayRef.current) overlayRef.current.style.opacity = String(crossfadeAlpha(t));
    } else if (phase === 'transitioning' && transition.current) {
      const tr = transition.current;
      tr.elapsed += delta;
      const p = Math.min(1, tr.elapsed / TRANSITION_DURATION);
      const eased = easeInOutCubic(p);
      camera.position.lerpVectors(tr.startPos, tr.endPos, eased);
      currentTarget.current.lerpVectors(tr.startTarget, tr.endTarget, eased);
      camera.lookAt(currentTarget.current);

      if (overlayRef.current) overlayRef.current.style.opacity = '0';
      if (p >= 1) onTransitionComplete();
    }
  });

  return null;
}
