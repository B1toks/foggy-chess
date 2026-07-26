/*
 * Throwaway sweep: how far does meshopt actually get on these meshes, and
 * which simplifier flags unlock it?
 *
 *   node tools/sweep-simplify.mjs knight.glb
 *
 * Context (see tools/diagnose-mesh.mjs): these Mint exports are NOT clean
 * manifolds. The knight welds to 418,533 verts for 500,000 tris (a closed
 * manifold would be ~250,000), splits into 38,146 disconnected components of
 * which 37,251 have under 10 vertices, and carries 269,120 boundary edges.
 * Edge-collapse simplification has almost nothing it is allowed to collapse,
 * which is why `error` makes no difference at all past 0.001 — the limit is
 * topological, not error-driven.
 *
 * meshopt has flags for exactly this, which @gltf-transform/functions'
 * simplify() does not expose (it only surfaces `lockBorder`):
 *   Prune       - allow removing small disconnected components outright
 *   Permissive  - allow collapses that change topology
 *   Sparse      - optimise for meshes using a small subset of the vertex buffer
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

const file = `public/models/${process.argv[2] ?? 'knight.glb'}`;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});
await MeshoptSimplifier.ready;

/** Wraps MeshoptSimplifier so gltf-transform's simplify() passes extra flags. */
function withFlags(extra) {
  return {
    ...MeshoptSimplifier,
    ready: MeshoptSimplifier.ready,
    supported: MeshoptSimplifier.supported,
    getScale: (...a) => MeshoptSimplifier.getScale(...a),
    compactMesh: (...a) => MeshoptSimplifier.compactMesh(...a),
    simplify: (indices, pos, stride, target, error, flags = []) =>
      MeshoptSimplifier.simplify(indices, pos, stride, target, error, [...flags, ...extra]),
  };
}

const count = (doc) => {
  let t = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives())
      t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  return t;
};

const cases = [
  ['baseline', []],
  ['Prune', ['Prune']],
  ['Permissive', ['Permissive']],
  ['Prune+Permissive', ['Prune', 'Permissive']],
];

console.log(`${file}   (target ratio 0.006 = ~3000 tris, error 0.05)`);
console.log('  flags'.padEnd(22) + 'tris out');
for (const [label, flags] of cases) {
  const doc = await io.read(file);
  await doc.transform(
    weld(),
    simplify({ simplifier: withFlags(flags), ratio: 0.006, error: 0.05 }),
  );
  console.log(`  ${label.padEnd(20)}${String(count(doc)).padStart(8)}`);
}
