import { useEffect, useMemo, useState } from 'react';
import { squareToWorld } from '../lib/coords';
import { ALL_SQUARES, HIGHLIGHT_HEIGHT } from '../lib/fog';
import { THEMES, themeKeyFromUrl } from '../lib/themes';
import { getBoardRoughnessMap } from './proceduralTextures';
import { sfx } from './audio';

// Крок 13: read once at module load, same convention PieceModel.jsx and
// RockIsland.jsx use.
const ACTIVE_THEME = THEMES[themeKeyFromUrl()];

// The light/dark split has to be obvious at a glance — a chessboard should
// read as a chessboard instantly. The previous pair (#EDE7D9 / #D6CDBA) was
// nearly the same value and left the board looking unfinished.
const LIGHT = ACTIVE_THEME.board.light;
const DARK = ACTIVE_THEME.board.dark;
const HIGHLIGHT = ACTIVE_THEME.accent;
const GRID = '#2B2018';
// Near-black frame: the darkest mass in the composition, and what anchors the
// whole light-key scene.
const BASE = '#2A241C';
const PLAYER_COLOR = 'w';

// 9 lines each way, spanning the full 8x8 board centred on the origin.
const GRID_POSITIONS = (() => {
  const points = [];
  for (let i = -4; i <= 4; i++) {
    points.push(i, 0, -4, i, 0, 4); // parallel to Z
    points.push(-4, 0, i, 4, 0, i); // parallel to X
  }
  return new Float32Array(points);
})();

export default function Board({
  board,
  canInteract,
  legalMovesFrom,
  isPromotion,
  makeMove,
  onSelectedChange,
  onHoveredChange,
  onPendingPromotionChange,
}) {
  const [selected, setSelected] = useState(null);
  const [targets, setTargets] = useState([]);
  // A promoting move the player has aimed but not yet completed: the pawn stays
  // where it is until a piece is picked, so cancelling costs nothing.
  const [pendingPromotion, setPendingPromotion] = useState(null);
  // Krok 8, Section C: which square the pointer is currently over, reported
  // upward so Pieces.jsx can lift that square's piece. Kept local to Board
  // (which already owns the pointer handlers) rather than lifted entirely,
  // same shape as `selected` below.
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    onSelectedChange?.(selected);
  }, [selected, onSelectedChange]);

  useEffect(() => {
    onHoveredChange?.(hovered);
  }, [hovered, onHoveredChange]);

  // Крок 13: promotion is an HTML modal now (components/PromotionModal.jsx),
  // which has to live outside the <Canvas> tree — so Board hands the whole
  // completion bundle upward instead of rendering a 3D picker itself. Board
  // still owns pendingPromotion and the actual makeMove/clearSelection
  // closures; GameCanvas just renders whatever this reports.
  useEffect(() => {
    onPendingPromotionChange?.(
      pendingPromotion
        ? {
            square: pendingPromotion.to,
            onPick: (promotion) => {
              makeMove(pendingPromotion.from, pendingPromotion.to, promotion);
              clearSelection();
            },
            onCancel: clearSelection,
          }
        : null,
    );
  }, [pendingPromotion, onPendingPromotionChange]);

  /*
   * One roughness map per square, each a clone of a single 512px noise texture
   * pointed at a different 1/8 slice of it. Sharing one texture straight across
   * all 64 tiles would stamp the identical grain on every square, which reads
   * as a repeating pattern rather than as surface.
   *
   * Clones share `texture.source`, so this is 64 samplers over exactly one GPU
   * upload — the offsets are uniforms, not separate images.
   */
  const tileRoughness = useMemo(() => {
    const base = getBoardRoughnessMap();
    const maps = new Map();
    for (const square of ALL_SQUARES) {
      const file = square.charCodeAt(0) - 97;
      const rank = Number(square[1]) - 1;
      const map = base.clone();
      map.repeat.set(1 / 8, 1 / 8);
      map.offset.set(file / 8, rank / 8);
      maps.set(square, map);
    }
    return maps;
  }, []);

  const pieceMap = useMemo(() => {
    const map = new Map();
    for (const row of board) {
      for (const cell of row) {
        if (cell) map.set(cell.square, cell);
      }
    }
    return map;
  }, [board]);

  // Safety net for state changes that don't originate from a click here:
  // the AI moving, or a new game being started.
  useEffect(() => {
    setSelected(null);
    setTargets([]);
    setPendingPromotion(null);
  }, [board]);

  // Reset hovered separately: it isn't a board-dependent state (the pointer
  // doesn't move just because the board did), but it must never survive a
  // move — the square under the cursor may hold a different piece, or none,
  // once the board updates, and a stale hover would lift the wrong thing.
  useEffect(() => {
    setHovered(null);
  }, [board]);

  function clearSelection() {
    setSelected(null);
    setTargets([]);
    setPendingPromotion(null);
  }

  function handleSquareClick(square) {
    if (!canInteract) return;

    // Any click on the board while the picker is open is a "click past" —
    // cancel and let this click fall through to normal selection.
    if (pendingPromotion) setPendingPromotion(null);

    if (selected && targets.includes(square)) {
      if (isPromotion(selected, square)) {
        setPendingPromotion({ from: selected, to: square });
        return;
      }
      // The thud is played from the move history in GameCanvas, so the AI's
      // moves are voiced by the same path as the player's.
      makeMove(selected, square);
      setSelected(null);
      setTargets([]);
      return;
    }

    const piece = pieceMap.get(square);
    if (piece && piece.color === PLAYER_COLOR) {
      sfx.select();
      setSelected(square);
      setTargets(legalMovesFrom(square));
      return;
    }

    clearSelection();
  }

  return (
    <group>
      {/* Slab under the tiles so the board reads as a solid object rather than
          a cutout floating in space. */}
      <mesh position={[0, -0.16, 0]} receiveShadow>
        <boxGeometry args={[8.6, 0.3, 8.6]} />
        <meshStandardMaterial color={BASE} roughness={0.95} metalness={0} />
      </mesh>

      {ALL_SQUARES.map((square) => {
        const [x, y, z] = squareToWorld(square);
        const file = square.charCodeAt(0) - 97;
        const rank = Number(square[1]) - 1;
        const isDark = (file + rank) % 2 === 0;
        const isHighlighted = selected === square || targets.includes(square);

        return (
          <group key={square}>
            <mesh
              position={[x, y, z]}
              rotation={[-Math.PI / 2, 0, 0]}
              receiveShadow
              onClick={(event) => {
                event.stopPropagation();
                handleSquareClick(square);
              }}
              onPointerOver={(event) => {
                event.stopPropagation();
                if (canInteract) {
                  document.body.style.cursor = 'pointer';
                  setHovered(square);
                }
              }}
              onPointerOut={(event) => {
                event.stopPropagation();
                document.body.style.cursor = 'default';
                setHovered((h) => (h === square ? null : h));
              }}
            >
              <planeGeometry args={[1, 1]} />
              {/* Roughness only, never a colour map: the light/dark pair is
                  load-bearing for reading the board at a glance and must not be
                  muddied. This just makes the light play unevenly across the
                  surface instead of the flat sheen that read as plastic. */}
              <meshStandardMaterial
                color={isDark ? DARK : LIGHT}
                roughness={0.9}
                roughnessMap={tileRoughness.get(square)}
                metalness={0}
              />
            </mesh>

            {isHighlighted && (
              <mesh
                position={[x, y + HIGHLIGHT_HEIGHT, z]}
                rotation={[-Math.PI / 2, 0, 0]}
                // Крок 11, Section B: HIGHLIGHT_HEIGHT was lowered to sit
                // right on the tile (0.011), but the brief's own safety
                // argument for that ("a legal target is always inside the
                // mover's zone of control, so it's always visible, so fog
                // never covers it") turned out not to hold universally —
                // verified with a headless Playwright pixel sample:
                // selecting the e2 pawn and sampling the rendered frame at
                // e3 (single push) reads clear ember, but e4 (the double
                // push, a legal opening move) reads as flat fog grey, no
                // ember tint at all. The reason: lib/visibility.js builds
                // `visibility` from game.attackers() (correctly, per its own
                // comment — that's real attack/defend geometry), and a pawn
                // does not attack the square two ranks ahead of it, only
                // diagonally. So a double-push target is a genuine legal
                // target that sits outside `visibility` and gets the fog
                // shader's ~0.94 max alpha on top of it.
                //
                // Since transparent draws with depthWrite:false composite in
                // renderOrder, not world-Y, order — not height — is what
                // actually controls whether fog can occlude the highlight.
                // renderOrder={4} (fog's single mesh is 3) keeps the
                // highlight compositing on top of fog unconditionally, so
                // every legal target stays visible regardless of whether
                // lib/visibility.js's attack-geometry definition happens to
                // cover that specific square — while HIGHLIGHT_HEIGHT still
                // moved down to sit snugly on the tile, per the rest of the
                // brief's ask.
                renderOrder={4}
              >
                <planeGeometry args={[0.92, 0.92]} />
                <meshBasicMaterial
                  color={HIGHLIGHT}
                  transparent
                  opacity={0.55}
                  depthWrite={false}
                />
              </mesh>
            )}
          </group>
        );
      })}

      <lineSegments position={[0, 0.004, 0]} renderOrder={1}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            array={GRID_POSITIONS}
            count={GRID_POSITIONS.length / 3}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={GRID} transparent opacity={0.42} depthWrite={false} />
      </lineSegments>
    </group>
  );
}
