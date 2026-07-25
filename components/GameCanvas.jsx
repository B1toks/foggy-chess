import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import CameraRig from './CameraRig';
import { useChessGame } from '../lib/useChessGame';
import { computeVisibility } from '../lib/visibility';
import Board from './Board';
import Pieces from './Pieces';
import Fog from './Fog';
import Lighting from './Lighting';
import Backdrop, { BACKDROP_FOG } from './Backdrop';
import Plateau, { SHOW_PLATEAU } from './Plateau';
import { playMoveSound } from './audio';
import HUD from './HUD';
import TitleScreen from './TitleScreen';

// Only ever seen for the one frame before the canvas paints (or if WebGL is
// unavailable) — SkyDome now covers the camera at every angle once mounted.
// Stops match SkyDome's own top/horizon/low so that one frame doesn't flash a
// different tone.
const SKY_GRADIENT = 'linear-gradient(180deg, #F0EBDE 0%, #DCD6C8 52%, #CFC7B6 100%)';
/*
 * ACES is stated explicitly rather than left to @react-three/fiber's default.
 * It happens to be the same value (fiber v8 picks ACESFilmicToneMapping unless
 * `flat` is set), but the whole light-key palette is balanced around its
 * shoulder, so it should not be an unwritten dependency on a library default.
 *
 * Exposure stays at 0.85, NOT the 1.05 the brief proposed. The brief's reason
 * for raising it was that white pieces were being blown to pure white — but
 * sampling the rendered frame over the bone pieces and light squares finds no
 * clipping at all: peak luma 234/255, zero pixels at or above 250, zero pixels
 * with all three channels >= 254. ACES was already doing that job. Raising
 * exposure 24% is the one change that would actually introduce the clipping
 * this was meant to remove. `?exp=` overrides it live if you want to look.
 */
const TONE_MAPPING = THREE.ACESFilmicToneMapping;
const EXPOSURE = 0.85;
const PLAYER_COLOR = 'w';

/*
 * Distance clamps, derived from the same ray-to-ground-plane method used
 * throughout this project (Plateau's RADIUS, Backdrop's skyline), not picked
 * by feel. Both are along the camera's fixed viewing direction (BASE_POSITION
 * normalized), so "distance" and "ground-hit radius" scale together linearly.
 *
 * MIN_DISTANCE = 8. The brief's target was "the board occupies ~65% of the
 * frame at minDistance" — taken literally (board's own AABB height / frame
 * height) that lands near d=15, but the *resting* camera (CameraRig's
 * BASE_POSITION, distance 11.55) already sits closer than that, at ~90%. A
 * minDistance greater than the resting distance would make OrbitControls
 * shove the default view backward on load, changing the framing every other
 * part of this file was tuned against. 8 is instead picked to comfortably
 * clear the tallest piece on the board (the king, 1.45 units) without
 * cropping it at the frame edges when it sits in a back corner, verified by
 * screenshot at both 2200x920 and 390x844 — see CLAUDE.md.
 *
 * MAX_DISTANCE = 14. The old value (17) was never derived: at 17 the
 * bottom-frame corner ray on a 21:9 viewport hits the ground at radius 12.6,
 * past the plateau's full radius (10.5, see Plateau.jsx) — the rim's alpha
 * fade is long gone there, so widescreen players could already zoom the
 * plateau's edge into the bottom corners. 14 keeps that same corner ray
 * inside 10.5.
 */
const MIN_DISTANCE = 8;
const MAX_DISTANCE = 14;

/*
 * Polar angle is measured from straight overhead (0) to straight underneath
 * (PI) in three.js/OrbitControls terms.
 *
 * MIN_POLAR_ANGLE = 0.838 rad (48 degrees) is NOT the "don't let the camera
 * climb too vertical" aesthetic preference it might look like — it is a hard
 * geometric requirement. Plateau's disc (radius 10.5) and the painted
 * backdrop cylinder (radius 46) never touch; there is a bare annulus of
 * ground between them that nothing was ever drawn to cover, because with the
 * old flat CSS sky nobody could tell — a gap showing uniform pale "sky" reads
 * as more sky. SkyDome's gradient is directional, so the same always-existing
 * gap now shows up as a distinctly domed, un-ground-colored bulge the instant
 * the camera pitches shallow enough to see across it (confirmed empirically:
 * visible through 40 degrees, gone by 45, at both MIN_DISTANCE and
 * MAX_DISTANCE). 48 keeps a few degrees of margin past that.
 *
 * MAX_POLAR_ANGLE = 1.25 rad (72 degrees), tightened from the old 1.4 (80) so
 * the camera can't dip low enough to look up through the board's underside at
 * the plateau's raw backface.
 *
 * Both are distance-independent, so they stay fixed regardless of the
 * MIN/MAX_DISTANCE tuning above.
 */
const MIN_POLAR_ANGLE = 0.838;
const MAX_POLAR_ANGLE = 1.25;

/*
 * Azimuth is unclamped. It used to be limited to the ~60 degree sector the
 * painted backdrop's segment actually covers (see Backdrop.jsx's old
 * AZIMUTH_SWING) — SkyDome now closes the other 300 degrees, and the painted
 * segment itself fades into the dome at its own edges (see
 * getBackdropEdgeAlphaMap), so there is no longer an edge to hide from.
 */

/**
 * QA hook, gated behind ?debug=1 like the HUD's own vision counter: exposes
 * the live scene/camera/controls so an external script (Playwright, a console
 * session) can set an exact spherical position and screenshot it, rather than
 * approximating one with mouse drags. See CLAUDE.md's camera QA section.
 */
function DebugHooks({ controlsRef }) {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('debug')) return;
    window.__scene = scene;
    window.__camera = camera;
    window.__gl = gl;
    window.__controls = controlsRef.current;
  });

  return null;
}

// QA hook: ?fen=... lets a specific position (mate, stalemate) be loaded
// directly. Read once at mount; the component is already client-only.
function initialFenFromUrl() {
  if (typeof window === 'undefined') return undefined;
  return new URLSearchParams(window.location.search).get('fen') ?? undefined;
}

// Tuning hooks: ?envi= and ?exp= override environment intensity and tone
// mapping exposure so the light balance can be swept without a rebuild.
function tuningFromUrl() {
  if (typeof window === 'undefined') return {};
  const q = new URLSearchParams(window.location.search);
  return {
    envIntensity: q.has('envi') ? Number(q.get('envi')) : undefined,
    exposure: q.has('exp') ? Number(q.get('exp')) : undefined,
  };
}

export default function GameCanvas() {
  const { game, board, turn, status, history, legalMovesFrom, isPromotion, makeMove, reset } =
    useChessGame(initialFenFromUrl());

  // One place voices every move, the player's and the AI's alike, by watching
  // the history grow. Driving it off the click instead would leave the AI
  // silent and need a second hook into lib/ — which must stay browser-free.
  const lastPlyRef = useRef(0);
  useEffect(() => {
    const previous = lastPlyRef.current;
    lastPlyRef.current = history.length;
    if (history.length > previous) playMoveSound(history[history.length - 1]);
  }, [history]);

  const controlsRef = useRef(null);
  const tuningRef = useRef(null);
  if (tuningRef.current === null) tuningRef.current = tuningFromUrl();
  const tuning = tuningRef.current;

  const visibility = computeVisibility(game, PLAYER_COLOR);
  const canInteract = turn === PLAYER_COLOR && status !== 'checkmate' && status !== 'draw';

  return (
    <div style={{ position: 'fixed', inset: 0, background: SKY_GRADIENT }}>
      {/* Negative Z is White's side of the board (rank 1 sits at z = -3.5), and
          the player is always White — so the camera starts behind the player's
          own pieces, looking up-board into the fog. */}
      {/* The canvas clears to transparent so the CSS gradient below shows
          through. A flat single-colour sky is a large part of why the scene
          read as unfinished. */}
      <Canvas
        shadows
        gl={{ alpha: true, toneMapping: TONE_MAPPING }}
        onCreated={({ gl }) => {
          gl.toneMappingExposure = tuning.exposure ?? EXPOSURE;
        }}
        camera={{ position: [3.5, 7, -8.5], fov: 42 }}
      >
        {/* Range depends on which backdrop is mounted — see BACKDROP_FOG. The
            colour matches the sky gradient where the ranges actually sit. */}
        <fog attach="fog" args={[BACKDROP_FOG.color, BACKDROP_FOG.near, BACKDROP_FOG.far]} />

        <Lighting envIntensity={tuning.envIntensity} />
        <Backdrop />
        {SHOW_PLATEAU && <Plateau />}

        <Board
          board={board}
          canInteract={canInteract}
          legalMovesFrom={legalMovesFrom}
          isPromotion={isPromotion}
          makeMove={makeMove}
        />
        <Pieces board={board} visibility={visibility} />

        {/* Separate from the shadow map: a soft dark pool directly under each
            base, which is what actually glues a piece to its square. The key
            light's own shadow is thrown at an angle and never lands under the
            piece itself.

            `far` is a height above the plane, and only 0.85 of it: a contact
            shadow wants the bottom of a piece, not its whole silhouette, and
            0.85 also lands below the promotion picker's plates at 0.95 so the
            panel casts no blobs onto the board underneath it. Raising this to
            clear the king's full 1.45 would do both of the wrong things.

            Left on drei's default continuous refresh: the pieces move, and one
            512px depth pass is cheap next to the fog shader already running
            three fbm evaluations per pixel every frame. */}
        <ContactShadows
          position={[0, 0.012, 0]}
          scale={9.4}
          resolution={512}
          far={0.85}
          blur={2.4}
          opacity={0.5}
          color="#2A241C"
        />

        <Fog visibility={visibility} />

        {/* minDistance/maxDistance are NOT declared here — CameraRig owns them
            exclusively, scaled per-aspect. See the comment on CameraRig for
            why splitting that ownership is what breaks it. */}
        <CameraRig controlsRef={controlsRef} minDistance={MIN_DISTANCE} maxDistance={MAX_DISTANCE} />
        <DebugHooks controlsRef={controlsRef} />
        <OrbitControls
          ref={controlsRef}
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          // 0.45, not drei's default 1: the old default let one wheel notch
          // jump the camera hard enough to feel like a cut, not a zoom.
          zoomSpeed={0.45}
          rotateSpeed={0.5}
          minPolarAngle={MIN_POLAR_ANGLE}
          maxPolarAngle={MAX_POLAR_ANGLE}
        />
      </Canvas>

      {/* Pure CSS rather than a postprocessing pass: no extra dependency, no
          second render target, and it composites over the canvas for free.
          Sits under the HUD's z-index and ignores pointer events so it never
          intercepts a click meant for the board. */}
      <div className="vignette" aria-hidden="true" />

      <HUD
        turn={turn}
        status={status}
        visibleCount={visibility.size}
        onNewGame={reset}
      />
      <TitleScreen />
    </div>
  );
}
