/** @type {import('next').NextConfig} */
const nextConfig = {
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
