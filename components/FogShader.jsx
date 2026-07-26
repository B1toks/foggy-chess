import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ALL_SQUARES,
  FOG_ALPHA_KNEE,
  FOG_DEPTH_COLOR_HIGH,
  FOG_DEPTH_COLOR_LOW,
  FOG_DEPTH_COLOR_MID,
  FOG_DETAIL_OCTAVES,
  FOG_ENABLE_DETAIL,
  FOG_LAYER_ALPHA_MULT,
  FOG_LAYER_HEIGHTS,
  FOG_LAYERS,
  FOG_LERP_SPEED,
  FOG_MAX_ALPHA,
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
 * build time, not passed as a uniform: GLSL loop bounds are simplest and
 * most portable as compile-time constants, and this is a perf knob a
 * developer dials (lib/fog.js), never something a player or a URL touches.
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
 * Shared by every layer's fragment shader (and the edge-multiply pass): the
 * uniforms and noise functions don't vary, so this exists as one piece of
 * text instead of several copies that could quietly drift apart.
 */
function sharedUniformsAndNoiseGLSL() {
  return /* glsl */ `
    uniform sampler2D uMask;
    uniform float uTime;
    uniform float uOpacity;
    uniform float uScale;
    uniform float uDriftScale;
    uniform float uDriftAngle;
    uniform vec2 uUvOffset;
    uniform float uEdgeGain;
    varying vec2 vUv;

    ${FBM_GLSL}
    ${ridgedGLSL('ridgedWisp', FOG_WISP_OCTAVES)}
    ${FOG_ENABLE_DETAIL ? ridgedGLSL('ridgedDetail', FOG_DETAIL_OCTAVES) : ''}

    vec2 rotate(vec2 v, float a) {
      float c = cos(a);
      float s = sin(a);
      return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
    }
  `;
}

/*
 * Also shared: everything from sampling the mask through to `density` (how
 * fogged this pixel is, boundary-boosted) and `shaped` (the wisp pattern's
 * own coverage, 0..1).
 *
 * Крок 10, Section B additions over the Крок 9.5 version: `uUvOffset` shifts
 * this layer's whole noise field by an amount the caller sets proportional
 * to the layer's own height ("UV-зсув пропорційний висоті" in the brief) —
 * real geometric parallax between layers already falls out for free from
 * them being actual planes at different Y as the camera orbits; this offset
 * is what keeps five layers from ever sampling the *identical* pattern
 * directly on top of each other, which would silhouette as one layer, not
 * five. `uDriftAngle` rotates the three drift vectors (not the static
 * sampling grid — that would fight the deliberately anisotropic "stretched"
 * sampling below and turn horizontal streaks into a rotated mess) so each
 * layer's wisps drift in their own direction, not just at their own speed.
 */
function densityAndShapeGLSL() {
  return /* glsl */ `
    vec2 sampleUv = vUv + uUvOffset;

    // Крок 10, Section B fix: sampling the mask at the live, freely-varying
    // vUv through a LinearFilter texture blends in neighbouring texels
    // whenever a fragment lands anywhere near a texel boundary — which is
    // most of a boundary square's own area, not just its edge pixels. At
    // the old, gentler alpha ceiling that bleed was invisible; at
    // FOG_MAX_ALPHA=0.94 it was enough on its own to wash a fully *visible*
    // boundary square down by 80+ luma, failing "visible squares stay
    // absolutely clean" outright. Snapping to the containing texel's exact
    // centre before sampling reads that texel undiluted — bilinear weights
    // are exactly (1,0,0,0) at a texel centre — so ownVisible is the true
    // discrete 0/1 state of *this* square, never a neighbour's blend.
    vec2 cellUv = (floor(vUv * 8.0) + 0.5) / 8.0;
    float ownVisible = texture2D(uMask, cellUv).r;

    // Three non-parallel, non-proportional drift vectors — not one vector
    // scaled and negated — so the wisp structure keeps reconfiguring as it
    // moves instead of just translating as a rigid pattern. Rotated per
    // layer by uDriftAngle so each layer also drifts its own direction.
    vec2 driftMass   = rotate(vec2( 0.015, -0.009), uDriftAngle) * uTime * uDriftScale;
    vec2 driftWisps  = rotate(vec2(-0.021,  0.017), uDriftAngle) * uTime * uDriftScale;
    vec2 driftDetail = rotate(vec2( 0.034,  0.026), uDriftAngle) * uTime * uDriftScale;

    // Compressing the sample point's V by 3.2x before feeding it to the
    // ridged layers means the noise argument changes fast along V (rank,
    // "into the board") and slow along U (file, "across the board") — so
    // the ridges it produces read as long streaks along U: horizontal
    // wisps, not an isotropic speckle.
    vec2 stretched = vec2(sampleUv.x, sampleUv.y * 3.2);

    // Large, slow: the general mass of haze — this is what the old single
    // fbm() call used to be on its own.
    float mass = fbm(sampleUv * 3.0 * uScale + driftMass);
    // Medium, ridged: the wisps themselves.
    float wisps = ridgedWisp(stretched * 4.0 * uScale + driftWisps);
    // Small, ridged, faint: frays the edges of the wisps rather than adding
    // its own visible shapes — note the double attenuation (0.35 here, more
    // wherever shaped is used below), deliberately faint.
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
    // Gated by (1 - ownVisible): the gradient is nonzero on *both* sides of
    // a boundary (a visible texel next to a fogged one has just as steep a
    // gradient as the fogged texel itself), but the frontier-thickening
    // effect is only wanted on the fogged side. Without this gate a visible
    // boundary square picked up real density from its fogged neighbour's
    // edge alone — the second half of the same bleed cellUv above fixes
    // for the mask's base term.
    float edge = clamp(length(vec2(gx, gy)) * 1.8, 0.0, 1.0) * (1.0 - ownVisible);

    float shaped = smoothstep(0.28, 0.78, clouds);

    // Steeper than linear so the fog stays opaque in the deep and gives way
    // quickly near the frontier, plus the edge boost so the boundary itself
    // stays dense rather than reading as a flat translucent rectangle. Exactly
    // zero on a visible square: ownVisible=1 zeroes the first term, and the
    // (1 - ownVisible) gate above zeroes edge too — both independently, so a
    // visible square stays clean regardless of camera angle, how many layers
    // are stacked overhead, or how steep its neighbour's own gradient is.
    float density = pow(1.0 - ownVisible, 1.35) + edge * uEdgeGain;
  `;
}

/*
 * Крок 10, Section A — the readability rebuild. Alpha, not multiply, is the
 * primary mechanism again: THREE.MultiplyBlending (Крок 9.5) could only ever
 * scale the framebuffer, never truly hide it, so even "readable" deep fog
 * still let a careful look tell a light tile from a dark one. Plain alpha
 * reaching FOG_MAX_ALPHA (0.94) in the deep field means whatever's
 * underneath contributes at most 6% of the final pixel — provably below the
 * "< 6 luma difference" verification bar, not just tuned to look right.
 *
 * `uOpacity` here is each layer's own alpha multiplier (1.0 for the base
 * layer, falling off fast for the raised ones — see FOG_LAYER_ALPHA_MULT),
 * not a single global knob anymore.
 *
 * `uSurfaceStart`/`uSurfaceEnd` — Section B's "top surface": an extra
 * smoothstep gate on `density` so a raised layer only appears where the fog
 * beneath it is *already* substantially deep, tapering to nothing at the
 * frontier. The base layer's gate is [0, 0] (smoothstep degenerates to "on"
 * for any density > 0), so it alone still reproduces Section A's curve
 * exactly, unrestricted — raised layers are silhouette riding on top of it,
 * never a second source of readability.
 *
 * `uColorMid` and `colorVariance` fix a bug the brief's own verification
 * step caught: mixing the full uColorLow-uColorHigh range (a ~37-luma
 * spread) at every density meant two *adjacent* deep-fog pixels could land
 * on different points of that range purely from noise phase, independent of
 * which tile was underneath — measured, this alone produced a bigger luma
 * delta between two deep-fogged neighbours than the "< 6" bar allows, before
 * the underlying tile ever entered into it. The brief's own colour range is
 * for the frontier ("на межі — м'який градієнт, це те, що розповідає
 * історію"); the deep interior is supposed to be "глухо" — muffled, uniform,
 * not textured — so `colorVariance` fades the noise mix out as density rises
 * past the alpha knee, converging on a single flat `uColorMid` deep in the
 * field instead of continuing to swing across the full range.
 */
function layerFragmentShaderSource() {
  return /* glsl */ `
    ${sharedUniformsAndNoiseGLSL()}
    uniform vec3 uColorLow;
    uniform vec3 uColorHigh;
    uniform vec3 uColorMid;
    uniform float uSurfaceStart;
    uniform float uSurfaceEnd;

    void main() {
      ${densityAndShapeGLSL()}

      float surface = uSurfaceEnd > uSurfaceStart
        ? smoothstep(uSurfaceStart, uSurfaceEnd, density)
        : step(uSurfaceStart, density);
      float alpha = smoothstep(0.0, ${FOG_ALPHA_KNEE.toFixed(3)}, density)
        * ${FOG_MAX_ALPHA.toFixed(3)} * uOpacity * surface;
      if (alpha < 0.002) discard;

      vec3 noisyColor = mix(uColorLow, uColorHigh, shaped);
      float colorVariance = 1.0 - smoothstep(${FOG_ALPHA_KNEE.toFixed(3)}, 1.0, density);
      vec3 color = mix(uColorMid, noisyColor, colorVariance);
      gl_FragColor = vec4(color, alpha);
    }
  `;
}

/*
 * The one surviving multiply pass, demoted from "the mechanism" (Крок 9.5)
 * to "a little extra depth right at the frontier" (Крок 10). Windowed to
 * density 0.15-0.5 so it touches neither the fully clear zone (nothing to
 * darken) nor the deep interior (already opaque — multiplying an already-
 * 94%-covered pixel toward a tint is imperceptible and not worth the ALU).
 * Mounted once, on the base layer only — raised layers are silhouette and
 * don't need their own edge treatment.
 */
function edgeMultiplyFragmentShaderSource() {
  return /* glsl */ `
    ${sharedUniformsAndNoiseGLSL()}
    uniform vec3 uTint;

    void main() {
      ${densityAndShapeGLSL()}

      float band = smoothstep(0.15, 0.3, density) * (1.0 - smoothstep(0.35, 0.5, density));
      if (band < 0.002) discard;

      vec3 base = mix(vec3(1.0), uTint, band * 0.5);
      gl_FragColor = vec4(base, 1.0);
    }
  `;
}

function makeLayerMaterial(mask, params) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMask: { value: mask },
      uTime: { value: 0 },
      uOpacity: { value: params.alphaMult },
      uScale: { value: params.scale },
      uDriftScale: { value: params.driftScale },
      uDriftAngle: { value: params.driftAngle },
      uUvOffset: { value: new THREE.Vector2(params.uvOffset[0], params.uvOffset[1]) },
      uEdgeGain: { value: params.edgeGain },
      uColorLow: { value: new THREE.Color(FOG_DEPTH_COLOR_LOW) },
      uColorHigh: { value: new THREE.Color(FOG_DEPTH_COLOR_HIGH) },
      uColorMid: { value: new THREE.Color(FOG_DEPTH_COLOR_MID) },
      uSurfaceStart: { value: params.surfaceStart },
      uSurfaceEnd: { value: params.surfaceEnd },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: layerFragmentShaderSource(),
    transparent: true,
    depthWrite: false,
  });
}

function makeEdgeMultiplyMaterial(mask, params) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMask: { value: mask },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uScale: { value: params.scale },
      uDriftScale: { value: params.driftScale },
      uDriftAngle: { value: params.driftAngle },
      uUvOffset: { value: new THREE.Vector2(0, 0) },
      uEdgeGain: { value: params.edgeGain },
      uTint: { value: new THREE.Color(FOG_TINT_COLOR) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: edgeMultiplyFragmentShaderSource(),
    transparent: true,
    depthWrite: false,
    blending: THREE.MultiplyBlending,
  });
}

/*
 * Крок 10, Section B: per-layer tuning, derived from index rather than
 * hand-picked per layer, so FOG_LAYERS can drop from 5 to 2 (the perf
 * ladder's first lever) without leaving orphaned config behind.
 *
 * - scale grows with height ("масштаб шуму зростає з висотою"): higher
 *   layers get finer-grained noise.
 * - driftAngle spreads layers around a circle so no two drift the same way;
 *   driftScale alternates sign and grows slightly so speed differs too.
 * - uvOffset is proportional to height, in a fixed (non-height-dependent)
 *   direction — see densityAndShapeGLSL's own comment for why this exists
 *   alongside the real geometric parallax the height difference already
 *   gives for free.
 * - surfaceStart/End step up with height: the base layer (index 0) is
 *   unrestricted ([0, 0]), each layer above needs progressively deeper fog
 *   beneath it before it shows at all, tapering the whole stack's silhouette
 *   to nothing at the frontier instead of a hard-edged wall of planes.
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

export default function FogShader({ visibility }) {
  const current = useRef(new Float32Array(64));
  const target = useRef(new Float32Array(64));

  const { mask, layers, edgeMultiply } = useMemo(() => {
    const data = new Float32Array(64); // 1 = visible, 0 = fogged
    const texture = new THREE.DataTexture(data, 8, 8, THREE.RedFormat, THREE.FloatType);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    const builtLayers = FOG_LAYER_HEIGHTS.slice(0, FOG_LAYERS).map((height, i) => {
      const params = layerParams(i, height);
      return { height, material: makeLayerMaterial(texture, params) };
    });

    return {
      mask: texture,
      layers: builtLayers,
      // Mounted against the base layer's own params (index 0) so its noise
      // sampling lines up with what it's adding depth on top of.
      edgeMultiply: makeEdgeMultiplyMaterial(texture, layerParams(0, FOG_LAYER_HEIGHTS[0])),
    };
  }, []);

  useEffect(
    () => () => {
      layers.forEach((l) => l.material.dispose());
      edgeMultiply.dispose();
      mask.dispose();
    },
    [layers, edgeMultiply, mask],
  );

  // QA hook, gated the same way HUD's ?debug=1 readout is: lets a script
  // inspect the live mask/uniform state instead of guessing from pixels.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.search.includes('debug')) return;
    window.__fogMaterials = { layers, edgeMultiply, mask };
  }, [layers, edgeMultiply, mask]);

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

    layers.forEach((l) => {
      l.material.uniforms.uTime.value += delta;
    });
    edgeMultiply.uniforms.uTime.value += delta;
  });

  return (
    <group>
      {layers.map((l, i) => (
        <mesh
          key={i}
          position={[0, l.height, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={2 + i}
        >
          <planeGeometry args={[8, 8]} />
          <primitive object={l.material} attach="material" />
        </mesh>
      ))}
      {/* Same height as the base layer, but drawn last (highest renderOrder)
          so its multiply darkens whatever the whole layer stack has already
          composited in the transition band, base included — a subtle final
          pass, not a step wedged between two alpha layers. */}
      <mesh position={[0, FOG_LAYER_HEIGHTS[0], 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2 + FOG_LAYERS}>
        <planeGeometry args={[8, 8]} />
        <primitive object={edgeMultiply} attach="material" />
      </mesh>
    </group>
  );
}
