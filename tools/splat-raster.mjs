/*
 * A CPU EWA Gaussian-splat rasterizer, in Node, so splat quality can be
 * measured as a number instead of judged from a screenshot.
 *
 * This exists because of CLAUDE.md's "Headless browser" section and Крок 20's
 * own hard-won lesson: this environment's software rasteriser renders splat
 * noise chaotically enough that a correctly-oriented capture and a broken one
 * were NOT visually distinguishable in a screenshot, and a single splat frame
 * costs 100+ seconds. So a screenshot cannot answer "did this pruning policy
 * preserve the image". A deterministic CPU render can: rasterize the full
 * cloud once as ground truth, rasterize a pruned cloud, and diff them.
 *
 * The math is standard 3DGS/EWA (Zwicker et al., as used by the reference
 * 3DGS rasterizer):
 *   Sigma_world = (R_place R_splat) diag(s^2) (R_place R_splat)^T
 *   Sigma_view  = W Sigma_world W^T
 *   J           = [[f/z, 0, -f x/z^2], [0, f/z, -f y/z^2]]
 *   Sigma_2D    = J Sigma_view J^T  + dilation
 *   alpha(px)   = opacity * exp(-0.5 * d^T Sigma_2D^-1 d)
 * composited front-to-back with transmittance.
 *
 * It also models the three SparkRenderer cost levers this project sets
 * (minAlpha, minPixelRadius, maxStdDev — see SplatBackdrop.jsx), so the
 * measured image matches what the app actually draws, and so those levers can
 * themselves be swept against a quality number rather than assumed safe.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { readSpz, decodeCenters, decodeAlpha, decodeScales, decodeRgb, decodeQuats } from './spz-io.mjs';
import { eulerXyzMatrix, CAMERA } from './splat-importance.mjs';

/** Matches SplatBackdrop.jsx's SPARK_* constants. */
export const SPARK_DEFAULTS = {
  minAlpha: 0.02,
  minPixelRadius: 1.0,
  maxStdDev: Math.sqrt(5),
};

function mul3(A, B) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      out[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
  return out;
}

function quatToMatrix(x, y, z, w) {
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    [1 - (yy + zz), xy - wz, xz + wy],
    [xy + wz, 1 - (xx + zz), yz - wx],
    [xz - wy, yz + wx, 1 - (xx + yy)],
  ];
}

export function makeView(position, target = [0, 0, 0]) {
  let fx = target[0] - position[0];
  let fy = target[1] - position[1];
  let fz = target[2] - position[2];
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz, ry = 0, rz = fx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  // Rows of W map world -> view (x right, y up, z forward).
  return { position, W: [[rx, ry, rz], [ux, uy, uz], [fx, fy, fz]] };
}

/**
 * Renders one view. Returns { rgb: Float32Array(w*h*3), alpha, drawn }.
 * `background` is composited under whatever the splats don't cover.
 */
export function render(splats, view, opts = {}) {
  const {
    width = 320,
    height = 200,
    fovDeg = CAMERA.fovDeg,
    background = [0.93, 0.92, 0.89],
    spark = SPARK_DEFAULTS,
  } = opts;

  const { world, quatMat, scale, alpha, rgb, count } = splats;
  const focal = height / 2 / Math.tan((fovDeg * Math.PI) / 360);
  const cx = width / 2;
  const cy = height / 2;
  const [px0, py0, pz0] = view.position;
  const W = view.W;

  // Collect visible splats with their screen-space conic, then sort by depth.
  const idx = [];
  const depth = new Float64Array(count);
  const sx = new Float64Array(count);
  const sy = new Float64Array(count);
  const ca = new Float64Array(count);
  const cb = new Float64Array(count);
  const cc = new Float64Array(count);
  const rad = new Float64Array(count);

  for (let i = 0; i < count; i++) {
    const a = alpha[i];
    if (a < spark.minAlpha) continue; // SparkRenderer.minAlpha

    const i3 = i * 3;
    const dx = world[i3] - px0;
    const dy = world[i3 + 1] - py0;
    const dz = world[i3 + 2] - pz0;
    const vz = W[2][0] * dx + W[2][1] * dy + W[2][2] * dz;
    if (vz <= 0.2) continue;
    const vx = W[0][0] * dx + W[0][1] * dy + W[0][2] * dz;
    const vy = W[1][0] * dx + W[1][1] * dy + W[1][2] * dz;

    const u = cx + (focal * vx) / vz;
    const v = cy - (focal * vy) / vz;

    // Sigma_world = M diag(s^2) M^T, with M = R_place * R_splat (rows in quatMat)
    const m = quatMat[i];
    const s0 = scale[i3], s1 = scale[i3 + 1], s2 = scale[i3 + 2];
    const a0 = s0 * s0, a1 = s1 * s1, a2 = s2 * s2;
    const c00 = m[0][0] * m[0][0] * a0 + m[0][1] * m[0][1] * a1 + m[0][2] * m[0][2] * a2;
    const c01 = m[0][0] * m[1][0] * a0 + m[0][1] * m[1][1] * a1 + m[0][2] * m[1][2] * a2;
    const c02 = m[0][0] * m[2][0] * a0 + m[0][1] * m[2][1] * a1 + m[0][2] * m[2][2] * a2;
    const c11 = m[1][0] * m[1][0] * a0 + m[1][1] * m[1][1] * a1 + m[1][2] * m[1][2] * a2;
    const c12 = m[1][0] * m[2][0] * a0 + m[1][1] * m[2][1] * a1 + m[1][2] * m[2][2] * a2;
    const c22 = m[2][0] * m[2][0] * a0 + m[2][1] * m[2][1] * a1 + m[2][2] * m[2][2] * a2;

    // Sigma_view = W Sigma W^T (only the 2x2 xy block plus the xz/yz needed by J)
    const t00 = W[0][0] * c00 + W[0][1] * c01 + W[0][2] * c02;
    const t01 = W[0][0] * c01 + W[0][1] * c11 + W[0][2] * c12;
    const t02 = W[0][0] * c02 + W[0][1] * c12 + W[0][2] * c22;
    const t10 = W[1][0] * c00 + W[1][1] * c01 + W[1][2] * c02;
    const t11 = W[1][0] * c01 + W[1][1] * c11 + W[1][2] * c12;
    const t12 = W[1][0] * c02 + W[1][1] * c12 + W[1][2] * c22;
    const t20 = W[2][0] * c00 + W[2][1] * c01 + W[2][2] * c02;
    const t21 = W[2][0] * c01 + W[2][1] * c11 + W[2][2] * c12;
    const t22 = W[2][0] * c02 + W[2][1] * c12 + W[2][2] * c22;
    const v00 = t00 * W[0][0] + t01 * W[0][1] + t02 * W[0][2];
    const v01 = t00 * W[1][0] + t01 * W[1][1] + t02 * W[1][2];
    const v02 = t00 * W[2][0] + t01 * W[2][1] + t02 * W[2][2];
    const v11 = t10 * W[1][0] + t11 * W[1][1] + t12 * W[1][2];
    const v12 = t10 * W[2][0] + t11 * W[2][1] + t12 * W[2][2];
    const v22 = t20 * W[2][0] + t21 * W[2][1] + t22 * W[2][2];

    // J = [[f/z, 0, -f vx/z^2], [0, f/z, -f vy/z^2]]
    const j00 = focal / vz;
    const j02 = (-focal * vx) / (vz * vz);
    const j11 = focal / vz;
    const j12 = (-focal * vy) / (vz * vz);
    // Sigma2D = J V J^T
    const k00 = j00 * v00 + j02 * v02;
    const k01 = j00 * v01 + j02 * v12;
    const k02 = j00 * v02 + j02 * v22;
    const k10 = j11 * v01 + j12 * v02;
    const k11 = j11 * v11 + j12 * v12;
    const k12 = j11 * v12 + j12 * v22;
    let s2d00 = k00 * j00 + k02 * j02 + 0.3;
    let s2d01 = k01 * j11 + k02 * j12;
    let s2d11 = k11 * j11 + k12 * j12 + 0.3;

    const det = s2d00 * s2d11 - s2d01 * s2d01;
    if (det <= 1e-12) continue;

    // Bounding radius from the larger eigenvalue.
    const mid = 0.5 * (s2d00 + s2d11);
    const disc = Math.sqrt(Math.max(0.01, mid * mid - det));
    const lambdaMax = mid + disc;
    const radius = spark.maxStdDev * Math.sqrt(lambdaMax);
    if (radius < spark.minPixelRadius) continue; // SparkRenderer.minPixelRadius

    if (u + radius < 0 || u - radius >= width || v + radius < 0 || v - radius >= height) continue;

    const invDet = 1 / det;
    idx.push(i);
    depth[i] = vz;
    sx[i] = u;
    sy[i] = v;
    ca[i] = s2d11 * invDet;
    cb[i] = -s2d01 * invDet;
    cc[i] = s2d00 * invDet;
    rad[i] = radius;
  }

  idx.sort((p, q) => depth[p] - depth[q]);

  const acc = new Float32Array(width * height * 3);
  const trans = new Float32Array(width * height).fill(1);
  const cutoff = 0.5 * spark.maxStdDev * spark.maxStdDev;
  // Fragment evaluations: the GPU-side cost that actually scales with
  // maxStdDev (footprint area) rather than with splat count. Counting it is
  // what lets the SparkRenderer levers be traded against quality instead of
  // assumed safe.
  let fragments = 0;

  for (const i of idx) {
    const u = sx[i];
    const v = sy[i];
    const r = rad[i];
    const x0 = Math.max(0, Math.floor(u - r));
    const x1 = Math.min(width - 1, Math.ceil(u + r));
    const y0 = Math.max(0, Math.floor(v - r));
    const y1 = Math.min(height - 1, Math.ceil(v + r));
    const A = ca[i], B = cb[i], C = cc[i];
    const op = alpha[i];
    const i3 = i * 3;
    const cr = rgb[i3], cg = rgb[i3 + 1], cbl = rgb[i3 + 2];

    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - v;
      const rowBase = y * width;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - u;
        fragments++;
        const power = 0.5 * (A * dx * dx + 2 * B * dx * dy + C * dy * dy);
        if (power > cutoff) continue;
        const p = rowBase + x;
        const T = trans[p];
        if (T < 0.003) continue;
        let al = op * Math.exp(-power);
        if (al > 0.999) al = 0.999;
        const w = T * al;
        const p3 = p * 3;
        acc[p3] += w * cr;
        acc[p3 + 1] += w * cg;
        acc[p3 + 2] += w * cbl;
        trans[p] = T * (1 - al);
      }
    }
  }

  for (let p = 0; p < width * height; p++) {
    const T = trans[p];
    const p3 = p * 3;
    acc[p3] += T * background[0];
    acc[p3 + 1] += T * background[1];
    acc[p3 + 2] += T * background[2];
  }
  return { rgb: acc, transmittance: trans, drawn: idx.length, fragments, width, height };
}

/** Loads a .spz and pre-transforms it into world space under a placement. */
export function loadSplats(path, placement) {
  const spz = readSpz(path);
  const n = spz.numSplats;
  const centers = decodeCenters(spz);
  const localScales = decodeScales(spz);
  const quats = decodeQuats(spz);
  const alpha = decodeAlpha(spz);
  const rgb = decodeRgb(spz);

  const Rp = eulerXyzMatrix(placement.rotation ?? [0, 0, 0]);
  const s = placement.scale ?? 1;
  const [ox, oy, oz] = placement.position ?? [0, 0, 0];

  const world = new Float32Array(n * 3);
  const scale = new Float32Array(n * 3);
  const quatMat = new Array(n);
  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    const lx = centers[i3], ly = centers[i3 + 1], lz = centers[i3 + 2];
    world[i3] = s * (Rp[0][0] * lx + Rp[0][1] * ly + Rp[0][2] * lz) + ox;
    world[i3 + 1] = s * (Rp[1][0] * lx + Rp[1][1] * ly + Rp[1][2] * lz) + oy;
    world[i3 + 2] = s * (Rp[2][0] * lx + Rp[2][1] * ly + Rp[2][2] * lz) + oz;
    scale[i3] = s * localScales[i3];
    scale[i3 + 1] = s * localScales[i3 + 1];
    scale[i3 + 2] = s * localScales[i3 + 2];
    const i4 = i * 4;
    quatMat[i] = mul3(Rp, quatToMatrix(quats[i4], quats[i4 + 1], quats[i4 + 2], quats[i4 + 3]));
  }
  return { world, scale, quatMat, alpha, rgb, count: n, spz };
}

export function psnr(a, b) {
  let mse = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    mse += d * d;
  }
  mse /= a.length;
  if (mse <= 1e-12) return Infinity;
  return 10 * Math.log10(1 / mse);
}

/** Mean absolute difference in 0..255 luma terms — easier to reason about than PSNR. */
export function lumaMAE(a, b, width, height) {
  let sum = 0;
  for (let p = 0; p < width * height; p++) {
    const p3 = p * 3;
    const la = 0.2126 * a[p3] + 0.7152 * a[p3 + 1] + 0.0722 * a[p3 + 2];
    const lb = 0.2126 * b[p3] + 0.7152 * b[p3 + 1] + 0.0722 * b[p3 + 2];
    sum += Math.abs(la - lb);
  }
  return (sum / (width * height)) * 255;
}

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

export function writePng(path, rgbFloat, width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const p3 = (y * width + x) * 3;
      for (let ch = 0; ch < 3; ch++) {
        const v = Math.max(0, Math.min(1, rgbFloat[p3 + ch]));
        raw[o++] = Math.round(Math.sqrt(v) * 255); // rough sRGB-ish for viewing
      }
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}
