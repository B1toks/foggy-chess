import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ALL_SQUARES,
  FOG_ALPHA_KNEE,
  FOG_BREATH_AMPLITUDE_FAST,
  FOG_BREATH_AMPLITUDE_SLOW,
  FOG_BREATH_PERIOD_FAST,
  FOG_BREATH_PERIOD_SLOW,
  FOG_DEPTH_COLOR_HIGH,
  FOG_DEPTH_COLOR_LOW,
  FOG_DEPTH_COLOR_MID,
  FOG_LAYER_ALPHA_MULT,
  FOG_LAYER_HEIGHTS,
  FOG_LAYERS,
  FOG_MAX_ALPHA,
  FOG_PARALLAX_STRENGTH,
  FOG_REVEAL_THICKEN_DURATION,
  FOG_TINT_COLOR,
  FOG_WAVE_DELAY_PER_CELL,
  FOG_WAVE_DURATION,
  squareChebyshevDistance,
  squareToMaskIndex,
} from '../lib/fog';
import { easeOutCubic } from '../lib/easing';
import { getFogNoiseTexture } from './proceduralTextures';

/*
 * Крок 11, Section A: this file used to mount FOG_LAYERS (5) separate planes,
 * each its own ShaderMaterial computing three from-scratch noise functions
 * (fbm + two ridged, five octaves each) per pixel, plus a sixth mesh for the
 * edge-multiply tint pass — six draw calls, ~15 noise-octave evaluations per
 * pixel per plane, multiplied again by transparent overdraw where the planes
 * stack. That is the actual GPU cost the perf pass targets.
 *
 * Two structural changes fix it, not tuning:
 *
 * - A1: `getFogNoiseTexture()` (proceduralTextures.js) bakes the noise into a
 *   256x256 RGBA texture once, at module load. fbmTex()/ridgedTex() below
 *   replace the old five-octave GLSL loops with one texture2D fetch each
 *   (its four channels ARE four pre-computed octaves), combined with the
 *   same amplitude falloff the loop used.
 * - A2: FOG_LAYERS "planes" are now one plane, sliced inside a single
 *   fragment shader. A raised slice's old real height (which used to buy
 *   real geometric parallax as the camera orbited) is faked with a UV shift
 *   along the camera's own view direction — `sliceGLSL()` unrolls one block
 *   per slice, JS-templated the same way `ridgedGLSL` used to be, so
 *   FOG_LAYERS/FOG_LAYER_HEIGHTS/FOG_LAYER_ALPHA_MULT still drive it and
 *   dropping FOG_LAYERS 5->2 doesn't leave orphaned config. Each slice is
 *   composited into `accum` with the exact src-over recurrence
 *   (`rgb*a + accum.rgb*(1-a)`, `a + accum.a*(1-a)`) that stacking N real
 *   transparent draws would have produced — same math, one draw call.
 *   The old edge-multiply mesh is folded into slice 0's own color instead of
 *   surviving as a second MultiplyBlending draw — an approximation (a direct
 *   tint mix on the fog's own color, not a true multiply of the framebuffer
 *   beneath it), acceptable because it was already demoted to "a little
 *   extra depth at the frontier," never the readability mechanism.
 *
 * `ownVisible`/`edge`'s safety property is unchanged: both still key off the
 * true, texel-snapped `vUv` (never the parallax-shifted sample), so a
 * visible square reads with density 0 on every slice regardless of how much
 * a raised slice's noise field has been shifted around it — the same
 * decoupling Крок 10 Section B's fix relied on.
 */

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

/*
 * A1: fbmTex/ridgedTex stand in for lib/noise.js's GLSL fbm() and the old
 * ridgedGLSL() loop. uNoiseTex's four channels are four independently-
 * seamless octaves at doubling frequency (see getFogNoiseTexture) — one
 * texture2D fetch returns all four, so a 4-octave sum costs one hardware-
 * filtered sample instead of four-to-five loop iterations of hash() calls.
 */
function sharedUniformsAndNoiseGLSL() {
  return /* glsl */ `
    uniform sampler2D uMask;
    uniform sampler2D uNoiseTex;
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vWorldPos;

    vec4 noise4(vec2 p) {
      return texture2D(uNoiseTex, p);
    }

    float fbmTex(vec2 p) {
      vec4 n = noise4(p);
      return n.r * 0.5 + n.g * 0.25 + n.b * 0.125 + n.a * 0.0625;
    }

    float ridgeFold(float n) {
      float r = 1.0 - abs(n * 2.0 - 1.0);
      return r * r;
    }

    float ridgedTex(vec2 p) {
      vec4 n = noise4(p);
      return ridgeFold(n.r) * 0.5 + ridgeFold(n.g) * 0.25 + ridgeFold(n.b) * 0.125 + ridgeFold(n.a) * 0.0625;
    }

    vec2 rotate(vec2 v, float a) {
      float c = cos(a);
      float s = sin(a);
      return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
    }
  `;
}

/*
 * One slice's contribution, JS-templated per index so every constant below
 * is a GLSL literal (no uniform-array indexing, no runtime branching) —
 * matches how ridgedGLSL/layerFragmentShaderSource baked FOG_ALPHA_KNEE etc.
 * as literals before this pass. Shares `ownVisible`, `edge`'s inputs
 * (cellUv/revealPulse), `parallaxDir` and `breathShift`, computed once in
 * main() below, across every slice.
 */
function sliceGLSL(index, params) {
  const { height, scale, driftScale, driftAngle, uvOffset, edgeGain, surfaceStart, surfaceEnd, alphaMult } =
    params;
  const surface =
    surfaceEnd > surfaceStart
      ? `smoothstep(${surfaceStart.toFixed(4)}, ${surfaceEnd.toFixed(4)}, density)`
      : `step(${surfaceStart.toFixed(4)}, density)`;

  return /* glsl */ `
  {
    // slice ${index}, virtual height ${height}
    vec2 parallax = parallaxDir * ${height.toFixed(4)} * ${FOG_PARALLAX_STRENGTH.toFixed(4)};
    vec2 sampleUv = vUv + parallax + vec2(${uvOffset[0].toFixed(4)}, ${uvOffset[1].toFixed(4)});

    vec2 driftMass   = rotate(vec2( 0.015, -0.009), ${driftAngle.toFixed(4)}) * uTime * ${driftScale.toFixed(4)};
    vec2 driftWisps  = rotate(vec2(-0.021,  0.017), ${driftAngle.toFixed(4)}) * uTime * ${driftScale.toFixed(4)};
    vec2 driftDetail = rotate(vec2( 0.034,  0.026), ${driftAngle.toFixed(4)}) * uTime * ${driftScale.toFixed(4)};

    vec2 stretched = vec2(sampleUv.x, sampleUv.y * 3.2);

    float mass   = fbmTex(sampleUv * 3.0 * ${scale.toFixed(4)} + driftMass);
    float wisps  = ridgedTex(stretched * 4.0 * ${scale.toFixed(4)} + driftWisps);
    float detail = ridgedTex(stretched * 11.0 * ${scale.toFixed(4)} + driftDetail) * 0.35;

    float clouds = mass * 0.5 + wisps * (0.4 + revealPulse * 0.3) + detail * 0.25;
    float shaped = smoothstep(0.28, 0.78, clouds);

    vec2 texel = vec2(1.0 / 8.0);
    vec2 boil = vec2(detail, wisps - mass) * 0.035;
    // Крок 11, Section D: sampled at breathedUv (vUv + the breathing offset),
    // not plain vUv — see main()'s own comment for why breathing has to move
    // *where* the boundary is tested, not nudge density after the fact.
    float gx = texture2D(uMask, breathedUv + vec2(texel.x, 0.0) + boil).r
             - texture2D(uMask, breathedUv - vec2(texel.x, 0.0) + boil).r;
    float gy = texture2D(uMask, breathedUv + vec2(0.0, texel.y) + boil).r
             - texture2D(uMask, breathedUv - vec2(0.0, texel.y) + boil).r;
    float edge = clamp(length(vec2(gx, gy)) * 1.8, 0.0, 1.0) * (1.0 - ownVisible);

    float density = pow(1.0 - ownVisible, 1.35) + edge * ${edgeGain.toFixed(4)};

    float surface = ${surface};
    float alpha = smoothstep(0.0, ${FOG_ALPHA_KNEE.toFixed(3)}, density)
      * ${FOG_MAX_ALPHA.toFixed(3)} * ${alphaMult.toFixed(4)} * surface;

    if (alpha > 0.002) {
      vec3 noisyColor = mix(uColorLow, uColorHigh, shaped);
      float colorVariance = 1.0 - smoothstep(${FOG_ALPHA_KNEE.toFixed(3)}, 1.0, density);
      vec3 color = mix(uColorMid, noisyColor, colorVariance);
      ${
        index === 0
          ? `
      // Крок 10's edge-multiply pass, folded into slice 0 instead of a
      // second MultiplyBlending draw call — see file header comment.
      float tintBand = smoothstep(0.15, 0.3, density) * (1.0 - smoothstep(0.35, 0.5, density));
      color = mix(color, uTint, tintBand * 0.5);
      `
          : ''
      }
      accum.rgb = color * alpha + accum.rgb * (1.0 - alpha);
      accum.a = alpha + accum.a * (1.0 - alpha);
    }
  }
  `;
}

/*
 * Крок 10, Section B: per-layer tuning, derived from index rather than
 * hand-picked, so FOG_LAYERS can drop from 5 to 2 without leaving orphaned
 * config behind. Unchanged from the pre-Крок-11 version other than living
 * here instead of feeding a separate material per layer.
 */
function layerParams(index, height) {
  const driftSign = index % 2 === 0 ? 1 : -1;
  return {
    height,
    alphaMult: FOG_LAYER_ALPHA_MULT[index],
    scale: 1.0 + index * 0.35,
    driftScale: driftSign * (1.0 + index * 0.12),
    driftAngle: index * 0.9,
    uvOffset: [height * 0.8, height * -0.55],
    edgeGain: index === 0 ? 0.35 : 0.12,
    surfaceStart: index === 0 ? 0 : index * 0.1,
    surfaceEnd: index === 0 ? 0 : index * 0.1 + 0.22,
  };
}

function fragmentShaderSource() {
  const slices = FOG_LAYER_HEIGHTS.slice(0, FOG_LAYERS)
    .map((height, i) => sliceGLSL(i, layerParams(i, height)))
    .join('\n');

  return /* glsl */ `
    ${sharedUniformsAndNoiseGLSL()}
    uniform vec3 uColorLow;
    uniform vec3 uColorHigh;
    uniform vec3 uColorMid;
    uniform vec3 uTint;

    void main() {
      // Unshifted read first, purely for this square's own timing state
      // (reveal pulse, wave-suppression clock below) — its identity must
      // stay tied to the true cell regardless of any breathing offset
      // applied later. Same texel-centre snap as before (see Крок 10
      // Section B): reads the texel undiluted, no neighbour blend.
      vec2 cellUv0 = (floor(vUv * 8.0) + 0.5) / 8.0;
      vec4 ownMask0 = texture2D(uMask, cellUv0);
      float revealAge = uTime - ownMask0.g;
      float revealPulse = ownMask0.g > -500.0 ? exp(-abs(revealAge) * 3.0) : 0.0;

      // Крок 11, Section D: breathing must not fight an in-flight
      // reveal/conceal wave (Крок 10 Section C). ownMask0.b carries the
      // wall-clock moment THIS square's current wave (either direction)
      // started — see FogShader's useFrame below. Amplitude is gated to 0
      // right as a wave starts and eases back in over the wave's own
      // duration, so the two motions never read as one blurred mess.
      float waveAge = uTime - ownMask0.b;
      float breathAmpMult = smoothstep(0.0, ${FOG_WAVE_DURATION.toFixed(3)}, waveAge);

      float breath1 = sin(uTime * ${FOG_BREATH_PERIOD_SLOW.toFixed(4)}) * 0.5 + 0.5;
      float edgeShift1 = mix(-${FOG_BREATH_AMPLITUDE_SLOW.toFixed(4)}, ${FOG_BREATH_AMPLITUDE_SLOW.toFixed(4)}, breath1);
      // Phase offset by vUv so the fast ripple doesn't pulse in lockstep
      // across the whole board — it travels as ripples, not a strobe.
      float breath2 = sin(uTime * ${FOG_BREATH_PERIOD_FAST.toFixed(4)} + dot(vUv, vec2(13.0, 7.0))) * 0.5 + 0.5;
      float edgeShift2 = mix(-${FOG_BREATH_AMPLITUDE_FAST.toFixed(4)}, ${FOG_BREATH_AMPLITUDE_FAST.toFixed(4)}, breath2);
      // Combined shift, in fractions of a board cell (matches the brief's
      // own units) — how far the boundary itself gets nudged this frame.
      float breathShift = (edgeShift1 + edgeShift2) * breathAmpMult;

      /*
       * Крок 11, Section D -- why this has to move a position, not nudge
       * density: verified empirically (a headless Playwright session
       * forcing uTime 500 units apart and reading back raw pixels via
       * gl.readPixels) that a settled, non-transitioning fogged cell has
       * ownVisible pinned at exactly 0.0 (only mid-wave does it take
       * intermediate values), which puts density at exactly 1.0+ -- already
       * saturating both smoothstep(0, FOG_ALPHA_KNEE, density) for alpha
       * and smoothstep(FOG_ALPHA_KNEE, 1.0, density) for colour variance.
       * Adding a small breathShift on top of an already-saturated density
       * changes nothing at all -- confirmed byte-identical pixels across the
       * jump. There is no continuous 0..1 spatial ramp to nudge in this
       * density model outside of an active wave; the soft edge the mask
       * itself describes is the wave's own temporal crossfade, not a
       * standing spatial gradient.
       *
       * So breathing instead shifts where the boundary is tested: vUv is
       * offset by up to a few percent of a cell before sampling uMask for
       * ownVisible / the edge gradient below. Only pixels already within
       * about that same distance of a true mask boundary can have their
       * ownVisible read flip as a result -- a cell's own centre needs a
       * shift larger than half its width to ever reach a different texel,
       * far more than breathShift ever produces, so "density at cell centres
       * stays exactly as the mask says" holds by construction, not by
       * coincidence.
       */
      vec2 breathedUv = vUv + vec2(breathShift) * (1.0 / 8.0);
      vec2 cellUv = (floor(breathedUv * 8.0) + 0.5) / 8.0;
      float ownVisible = texture2D(uMask, cellUv).r;

      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      vec2 vd = viewDir.xz;
      float vdLen = length(vd);
      vec2 parallaxDir = vdLen > 0.0001 ? vd / vdLen : vec2(0.0);

      vec4 accum = vec4(0.0);
      ${slices}

      if (accum.a < 0.002) discard;
      gl_FragColor = vec4(accum.rgb, accum.a);
    }
  `;
}

function makeFogMaterial(mask, noiseTex) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMask: { value: mask },
      uNoiseTex: { value: noiseTex },
      uTime: { value: 0 },
      uColorLow: { value: new THREE.Color(FOG_DEPTH_COLOR_LOW) },
      uColorHigh: { value: new THREE.Color(FOG_DEPTH_COLOR_HIGH) },
      uColorMid: { value: new THREE.Color(FOG_DEPTH_COLOR_MID) },
      uTint: { value: new THREE.Color(FOG_TINT_COLOR) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: fragmentShaderSource(),
    transparent: true,
    depthWrite: false,
  });
}

/*
 * Крок 10, Section C: state that drives the per-square wave instead of a flat
 * exponential lerp. Indexed by mask index (squareToMaskIndex), not board
 * order, so it lines up directly with the DataTexture's own layout.
 *
 * - `effective` is what actually gets written into the mask's R channel every
 *   frame — read fresh each time a new wave is scheduled (see below), so an
 *   interrupted wave (a second move landing before the first one finishes)
 *   restarts from wherever the square visually was, not from a stale target
 *   or a hard pop.
 * - `oldValue`/`newValue` are the two ends of the current wave for that
 *   square; `startTime` is when (on the local clock) that square's wave is
 *   scheduled to begin, already carrying its distance-from-origin stagger
 *   and, for a dramatic enemy reveal, the extra thicken hold. Крок 11
 *   reuses this same array as the mask's B channel — "when did this
 *   square's current wave, either direction, start" is exactly what
 *   Section D's breathing suppression needs, so no second array was added.
 * - `revealTime` mirrors `startTime` but only for reveals (isVisible target
 *   1), and survives past the wave's own completion — it's what the shader's
 *   G-channel turbulence pulse reads (see fragmentShaderSource above).
 */
function useWaveState() {
  return useRef({
    effective: new Float32Array(64),
    oldValue: new Float32Array(64),
    newValue: new Float32Array(64),
    startTime: new Float32Array(64),
    revealTime: new Float32Array(64).fill(-999),
    prevVisible: new Set(),
    clock: 0,
  });
}

export default function FogShader({ visibility, lastMove = null, enemyPieceSquares = null }) {
  const wave = useWaveState();

  const { mask, material } = useMemo(() => {
    // RGBA now, not RG: A (r=eased visibility, g=reveal time) plus
    // (Крок 11) b = this square's current wave start time, for the
    // breathing-suppression gate. A channel is unused, kept at 0.
    const data = new Float32Array(64 * 4);
    for (let i = 0; i < 64; i++) {
      data[i * 4] = 0; // start fully fogged
      data[i * 4 + 1] = -999; // revealTime
      data[i * 4 + 2] = 0; // lastChangeStart
      data[i * 4 + 3] = 0;
    }
    const texture = new THREE.DataTexture(data, 8, 8, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    const noiseTex = getFogNoiseTexture();

    return { mask: texture, material: makeFogMaterial(texture, noiseTex) };
  }, []);

  useEffect(
    () => () => {
      material.dispose();
      mask.dispose();
      // getFogNoiseTexture() is a shared module-level singleton (like
      // getBoardRoughnessMap) — not disposed per-mount.
    },
    [material, mask],
  );

  // QA hook, gated the same way HUD's ?debug=1 readout is: lets a script
  // inspect the live mask/uniform state instead of guessing from pixels.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('debug')) return;
    window.__fogMaterials = { material, mask };
    window.__fogWave = wave;
  }, [material, mask, wave]);

  /*
   * Schedules a new wave whenever the *content* of `visibility` actually
   * changes — not on every render (GameCanvas recomputes `visibility` fresh
   * every render, including hover/select changes that never touch game
   * state, so a reference check alone would refire this constantly for no
   * reason). Since visibility is a pure function of piece positions, a real
   * content change only ever happens alongside a move — which is exactly
   * when `lastMove` is fresh too.
   *
   * Reveal and conceal get different origins on purpose: a square becomes
   * visible because a piece just arrived somewhere with a new sightline
   * (`lastMove.to`), and a square goes dark because a piece just left the
   * square that used to see it (`lastMove.from`) — so "you retreat, and the
   * darkness follows" falls out of using the vacated square as the close-in
   * wave's own origin, not a separate nearest-visible-square search.
   */
  useEffect(() => {
    const w = wave.current;
    const prev = w.prevVisible;
    let changed = prev.size !== visibility.size;
    if (!changed) {
      for (const sq of visibility) {
        if (!prev.has(sq)) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return;

    const now = w.clock;
    const revealOrigin = lastMove?.to ?? null;
    const concealOrigin = lastMove?.from ?? revealOrigin;

    for (let i = 0; i < 64; i++) {
      const square = ALL_SQUARES[i];
      const idx = squareToMaskIndex(square);
      const wasVisible = prev.has(square);
      const isVisible = visibility.has(square);
      if (wasVisible === isVisible) continue;

      const origin = isVisible ? revealOrigin : concealOrigin;
      let delay = origin ? squareChebyshevDistance(square, origin) * FOG_WAVE_DELAY_PER_CELL : 0;
      if (isVisible && enemyPieceSquares?.has(square)) delay += FOG_REVEAL_THICKEN_DURATION;

      // Continue from wherever the square currently, visually is — not from
      // its last discrete target — so a wave interrupted mid-flight by a
      // second quick move restarts smoothly instead of popping.
      w.oldValue[idx] = w.effective[idx];
      w.newValue[idx] = isVisible ? 1 : 0;
      w.startTime[idx] = now + delay;
      if (isVisible) w.revealTime[idx] = now + delay;
    }

    w.prevVisible = new Set(visibility);
  }, [visibility, lastMove, enemyPieceSquares, wave]);

  useFrame((_, delta) => {
    const w = wave.current;
    w.clock += delta;
    const now = w.clock;

    const data = mask.image.data;
    for (let i = 0; i < 64; i++) {
      const t =
        FOG_WAVE_DURATION > 0
          ? Math.min(1, Math.max(0, (now - w.startTime[i]) / FOG_WAVE_DURATION))
          : 1;
      const eased = easeOutCubic(t);
      const value = w.oldValue[i] + (w.newValue[i] - w.oldValue[i]) * eased;
      w.effective[i] = value;
      data[i * 4] = value;
      data[i * 4 + 1] = w.revealTime[i];
      data[i * 4 + 2] = w.startTime[i];
    }
    mask.needsUpdate = true;

    material.uniforms.uTime.value = now;
  });

  return (
    <mesh position={[0, FOG_LAYER_HEIGHTS[0], 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
      <planeGeometry args={[8, 8]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
