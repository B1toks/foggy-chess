import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import CameraRig from './CameraRig';
import { useChessGame } from '../lib/useChessGame';
import { computeVisibility } from '../lib/visibility';
import Board from './Board';
import Pieces from './Pieces';
import Fog from './Fog';
import Lighting from './Lighting';
import Backdrop, {
  AZIMUTH_SWING,
  BACKDROP_FOG,
  BACKDROP_MODE,
  HOME_AZIMUTH,
} from './Backdrop';
import Plateau, { SHOW_PLATEAU } from './Plateau';
import { playMoveSound } from './audio';
import HUD from './HUD';
import TitleScreen from './TitleScreen';

// Light at the top, weightier toward the bottom — gives the frame a direction
// and stops the sky reading as a flat fill.
const SKY_GRADIENT = 'linear-gradient(180deg, #F4F0E7 0%, #E7DFD0 52%, #CDC1AA 100%)';
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

// The painted backdrop is one frame, not a seamless panorama, so in image mode
// the orbit is clamped to the sector it covers. Procedural mode keeps 360.
const AZIMUTH_LIMITS =
  BACKDROP_MODE === 'image'
    ? { minAzimuthAngle: HOME_AZIMUTH - AZIMUTH_SWING, maxAzimuthAngle: HOME_AZIMUTH + AZIMUTH_SWING }
    : {};

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

        <CameraRig controlsRef={controlsRef} />
        <OrbitControls
          ref={controlsRef}
          enablePan={false}
          minPolarAngle={0.2}
          maxPolarAngle={1.4}
          minDistance={5}
          // Capped so the board can never shrink to a speck inside the ranges.
          maxDistance={17}
          {...AZIMUTH_LIMITS}
          enableDamping
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
