import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  /*
   * Pin the workspace root to this project.
   *
   * Without it, Next walks up looking for a lockfile, finds an unrelated one in
   * a parent directory (D:\Sw\IT\package-lock.json), warns "inferred your
   * workspace root, but it may not be correct", and then hands that parent to
   * Watchpack — which recursively scans the whole drive from there. In this
   * checkout that produced a stream of
   *
   *   Watchpack Error (initial scan): EINVAL: invalid argument,
   *   lstat 'D:\System Volume Information'
   *
   * followed by the dev server dying outright on
   * `RangeError: Array buffer allocation failed` — an out-of-memory from trying
   * to hold a file-watch tree for an entire disk. It looks exactly like the
   * flaky-HMR failure mode CLAUDE.md's "Dev-server gotcha" section describes and
   * it is not fixed by clearing .next, because the cause is outside the project.
   */
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  webpack: (config) => {
    /*
     * @sparkjsdev/spark inlines its splat-sorting WASM as a
     * `new URL("data:application/wasm;base64,...")`. Webpack 5 sees the
     * `new URL(...)` and tries to route it through Next's asset-module rules,
     * which are configured with `generator.filename` — invalid for the
     * `asset/inline` generator a data: URL resolves to. The build dies with:
     *
     *   Invalid generator object. Asset Modules Plugin has been initialized
     *   using a generator object that does not match the API schema.
     *    - generator has an unknown property 'filename'
     *
     * Turning the url parser off for Spark's own files only leaves the
     * expression alone as a plain runtime `new URL(...)`, which the browser
     * constructs perfectly well — data: URLs are fetchable, so Spark still
     * instantiates its WASM. Scoped to Spark so nothing else changes.
     */
    config.module.rules.push({
      test: /\.m?js$/,
      include: /node_modules[\\/]@sparkjsdev[\\/]/,
      parser: { url: false },
    });
    return config;
  },
};

export default nextConfig;
