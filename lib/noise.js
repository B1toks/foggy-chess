// Pure noise. No three.js imports allowed in this file.
//
// One fbm definition, used in two places on purpose:
//   - the board's fog-of-war shader (GLSL port below, FBM_GLSL)
//   - the mountain ridge silhouettes and their haze (JS, on a 2D canvas)
// The fog of war and the mountain haze are meant to read as the same
// substance, so they must not drift apart into two different noises.

export function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  // Smoothstep the interpolant so cell boundaries don't show as creases.
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);

  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

export function fbm(x, y, octaves = 5) {
  let value = 0;
  let amplitude = 0.5;
  let px = x;
  let py = y;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * valueNoise(px, py);
    // Must match FBM_GLSL's lacunarity, see the note there.
    px *= 2.03;
    py *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

// GLSL twin of the functions above. Kept as a string so the shader and the JS
// stay literally the same algorithm.
export const FBM_GLSL = /* glsl */ `
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amplitude * valueNoise(p);
      // 2.03 rather than exactly 2.0: an integer lacunarity lines every octave
      // up on the same lattice and leaves a visible grid in the result.
      p *= 2.03;
      amplitude *= 0.5;
    }
    return value;
  }
`;
