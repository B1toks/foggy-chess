import { useEffect, useMemo, useState } from 'react';
import { squareToWorld } from '../lib/coords';
import { ALL_SQUARES, HIGHLIGHT_HEIGHT } from '../lib/fog';
import PromotionPicker from './PromotionPicker';
import { getBoardRoughnessMap } from './proceduralTextures';
import { sfx } from './audio';

// The light/dark split has to be obvious at a glance — a chessboard should
// read as a chessboard instantly. The previous pair (#EDE7D9 / #D6CDBA) was
// nearly the same value and left the board looking unfinished.
const LIGHT = '#E0D6C0';
const DARK = '#8B7F6A';
const HIGHLIGHT = '#C1440E';
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

export default function Board({ board, canInteract, legalMovesFrom, isPromotion, makeMove }) {
  const [selected, setSelected] = useState(null);
  const [targets, setTargets] = useState([]);
  // A promoting move the player has aimed but not yet completed: the pawn stays
  // where it is until a piece is picked, so cancelling costs nothing.
  const [pendingPromotion, setPendingPromotion] = useState(null);

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
                if (canInteract) document.body.style.cursor = 'pointer';
              }}
              onPointerOut={(event) => {
                event.stopPropagation();
                document.body.style.cursor = 'default';
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
                renderOrder={3}
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

      {pendingPromotion && (
        <PromotionPicker
          square={pendingPromotion.to}
          onPick={(promotion) => {
            makeMove(pendingPromotion.from, pendingPromotion.to, promotion);
            clearSelection();
          }}
          onCancel={clearSelection}
        />
      )}
    </group>
  );
}
