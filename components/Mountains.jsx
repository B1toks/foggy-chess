import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { fbm } from '../lib/noise';

/*
 * Placement is derived, not eyeballed.
 *
 * The camera sits at y~7 and is pitched down at the board, so the top of the
 * frame is already ~16 degrees BELOW horizontal — the true horizon is off
 * screen. Ridge heights therefore cannot be chosen by feel: a range looks
 * "on the skyline" only if it lands in the narrow screen band between the top
 * of the frame and the board's far edge (~28 degrees down).
 *
 * So each shell's peak/base are solved from a target elevation angle. Because
 * the angle is fixed and the distance varies, farther ranges resolve to lower
 * world Y — which is exactly right: they all land on the same screen band and
 * stack into depth.
 */
const CAMERA_Y = 7;
const PEAK_ANGLE = (17 * Math.PI) / 180;
const BASE_ANGLE = (26 * Math.PI) / 180;

// One shared vertical slab for every shell keeps the texture mapping uniform.
const CYL_BOTTOM = -14;
const CYL_TOP = 10;
const CYL_H = CYL_TOP - CYL_BOTTOM;

// Far -> near. Distant ranges are paler and lower-contrast so none of them
// competes with the board.
const LAYERS = [
  { radius: 36, tone: '#BCC2BC', alpha: 0.8, seed: 11, jitter: 0.8 },
  { radius: 30, tone: '#AEB4AE', alpha: 0.84, seed: 27, jitter: 0.95 },
  { radius: 24, tone: '#9BA19B', alpha: 0.88, seed: 43, jitter: 1.1 },
  { radius: 18, tone: '#868C86', alpha: 0.9, seed: 61, jitter: 1.25 },
];

const TEX_W = 2048;
const TEX_H = 512;
// The haze is low frequency, so it is generated small and scaled up. At full
// resolution this loop is ~1M fbm evaluations per layer and stalls first paint.
const HAZE_W = 256;
const HAZE_H = 64;

const toFraction = (y) => (y - CYL_BOTTOM) / CYL_H;

/**
 * One ridge band as a canvas texture: an fbm horizon silhouette, filled flat,
 * lightened toward the peaks for aerial perspective, then hazed with the same
 * fbm the board's fog of war uses — mountain mist and fog of war are meant to
 * read as one substance.
 */
function makeRidgeTexture({ seed, tone, radius, jitter }) {
  const baseY = CAMERA_Y - radius * Math.tan(BASE_ANGLE);
  const peakY = CAMERA_Y - radius * Math.tan(PEAK_ANGLE);
  const amp = (peakY - baseY) * jitter;

  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, TEX_W, TEX_H);

  // Sampled around a circle so the texture's left and right edges meet
  // seamlessly where the cylinder wraps.
  const fractions = new Float32Array(TEX_W);
  for (let x = 0; x < TEX_W; x++) {
    const theta = (x / TEX_W) * Math.PI * 2;
    const r = 2.4;
    const n = fbm(Math.cos(theta) * r + seed, Math.sin(theta) * r + seed, 5);
    fractions[x] = toFraction(baseY + n * amp);
  }

  // CanvasTexture keeps flipY, so canvas bottom maps to the cylinder bottom —
  // fill downward from the ridge line to put rock below and sky above.
  ctx.beginPath();
  ctx.moveTo(0, TEX_H);
  for (let x = 0; x < TEX_W; x++) {
    ctx.lineTo(x, TEX_H - fractions[x] * TEX_H);
  }
  // Close on x = TEX_W, not TEX_W - 1. Stopping a column short leaves an
  // unfilled strip that linear filtering smears into a visible vertical seam
  // where the cylinder's UVs wrap.
  ctx.lineTo(TEX_W, TEX_H - fractions[0] * TEX_H);
  ctx.lineTo(TEX_W, TEX_H);
  ctx.closePath();
  ctx.fillStyle = tone;
  ctx.fill();

  const peakPx = TEX_H - toFraction(peakY) * TEX_H;
  const basePx = TEX_H - toFraction(baseY) * TEX_H;
  const bandPx = Math.max(basePx - peakPx, 1);

  // Dissolve the body below the ridge. There is no terrain in this scene to
  // hide a mountain's lower slopes, so a solid silhouette fills the whole
  // background as a flat grey wall. Fading it out leaves only the skyline band
  // and reads as ranges standing out of a misty valley.
  ctx.globalCompositeOperation = 'destination-out';
  const fade = ctx.createLinearGradient(0, basePx, 0, basePx + bandPx * 1.25);
  fade.addColorStop(0, 'rgba(0, 0, 0, 0)');
  fade.addColorStop(1, 'rgba(0, 0, 0, 1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // Everything below only tints existing rock, never the open sky.
  ctx.globalCompositeOperation = 'source-atop';

  // Aerial perspective: pale at the peaks, denser lower down.
  const grad = ctx.createLinearGradient(0, peakPx, 0, basePx);
  grad.addColorStop(0, 'rgba(242, 239, 230, 0.4)');
  grad.addColorStop(1, 'rgba(242, 239, 230, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // Drifting mist on the slopes.
  const haze = ctx.createImageData(HAZE_W, HAZE_H);
  for (let y = 0; y < HAZE_H; y++) {
    for (let x = 0; x < HAZE_W; x++) {
      const n = fbm((x / HAZE_W) * 7 + seed, (y / HAZE_H) * 3 + seed, 4);
      const i = (y * HAZE_W + x) * 4;
      haze.data[i] = 242;
      haze.data[i + 1] = 239;
      haze.data[i + 2] = 230;
      haze.data[i + 3] = Math.max(0, n - 0.4) * 190;
    }
  }
  const hazeCanvas = document.createElement('canvas');
  hazeCanvas.width = HAZE_W;
  hazeCanvas.height = HAZE_H;
  hazeCanvas.getContext('2d').putImageData(haze, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(hazeCanvas, 0, 0, TEX_W, TEX_H);

  ctx.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Concentric open cylinders viewed from inside. Cylinders rather than flat
 * planes so parallax holds from every azimuth — OrbitControls can spin all the
 * way round without the backdrop ever showing an edge.
 */
export default function Mountains() {
  // Canvas work needs the DOM, so build after mount rather than during render.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const layers = useMemo(() => {
    if (!ready) return [];
    return LAYERS.map((layer) => ({ ...layer, texture: makeRidgeTexture(layer) }));
  }, [ready]);

  useEffect(() => () => layers.forEach((l) => l.texture?.dispose()), [layers]);

  if (!ready) return null;

  return (
    <group>
      {layers.map((layer) => (
        <mesh key={layer.radius} position={[0, CYL_BOTTOM + CYL_H / 2, 0]} renderOrder={-1}>
          <cylinderGeometry args={[layer.radius, layer.radius, CYL_H, 96, 1, true]} />
          {/* Scene fog is deliberately left ON here (the reference snippet had
              fog:false). Dissolving the far ranges into the background is the
              whole point of the scene fog; disabling it would make the distant
              ridges end on a hard edge. */}
          <meshBasicMaterial
            map={layer.texture}
            transparent
            opacity={layer.alpha}
            side={THREE.BackSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
