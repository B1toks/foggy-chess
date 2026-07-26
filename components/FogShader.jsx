import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ALL_SQUARES,
  FOG_DETAIL_OCTAVES,
  FOG_DRIFT_HEIGHT,
  FOG_DRIFT_OPACITY,
  FOG_ENABLE_DETAIL,
  FOG_HEIGHT,
  FOG_LERP_SPEED,
  FOG_OPACITY,
  FOG_STRAND_COLOR,
  FOG_TINT_COLOR,
  FOG_WISP_OCTAVES,
  squareToMaskIndex,
} from '../lib/fog';
import { FBM_GLSL } from '../lib/noise';

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/*
 * Ridged noise: same value-noise lattice as fbm (from FBM_GLSL, already
 * included above this), but each octave is folded around its midpoint
 * (`1.0 - abs(n*2.0-1.0)`) and squared. Where plain fbm gives soft blobs,
 * folding turns every octave's zero-crossings into a sharp ridge — the result
 * reads as fibrous wisps and gaps rather than clouds.
 *
 * Octave count is baked into the function name/loop bound at shader-source
 * build time (see the fragment-shader builders below), not passed as a
 * uniform: GLSL loop bounds are simplest and most portable as compile-time
 * constants, and this is a perf knob a developer dials (lib/fog.js), never
 * something a player or a URL touches — a plain top-of-file constant is the
 * right shape for it, matching how PIECE_SCALE etc. are tuned elsewhere in
 * this project.
 */
function ridgedGLSL(name, octaves) {
  return /* glsl */ `
    float ${name}(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < ${octaves}; i++) {
        float n = valueNoise(p);
        n = 1.0 - abs(n * 2.0 - 1.0);
        n *= n;
        v += a * n;
        p *= 2.07;
        a *= 0.5;
      }
      return v;
    }
  `;
}

/*
 * Shared by both the multiply and the strands fragment shader below: the
 * uniforms and noise functions neither varies by mode, so it only exists as
 * one piece of text instead of two copies that could quietly drift apart.
 */
function sharedUniformsAndNoiseGLSL() {
  return /* glsl */ `
    uniform sampler2D uMask;
    uniform float uTime;
    uniform float uOpacity;
    uniform float uScale;
    uniform float uDriftScale;
    uniform float uEdgeGain;
    varying vec2 vUv;

    ${FBM_GLSL}
    ${ridgedGLSL('ridgedWisp', FOG_WISP_OCTAVES)}
    ${FOG_ENABLE_DETAIL ? ridgedGLSL('ridgedDetail', FOG_DETAIL_OCTAVES) : ''}
  `;
}

/*
 * Also shared: everything from sampling the mask through to `density` (how
 * fogged this pixel is, boundary-boosted) and `shaped` (the wisp pattern's
 * own coverage, 0..1). Both fragment shaders below need exactly these two
 * numbers and differ only in what they do with them.
 */
function densityAndShapeGLSL() {
  return /* glsl */ `
    // LinearFilter on the 8x8 mask is what turns per-square 0/1 values into
    // a smooth gradient, so this is already soft before the noise lands.
    float visible = texture2D(uMask, vUv).r;

    // Three non-parallel, non-proportional drift vectors — not one vector
    // scaled and negated — so the wisp structure keeps reconfiguring as it
    // moves instead of just translating as a rigid pattern.
    vec2 driftMass   = vec2( 0.015, -0.009) * uTime * uDriftScale;
    vec2 driftWisps  = vec2(-0.021,  0.017) * uTime * uDriftScale;
    vec2 driftDetail = vec2( 0.034,  0.026) * uTime * uDriftScale;

    // Compressing the sample point's V by 3.2x before feeding it to the
    // ridged layers means the noise argument changes fast along V (rank,
    // "into the board") and slow along U (file, "across the board") — so
    // the ridges it produces read as long streaks along U: horizontal
    // wisps, not an isotropic speckle.
    vec2 stretched = vec2(vUv.x, vUv.y * 3.2);

    // Large, slow: the general mass of haze — this is what the old single
    // fbm() call used to be on its own.
    float mass = fbm(vUv * 3.0 * uScale + driftMass);
    // Medium, ridged: the wisps themselves.
    float wisps = ridgedWisp(stretched * 4.0 * uScale + driftWisps);
    // Small, ridged, faint: frays the edges of the wisps rather than adding
    // its own visible shapes — note the double attenuation (0.35 here, 0.5
    // again in the strand alpha), deliberately faint.
    float detail = ${FOG_ENABLE_DETAIL ? "ridgedDetail(stretched * 11.0 * uScale + driftDetail) * 0.35" : "0.0"};

    float clouds = mass * 0.5 + wisps * 0.4 + detail * 0.25;

    // A wisp along the frontier. The mask gradient peaks exactly where
    // visible meets fogged, so it thickens the boundary and keeps it from
    // reading as a plain translucent rectangle.
    vec2 texel = vec2(1.0 / 8.0);
    float gx = texture2D(uMask, vUv + vec2(texel.x, 0.0)).r
             - texture2D(uMask, vUv - vec2(texel.x, 0.0)).r;
    float gy = texture2D(uMask, vUv + vec2(0.0, texel.y)).r
             - texture2D(uMask, vUv - vec2(0.0, texel.y)).r;
    float edge = clamp(length(vec2(gx, gy)) * 1.8, 0.0, 1.0);

    float shaped = smoothstep(0.28, 0.78, clouds);

    // Steeper than linear so the fog stays opaque in the deep and gives way
    // quickly near the frontier, plus the edge boost so the boundary itself
    // stays dense rather than reading as a flat translucent rectangle. Zero
    // on a fully visible square away from any fogged neighbour — visible=1
    // and edge=0 both drop out — which is what keeps clean squares clean in
    // both layers below.
    float density = pow(1.0 - visible, 1.35) + edge * uEdgeGain;
  `;
}

/*
 * Крок 9.5, Component 1 — the darkening base. THREE.MultiplyBlending scales
 * whatever is already in the framebuffer instead of painting over it, which
 * is what makes this darken a light tile exactly as reliably as a dark one:
 * a fully visible square has density 0, so `base` is exactly vec3(1.0) and
 * multiplying by white is a no-op — the tile's own colour passes through
 * completely untouched. This is the layer that fixes the readability bug;
 * get it right and the strand layer below is purely cosmetic on top of it.
 */
function multiplyFragmentShaderSource() {
  return /* glsl */ `
    ${sharedUniformsAndNoiseGLSL()}
    uniform vec3 uTint;

    void main() {
      ${densityAndShapeGLSL()}

      if (density < 0.002) discard;

      vec3 base = mix(vec3(1.0), uTint, clamp(density * uOpacity, 0.0, 1.0));
      gl_FragColor = vec4(base, 1.0);
    }
  `;
}

/*
 * Крок 9.5, Component 2 — the pale wisp threads, laid on top of the
 * darkened base as a normal alpha overlay. This is visually almost the same
 * pattern the old single-layer shader painted, but it no longer has to also
 * carry the "is this square fogged at all" job — that's the multiply layer's
 * job now — so this one can stay a pale, high-contrast overlay without
 * worrying about disappearing into a light tile itself.
 */
function strandsFragmentShaderSource() {
  return /* glsl */ `
    ${sharedUniformsAndNoiseGLSL()}
    uniform vec3 uStrandColor;

    void main() {
      ${densityAndShapeGLSL()}

      float alpha = shaped * density * 0.5 * uOpacity;
      if (alpha < 0.002) discard;

      gl_FragColor = vec4(uStrandColor, alpha);
    }
  `;
}

function makeMultiplyMaterial(mask, { opacity, scale, driftScale, edgeGain }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMask: { value: mask },
      uTime: { value: 0 },
      uOpacity: { value: opacity },
      uScale: { value: scale },
      uDriftScale: { value: driftScale },
      uEdgeGain: { value: edgeGain },
      uTint: { value: new THREE.Color(FOG_TINT_COLOR) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: multiplyFragmentShaderSource(),
    transparent: true,
    depthWrite: false,
    // The whole point of this layer: scale the destination instead of
    // painting over it.
    blending: THREE.MultiplyBlending,
  });
}

function makeStrandsMaterial(mask, { opacity, scale, driftScale, edgeGain }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMask: { value: mask },
      uTime: { value: 0 },
      uOpacity: { value: opacity },
      uScale: { value: scale },
      uDriftScale: { value: driftScale },
      uEdgeGain: { value: edgeGain },
      uStrandColor: { value: new THREE.Color(FOG_STRAND_COLOR) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: strandsFragmentShaderSource(),
    transparent: true,
    depthWrite: false,
  });
}

export default function FogShader({ visibility }) {
  const current = useRef(new Float32Array(64));
  const target = useRef(new Float32Array(64));

  const { mask, groundMultiply, groundStrands, driftStrands } = useMemo(() => {
    const data = new Float32Array(64); // 1 = visible, 0 = fogged
    const texture = new THREE.DataTexture(data, 8, 8, THREE.RedFormat, THREE.FloatType);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    // uScale multiplies the shader's literal per-layer base scales
    // (3.0/4.0/11.0), so 1.0 is "as specified" and >1 is finer-grained.
    const groundParams = { opacity: FOG_OPACITY, scale: 1.0, driftScale: 1.0, edgeGain: 0.35 };

    return {
      mask: texture,
      groundMultiply: makeMultiplyMaterial(texture, groundParams),
      groundStrands: makeStrandsMaterial(texture, groundParams),
      // Second, higher sheet at a finer grain and a mirrored (negative)
      // drift rate. The parallax between the two sells volume without a real
      // volumetric pass. Its opacity is deliberately tiny: anything raised
      // above the board occludes far squares at shallow camera angles, which
      // is the exact problem that put the main fog on the ground in the
      // first place. It's a strands-only layer, not multiply-darken-and-
      // strands: its job is faint drifting texture on top of a base the
      // ground layer already darkened, not readability on its own.
      //
      // Skipped entirely (not just rendered at zero alpha) when
      // FOG_DRIFT_OPACITY is 0 — this is the first item on lib/fog.js's
      // performance ladder, and it only actually saves anything if the
      // second draw call, and the shader compile behind it, never happen.
      driftStrands:
        FOG_DRIFT_OPACITY > 0
          ? makeStrandsMaterial(texture, {
              opacity: FOG_DRIFT_OPACITY,
              scale: 1.7,
              driftScale: -1.7,
              edgeGain: 0.0,
            })
          : null,
    };
  }, []);

  useEffect(
    () => () => {
      groundMultiply.dispose();
      groundStrands.dispose();
      driftStrands?.dispose();
      mask.dispose();
    },
    [groundMultiply, groundStrands, driftStrands, mask],
  );

  // QA hook, gated the same way HUD's ?debug=1 readout is: lets a script
  // inspect the live mask/uniform state instead of guessing from pixels.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('debug')) return;
    window.__fogMaterials = { groundMultiply, groundStrands, driftStrands, mask };
  }, [groundMultiply, groundStrands, driftStrands, mask]);

  useFrame((_, delta) => {
    for (let i = 0; i < 64; i++) {
      target.current[squareToMaskIndex(ALL_SQUARES[i])] = visibility.has(ALL_SQUARES[i]) ? 1 : 0;
    }

    const data = mask.image.data;
    // Clamp the step so a long frame (tab regain, first paint) can't overshoot
    // past the target and pop.
    const step = Math.min(delta * FOG_LERP_SPEED, 1);
    for (let i = 0; i < 64; i++) {
      current.current[i] += (target.current[i] - current.current[i]) * step;
      data[i] = current.current[i];
    }
    mask.needsUpdate = true;

    groundMultiply.uniforms.uTime.value += delta;
    groundStrands.uniforms.uTime.value += delta;
    if (driftStrands) driftStrands.uniforms.uTime.value += delta;
  });

  return (
    <group>
      {/* Multiply pass first, strands pass second, same height: the strands
          alpha-composite on top of whatever the multiply pass already
          darkened. Order matters here — three.js draws transparent objects
          in the order given when renderOrder ties, and these are given
          explicit, adjacent renderOrder values so that's never left to
          chance. */}
      <mesh position={[0, FOG_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <planeGeometry args={[8, 8]} />
        <primitive object={groundMultiply} attach="material" />
      </mesh>
      <mesh position={[0, FOG_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
        <planeGeometry args={[8, 8]} />
        <primitive object={groundStrands} attach="material" />
      </mesh>
      {driftStrands && (
        <mesh position={[0, FOG_DRIFT_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
          <planeGeometry args={[8, 8]} />
          <primitive object={driftStrands} attach="material" />
        </mesh>
      )}
    </group>
  );
}
