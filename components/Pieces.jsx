import { Suspense } from 'react';
import { squareToWorld } from '../lib/coords';
import { CODE_TO_PIECE } from '../lib/pieces';
import PieceModel from './PieceModel';

const PLAYER_COLOR = 'w';

export default function Pieces({ board, visibility }) {
  const cells = board.flat().filter(Boolean);

  return (
    <Suspense fallback={null}>
      <group>
        {cells.map((cell) => {
          if (cell.color !== PLAYER_COLOR && !visibility.has(cell.square)) return null;
          const [x, y, z] = squareToWorld(cell.square);
          return (
            <PieceModel
              key={cell.square}
              type={CODE_TO_PIECE[cell.type]}
              color={cell.color}
              position={[x, y, z]}
            />
          );
        })}
      </group>
    </Suspense>
  );
}
