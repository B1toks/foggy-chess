/*
 * Крок 12, Section A: the asset budget fix.
 *
 *   node tools/decimate-models.mjs            # report only, writes nothing
 *   node tools/decimate-models.mjs --write    # rewrite public/models/*.glb
 *
 * WHY THIS EXISTS
 *
 * Every model Mint delivered is exactly 500,000 triangles — a hard cap on
 * Mint's side, not a number anyone chose for this scene. Measured off the glb
 * JSON chunks directly (accessor `count`s, which stay correct under Draco):
 *
 *   bishop 499,998   king 499,998   knight 500,000   pawn 499,998
 *   queen  500,000   rook 500,000   granite-pine-aerie 500,000
 *
 * The opening position has 32 pieces on the board, so the scene submits
 * 32 x 500k = 16,000,000 triangles for the pieces, plus 500k for the rock.
 * That geometry is then drawn three times per frame:
 *
 *   1. the directional key light's shadow map  (every castShadow mesh)
 *   2. drei's <ContactShadows> depth pass      (re-renders continuously)
 *   3. the main colour pass
 *
 * ~= 49,500,000 triangles per frame. At 60 fps that is ~3.0 billion
 * triangles/second of pure vertex+primitive work for a chess set where no
 * piece is more than a couple of hundred pixels tall. That is the reason a
 * 4060 sits pinned at 90%: it is not shader-bound, it is geometry-bound, and
 * no amount of fog-shader tuning touches it.
 *
 * A chess piece at this on-screen size is fully described by a few thousand
 * triangles. Decimating to ~0.8% takes the frame from ~49.5M triangles to
 * ~400k — a ~120x reduction in the dominant cost.
 *
 * WHAT ELSE IS STRIPPED, AND WHY IT IS SAFE
 *
 * - TANGENT: only ever read by a normal map. PieceModel.jsx replaces every
 *   piece material with the shared BONE/LACQUER MeshStandardMaterial, which
 *   has no normal map, so a tangent per vertex is 16 bytes of pure waste
 *   across ~330k vertices per model.
 * - TEXCOORD_0 + all embedded textures, FOR PIECES ONLY: same reason —
 *   applyMaterial() discards Mint's materials outright, so the three baked
 *   textures per piece file (a ~1.2 MB normal map among them) are downloaded,
 *   decoded, and uploaded to the GPU only to be thrown away.
 *   The ROCK is deliberately excluded from this: Крок 12 Section D starts
 *   USING its baked diffuse + normal maps (see RockIsland.jsx), so it keeps
 *   TEXCOORD_0, its textures, and a gentler decimation ratio.
 *
 * The pieces keep NORMAL (flatShading is set on the shared materials, but
 * three still needs the attribute present for the non-flat path and for
 * consistent shadow normalBias behaviour) and keep Draco compression on the
 * way out, so the wire format is unchanged in kind, only in size.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { simplify, weld, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

/*
 * Крок 13: ocean and snow ship their own piece + rock sets, laid out the same
 * way as mist (public/models/<theme>/{king,queen,rook,bishop,knight,pawn,
 * rock-island}.glb — see lib/themes.js). This tool now iterates all three
 * theme directories instead of one, mirroring the same structure into the
 * backup dir (assets-src/models-original/<theme>/...) so the per-theme
 * "rock-island.glb"/"king.glb" basenames — identical across themes — don't
 * collide in a single flat backup folder.
 */
const THEME_DIRS = ['mist', 'ocean', 'snow'].map((theme) => ({
  theme,
  modelDir: `public/models/${theme}`,
  backupDir: `assets-src/models-original/${theme}`,
}));

/*
 * THE FLAG THAT ACTUALLY MAKES THIS WORK
 *
 * Do not remove 'Permissive' without re-reading this. These exports are not
 * clean manifolds — measured with tools/diagnose-mesh.mjs, the knight welds to
 * 418,533 verts for 500,000 triangles (a closed manifold would be ~250,000),
 * shatters into 38,146 disconnected components of which 37,251 have fewer than
 * 10 vertices, and carries 269,120 boundary edges. A normal edge-collapse pass
 * has almost nothing it is permitted to collapse, so it stalls at ~21% of the
 * original count and `error` makes no difference whatsoever past 0.001:
 *
 *   knight, target ratio 0.006:  error 0.001 -> 111,268 tris
 *                                error 0.01  -> 107,794
 *                                error 0.3   -> 107,784   (a hard topological floor)
 *
 * meshopt's own flags fix it, but @gltf-transform/functions' simplify() only
 * surfaces `lockBorder` and never passes the rest through, so this wraps the
 * simplifier to inject them. Measured on the knight at ratio 0.006:
 *
 *   baseline           107,784      Permissive         3,000  (target reached)
 *   Prune              107,784      Prune+Permissive   3,000
 *
 * 'Permissive' allows topology-changing collapses (the disconnected shells can
 * finally merge); 'Prune' additionally discards small disconnected components
 * outright and is kept because it is the right thing to do with 37k pieces of
 * sub-10-vertex junk, even though Permissive alone already reaches the target.
 */
const SIMPLIFIER_FLAGS = ['Permissive', 'Prune'];

/*
 * Ratio is a target fraction of the original triangle count. With the flags
 * above the target is actually reached, so these numbers ARE the output:
 *
 * - Pieces at 0.016 land ~8,000 triangles each. A piece is 0.55-1.45 units
 *   tall in a frame ~8 units across, so at most ~15% of frame height; 8k
 *   triangles is well past the point where silhouette error is visible at
 *   that size, and it leaves headroom for the knight's mane and the kabuto
 *   facets, which are the finest detail in the set.
 * - The rock is ONE instance rather than 32, so it can afford far more, and it
 *   needs more for two independent reasons: it is the largest object on screen
 *   by area, and it is the only model whose silhouette is seen against open
 *   sky at every orbit angle, where faceting reads immediately.
 *
 * `error` is left generous (0.05) on purpose — with Permissive in play the
 * ratio is the binding constraint, and a tight error would just reintroduce
 * the stall above.
 */
const PROFILES = {
  // Крок 13: renamed from the mist-specific 'granite-pine-aerie-optimized.glb'
  // to the shared per-theme basename now that ocean/snow ship their own rock
  // under the same name (public/models/<theme>/rock-island.glb).
  'rock-island.glb': {
    ratio: 0.06,
    error: 0.05,
    keepTextures: true,
    keepUVs: true,
  },
  default: { ratio: 0.016, error: 0.05, keepTextures: false, keepUVs: false },
};

/**
 * gltf-transform's simplify() takes a `simplifier` object and calls
 * `.simplify(indices, positions, stride, target, error, flags)` on it, where
 * `flags` carries only its own lockBorder decision. This forwards everything
 * else untouched and appends SIMPLIFIER_FLAGS to that argument.
 */
function permissiveSimplifier() {
  return {
    ...MeshoptSimplifier,
    ready: MeshoptSimplifier.ready,
    supported: MeshoptSimplifier.supported,
    getScale: (...args) => MeshoptSimplifier.getScale(...args),
    compactMesh: (...args) => MeshoptSimplifier.compactMesh(...args),
    simplify: (indices, positions, stride, target, error, flags = []) =>
      MeshoptSimplifier.simplify(indices, positions, stride, target, error, [
        ...flags,
        ...SIMPLIFIER_FLAGS,
      ]),
  };
}

const WRITE = process.argv.includes('--write');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});

await MeshoptSimplifier.ready;

function countTris(doc) {
  let tris = 0;
  let verts = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      verts += pos.getCount();
      tris += idx ? idx.getCount() / 3 : pos.getCount() / 3;
    }
  }
  return { tris, verts };
}

/*
 * Refuse to run twice PER THEME: a theme whose files already have a backup
 * has already been decimated (a second pass would decimate the already-
 * decimated file by another 1.6%), but a theme that has never been touched
 * (e.g. ocean/snow the first time this runs after Крок 13) must still
 * proceed — so the guard is evaluated independently per theme directory,
 * not once globally, and themes that are already done are simply skipped
 * rather than aborting the whole run.
 */
const jobs = [];
for (const { theme, modelDir, backupDir } of THEME_DIRS) {
  if (!fs.existsSync(modelDir)) continue;
  const files = fs.readdirSync(modelDir).filter((f) => f.endsWith('.glb'));
  const already = files.filter((f) => fs.existsSync(path.join(backupDir, f)));
  if (already.length) {
    console.log(`[${theme}] already decimated (backup present) — skipping ${already.length} file(s)`);
    continue;
  }
  for (const file of files) jobs.push({ theme, modelDir, backupDir, file });
}

let beforeTotal = 0;
let afterTotal = 0;
let beforeBytes = 0;
let afterBytes = 0;

console.log(WRITE ? '\nDECIMATING (writing files)\n' : '\nDRY RUN (pass --write to apply)\n');
console.log(
  'file'.padEnd(38) + 'tris in'.padStart(9) + 'tris out'.padStart(10) + 'KB in'.padStart(9) + 'KB out'.padStart(9),
);

for (const { theme, modelDir, backupDir, file } of jobs) {
  const full = path.join(modelDir, file);
  const label = `${theme}/${file}`;
  const profile = PROFILES[file] ?? PROFILES.default;
  const doc = await io.read(full);
  const before = countTris(doc);
  const sizeBefore = fs.statSync(full).size;

  /*
   * weld() before simplify() is mandatory, not optional cleanup: meshopt
   * collapses edges, and an unwelded mesh (Mint exports split vertices along
   * every UV/normal seam — 366k verts for 500k tris means heavy splitting)
   * has no edges to collapse across those seams, so simplification stalls at
   * a fraction of the requested ratio and leaves a shredded silhouette.
   */
  await doc.transform(
    weld(),
    simplify({ simplifier: permissiveSimplifier(), ratio: profile.ratio, error: profile.error }),
  );

  if (!profile.keepUVs) {
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        for (const semantic of ['TEXCOORD_0', 'TEXCOORD_1', 'TANGENT', 'COLOR_0']) {
          const attr = prim.getAttribute(semantic);
          if (attr) prim.setAttribute(semantic, null);
        }
      }
    }
  } else {
    // The rock keeps UVs but still has no use for TANGENT: three.js derives
    // tangents from screen-space derivatives when a normal map has no TANGENT
    // attribute, which is what every other normal-mapped material in this
    // project already relies on.
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        if (prim.getAttribute('TANGENT')) prim.setAttribute('TANGENT', null);
      }
    }
  }

  if (!profile.keepTextures) {
    // Detach the materials' texture slots first, so prune() sees the textures
    // and their images as genuinely unreferenced and drops the image payloads
    // out of the binary chunk.
    for (const material of doc.getRoot().listMaterials()) {
      material
        .setBaseColorTexture(null)
        .setNormalTexture(null)
        .setMetallicRoughnessTexture(null)
        .setOcclusionTexture(null)
        .setEmissiveTexture(null);
    }
  }

  await doc.transform(dedup(), prune());

  doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({
    method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
  });

  const after = countTris(doc);
  const bytes = await io.writeBinary(doc);

  if (WRITE) {
    /*
     * The untouched 500k-triangle originals are kept, but in assets-src/ —
     * which is gitignored and outside public/, exactly like the 6.6 MB
     * mountains-source.png. Keeping them next to the shipped files under
     * public/ would both commit 32 MB of dead weight to git history forever
     * and let Next serve them.
     *
     * Because this is the rollback, a backup is never overwritten: run the
     * tool twice and the second run would otherwise "back up" the already-
     * decimated file over the true original and destroy it.
     */
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, file);
    if (!fs.existsSync(backup)) fs.copyFileSync(full, backup);
    fs.writeFileSync(full, bytes);
  }

  beforeTotal += before.tris;
  afterTotal += after.tris;
  beforeBytes += sizeBefore;
  afterBytes += bytes.byteLength;

  console.log(
    label.padEnd(38) +
      String(before.tris).padStart(9) +
      String(after.tris).padStart(10) +
      String(Math.round(sizeBefore / 1024)).padStart(9) +
      String(Math.round(bytes.byteLength / 1024)).padStart(9),
  );
}

console.log(
  '\n' +
    'TOTAL'.padEnd(38) +
    String(beforeTotal).padStart(9) +
    String(afterTotal).padStart(10) +
    String(Math.round(beforeBytes / 1024)).padStart(9) +
    String(Math.round(afterBytes / 1024)).padStart(9),
);

// What the numbers above mean for the actual frame: 32 pieces on the board
// (16 pawns, 4 each of rook/knight/bishop, 2 each of queen/king) + 1 rock,
// each drawn in the shadow pass, the contact-shadow depth pass, and the
// colour pass.
function sceneTris(perModel) {
  const counts = { pawn: 16, rook: 4, knight: 4, bishop: 4, queen: 2, king: 2 };
  let t = 0;
  for (const [name, n] of Object.entries(counts)) t += (perModel[name] ?? 0) * n;
  return t + (perModel.rock ?? 0);
}
console.log(
  `\nscene geometry per frame (32 pieces + rock, x3 passes):\n` +
    `  before: ${(sceneTris({ pawn: 499998, rook: 500000, knight: 500000, bishop: 499998, queen: 500000, king: 499998, rock: 500000 }) * 3).toLocaleString()} triangles\n` +
    `  after:  see the 'tris out' column above, same arithmetic`,
);
