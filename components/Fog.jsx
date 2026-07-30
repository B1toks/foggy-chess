import { FOG_MODE } from '../lib/fog';
import FogLayer from './FogLayer';
import FogShader from './FogShader';

/**
 * Dispatches to the fog implementation selected by FOG_MODE in lib/fog.js.
 * Flip that one constant to roll back to Tier 1. Tier 1 doesn't take
 * lastMove/enemyPieceSquares — it's the plain, event-free rollback path.
 */
export default function Fog({ visibility, lastMove, enemyPieceSquares, themeKey }) {
  if (FOG_MODE === 'tier1') return <FogLayer visibility={visibility} />;
  return (
    <FogShader
      visibility={visibility}
      lastMove={lastMove}
      enemyPieceSquares={enemyPieceSquares}
      themeKey={themeKey}
    />
  );
}
