import { useMemo } from 'react';
import * as THREE from 'three';
import { FBM_GLSL } from '../lib/noise';

/*
 * A full sphere, seen from inside, that closes the scene on every azimuth and
 * every pitch. Everything else that draws a "background" — the painted
 * segment, the procedural ridge shells — only covers a slice of the sphere
 * around the camera's resting direction; this is what is behind THEM, so
 * there is no longer a way to orbit into open space.
 *
 * Radius comfortably clears the farthest other geometry (the painted segment
 * at r=46, procedural shells at r<=36) and stays well inside the default
 * camera far plane (2000).
 */
export const DOME_RADIUS = 180;

// Same three stops the brief specifies. HORIZON is exported because scene fog
// is set to match it in GameCanvas — otherwise the point where the painting's
// distance-fog fades into open dome shows a visible seam of mismatched tone.
export const DOME_TOP_COLOR = '#F0EBDE';
export const DOME_HORIZON_COLOR = '#DCD6C8';
export const DOME_LOW_COLOR = '#CFC7B6';

// Barely-there large-scale texture so an empty stretch of "paper" doesn't read
// as a perfectly flat fill. Amplitude is tuned to be almost subliminal.
const HAZE_AMOUNT = 0.035;
const HAZE_SCALE = 0.85;

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vDir;

  void main() {
    // The sphere is centred on the origin and not scaled, so local position IS
    // the outward direction (up to the constant radius) — no extra transform
    // needed to get a per-fragment view/sky direction.
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uLow;
  uniform float uHazeAmount;
  uniform float uHazeScale;
  varying vec3 vDir;

  ${FBM_GLSL}

  void main() {
    // Three-stop vertical gradient keyed off the sphere direction's own Y —
    // equivalent to elevation angle, and correct regardless of dome radius.
    float t = vDir.y;
    vec3 color = t >= 0.0
      ? mix(uHorizon, uTop, smoothstep(0.0, 1.0, t))
      : mix(uHorizon, uLow, smoothstep(0.0, 1.0, -t));

    // Sampled straight off vDir.xz rather than an azimuth angle: xz is already
    // a smooth, continuous parametrisation of direction with no wraparound, so
    // this has no seam at any azimuth without needing to special-case one.
    float haze = fbm(vDir.xz * uHazeScale) - 0.5;
    color += haze * uHazeAmount;

    gl_FragColor = vec4(color, 1.0);
  }
`;

export default function SkyDome() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTop: { value: new THREE.Color(DOME_TOP_COLOR) },
          uHorizon: { value: new THREE.Color(DOME_HORIZON_COLOR) },
          uLow: { value: new THREE.Color(DOME_LOW_COLOR) },
          uHazeAmount: { value: HAZE_AMOUNT },
          uHazeScale: { value: HAZE_SCALE },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        // Fully opaque and the single farthest thing in the scene: ordinary
        // depth testing already puts it behind everything, and NOT reacting to
        // scene fog is deliberate — the dome IS the atmosphere at infinity, so
        // fogging it toward fogColor would just flatten its own gradient into
        // a single flat tint past `fog.far`.
        side: THREE.BackSide,
      }),
    [],
  );

  return (
    <mesh material={material}>
      <sphereGeometry args={[DOME_RADIUS, 32, 24]} />
    </mesh>
  );
}
