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
  FOG_DENSITY_KNEE,
  FOG_DENSITY_SOFT,
  FOG_DEPTH_SHADE,
  FOG_EXTINCTION,
  FOG_HEIGHT,
  FOG_LIGHT_STEP,
  FOG_LIGHT_UV,
  FOG_LIT_COLOR,
  FOG_MARCH_STEPS,
  FOG_MAX_ALPHA,
  FOG_NOISE_SCALE_DETAIL,
  FOG_NOISE_SCALE_MASS,
  FOG_NOISE_SCALE_WISPS,
  FOG_NOISE_STRETCH_V,
  FOG_REVEAL_THICKEN_DURATION,
  FOG_SHADE_GAIN,
  FOG_SHADOW_COLOR,
  FOG_SLAB_HEIGHT,
  FOG_SLAB_OVERHANG,
  FOG_TINT_COLOR,
  FOG_VERTICAL_FALLOFF,
  FOG_VOLUME_MAX_ALPHA,
  FOG_WAVE_DELAY_PER_CELL,
  FOG_WAVE_DURATION,
  squareChebyshevDistance,
  squareToMaskIndex,
} from '../lib/fog';
import { easeOutCubic } from '../lib/easing';
import { getFogNoiseTexture } from './proceduralTextures';

/*
 * ARCHITECTURE, and the two previous ones it replaced.
 *
 * Крок 10 Section B: FOG_LAYERS (5) real planes at five heights, each its own
 * ShaderMaterial computing three from-scratch noise functions (one fbm + two
 * ridged, five octaves each) per pixel, plus a sixth mesh for an edge-multiply
 * tint. Six draw calls and ~15 noise-octave evaluations per pixel per plane,
 * multiplied again by transparent overdraw where the planes stacked.
 *
 * Крок 11 Section A: one plane, five VIRTUAL slices composited inside a single
 * fragment shader, each slice's height faked by a UV parallax shift along the
 * view direction. Noise moved into a baked texture (getFogNoiseTexture — four
 * channels ARE four pre-computed octaves, so one texture2D fetch replaces an
 * octave loop; fbmTex/ridgedTex below are what read it, and that part survives
 * unchanged). Six draw calls became one.
 *
 * Крок 12 Section C2: A BOX, RAYMARCHED. The Крок 11 shape was the problem: a
 * flat plane, however cleverly shaded, has no vertical extent, so the fog could
 * never stand up off the board — repeatedly reported as "no volume". The fog is
 * now a real 8+overhang x FOG_SLAB_HEIGHT x 8+overhang slab whose fragment shader
 * intersects the view ray analytically and marches FOG_MARCH_STEPS samples
 * through a 3D density field. Still one draw call. See lib/fog.js for the full
 * account, including the two intermediate density models (a filled region under a
 * lumpy "ceiling" surface) that both read as a solid object and were abandoned.
 *
 * WHAT MUST NOT REGRESS, across any future rework of this file:
 *
 * The occlusion guarantee is computed from the MASK ALONE, never from the march —
 * see baseAlpha in main(). It is the same expression Крок 10 Section A tuned and
 * verified, evaluated at the texel-snapped cell the view ray's base-plane
 * crossing lands in, and the volume can only ever RAISE the final alpha via
 * max(). So "you cannot tell a light tile from a dark one under deep fog" cannot
 * be broken by anything the raymarch does. tools/fogdiag.mjs measures it directly
 * by repainting every tile flat and re-rendering: whatever the fog hides cannot
 * change between the two frames, so the per-square difference IS the leak.
 * Current: 2.18 luma mean, 4.44 max, against a 6-luma budget.
 *
 * baseAlpha is additionally gated by `onBoard`, which is not cosmetic — without
 * it the clamped ground UV gives every fragment in the overhang some border
 * square's full 94% opacity, painting a hard rectangular apron around the board.
 */

/*
 * The box is axis-aligned in world space and never rotated or scaled, so the
 * fragment shader can do its ray-box intersection directly in WORLD coordinates
 * against two constant corners. That is deliberate: GLSL ES 1.0 has no
 * inverse(), so working in object space would mean either passing an inverse
 * model matrix as a uniform or reconstructing it — for no benefit, since the box
 * is a fixed 8 x FOG_SLAB_HEIGHT x 8 sitting on the origin.
 */
const VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPos;

  void main() {
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
 * Крок 12, Section C2: the raymarched fog volume.
 *
 * This replaces sliceGLSL()/layerParams(), which composited FOG_LAYERS virtual
 * slices into one flat plane. See lib/fog.js's FOG_SLAB_HEIGHT comment for why a
 * flat plane could not be made to read as volume no matter how its colour was
 * tuned: there was no vertical extent anywhere in the model.
 *
 * Everything is templated in as GLSL literals from lib/fog.js, the same way the
 * slice code was, and the march is a fixed, fully-unrollable loop count.
 */
function fragmentShaderSource() {
  const slabTop = FOG_HEIGHT + FOG_SLAB_HEIGHT;
  const slabHalf = 4 + FOG_SLAB_OVERHANG;

  return /* glsl */ `
    ${sharedUniformsAndNoiseGLSL()}
    uniform vec3 uColorShadow;
    uniform vec3 uColorLit;
    uniform vec3 uTint;
    uniform vec2 uLightUv;

    // Constant world-space bounds of the fog slab. The mesh is never rotated or
    // scaled, so these are literals rather than uniforms. The XZ bounds are the
    // board's own 4.0 half-width PLUS FOG_SLAB_OVERHANG, so fog can spill past
    // the board edge and over the rock — see FOG_SLAB_OVERHANG in lib/fog.js.
    const float BOARD_HALF = 4.0;
    const float OVERHANG = ${FOG_SLAB_OVERHANG.toFixed(4)};
    const vec3 BOX_MIN = vec3(-${slabHalf.toFixed(4)}, ${FOG_HEIGHT.toFixed(4)}, -${slabHalf.toFixed(4)});
    const vec3 BOX_MAX = vec3( ${slabHalf.toFixed(4)}, ${slabTop.toFixed(4)},  ${slabHalf.toFixed(4)});

    /*
     * Board XZ -> mask UV. Derived exactly as squareToMaskIndex documents:
     * world x = -4 + 8*u and world z = 4 - 8*v. Getting this transposed or
     * mirrored is the classic fog bug — /dev-fog?visible=a1 is the check.
     */
    vec2 boardUv(vec3 p) {
      return vec2((p.x + 4.0) / 8.0, (4.0 - p.z) / 8.0);
    }

    /*
     * The cloud field at a point, as a function of board UV and height fraction.
     * The height term shears the sampling position, so different heights in the
     * slab see different parts of the noise field — without it the volume would
     * be a vertically extruded 2D pattern, which reads as a stack of identical
     * cutouts rather than a body of fog.
     */
    float cloudField(vec2 uvIn, float h, float pulse) {
      vec2 sampleUv = uvIn + vec2(h * 0.30, h * -0.19);
      vec2 driftMass  = vec2( 0.015, -0.009) * uTime;
      vec2 driftWisps = vec2(-0.021,  0.017) * uTime;
      vec2 stretched = vec2(sampleUv.x, sampleUv.y * ${FOG_NOISE_STRETCH_V.toFixed(4)});
      float mass  = fbmTex(sampleUv * ${FOG_NOISE_SCALE_MASS.toFixed(4)} + driftMass);
      float wisps = ridgedTex(stretched * ${FOG_NOISE_SCALE_WISPS.toFixed(4)} + driftWisps);
      // Weighted toward mass, not wisps. The ridged layer is sampled through the
      // anisotropic V stretch, so leaning on it reads as horizontal brush strokes
      // — convincing as fibre on a flat sheet, but on a volume it looked like
      // brushed metal. Mass carries the billow shapes; wisps only texture them.
      // Крок 13: 0.74/0.26 -> 0.70/0.30, a small nudge toward wisps for a bit
      // more visible fibre detail without tipping back into brushed-metal
      // territory.
      return mass * 0.70 + wisps * (0.30 + pulse * 0.2);
    }

    // Standard slab method. Returns false when the ray misses the box.
    bool rayBox(vec3 ro, vec3 rd, out float t0, out float t1) {
      vec3 inv = 1.0 / rd;
      vec3 a = (BOX_MIN - ro) * inv;
      vec3 b = (BOX_MAX - ro) * inv;
      vec3 lo = min(a, b);
      vec3 hi = max(a, b);
      t0 = max(max(lo.x, lo.y), lo.z);
      t1 = min(min(hi.x, hi.y), hi.z);
      return t1 > max(t0, 0.0);
    }

    void main() {
      vec3 ro = cameraPosition;
      vec3 rd = normalize(vWorldPos - ro);

      float t0, t1;
      if (!rayBox(ro, rd, t0, t1)) discard;
      t0 = max(t0, 0.0);

      /*
       * GROUND UV: where the view ray crosses the slab's BASE plane. That is the
       * square the player is actually looking at through the fog, and it is what
       * the occlusion guarantee below is computed from — the same quantity the
       * old flat-plane shader had as vUv, so Крок 10 Section A's verified alpha
       * expression carries over unchanged.
       *
       * A near-horizontal ray can exit through a side wall without ever reaching
       * the base plane; there is no such square then, so the exit point is used
       * instead. That is what makes a fog bank seen edge-on still belong to the
       * fogged region behind it rather than reading as unfogged.
       */
      float tGround = abs(rd.y) > 1e-5 ? (BOX_MIN.y - ro.y) / rd.y : -1.0;
      vec3 groundHit = ro + rd * (tGround > t0 && tGround <= t1 ? tGround : t1);
      vec2 groundUv = clamp(boardUv(groundHit), vec2(0.0), vec2(1.0));

      /*
       * Is the ground hit actually ON the 8x8 board, or out in the overhang?
       *
       * This gate is not optional. groundUv above is CLAMPED, so every fragment
       * out in the overhang resolves to some board-border square — and if that
       * square happens to be fogged, the mask-driven baseAlpha below would return
       * FOG_MAX_ALPHA for the entire overhang. The visible result is a solid
       * rectangular apron of flat 94%-opaque grey extending past the board on all
       * four sides: the "translucent plate hovering over the board" symptom, whose
       * cause is this clamp rather than anything in the march.
       *
       * Gating baseAlpha by it is also correct on its own terms: baseAlpha exists
       * to guarantee that a fogged SQUARE is occluded, and off the board there is
       * no square to guarantee anything about. Out there the raymarch's own alpha
       * is the whole story, which is what makes the spill read as fog rather than
       * as a rectangle.
       */
      vec2 gEdge = abs(groundHit.xz) - vec2(BOARD_HALF);
      float onBoard = 1.0 - smoothstep(0.0, OVERHANG, max(max(gEdge.x, gEdge.y), 0.0));

      // Unshifted read first, purely for this square's own timing state (reveal
      // pulse, wave-suppression clock below) — its identity must stay tied to the
      // true cell regardless of any breathing offset applied after. Texel-centre
      // snap per Крок 10 Section B: reads the texel undiluted, no neighbour blend.
      vec2 cellUv0 = (floor(groundUv * 8.0) + 0.5) / 8.0;
      vec4 ownMask0 = texture2D(uMask, cellUv0);
      float revealAge = uTime - ownMask0.g;
      float revealPulse = ownMask0.g > -500.0 ? exp(-abs(revealAge) * 3.0) : 0.0;

      // Крок 11, Section D: breathing must not fight an in-flight reveal/conceal
      // wave (Крок 10 Section C). ownMask0.b carries the wall-clock moment THIS
      // square's current wave (either direction) started. Amplitude is gated to 0
      // as a wave starts and eased back in over the wave's own duration, so the
      // two motions never read as one blurred mess.
      float waveAge = uTime - ownMask0.b;
      float breathAmpMult = smoothstep(0.0, ${FOG_WAVE_DURATION.toFixed(3)}, waveAge);

      float breath1 = sin(uTime * ${FOG_BREATH_PERIOD_SLOW.toFixed(4)}) * 0.5 + 0.5;
      float edgeShift1 = mix(-${FOG_BREATH_AMPLITUDE_SLOW.toFixed(4)}, ${FOG_BREATH_AMPLITUDE_SLOW.toFixed(4)}, breath1);
      // Phase offset by position so the fast ripple doesn't pulse in lockstep
      // across the whole board — it travels as ripples, not a strobe.
      float breath2 = sin(uTime * ${FOG_BREATH_PERIOD_FAST.toFixed(4)} + dot(groundUv, vec2(13.0, 7.0))) * 0.5 + 0.5;
      float edgeShift2 = mix(-${FOG_BREATH_AMPLITUDE_FAST.toFixed(4)}, ${FOG_BREATH_AMPLITUDE_FAST.toFixed(4)}, breath2);
      // In fractions of a board cell (the brief's own units) — how far the
      // boundary itself is nudged this frame. Applied as a UV offset, i.e. it
      // moves WHERE the boundary is tested rather than nudging density after the
      // fact; see Крок 11 Section D for why the latter provably does nothing.
      vec2 breathOffset = vec2((edgeShift1 + edgeShift2) * breathAmpMult) * (1.0 / 8.0);

      vec2 breathedUv = groundUv + breathOffset;
      vec2 cellUv = (floor(breathedUv * 8.0) + 0.5) / 8.0;
      float ownVisible = texture2D(uMask, cellUv).r;

      /*
       * Frontier gradient, computed ONCE. In the old five-slice shader this sat
       * inside the per-slice block, costing 4 mask fetches x 5 slices for what is
       * a property of the pixel and the mask, not of any slice — only the
       * per-slice weight differed.
       *
       * The (1 - ownVisible) gate is unchanged and still load-bearing (Крок 10
       * Section B): the gradient is genuinely nonzero on BOTH sides of a
       * boundary, and the thickening belongs only on the fogged side.
       *
       * The boil warp (Крок 10 Section D — the frontier wobbles rather than
       * tracing a flat edge) needs a noise value, which used to come free from a
       * slice's own detail band and now costs one dedicated ridged sample.
       */
      vec2 texel = vec2(1.0 / 8.0);
      float boilNoise = ridgedTex(
        vec2(groundUv.x, groundUv.y * ${FOG_NOISE_STRETCH_V.toFixed(4)}) * ${FOG_NOISE_SCALE_DETAIL.toFixed(4)}
        + vec2(0.034, 0.026) * uTime
      );
      // Крок 13: 0.07 -> 0.15 — the edge-gradient sample now wanders further
      // off the true mask boundary, which is what stops the frontier reading
      // as a clean 8x8 grid line with just a faint shimmer on it.
      vec2 boil = vec2(boilNoise - 0.5, 0.5 - boilNoise) * 0.15;
      float gx = texture2D(uMask, breathedUv + vec2(texel.x, 0.0) + boil).r
               - texture2D(uMask, breathedUv - vec2(texel.x, 0.0) + boil).r;
      float gy = texture2D(uMask, breathedUv + vec2(0.0, texel.y) + boil).r
               - texture2D(uMask, breathedUv - vec2(0.0, texel.y) + boil).r;
      float edgeRaw = clamp(length(vec2(gx, gy)) * 1.8, 0.0, 1.0) * (1.0 - ownVisible);

      /*
       * THE OCCLUSION GUARANTEE, computed from the mask alone and NOT from the
       * raymarch. This is the curve Крок 10 Section A tuned and verified: density
       * from ownVisible, smoothstepped to FOG_MAX_ALPHA at FOG_ALPHA_KNEE. The
       * volume below can only ever RAISE the final alpha, never lower it, so
       * "you cannot tell a light tile from a dark one under deep fog" cannot
       * regress from anything the march does.
       */
      float density = pow(1.0 - ownVisible, 1.35) + edgeRaw * 0.35;
      float baseAlpha = smoothstep(0.0, ${FOG_ALPHA_KNEE.toFixed(3)}, density)
        * ${FOG_MAX_ALPHA.toFixed(3)} * onBoard;

      /*
       * ---- the march ----
       * A fixed step count across the actual entry/exit span, so a grazing ray
       * samples its longer path at the same resolution as an overhead one and
       * genuinely accumulates more optical depth. That is what makes the fog read
       * as thick from the side and thin from above.
       */
      float span = t1 - t0;
      float stepLen = span / float(${FOG_MARCH_STEPS});
      // Half-step offset so samples sit at segment centres, plus a small
      // screen-space jitter: a fixed 10-step march otherwise shows its sample
      // planes as concentric shells across the slab. Kept low (0.35, not the 0.6
      // it started at) because jitter trades banding for per-pixel sparkle, and
      // with the wide FOG_TOP_SKIN there is much less banding left to hide.
      float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      float t = t0 + stepLen * (0.5 + (jitter - 0.5) * 0.35);

      vec3 volColor = vec3(0.0);
      float trans = 1.0;

      for (int i = 0; i < ${FOG_MARCH_STEPS}; i++) {
        vec3 p = ro + rd * t;
        t += stepLen;

        vec2 uv = boardUv(p) + breathOffset;
        float h = clamp((p.y - BOX_MIN.y) / ${FOG_SLAB_HEIGHT.toFixed(4)}, 0.0, 1.0);

        // Linear-filtered (not texel-snapped) on purpose: this is the volume's
        // own soft frontier in 3D, where the bleed IS the intended look. The
        // texel-snapped read above is what the occlusion guarantee uses.
        float fogAmount = 1.0 - texture2D(uMask, uv).r;
        if (fogAmount <= 0.01) continue;

        /*
         * How far past the board edge this sample is, faded across the overhang
         * so the slab has no hard side walls and the fog visibly spills over the
         * board's rim rather than being sliced off at it.
         */
        vec2 q = abs(p.xz) - vec2(BOARD_HALF);
        float outside = max(max(q.x, q.y), 0.0);
        float spill = 1.0 - smoothstep(0.0, OVERHANG, outside);
        if (spill <= 0.01) continue;

        /*
         * A density FIELD, not a filled region below a surface. See lib/fog.js's
         * FOG_DENSITY_KNEE comment for why the surface model was abandoned.
         *
         * The vertical term decays with height, so multiplying it into the cloud
         * field and then thresholding means only the strongest cloud values
         * survive high up: the fog breaks into billows that end at different
         * heights, with real gaps between them, and reaches exactly 0 before the
         * slab top so no top edge is ever visible. Scaling by fogAmount also makes
         * the bank taper down to nothing at the frontier rather than ending in a
         * cliff.
         */
        float cloud = cloudField(uv, h, revealPulse);
        float vertical = pow(1.0 - h, ${FOG_VERTICAL_FALLOFF.toFixed(4)});
        float shape = cloud * vertical * fogAmount * spill;
        float d = smoothstep(
          ${FOG_DENSITY_KNEE.toFixed(4)},
          ${(FOG_DENSITY_KNEE + FOG_DENSITY_SOFT).toFixed(4)},
          shape
        );
        if (d <= 0.002) continue;

        /*
         * Shading — the part that actually reads as volume:
         *  - height in the slab. Light arrives from above, so a sample's own
         *    height IS how much fog is stacked above it absorbing that light:
         *    crowns bright, base dark. Dominant cue.
         *  - one extra cloud sample toward the light tilts each billow's lit side
         *    brighter and its far side darker, giving the forms a consistent
         *    direction instead of symmetric lumps.
         */
        float cloudToLight = cloudField(uv + uLightUv * ${FOG_LIGHT_STEP.toFixed(4)}, h, revealPulse);
        float facing = clamp(0.5 + (cloud - cloudToLight) * ${FOG_SHADE_GAIN.toFixed(4)}, 0.0, 1.0);
        float lit = facing * mix(1.0 - ${FOG_DEPTH_SHADE.toFixed(4)}, 1.0, h);

        vec3 sampleColor = mix(uColorShadow, uColorLit, lit);
        // A little extra depth right at the frontier — Крок 10's edge tint,
        // demoted long ago from mechanism to accent.
        float tintBand = smoothstep(0.15, 0.3, density) * (1.0 - smoothstep(0.35, 0.5, density));
        sampleColor = mix(sampleColor, uTint, tintBand * 0.5);

        // Beer-Lambert over this segment, front to back.
        float a = 1.0 - exp(-d * stepLen * ${FOG_EXTINCTION.toFixed(4)});
        volColor += sampleColor * a * trans;
        trans *= 1.0 - a;
        if (trans < 0.01) break;
      }

      float volAlpha = min(1.0 - trans, ${FOG_VOLUME_MAX_ALPHA.toFixed(4)});

      /*
       * Combine. baseAlpha is the guarantee, volAlpha is the silhouette. Taking
       * the max keeps a fully fogged square occluded to FOG_MAX_ALPHA even where
       * the march happens to cross a thin patch, while a fog bank rising into the
       * line of sight over CLEAR ground still shows up — bounded by
       * FOG_VOLUME_MAX_ALPHA so it stays haze rather than becoming a wall.
       */
      float outAlpha = max(baseAlpha, volAlpha);
      if (outAlpha < 0.004) discard;

      // volColor is premultiplied by its own coverage, so it is renormalised
      // before being re-premultiplied against outAlpha — otherwise the two alphas
      // compound and the result goes unintentionally dark wherever volAlpha is
      // small but baseAlpha is not.
      vec3 outColor = volAlpha > 0.004 ? volColor / volAlpha : mix(uColorShadow, uColorLit, 0.5);
      gl_FragColor = vec4(outColor * outAlpha, outAlpha);
    }
  `;
}

function makeFogMaterial(mask, noiseTex) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMask: { value: mask },
      uNoiseTex: { value: noiseTex },
      uTime: { value: 0 },
      uColorShadow: { value: new THREE.Color(FOG_SHADOW_COLOR) },
      uColorLit: { value: new THREE.Color(FOG_LIT_COLOR) },
      uTint: { value: new THREE.Color(FOG_TINT_COLOR) },
      // Normalised in JS rather than in GLSL: it is a constant, and normalize()
      // per pixel for a value that never changes is pure waste.
      uLightUv: {
        value: new THREE.Vector2(FOG_LIGHT_UV[0], FOG_LIGHT_UV[1]).normalize(),
      },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: fragmentShaderSource(),
    transparent: true,
    depthWrite: false,
    /*
     * FrontSide, not DoubleSide. The shader reconstructs the whole view ray and
     * intersects the slab analytically, so it only needs ONE fragment per pixel —
     * DoubleSide would run the entire march twice per pixel for an identical
     * result. This is safe because the camera is always outside the slab: the box
     * tops out at FOG_HEIGHT + FOG_SLAB_HEIGHT (0.57) and the shallowest legal
     * camera (MAX_POLAR_ANGLE 1.25 rad at CameraRig's resting distance) sits at
     * y = 3.57. If the slab is ever made tall enough to swallow the camera, the
     * near faces would be culled and the fog would vanish — that is the failure
     * mode to look for, and DoubleSide is the fix if it ever happens.
     */
    side: THREE.FrontSide,
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

  /*
   * A BOX, not a plane (Крок 12, Section C2). Its only job is to rasterise the
   * pixels the fog volume could possibly cover — the shader reconstructs the view
   * ray and intersects the slab analytically, so the geometry is a bounding
   * proxy, not the fog's shape.
   *
   * Positioned so its underside sits at FOG_HEIGHT and its top at
   * FOG_HEIGHT + FOG_SLAB_HEIGHT, which is exactly what BOX_MIN/BOX_MAX are
   * templated to in the fragment shader. Those are world-space literals there, so
   * this position and those constants must move together.
   *
   * renderOrder 3 is unchanged, and still what keeps Board's move highlights
   * (renderOrder 4) compositing on top of fog — see Крок 11 Section B: both are
   * depthWrite:false transparents, so order decides, not world Y.
   */
  const slabWidth = 8 + FOG_SLAB_OVERHANG * 2;
  return (
    <mesh position={[0, FOG_HEIGHT + FOG_SLAB_HEIGHT / 2, 0]} renderOrder={3}>
      <boxGeometry args={[slabWidth, FOG_SLAB_HEIGHT, slabWidth]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
