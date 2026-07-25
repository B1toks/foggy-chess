import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ALL_SQUARES,
  FOG_COLOR,
  FOG_DRIFT_HEIGHT,
  FOG_DRIFT_OPACITY,
  FOG_HEIGHT,
  FOG_LERP_SPEED,
  FOG_OPACITY,
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

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uMask;
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColor;
  uniform float uScale;
  uniform float uDriftScale;
  uniform float uEdgeGain;
  varying vec2 vUv;

  ${FBM_GLSL}

  void main() {
    // LinearFilter on the 8x8 mask is what turns per-square 0/1 values into
    // a smooth gradient, so this is already soft before the noise lands.
    float visible = texture2D(uMask, vUv).r;

    // Domain warping: displacing the sample point by another fbm is what makes
    // the fog billow into clumps instead of an even speckled wash.
    vec2 q = vec2(
      fbm(vUv * 3.0 + uTime * 0.02 * uDriftScale),
      fbm(vUv * 3.0 + vec2(5.2, 1.3) - uTime * 0.015 * uDriftScale)
    );
    float clouds = fbm(vUv * uScale + q * 1.5);

    // Steeper than linear so the fog stays opaque in the deep and gives way
    // quickly near the frontier, rather than hazing the whole board evenly.
    float density = pow(1.0 - visible, 1.4);
    float shaped = smoothstep(0.30, 0.72, clouds);

    // A wisp along the frontier. The mask gradient peaks exactly where visible
    // meets fogged, so it thickens the boundary and keeps it from reading as a
    // plain translucent rectangle.
    vec2 texel = vec2(1.0 / 8.0);
    float gx = texture2D(uMask, vUv + vec2(texel.x, 0.0)).r
             - texture2D(uMask, vUv - vec2(texel.x, 0.0)).r;
    float gy = texture2D(uMask, vUv + vec2(0.0, texel.y)).r
             - texture2D(uMask, vUv - vec2(0.0, texel.y)).r;
    float edge = clamp(length(vec2(gx, gy)), 0.0, 1.0);

    float alpha = density * mix(0.55, 1.0, shaped);
    alpha += edge * uEdgeGain * clouds * density;
    alpha = clamp(alpha, 0.0, 1.0) * uOpacity;

    if (alpha < 0.002) discard;

    gl_FragColor = vec4(uColor, alpha);
  }
`;

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
    fragmentShader: FRAGMENT_SHADER,
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
      groundMaterial: makeFogMaterial(texture, {
        opacity: FOG_OPACITY,
        scale: 5.0,
        driftScale: 1.0,
        edgeGain: 0.45,
      }),
      // Second, higher sheet at a different noise scale and drift rate. The
      // parallax between the two sells volume without a real volumetric pass.
      // Its opacity is deliberately tiny: anything raised above the board
      // occludes far squares at shallow camera angles, which is the exact
      // problem that put the main fog on the ground in the first place.
      driftMaterial: makeFogMaterial(texture, {
        opacity: FOG_DRIFT_OPACITY,
        scale: 8.5,
        driftScale: -1.7,
        edgeGain: 0.0,
      }),
    };
  }, []);

  useEffect(
    () => () => {
      groundMaterial.dispose();
      driftMaterial.dispose();
      mask.dispose();
    },
    [groundMaterial, driftMaterial, mask],
  );

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
    driftMaterial.uniforms.uTime.value += delta;
  });

  return (
    <group>
      <mesh position={[0, FOG_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <planeGeometry args={[8, 8]} />
        <primitive object={groundMaterial} attach="material" />
      </mesh>
      <mesh position={[0, FOG_DRIFT_HEIGHT, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
        <planeGeometry args={[8, 8]} />
        <primitive object={driftMaterial} attach="material" />
      </mesh>
    </group>
  );
}
