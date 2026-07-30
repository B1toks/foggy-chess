/*
 * Shared SPZ v3 read/write for the splat tooling (analyze-spz, shrink-spz,
 * splat-raster). One decoder so the pruner and the quality measurement can
 * never disagree about what a byte means.
 *
 * Every quantization rule below was read directly out of
 * node_modules/@sparkjsdev/spark/dist/spark.module.js (SpzReader.parseSplats /
 * SpzWriter.set*), not from SPZ documentation — Spark's decoder is what
 * actually renders these files, so it is the authority.
 *
 * Layout (v3, structure-of-arrays, never interleaved):
 *   16-byte header, then centers[n*9], alpha[n*1], rgb[n*3], scale[n*3],
 *   quat[n*4], sh[n*SH_VECS*3].
 *
 * Quantization:
 *   center : 24-bit signed fixed point, /(1 << fractionalBits)
 *   alpha  : byte / 255            -> opacity directly (sigmoid already applied)
 *   rgb    : (byte/255 - 0.5) * (SH_C0/0.15) + 0.5
 *   scale  : exp(byte/16 - 10)     -> world-space std dev, per axis
 *   quat   : smallest-three, 9 bits + sign each, largest index in the top 2 bits
 *
 * The scale rule is worth calling out: because it is log-quantized with a fixed
 * step of 1/16 in ln-space, multiplying a splat's scale by a factor f is exactly
 * adding round(ln(f) * 16) to its byte. No decode/re-encode round trip is needed
 * to grow a splat, and the quantization step is a constant 6.45% either way.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

export const SPZ_MAGIC = 1347635022;
export const SH_C0 = 0.28209479177387814;
const SH_DEGREE_TO_VECS = { 0: 0, 1: 3, 2: 8, 3: 15 };

/** ln-space step of the scale byte encoding: scale = exp(byte/16 - 10). */
export const SCALE_LN_STEP = 1 / 16;

export function readSpz(path) {
  const gz = fs.readFileSync(path);
  const raw = zlib.gunzipSync(gz);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

  const magic = view.getUint32(0, true);
  if (magic !== SPZ_MAGIC) throw new Error(`Invalid SPZ magic: ${magic}`);
  const version = view.getUint32(4, true);
  if (version !== 3) throw new Error(`This tooling only handles SPZ v3, got v${version}`);

  const numSplats = view.getUint32(8, true);
  const shDegree = view.getUint8(12);
  const fractionalBits = view.getUint8(13);
  const flags = view.getUint8(14);
  const reserved = view.getUint8(15);

  const shVecs = SH_DEGREE_TO_VECS[shDegree] ?? 0;
  const fields = [
    ['center', 9],
    ['alpha', 1],
    ['rgb', 3],
    ['scale', 3],
    ['quat', 4],
    ...(shVecs > 0 ? [['sh', shVecs * 3]] : []),
  ];

  let offset = 16;
  const arrays = {};
  const strides = {};
  for (const [name, stride] of fields) {
    arrays[name] = raw.subarray(offset, offset + numSplats * stride);
    strides[name] = stride;
    offset += numSplats * stride;
  }
  if (offset !== raw.length) {
    throw new Error(
      `Layout mismatch: parsed ${offset} bytes, file has ${raw.length} (shDegree=${shDegree})`,
    );
  }

  return {
    numSplats,
    version,
    shDegree,
    fractionalBits,
    flags,
    reserved,
    fields,
    arrays,
    strides,
    gzBytes: gz.length,
    rawBytes: raw.length,
  };
}

/** Decoded centers as a Float32Array of length numSplats*3. */
export function decodeCenters(spz) {
  const { numSplats, fractionalBits, arrays } = spz;
  const b = arrays.center;
  const fixed = 1 << fractionalBits;
  const out = new Float32Array(numSplats * 3);
  for (let i = 0; i < numSplats; i++) {
    const i9 = i * 9;
    const i3 = i * 3;
    out[i3] = (((b[i9 + 2] << 24) | (b[i9 + 1] << 16) | (b[i9] << 8)) >> 8) / fixed;
    out[i3 + 1] = (((b[i9 + 5] << 24) | (b[i9 + 4] << 16) | (b[i9 + 3] << 8)) >> 8) / fixed;
    out[i3 + 2] = (((b[i9 + 8] << 24) | (b[i9 + 7] << 16) | (b[i9 + 6] << 8)) >> 8) / fixed;
  }
  return out;
}

/** Opacity in 0..1, one per splat. */
export function decodeAlpha(spz) {
  const out = new Float32Array(spz.numSplats);
  for (let i = 0; i < spz.numSplats; i++) out[i] = spz.arrays.alpha[i] / 255;
  return out;
}

/** Per-axis world-space std dev, Float32Array of length numSplats*3. */
export function decodeScales(spz) {
  const b = spz.arrays.scale;
  const out = new Float32Array(spz.numSplats * 3);
  for (let i = 0; i < spz.numSplats * 3; i++) out[i] = Math.exp(b[i] / 16 - 10);
  return out;
}

/** Linear-ish RGB in 0..1 (Spark's own SH_C0/0.15 dequantization). */
export function decodeRgb(spz) {
  const b = spz.arrays.rgb;
  const s = SH_C0 / 0.15;
  const out = new Float32Array(spz.numSplats * 3);
  for (let i = 0; i < spz.numSplats * 3; i++) out[i] = (b[i] / 255 - 0.5) * s + 0.5;
  return out;
}

/** Normalized quaternions [x,y,z,w], Float32Array of length numSplats*4. */
export function decodeQuats(spz) {
  const b = spz.arrays.quat;
  const out = new Float32Array(spz.numSplats * 4);
  const maxValue = 1 / Math.SQRT2;
  const valueMask = (1 << 9) - 1;
  for (let i = 0; i < spz.numSplats; i++) {
    const i4 = i * 4;
    const combined = b[i4] + (b[i4 + 1] << 8) + (b[i4 + 2] << 16) + (b[i4 + 3] << 24);
    const largest = combined >>> 30;
    let remaining = combined;
    let sumSquares = 0;
    const q = [0, 0, 0, 0];
    for (let k = 3; k >= 0; --k) {
      if (k === largest) continue;
      const value = remaining & valueMask;
      const sign = (remaining >>> 9) & 1;
      remaining = remaining >>> 10;
      q[k] = maxValue * (value / valueMask) * (sign === 0 ? 1 : -1);
      sumSquares += q[k] * q[k];
    }
    q[largest] = Math.sqrt(Math.max(1 - sumSquares, 0));
    out[i4] = q[0];
    out[i4 + 1] = q[1];
    out[i4 + 2] = q[2];
    out[i4 + 3] = q[3];
  }
  return out;
}

/**
 * Write a new .spz keeping only `indices`, in order.
 *
 * `scaleGain` (optional, one factor per kept splat) and `alphaGain` (same) are
 * applied in the quantized domain: a scale gain is +round(ln(f)*16) on each of
 * the three scale bytes, an alpha gain is a straight byte multiply. Every other
 * field — center, rgb, quat, sh — is copied byte-for-byte, so kept splats carry
 * exactly the precision they had in the source file.
 */
export function writeSpz(path, spz, indices, { scaleGain = null, alphaGain = null } = {}) {
  const keepCount = indices.length;
  const header = Buffer.alloc(16);
  header.writeUInt32LE(SPZ_MAGIC, 0);
  header.writeUInt32LE(spz.version, 4);
  header.writeUInt32LE(keepCount, 8);
  header.writeUInt8(spz.shDegree, 12);
  header.writeUInt8(spz.fractionalBits, 13);
  header.writeUInt8(spz.flags, 14);
  header.writeUInt8(spz.reserved, 15);

  const parts = [header];
  for (const [name, stride] of spz.fields) {
    const src = spz.arrays[name];
    const out = new Uint8Array(keepCount * stride);
    for (let i = 0; i < keepCount; i++) {
      const s = indices[i] * stride;
      out.set(src.subarray(s, s + stride), i * stride);
    }
    if (name === 'scale' && scaleGain) {
      for (let i = 0; i < keepCount; i++) {
        const delta = Math.round(Math.log(scaleGain[i]) / SCALE_LN_STEP);
        if (delta === 0) continue;
        const base = i * 3;
        for (let a = 0; a < 3; a++) {
          out[base + a] = Math.max(0, Math.min(255, out[base + a] + delta));
        }
      }
    }
    if (name === 'alpha' && alphaGain) {
      for (let i = 0; i < keepCount; i++) {
        out[i] = Math.max(0, Math.min(255, Math.round(out[i] * alphaGain[i])));
      }
    }
    parts.push(Buffer.from(out.buffer, out.byteOffset, out.byteLength));
  }

  const body = Buffer.concat(parts);
  const compressed = zlib.gzipSync(body, { level: 9 });
  fs.writeFileSync(path, compressed);
  return { keepCount, outBytes: compressed.length, rawBytes: body.length };
}
