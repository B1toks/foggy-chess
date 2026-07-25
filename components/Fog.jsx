import { FOG_MODE } from '../lib/fog';
import FogLayer from './FogLayer';
import FogShader from './FogShader';

/**
 * Dispatches to the fog implementation selected by FOG_MODE in lib/fog.js.
 * Flip that one constant to roll back to Tier 1.
 */
export default function Fog({ visibility }) {
  if (FOG_MODE === 'tier1') return <FogLayer visibility={visibility} />;
  return <FogShader visibility={visibility} />;
}
