import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ALL_SQUARES,
  FOG_COLOR,
  FOG_DETAIL_OCTAVES,
  FOG_DRIFT_HEIGHT,
  FOG_DRIFT_OPACITY,
  FOG_ENABLE_DETAIL,
  FOG_HEIGHT,
  FOG_LERP_SPEED,
  FOG_OPACITY,
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
 * build time (see fragmentShaderSource below), not passed as a uniform:
 * GLSL loop bounds are simplest and most portable as compile-time constants,
 * and this is a perf knob a developer dials (lib/fog.js), never something a
 * player or a URL touches — a plain top-of-file constant is the right shape
 * for it, matching how PIECE_SCALE etc. are tuned elsewhere in this project.
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

function fragmentShaderSource() {
  return /* glsl */ `
    uniform sampler2D uMask;
    uniform float uTime;
    uniform float uOpacity;
    uniform vec3 uColor;
    uniform float uScale;
    uniform float uDriftScale;
    uniform float uEdgeGain;
    varying vec2 vUv;

    ${FBM_GLSL}
    ${ridgedGLSL('ridgedWisp', FOG_WISP_OCTAVES)}
    ${FOG_ENABLE_DETAIL ? ridgedGLSL('ridgedDetail', FOG_DETAIL_OCTAVES) : ''}

    void main() {
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
      // its own visible shapes — note the double attenuation (0.35 here, 0.25
      // again below), deliberately faint.
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
      // stays dense rather than reading as a flat translucent rectangle.
      float density = pow(1.0 - visible, 1.35) + edge * uEdgeGain;
      float alpha = clamp(density * mix(0.35, 1.0, shaped), 0.0, 1.0);
      alpha *= uOpacity;

      if (alpha < 0.002) discard;

      // Alpha alone cannot carry the wisp structure over every tile: FOG_COLOR
      // is a pale near-white, and blending a pale colour at any alpha over an
      // already-pale light square barely moves the result — the light squares
      // start close enough to FOG_COLOR that even a 0.85 opacity difference is
      // a few luma units. Varying the colour itself (denser/greyer between
      // wisps, palest at their peaks) keeps the thread structure legible over
      // dark AND light tiles alike, not just the dark ones.
      vec3 fogColor = mix(uColor * 0.74, uColor, shaped);

      gl_FragColor = vec4(fogColor, alpha);
    }
  `;
}

function makeFogMaterial(mask, { opacity, scale, driftScale, edgeGain }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMask: { value: mask },
      uTime: { value: 0 },
      uOpacity: { value: opacity },
      uColor: { value: new THREE.Color(FOG_COLOR) },
      uScale: { value: scale },
      uDriftScale: { value: driftScale },
      uEdgeGain: { value: edgeGain },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: fragmentShaderSource(),
    transparent: true,
    depthWrite: false,
  });
}

export default function FogShader({ visibility }) {
  const current = useRef(new Float32Array(64));
  const target = useRef(new Float32Array(64));

  const { mask, groundMaterial, driftMaterial } = useMemo(() => {
    const data = new Float32Array(64); // 1 = visible, 0 = fogged
    const texture = new THREE.DataTexture(data, 8, 8, THREE.RedFormat, THREE.FloatType);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    return {
      mask: texture,
      // uScale multiplies the shader's literal per-layer base scales
      // (3.0/4.0/11.0), so 1.0 is "as specified" and >1 is finer-grained.
      groundMaterial: makeFogMaterial(texture, {
        opacity: FOG_OPACITY,
        scale: 1.0,
        driftScale: 1.0,
        edgeGain: 0.35,
      }),
      // Second, higher sheet at a finer grain and a mirrored (negative)
      // drift rate. The parallax between the two sells volume without a real
      // volumetric pass. Its opacity is deliberately tiny: anything raised
      // above the board occludes far squares at shallow camera angles, which
      // is the exact problem that put the main fog on the ground in the
      // first place.
      //
      // Skipped entirely (not just rendered at zero alpha) when
      // FOG_DRIFT_OPACITY is 0 — this is the first item on lib/fog.js's
      // performance ladder, and it only actually saves anything if the
      // second draw call, and the shader compile behind it, never happen.
      driftMaterial:
        FOG_DRIFT_OPACITY > 0
          ? makeFogMaterial(texture, {
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
      groundMaterial.dispose();
      driftMaterial?.dispose();
      mask.dispose();
    },
    [groundMaterial, driftMaterial, mask],
  );

  // QA hook, gated the same way HUD's ?debug=1 readout is: lets a script
  // inspect the live mask/uniform state instead of guessing from pixels.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('debug')) return;
    window.__fogMaterials = { groundMaterial, driftMaterial, mask };
  }, [groundMaterial, driftMaterial, mask]);

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

    groundMaterial.uniforms.uTime.value += delta;
    if (driftMaterial) driftMaterial.uniforms.uTime.value += delta;
  });

  return (
    <group>
      <mesh position={[0, FOG_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <planeGeometry args={[8, 8]} />
        <primitive object={groundMaterial} attach="material" />
      </mesh>
      {driftMaterial && (
        <mesh position={[0, FOG_DRIFT_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
          <planeGeometry args={[8, 8]} />
          <primitive object={driftMaterial} attach="material" />
        </mesh>
      )}
    </group>
  );
}
