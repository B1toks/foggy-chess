import * as THREE from 'three';
import { fbm } from '../lib/noise';

/*
 * Canvas-generated maps for the backdrop edge fade and the board tiles.
 *
 * Lives in components/ rather than lib/ on purpose: it builds THREE.Texture
 * objects, and nothing in lib/ is allowed to import three.
 *
 * Everything here is generated once, lazily, and memoised at module scope —
 * these are a few hundred thousand fbm evaluations each, which is fine once at
 * load and very much not fine per render. All callers are inside components
 * that only ever mount client-side (ssr:false), so `document` is available.
 *
 * Крок 9.6, Section C removed this file's three plateau-only maps
 * (getStoneRoughnessMap/getStoneNormalMap/getPlateauAlphaMap) along with
 * Plateau.jsx itself — the board no longer sits on a textured stone disc, see
 * RockIsland.jsx.
 */

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function finish(canvas, { repeat = 1, colorSpace = THREE.NoColorSpace, mirror = false } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  // fbm is not tileable, so plain RepeatWrapping shows a grid of seams once the
  // repeat count goes above 1. Mirroring makes every seam continuous. It buys
  // that with a mirrored symmetry, which is invisible in a roughness field and
  // acceptable in a normal map only because normalScale is kept low.
  const wrap = mirror ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = colorSpace;
  texture.anisotropy = 4;
  return texture;
}

let backdropEdgeAlpha = null;
/**
 * Edge/bottom fade for the painted backdrop segment, baked to a texture rather
 * than computed live in a fragment shader. The gradient is a static function
 * of UV alone — nothing about it is animated or depends on a uniform — so a
 * baked alphaMap on the existing MeshBasicMaterial produces an identical
 * result to a custom ShaderMaterial, while keeping MeshBasicMaterial's
 * built-in scene-fog blending, which the painting already relies on for its
 * own distance fade.
 *
 * Matches CylinderGeometry's UV convention (see node_modules/three's
 * CylinderGeometry: `uvs.push(u, 1 - v)`, so texture V=1 is the mesh TOP):
 * both left/right edges fade in over the first/last 12% of U, V=0 (the mesh
 * bottom, the painting's foreground) fades out over the first 18% of V, and
 * (Крок 9.6, Section B) V=1 (the mesh top, the sky) now fades out over its
 * own top 18% too — before this the sides and bottom dissolved into SkyDome
 * but the top cut off hard, which read as a visible horizontal seam where
 * the painting met the dome. Symmetric to the bottom fade on purpose, and
 * symmetric in U, so this does not care about the diffuse map's own U flip.
 *
 * 0.82, not lower: the source image's own flat sky only extends to ~20% down
 * from its top edge before the far ridges break in (measured off the
 * luminance profile when SKYLINE_FRACTION was derived — see the framing
 * comment on ImageBackdropSegment). Fading out the top 18% (down to V=0.82)
 * stays just inside that flat-sky band with a couple of percent to spare, so
 * the fade dissolves empty sky, never a ridge line. If a future image swaps
 * in with a shorter flat-sky margin, widen the mesh's own height rather than
 * pushing this fraction past ~0.8 — the alternative is fading out actual
 * mountain silhouette, which reads as ridges melting into the dome rather
 * than a clean horizon dissolve.
 */
export function getBackdropEdgeAlphaMap() {
  if (backdropEdgeAlpha) return backdropEdgeAlpha;

  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;

  const smoothstep = (edge0, edge1, x) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };

  for (let py = 0; py < size; py++) {
    // CanvasTexture keeps flipY (the default, same as an image texture), so
    // canvas row 0 (top) is texture V=1 and row size-1 (bottom) is V=0.
    const v = 1 - py / (size - 1);
    const bottomFade = smoothstep(0, 0.18, v);
    const topFade = smoothstep(1.0, 0.82, v);

    for (let px = 0; px < size; px++) {
      const u = px / (size - 1);
      const edgeFade = smoothstep(0, 0.12, u) * smoothstep(1, 0.88, u);
      const value = Math.round(255 * edgeFade * bottomFade * topFade);
      const i = (py * size + px) * 4;
      data[i] = value;
      data[i + 1] = value; // alphaMap reads the green channel
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  backdropEdgeAlpha = new THREE.CanvasTexture(canvas);
  backdropEdgeAlpha.wrapS = THREE.ClampToEdgeWrapping;
  backdropEdgeAlpha.wrapT = THREE.ClampToEdgeWrapping;
  backdropEdgeAlpha.colorSpace = THREE.NoColorSpace;
  return backdropEdgeAlpha;
}

let boardRoughness = null;
/**
 * Tile surface: fine noise plus faint directional fibres. Roughness only, never
 * a colour map — the palette's light/dark pair is load-bearing and must not be
 * muddied. What this buys is light that plays unevenly across the tiles instead
 * of the uniform sheen that made the board read as plastic.
 *
 * Callers clone this per tile and set a 1/8 repeat + per-square offset, so no
 * two squares show the same patch. Clones share `texture.source`, so all 64
 * still cost one GPU upload.
 */
export function getBoardRoughnessMap() {
  if (boardRoughness) return boardRoughness;

  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain = fbm((x / size) * 26, (y / size) * 26, 4);
      // Stretched heavily along x: fibres, not blobs.
      const fibre = fbm((x / size) * 3, (y / size) * 90, 3);
      const n = grain * 0.72 + fibre * 0.28;
      const v = Math.round(255 * (0.74 + 0.26 * Math.min(1, Math.max(0, n))));
      const i = (y * size + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  boardRoughness = finish(canvas);
  return boardRoughness;
}
