/*
 * Why won't meshopt simplify past ~20% no matter what `error` is set to?
 * Answer candidates, in order of likelihood:
 *   1. weld() isn't merging split vertices, so there are no edges to collapse.
 *   2. The mesh is shattered into thousands of disconnected shells, each of
 *      which meshopt must keep at least a few triangles of.
 *   3. Non-manifold edges lock the collapse.
 * This measures all three.
 *
 *   node tools/diagnose-mesh.mjs knight.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';

const file = `public/models/${process.argv[2] ?? 'knight.glb'}`;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});

const doc = await io.read(file);
let prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
console.log(
  `${file}\n  raw:    verts ${prim.getAttribute('POSITION').getCount()}  tris ${prim.getIndices().getCount() / 3}`,
);

await doc.transform(weld());
prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const V = prim.getAttribute('POSITION').getCount();
const idx = prim.getIndices();
const T = idx.getCount() / 3;
console.log(`  welded: verts ${V}  tris ${T}   (closed manifold would be V ~= T/2 = ${Math.round(T / 2)})`);

// Connected components over the welded index buffer, via union-find on
// triangle-shared vertices.
const parent = new Int32Array(V);
for (let i = 0; i < V; i++) parent[i] = i;
const find = (a) => {
  while (parent[a] !== a) {
    parent[a] = parent[parent[a]];
    a = parent[a];
  }
  return a;
};
const union = (a, b) => {
  const ra = find(a);
  const rb = find(b);
  if (ra !== rb) parent[ra] = rb;
};

const edgeCount = new Map();
for (let t = 0; t < T; t++) {
  const a = idx.getScalar(t * 3);
  const b = idx.getScalar(t * 3 + 1);
  const c = idx.getScalar(t * 3 + 2);
  union(a, b);
  union(b, c);
  for (const [u, v] of [
    [a, b],
    [b, c],
    [c, a],
  ]) {
    const key = u < v ? `${u},${v}` : `${v},${u}`;
    edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
  }
}

const compSize = new Map();
for (let i = 0; i < V; i++) {
  const r = find(i);
  compSize.set(r, (compSize.get(r) ?? 0) + 1);
}
const sizes = [...compSize.values()].sort((a, b) => b - a);
console.log(`  connected components: ${sizes.length}`);
console.log(`  largest 8 component sizes (verts): ${sizes.slice(0, 8).join(', ')}`);
console.log(`  components with < 10 verts: ${sizes.filter((s) => s < 10).length}`);

let boundary = 0;
let nonManifold = 0;
for (const n of edgeCount.values()) {
  if (n === 1) boundary++;
  else if (n > 2) nonManifold++;
}
console.log(`  edges: ${edgeCount.size}  boundary (1 tri): ${boundary}  non-manifold (>2 tris): ${nonManifold}`);
