import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import CameraRig from './CameraRig';
import IntroCameraRig, { INTRO_START_POSITION } from './IntroCameraRig';
import { useChessGame } from '../lib/useChessGame';
import { computeVisibility } from '../lib/visibility';
import { ALL_SQUARES, squaresBetween } from '../lib/fog';
import Board from './Board';
import Pieces, { MOVE_DURATION } from './Pieces';
import Fog from './Fog';
import Lighting from './Lighting';
import Backdrop, { BACKDROP_FOG } from './Backdrop';
import RockIsland, { SHOW_ROCK_ISLAND } from './RockIsland';
import { playMoveSound } from './audio';
import HUD from './HUD';
import IntroOverlay from './IntroOverlay';
import PromotionModal from './PromotionModal';

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
 * Distance clamps. Originally derived from a ray-to-ground-plane method
 * against Plateau's radius and Backdrop's skyline (see git history before
 * Крок 9.6) — that ground plane is gone now (RockIsland.jsx replaced it with
 * a small floating pedestal, see "Крок 9.6, Section C"), so the specific
 * "stay inside the plateau's rim" reasoning no longer applies. The numbers
 * themselves are kept as-is (not revisited this pass): MIN_DISTANCE=8 still
 * comfortably clears the tallest piece (the king, 1.45 units) without
 * cropping it at the frame edge, and MAX_DISTANCE=14 still frames the board
 * reasonably at both 2200x920 and 390x844. Re-derive both properly if they
 * ever get revisited on purpose.
 */
const MIN_DISTANCE = 8;
const MAX_DISTANCE = 14;

/*
 * Polar angle is measured from straight overhead (0) to straight underneath
 * (PI) in three.js/OrbitControls terms — SMALL values are steep/overhead,
 * LARGE values (toward MAX_POLAR_ANGLE) are shallow/grazing, close to level
 * with the board. Easy to get backwards; verified against the project's own
 * documented fact that the default resting camera's top-of-frame ray sits
 * 16.3 degrees below horizontal — that number only falls out of this formula
 * (pitch-below-horizontal = 90 - polarAngle) with this sign convention.
 *
 * MIN_POLAR_ANGLE's whole history (0.838 rad -> 0.38 rad, see git blame on
 * this file and on the now-deleted Plateau.jsx) was about keeping a fake
 * continuous horizon from showing its own edge. Крок 9.6, Section C removed
 * that horizon entirely — the board now sits on a small floating rock with
 * open sky underneath it on purpose (see RockIsland.jsx) — so there is no
 * ground-gap bulge left to clamp around at any angle. 0.38 rad (~22 degrees)
 * is kept because it's still what the cinematic intro's low opening shot and
 * the brief's own ask for this value need, not because anything would break
 * at a smaller one now.
 *
 * MAX_POLAR_ANGLE = 1.25 rad (72 degrees) keeps the camera from dipping low
 * enough to look up through the board's underside / the pedestal's own
 * backface — that constraint is about the board and pedestal specifically,
 * not the old ground plane, so it's unaffected by Section C and stays put.
 *
 * Both are distance-independent, so they stay fixed regardless of the
 * MIN/MAX_DISTANCE tuning above.
 */
const MIN_POLAR_ANGLE = 0.38;
const MAX_POLAR_ANGLE = 1.25;

/*
 * Azimuth is unclamped. It used to be limited to the ~60 degree sector the
 * painted backdrop's segment actually covers (see Backdrop.jsx's old
 * AZIMUTH_SWING) — SkyDome now closes the other 300 degrees, and the painted
 * segment itself fades into the dome at its own edges (see
 * getBackdropEdgeAlphaMap), so there is no longer an edge to hide from.
 */

/*
 * Крок 12, Section B: NO FOG ON THE INTRO.
 *
 * Крок 8, Section B built the intro's three shots on top of the real fog-of-war
 * machinery (Fog + Pieces both key off a `visibility` Set) — frame 0 with an
 * empty set so everything read as fogged, frame 1 with only g8 clear so the
 * black knight sat alone at the frontier, frame 2 with the live starting
 * visibility. Reusing the real mechanic instead of mocking one is still the
 * right architecture and is not what changed here.
 *
 * What changed is the brief: the loading/intro screen should not be under fog
 * at all. It is the first thing anyone sees, and three shots of a near-uniform
 * grey sheet is a bad first frame — it hides the board, the pieces, and the
 * rock the whole composition is built on.
 *
 * So during 'intro' and 'transitioning' the fog mesh is not mounted at all (see
 * the Canvas children below) and visibility is FULL. Both halves of that matter:
 * dropping the fog alone would leave `Pieces`' own rule ("an enemy piece outside
 * `visibility` is not rendered") in force, so Black's whole side would simply be
 * missing from the intro — an empty half-board with nothing covering it, which
 * reads worse than the fog did. ALL_VISIBLE makes the intro show the complete
 * set on a clear board.
 *
 * The real fog is still the first thing the player sees *of the mechanic*: it
 * appears as gameplay starts, which is also when the HUD and controls arrive.
 */
const ALL_VISIBLE = new Set(ALL_SQUARES);

const INTRO_SEEN_KEY = 'dead-reckoning:intro-seen';

/**
 * QA hook, gated behind ?debug=1 like the HUD's own vision counter: exposes
 * the live scene/camera/controls so an external script (Playwright, a console
 * session) can set an exact spherical position and screenshot it, rather than
 * approximating one with mouse drags. See CLAUDE.md's camera QA section.
 */
function DebugHooks({ controlsRef, phase }) {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('debug')) return;
    window.__scene = scene;
    window.__camera = camera;
    window.__gl = gl;
    window.__controls = controlsRef.current;
    window.__phase = phase;
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

// Skips straight to gameplay on a repeat visit within the same session — the
// same behaviour the old static title screen had. Read once, synchronously:
// GameCanvas is only ever mounted client-side (next/dynamic ssr:false in
// pages/index.js), so `window` is always available here.
function initialPhase() {
  try {
    return window.sessionStorage.getItem(INTRO_SEEN_KEY) === '1' ? 'playing' : 'intro';
  } catch {
    return 'intro';
  }
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

  // Крок 8, Section C: lifted out of Board so Pieces can lift the hovered/
  // selected piece. Board still owns the pointer handlers and click logic —
  // it just reports the two values up via these setters.
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [hoveredSquare, setHoveredSquare] = useState(null);

  /*
   * Крок 13: promotion is now an HTML modal (4 squares, 2x2) instead of a
   * floating 3D picker, so it has to live outside the <Canvas> tree the same
   * way HUD does. Board still owns pendingPromotion state and the actual
   * makeMove/clearSelection closures (it already has canInteract, targets,
   * etc.) — it just hands the whole {square, onPick, onCancel} bundle
   * upward, mirroring onSelectedChange/onHoveredChange above, instead of
   * GameCanvas trying to re-derive Board's internal completion logic.
   */
  const [pendingPromotion, setPendingPromotion] = useState(null);

  /*
   * Крок 13: squares an own piece's in-flight move animation is currently
   * passing over, temporarily unioned into the Set fed to <Fog> only (never
   * to <Pieces>) — see squaresBetween in lib/fog.js for the full bug this
   * fixes ("fog jumps in front of and covers a piece" during a slide across
   * several ranks/files). Only meaningful for the player's own moves: an
   * enemy piece's reveal animation flying in from off-screen is fine to
   * flicker under fog mid-flight, since the player never had eyes on that
   * path either.
   */
  const [flightClearSquares, setFlightClearSquares] = useState(() => new Set());

  useEffect(() => {
    const move = history.length ? history[history.length - 1] : null;
    if (!move || move.color !== PLAYER_COLOR) {
      setFlightClearSquares(new Set());
      return;
    }
    setFlightClearSquares(new Set(squaresBetween(move.from, move.to)));
    const timer = setTimeout(() => setFlightClearSquares(new Set()), MOVE_DURATION * 1000);
    return () => clearTimeout(timer);
  }, [history]);

  // 'intro' -> 'transitioning' -> 'playing'. IntroCameraRig owns the camera
  // for the first two; real OrbitControls + CameraRig only mount for the
  // third — see the Canvas children below.
  const [phase, setPhase] = useState(initialPhase);
  // Mutated imperatively from inside the Canvas (IntroCameraRig's useFrame),
  // never through React state — see FogLayer/CameraRig for the same pattern
  // elsewhere in this codebase.
  const crossfadeRef = useRef(null);

  function handleStart() {
    try {
      window.sessionStorage.setItem(INTRO_SEEN_KEY, '1');
    } catch {
      // Non-fatal: the intro will simply play again next reload.
    }
    setPhase('transitioning');
  }

  const gameVisibility = computeVisibility(game, PLAYER_COLOR);
  // Крок 12, Section B: the intro and the hand-off both run clear — see
  // ALL_VISIBLE's comment. Only 'playing' gets the real fog-of-war set.
  const showFog = phase === 'playing';
  const visibility = showFog ? gameVisibility : ALL_VISIBLE;
  // Крок 13: fog-only, never fed to <Pieces> — see squaresBetween in
  // lib/fog.js and flightClearSquares' own comment above for why an own
  // piece's flight path needs a temporary exemption from the fog volume.
  const fogVisibility =
    showFog && flightClearSquares.size ? new Set([...visibility, ...flightClearSquares]) : visibility;
  const canInteract =
    phase === 'playing' && turn === PLAYER_COLOR && status !== 'checkmate' && status !== 'draw';

  // Крок 10, Section C: the same "what just happened" pair feeds both the
  // fog's dispersal wave (Fog) and the enemy-piece reveal fade (Pieces), so
  // they read as one event instead of two components independently guessing
  // at timing. lastMove is null before any move exists (game start/reset),
  // which both consumers treat as "no wave origin, just settle in place."
  const lastMove = history.length ? history[history.length - 1] : null;
  const enemyPieceSquares = new Set();
  for (const row of board) {
    for (const cell of row) {
      if (cell && cell.color !== PLAYER_COLOR) enemyPieceSquares.add(cell.square);
    }
  }

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
        // Крок 11, Section A3: dpr was unclamped, so a high-density display
        // (2x/3x devicePixelRatio) was rendering 4x-9x the pixels a 1x
        // display does for the exact same frame — the single biggest lever
        // available outside the fog shader itself. Capped at 1.5, not 1:
        // 1.5 still reads noticeably sharper than 1x on a Retina-class
        // screen, just not the full (and mostly wasted, past normal viewing
        // distance) native density.
        dpr={[1, 1.5]}
        gl={{ alpha: true, toneMapping: TONE_MAPPING, powerPreference: 'high-performance', antialias: true }}
        onCreated={({ gl }) => {
          gl.toneMappingExposure = tuning.exposure ?? EXPOSURE;
        }}
        // Seeded at the intro's own first shot rather than the game's resting
        // position, so a session that plays the intro never flashes the
        // gameplay angle for a frame before IntroCameraRig's first tick. A
        // session that skips the intro (phase starts 'playing') flashes this
        // for one frame instead, same as the hardcoded value here before —
        // CameraRig's mount effect corrects it immediately.
        camera={{ position: INTRO_START_POSITION, fov: 42 }}
      >
        {/* Range depends on which backdrop is mounted — see BACKDROP_FOG. The
            colour matches the sky gradient where the ranges actually sit. */}
        <fog attach="fog" args={[BACKDROP_FOG.color, BACKDROP_FOG.near, BACKDROP_FOG.far]} />

        <Lighting envIntensity={tuning.envIntensity} />
        <Backdrop />
        {SHOW_ROCK_ISLAND && <RockIsland />}

        <Board
          board={board}
          canInteract={canInteract}
          legalMovesFrom={legalMovesFrom}
          isPromotion={isPromotion}
          makeMove={makeMove}
          onSelectedChange={setSelectedSquare}
          onHoveredChange={setHoveredSquare}
          onPendingPromotionChange={setPendingPromotion}
        />
        <Pieces
          board={board}
          visibility={visibility}
          lastMove={lastMove}
          historyLength={history.length}
          selectedSquare={phase === 'playing' ? selectedSquare : null}
          hoveredSquare={phase === 'playing' ? hoveredSquare : null}
        />

        {/* Separate from the shadow map: a soft dark pool directly under each
            base, which is what actually glues a piece to its square. The key
            light's own shadow is thrown at an angle and never lands under the
            piece itself.

            `far` is a height above the plane, and only 0.85 of it: a contact
            shadow wants the bottom of a piece, not its whole silhouette.
            Raising this to clear the king's full 1.45 would blur that into a
            shadow of the whole piece instead. (Promotion is an HTML modal
            now, not a floating 3D panel, so this no longer has to dodge one
            — see components/PromotionModal.jsx.)

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

        {/* Not mounted at all during the intro, rather than mounted with a
            full-visibility mask: an unmounted fog mesh is one fewer transparent
            full-board draw during the intro, and it also means the very first
            fog the player ever sees is a freshly-mounted mask settling into the
            real starting position rather than a 64-square dissolve firing on the
            hand-off frame. See ALL_VISIBLE above. */}
        {showFog && (
          <Fog visibility={fogVisibility} lastMove={lastMove} enemyPieceSquares={enemyPieceSquares} />
        )}

        {phase === 'playing' ? (
          <>
            {/* minDistance/maxDistance are NOT declared here — CameraRig owns
                them exclusively, scaled per-aspect. See the comment on
                CameraRig for why splitting that ownership is what breaks it. */}
            <CameraRig
              controlsRef={controlsRef}
              minDistance={MIN_DISTANCE}
              maxDistance={MAX_DISTANCE}
            />
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
          </>
        ) : (
          // Not OrbitControls with enabled={false}: the three cinematic shots
          // are scripted cuts (frame 2 orbits *around a piece*, not the board
          // centre), which a spherical orbit around one fixed target can't
          // produce. See IntroCameraRig.jsx.
          <IntroCameraRig
            phase={phase}
            overlayRef={crossfadeRef}
            onTransitionComplete={() => setPhase('playing')}
          />
        )}
        <DebugHooks controlsRef={controlsRef} phase={phase} />
      </Canvas>

      {/* Pure CSS rather than a postprocessing pass: no extra dependency, no
          second render target, and it composites over the canvas for free.
          Sits under the HUD's z-index and ignores pointer events so it never
          intercepts a click meant for the board. */}
      <div className="vignette" aria-hidden="true" />

      {/* Crossfade wash for the intro's cuts between shots — see
          IntroCameraRig's crossfadeAlpha. Opacity is written directly from
          inside the Canvas's useFrame loop via crossfadeRef, not through
          React state (a per-frame setState would re-render this whole tree
          for 14 seconds straight). Sits below the intro text (z-index 20) so
          the title stays legible through every cut; above the HUD (10) since
          the HUD isn't shown until 'playing' anyway. */}
      {phase !== 'playing' && (
        <div
          ref={crossfadeRef}
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 15,
            background: '#181510',
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
      )}

      <HUD
        turn={turn}
        status={status}
        visibleCount={visibility.size}
        onNewGame={reset}
        showGameplay={phase === 'playing'}
      />

      {phase === 'intro' && <IntroOverlay onStart={handleStart} />}

      {/* HTML modal, not a floating 3D panel (Крок 13) — see
          components/PromotionModal.jsx. onPick/onCancel are Board's own
          closures over pendingPromotion, handed up unchanged. */}
      {pendingPromotion && (
        <PromotionModal onPick={pendingPromotion.onPick} onCancel={pendingPromotion.onCancel} />
      )}
    </div>
  );
}
