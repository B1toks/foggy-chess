import * as THREE from 'three';
import { fbm } from '../lib/noise';

/*
 * Canvas-generated maps for the stone plateau and the board tiles.
 *
 * Lives in components/ rather than lib/ on purpose: it builds THREE.Texture
 * objects, and nothing in lib/ is allowed to import three.
 *
 * Everything here is generated once, lazily, and memoised at module scope —
 * these are a few hundred thousand fbm evaluations each, which is fine once at
 * load and very much not fine per render. All callers are inside components
 * that only ever mount client-side (ssr:false), so `document` is available.
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

/**
 * Greyscale fbm written straight into the pixel buffer. `low`/`high` map the
 * noise into a roughness range — never the full 0..1, because roughness 0
 * turns a patch of stone into a mirror.
 */
function noiseCanvas(size, { frequency, octaves, low, high }) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm((x / size) * frequency, (y / size) * frequency, octaves);
      const v = Math.round(255 * (low + (high - low) * Math.min(1, Math.max(0, n))));
      const i = (y * size + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

let stoneRoughness = null;
/** Broad, slow-varying roughness for the plateau: weathered rock, not gravel. */
export function getStoneRoughnessMap() {
  if (!stoneRoughness) {
    // repeat 5: the disc is 21 units across, and one pass of a 512px map over
    // that reads as smooth plastic no matter what the noise does.
    stoneRoughness = finish(
      noiseCanvas(512, { frequency: 7, octaves: 5, low: 0.62, high: 1 }),
      { repeat: 5, mirror: true },
    );
  }
  return stoneRoughness;
}

let stoneNormal = null;
/**
 * Derived from the same field as the roughness map by central differences.
 * Roughness alone modulates the sheen but leaves the disc geometrically flat,
 * and under a single key light a flat disc reads as paper. This is what makes
 * it read as rock.
 */
export function getStoneNormalMap() {
  if (stoneNormal) return stoneNormal;

  const size = 256;
  const frequency = 7;
  const strength = 2.2;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;

  const h = (x, y) => fbm(((x + size) % size / size) * frequency, ((y + size) % size / size) * frequency, 5);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const n = new THREE.Vector3(-dx, -dy, 1).normalize();
      const i = (y * size + x) * 4;
      data[i] = Math.round((n.x * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((n.y * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((n.z * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  stoneNormal = finish(canvas, { repeat: 5, mirror: true });
  return stoneNormal;
}

let plateauAlpha = null;
/**
 * Radial fade for the plateau's rim. Scene fog cannot do this job here: its
 * range starts past the board (see BACKDROP_FOG) so the plateau sits entirely
 * inside the unfogged zone. Fading the rim to transparent lets the fogged
 * painting take over instead, which is the same read.
 *
 * The edge is broken up with noise so it is a dissolving shore, not a circle.
 */
export function getPlateauAlphaMap() {
  if (plateauAlpha) return plateauAlpha;

  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const c = size / 2;
  /*
   * These are in CircleGeometry's UV space, where the *rim* of the disc is at
   * radius 0.5 from the texture's centre, not 1.0 — the circle is inscribed in
   * the UV square. Getting that wrong is what made the first attempt a fully
   * opaque disc with a hard edge: the whole fade band sat outside the geometry.
   *
   * 0.32 -> 0.50 puts the dissolve between world radius 6.7 and 10.5, which is
   * past the board's corners (6.1) and gone before the painting's skyline.
   */
  const FADE_START = 0.32;
  const FADE_END = 0.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c) / c; // 0 at centre, 0.5 at the disc rim
      // Ragged shoreline: push the fade in and out with low-frequency noise.
      const wobble = (fbm((x / size) * 4, (y / size) * 4, 4) - 0.5) * 0.07;
      const t = (r + wobble - FADE_START) / (FADE_END - FADE_START);
      const a = 1 - Math.min(1, Math.max(0, t));
      // Smoothstep so the falloff has no visible start or end.
      const v = Math.round(255 * a * a * (3 - 2 * a));
      const i = (y * size + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  plateauAlpha = new THREE.CanvasTexture(canvas);
  plateauAlpha.wrapS = THREE.ClampToEdgeWrapping;
  plateauAlpha.wrapT = THREE.ClampToEdgeWrapping;
  plateauAlpha.colorSpace = THREE.NoColorSpace;
  return plateauAlpha;
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
 * both left/right edges fade in over the first/last 12% of U, and V=1 (sky)
 * stays opaque while V=0 (the mesh bottom, the painting's foreground) fades
 * out over the first 18% of V. Symmetric in U on purpose, so it does not care
 * about the diffuse map's own U flip.
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

    for (let px = 0; px < size; px++) {
      const u = px / (size - 1);
      const edgeFade = smoothstep(0, 0.12, u) * smoothstep(1, 0.88, u);
      const value = Math.round(255 * edgeFade * bottomFade);
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
