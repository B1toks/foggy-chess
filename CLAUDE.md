# dead-reckoning

3D chess with fog of war. Player is always white; a greedy AI plays black.
Deployed at https://foggy-chess.vercel.app.

## Stack

```json
"dependencies": {
  "next": "15.5.21",
  "react": "18.3.1",
  "react-dom": "18.3.1",
  "three": "0.169.0",
  "@react-three/fiber": "8.17.10",
  "@react-three/drei": "9.114.3",
  "chess.js": "^1.0.0"
},
"overrides": { "react": "18.3.1", "react-dom": "18.3.1" }
```

**React 18.3.1 is the load-bearing pin, not the Next version.**
`@react-three/fiber` 8.x needs a real React 18 reconciler end to end. Don't
bump react/react-dom, and don't bump `@react-three/fiber`/`@react-three/drei`
without upgrading the other together as a matched pair.

Next itself is free to move inside 15.x — every 15.x release still lists
`react: ^18.2.0` as a peer, and the Pages Router does not vendor React (see
below). The project originally pinned 15.0.3, but **Vercel refuses to deploy
it**: `Vulnerable version of Next.js detected` (CVE-2025-66478, the same one
npm warns about at install). Staying on a patched 15.x is mandatory for
deployment; the r3f combo was re-verified on 15.5.21 and renders identically.

## Router: Pages Router, not App Router — this is deliberate

The project was originally scaffolded with `--app`. It was migrated off App
Router during initial setup because **Next.js 15's App Router client bundle
(`appPagesBrowser` webpack layer) unconditionally aliases every bare `react`
import to its own vendored copy** (`next/dist/compiled/react`, a React 19 RC
build for 15.0.3), regardless of what's pinned in `package.json`. That copy's
internals are shaped differently from what `react-reconciler` 0.27.x (what
`@react-three/fiber` 8.x needs) expects, which crashes immediately with:

```
TypeError: Cannot read properties of undefined (reading 'ReactCurrentOwner')
```

Two workarounds were tried and both failed before switching to Pages Router:
- Overriding `resolve.alias` in `next.config.mjs` — the App Router layer sets
  its alias at the webpack *rule* level (scoped to `issuerLayer:
  appPagesBrowser`), which wins over anything set at the top-level
  `config.resolve.alias`, so the override was silently ignored.
- Forcing a newer `react-reconciler` (via npm `overrides`) to match React
  19's internals — this fixes `ReactCurrentOwner` but then crashes on
  `resolveUpdatePriority is not a function`, because `@react-three/fiber`
  8.x's host config doesn't implement the newer reconciler's expanded
  interface. There is no `react-reconciler` version that satisfies both
  React 19's internals *and* r3f 8.x's host config.

Pages Router has no RSC/"use client" layer system, so bare `react` imports
resolve normally through node_modules — the pinned React 18.3.1 — and
everything just works. **If a future session is tempted to move this back to
`app/`, don't, unless `@react-three/fiber` is also upgraded to a 9.x line
that targets React 19.**

Routing lives in `pages/`: `_app.js` (imports `styles/globals.css`),
`_document.js` (`<html lang>`), `index.js` (mounts the game). `'use client'`
directives are meaningless here (that's an App Router concept) — don't add
them back.

## Hard rules

- Any component touching three.js is mounted via
  `next/dynamic(() => import(...), { ssr: false })`. `@react-three/fiber`
  cannot render on the server. `pages/index.js` does this for `GameCanvas`.
- Nothing in `lib/` imports three.js, ever. `lib/` is pure game logic
  (chess.js + plain JS), testable with plain Node.
- All 3D hover/click handling goes through raycasting — `onClick` /
  `onPointerOver` on a `<mesh>`. Never compute board position from
  screen-space cursor coordinates.
- Before relying on a chess.js method/signature, check
  `node_modules/chess.js` for the installed version — signatures have
  changed across versions. Confirmed facts for the pinned `^1.0.0` (currently
  resolves to 1.4.0), so you don't have to re-derive them:
  - `new Chess()`, `game.board()` (8×8, rank 8 → rank 1, files a → h, cells
    are `{square, type, color} | null`), `game.turn()` and `game.moves(...)`
    are **methods**, not properties.
  - `game.moves({ square, verbose: true })` returns `Move[]` with `.from`/
    `.to`/`.san`/`.captured`/`.promotion` (algebraic strings, not 0x88
    indices).
  - `game.move({ from, to, promotion })` **throws** on an illegal move — it
    does not return `null`. Wrap it (see `lib/useChessGame.js`).
  - `game.attackers(square, color)` exists and is what `lib/visibility.js`
    uses — it returns raw attack/defend geometry (including pawns' diagonal
    attack squares, independent of whether they can legally capture there),
    not filtered by pin/check legality. That's the correct semantic for
    "vision," and better than deriving it from `moves()`. `lib/visibility.js`
    still carries a `moves()`-based fallback for pawns specifically (pawns
    attack diagonally, not where they push — a classic fog-of-war bug) in
    case a future chess.js version drops `attackers()`.
  - `game.isDraw()` already covers stalemate + insufficient material +
    threefold + 50-move; check `isCheckmate()` before it (checkmate implies
    check, so check that first too).

## Palette

| Use | Color |
|---|---|
| Light square | `#E0D6C0` |
| Dark square | `#8B7F6A` |
| Board frame / base | `#2A241C` |
| Grid lines | `#2B2018` @ 0.42 |
| Move/selection highlight | `#C1440E` (low opacity) |
| Fog | `#EDEBE3` (transparent, `depthWrite: false`) |
| White piece ("bone") | `#DDD3BE`, roughness `0.78`, metalness `0` |
| Black piece ("lacquer") | `#0E0E10`, roughness `0.32`, metalness `0.15` |
| Sky | CSS gradient `#F4F0E7 -> #E7DFD0 -> #CDC1AA` |

Two rules behind these values:

- **Bone must never equal the sky.** When the white pieces and the background
  share a value they dissolve into it, which is most of what made early builds
  read as unfinished.
- **The light/dark squares must differ obviously.** The original pair
  (`#EDE7D9` / `#D6CDBA`) was nearly the same value, and a chessboard that
  doesn't read as a chessboard at a glance looks broken.

## Lighting and exposure

`components/Lighting.jsx` is shared by the game and `/dev-pieces`, so what you
approve in the inspector is what ships.

The `Environment` map is what puts specular highlights on the lacquer facets —
`MeshStandardMaterial` with nothing to reflect renders as plaster, and the
lacquer carries `metalness: 0.15` specifically so it has something to catch.
The HDR is **served from `public/hdr/`, not via drei's `preset` prop**: `preset`
fetches from `raw.githack.com` at runtime, putting a third-party CDN on the
critical path of every page load.

**An environment map contributes diffuse irradiance, not just reflections.**
Dropping one into a rig that was balanced without it blows the scene out. Tune
by measuring, not by eye: screenshot the board and sample tile pixels (see
`ENV_INTENSITY` in Lighting.jsx for the recorded sweep). The current pairing is
`ENV_INTENSITY = 0.2` with `toneMappingExposure = 0.85`, which lands a dark
square on `#8e8979` against its `#8B7F6A` material.

`?envi=` and `?exp=` override both at runtime so the balance can be swept
without a rebuild.

### Tone mapping — do not "fix" the exposure

`toneMapping: THREE.ACESFilmicToneMapping` is now stated explicitly on the
`<Canvas>` gl props. It is the same value `@react-three/fiber` v8 picks by
default (unless `flat` is set), but the entire light-key palette is balanced
around ACES' shoulder and that should not be an unwritten dependency on a
library default.

**Exposure stays at 0.85.** A later brief called for 1.05 on the grounds that
white pieces were being blown to pure white. They are not — sampling the
rendered frame across the bone pieces and light squares gives peak luma
234/255, zero pixels at or above luma 250, and zero pixels with all three
channels >= 254. ACES was already doing that job. Raising exposure 24% is the
one change that would actually *introduce* the clipping. Measure before
changing this (`?exp=` makes it a one-URL experiment).

### Grading

- **Vignette** — plain CSS radial gradient over the canvas (`.vignette` in
  `globals.css`), not a postprocessing pass: no extra dependency and no second
  render target. `z-index: 5`, under the HUD (10) and the title screen (20);
  the HUD carries an explicit z-index only because of this.
- **ContactShadows** (drei) at y=0.012 — the soft pool directly under each base
  that glues a piece to its square. Separate from the shadow map, whose light
  is thrown at an angle and never lands under the piece itself. `far={1.6}`
  clears the king (1.45) but deliberately excludes the promotion picker
  floating at 0.95+, so the panel casts no blobs onto the board.
- **Board tile roughness** — one 512px noise texture, cloned per square with a
  1/8 repeat and a per-square offset, so no two squares carry the same grain.
  Clones share `texture.source`, so all 64 samplers cost one GPU upload.
  Roughness only, never a colour map: the light/dark pair is load-bearing.

## Promotion

`components/PromotionPicker.jsx`. The player's promoting move is **not played
when the square is clicked** — `Board` holds it in `pendingPromotion` and the
pawn stays put, so Esc or a click past costs nothing. The AI still auto-queens
(`makeMove`'s `promotion` defaults to `'q'`), which is what a greedy AI would
pick anyway.

`useChessGame.isPromotion(from, to)` reads chess.js' `flags` for `'p'`. Deriving
it from the destination rank instead would also fire for a rook or queen simply
arriving on the back rank. `lib/rules.test.js` pins both that flag and the
`promotion:` code -> piece mapping.

The panel's geometry is set by the frame, not by taste. Promotion happens on the
8th rank — the far edge, at -28 degrees, with the frame top only 12 degrees
above it. Full-size models 1.7 units straight up were **cut off by the top of
the viewport**. Three things fix it together: `SCALE = 0.72` so it reads as a
panel rather than four more pieces, a smaller `LIFT`, and `PULL` toward the
camera — a point at fixed height moves *down* the frame as it nears, so the
pull buys vertical room as well as putting the choice closer to hand.

The row yaws to face the camera every frame, and the yaw is **also seeded at
render time** from `useThree`'s camera: `useFrame` does not run until after the
first frame is committed, so without the seed the panel appears once unrotated,
foreshortened into a clump.

## Sound

`components/audio.js` — everything synthesised through Web Audio, no audio
files: short filtered noise bursts and a wind bed, a few hundred bytes of code
instead of a few hundred KB on the critical path. The pieces are stone, so
noise through a resonant filter is closer to right than a sample anyway.

**Off by default.** Autoplay policy would block it regardless, and a scene that
starts making noise on its own is worse than a silent one. The toggle in the
bottom-right corner is the user gesture that resumes the AudioContext.

Move and capture sounds are voiced in `GameCanvas` by watching `history` grow,
not from the click — that way the AI's moves are voiced by the same path as the
player's, and `lib/` stays browser-free. Only `select` is fired from `Board`.

## 3D models

Six Draco-compressed `.glb` files in `public/models/`, named exactly
`king|queen|rook|bishop|knight|pawn.glb`. **There is one file per piece
type — both colors reuse the same geometry**, cloned per instance and
re-materialed. If a piece looks "wrong" on one square but right on another,
it is the viewing azimuth, not a second model; verify with `md5sum` before
chasing a phantom duplicate.

Mint exports every model normalized into roughly the same ~1.9-unit
bounding cube (measured raw heights span only 1.8848–1.9041). So a raw
height that is wildly out of that band is the signal for junk geometry — a
leftover base plate or stray vertex — not the visible silhouette.

`components/PieceModel.jsx` owns the whole pipeline:
- `useGLTF(url)` (cached per URL; `useGLTF.preload` runs at module load).
- `scene.clone(true)` per instance — these models have no skeleton, so a
  plain deep clone is correct; `SkeletonUtils.clone` is unnecessary.
- `normalizeHeight()` scales to `PIECE_CONFIG[type].targetHeight`, then
  re-measures and subtracts `box.min.y` so the base sits exactly on y=0.
- `applyMaterial()` **replaces** whatever material came out of Mint with the
  shared `BONE` / `LACQUER` `MeshStandardMaterial` and sets castShadow +
  receiveShadow. Mint's own textures/materials are always discarded.

Board position goes on a wrapping `<group>`, never on the `<primitive>`
itself — the primitive carries the normalization transform and must not have
it overwritten.

`PIECE_SCALE` in `lib/pieces.js` is the **only** knob for fitting pieces to a
1-unit square. `normalizeHeight` multiplies `targetHeight` by it, so the
proportion ladder below stays locked while overall size is tuned with one
number.

Currently **1.45**. Measured on `/dev-pieces`, which spaces the row at exactly
one board square so it doubles as the adjacent-square clearance test:

| piece | footprint X | footprint Z | air to square edge | gap between two |
|---|---|---|---|---|
| **knight** | 0.557 | **0.803** | **0.099** | **0.197** |
| bishop | 0.638 | 0.639 | 0.180 | 0.361 |
| queen | 0.580 | 0.634 | 0.183 | 0.366 |
| king | 0.535 | 0.472 | 0.232 | 0.465 |
| rook | 0.448 | 0.449 | 0.275 | 0.551 |
| pawn | 0.331 | 0.330 | 0.335 | 0.669 |

**The binding piece is the knight, not the bishop** — and on Z, not X. Its
0.803 depth is what sets the ceiling: at 1.45 it has 0.099 units of air, and
1.55 would take that to 0.045. Do not raise `PIECE_SCALE` past 1.45 without
re-measuring the knight's footprint Z specifically; the bishop's larger *X*
makes it look like the widest piece in the side-on inspector view and it is not.

Height ladder (`targetHeight` in `lib/pieces.js`), verified in-browser:

| piece | target | note |
|---|---|---|
| king | 1.00 | |
| queen | 0.92 | |
| bishop | 0.80 | |
| **knight** | **0.70** | deliberately below the rook |
| rook | 0.68 | |
| pawn | 0.55 | |

The knight breaks the "taller piece = more important" ordering on purpose.
Its bounding box is ~2x deeper than the king's (0.55 vs 0.33 in Z), so
height-matching it to 0.78 made it read as the largest piece on the board.
Don't "fix" it back without re-checking footprint.

`/dev-pieces` (`components/DevPieceRow.jsx`) is a dev-only page that lines up
all 12 pieces side-on under a long lens (fov 12 from z=16, ≈ orthographic) so
heights compare honestly without perspective. Its `<Measurer>` writes real
world-space measurements to `window.__pieceMeasurements` — read that instead
of eyeballing pixels when a proportion looks off.

## Architecture

```
pages/_app.js, _document.js, index.js   — Pages Router shell; index.js dynamic-imports GameCanvas (ssr:false)
pages/dev-pieces.js        — dev-only piece inspector route (not part of the game)
components/GameCanvas.jsx  — Canvas, camera, lights, OrbitControls; owns useChessGame() + computeVisibility()
components/Board.jsx       — 64 tile meshes, click-to-select/move, legal-move highlight, pending-promotion state
components/PromotionPicker.jsx — 3D piece choices above the promoting square; camera-facing, self-cancelling
components/Plateau.jsx     — the ground under the board; alpha-dissolved rim (see "Plateau")
components/proceduralTextures.js — canvas noise -> roughness/normal/alpha maps for the plateau and tiles
components/audio.js        — synthesised SFX + wind bed, off by default
components/Pieces.jsx      — maps chess.js cells -> PieceModel; skips opponent pieces outside `visibility`
components/PieceModel.jsx  — GLTF load + height normalization + material override (see "3D models")
components/DevPieceRow.jsx — dev-only side-on comparison row + measurement probe
components/FogLayer.jsx    — 64 persistent fog planes, opacity lerped imperatively in useFrame (never via React state)
components/HUD.jsx         — plain DOM overlay (turn/status/new game), absolutely positioned over the canvas
lib/coords.js              — squareToWorld/worldToSquare, board centered at origin, a1 at the corner, 1 unit/cell
lib/pieces.js              — PIECE_CONFIG (model path + targetHeight) and CODE_TO_PIECE ('n' -> 'knight')
lib/useChessGame.js        — chess.js wrapper hook; isPromotion(); owns the AI-move effect (setTimeout keyed off turn/status)
lib/visibility.js          — computeVisibility(game, color) -> Set<string>; unit-tested (lib/visibility.test.js)
lib/ai.js                  — pickGreedyMove(game): highest-value capture, else random legal move
```

## Fog

`lib/fog.js` holds the shared config; `FOG_MODE` picks the implementation and
`components/Fog.jsx` dispatches. Tier 1 (`components/FogLayer.jsx`, one plane
per square) is kept working as a rollback — do not delete it.

Tier 2 (`components/FogShader.jsx`) drives an 8x8 `DataTexture` mask through a
single plane over the board. `LinearFilter` on that mask is what turns
per-square 0/1 into smooth gradients; without it the fog is a visible grid of
squares. An fbm value-noise field adds drifting cloud density on top.

**The fog sits at y=0.05, just above the tiles — not above the pieces.**
Floating it over the pieces (the obvious reading of "above the pieces") means
a shallow camera looks through every fogged square between it and a distant
piece, washing the whole board out. Nothing ever pokes through at ground
level: a square holding one of your own pieces is always visible so never
fogged, and enemy pieces inside fog are not rendered at all. Move-highlights
sit at `HIGHLIGHT_HEIGHT` just above the fog so legal-move markers stay crisp
on squares you have not explored.

Mask orientation is easy to get subtly wrong (mirrored/transposed) and hard to
spot on a symmetric start position. `/dev-fog?visible=a1` renders top-down
with only the listed squares cleared and paints them orange — the clear hole
must land on the orange square. Corners alone do not prove it (they are
invariant under mirroring); use a single asymmetric square.

## Camera

The player is always White and rank 1 sits at z = -3.5, so the camera starts
at **negative Z, behind White's own pieces**, looking up-board into the fog.
A camera at +Z looks from Black's side and puts the player's pieces at the far
edge — wrong, and easy to do by accident.

`components/CameraRig.jsx` pulls the camera back on narrow/portrait viewports.
A single fixed position framed for a landscape window crops the board badly on
a phone — production showed exactly that on a 390x844 screen.

## Mountains

`components/Mountains.jsx` draws four concentric open cylinders (BackSide,
viewed from inside) with procedurally generated ridge textures. Cylinders
rather than flat planes so parallax survives a full 360 degrees of orbit.

**Ridge heights are derived, not eyeballed.** The camera sits at y~7 pitched
down at the board, so the top of the frame is already ~16 degrees *below*
horizontal — the true horizon is off screen. A range only reads as a skyline
if it lands in the band between the frame top and the board's far edge
(~28 degrees down), so each shell solves its peak/base from a target elevation
angle. Because the angle is fixed and distance varies, farther shells resolve
to lower world Y. That is correct, not a bug: they all land on the same screen
band and stack into depth. Two earlier attempts that picked heights by feel
put the ridges below the board entirely.

Two non-obvious details:
- The silhouette is **faded out below the ridge**. There is no terrain in this
  scene to hide a mountain's lower slopes, so a solid fill becomes a flat grey
  wall across the whole background.
- The fill path closes on `x = TEX_W`, not `TEX_W - 1`. Stopping a column short
  leaves a strip that linear filtering smears into a visible vertical seam
  where the cylinder's UVs wrap.

`lib/noise.js` holds one fbm implementation in both JS and GLSL
(`FBM_GLSL`). The board's fog of war and the mountain haze are meant to read
as the same substance, so they must not drift into two different noises. Its
lacunarity is 2.03 rather than 2.0 on purpose — an integer lacunarity lines
every octave up on the same lattice and leaves a visible grid.

`components/Backdrop.jsx` switches between these procedural shells and a
painted panorama via `BACKDROP_MODE`. The image path is probed with a HEAD
request before mounting `useTexture`, because `useTexture` suspends forever on
a 404 and would hang the entire canvas behind Suspense.

## The painted backdrop (`BACKDROP_MODE = 'image'`, current default)

`public/textures/mountains.jpg` — a sumi-e valley with a stone plateau in the
foreground, 2560x1429, 434 KB. The 2752x1536 / 6.6 MB original lives in
`assets-src/` and is **not** under `public/`, so it never ships.

It is **one frame, not a seamless 360 panorama.** It is therefore mapped onto a
cylinder *segment* and `OrbitControls` is clamped to a sector where the open
ends stay off screen (`AZIMUTH_LIMITS` in GameCanvas, from `HOME_AZIMUTH` +/-
`AZIMUTH_SWING` = 30 degrees). A narrow sector with a good frame beats a full
orbit with a visible seam. Procedural mode keeps the full 360.

**The framing is derived, not eyeballed** — same method as the procedural
shells, and the derivation is the only reason it sits right:

- The camera pitches 37.3 degrees down, so the top of the frame is 16.3 degrees
  *below* horizontal and the board's far edge is at -28.3. The entire
  background is that ~12-degree band. Everything else on the wall is off
  screen, which is fine and intended.
- The painting's skyline (20% down the image, measured off a per-row luminance
  profile: rows 0-10% are flat sky at ~227, the far ridges break in near 20%)
  is solved onto -19 degrees. `TOP_Y` falls out of that.
- Height follows from the arc so the painting keeps its own proportions.

`ARC_DEG = 200`, not the ~150 that first framed well. The camera subtends up to
~50 degrees of the wall on a 21:9 viewport, and the player may swing 30 either
side, so 80 degrees of half-arc is the requirement; at 75 the open end of the
segment walked into frame at both swing limits. Verified at both limits and at
2200x920.

Scene fog range is **mode-dependent** (`BACKDROP_FOG`). The procedural shells
sit at r<=36 and are built to be eaten by fog; the painting sits at r=46 and has
to survive it. Image mode uses `[44, 96]`, which starts past the board so the
pieces stay crisp and fades the painting's lower band from 0.28 to 0.41.

`?bdr=` `?bda=` `?bdt=` `?bde=` `?bdflip=` override radius, arc, top Y, skyline
elevation and the u-flip at runtime.

The bottom edge of the cylinder is *inside* the frame — it cannot be pushed out
without either zooming the painting hard or breaking its aspect. The plateau is
what covers it. That is a real coupling between the two sections: **if you turn
`SHOW_PLATEAU` off, the painting's lower edge becomes visible at the bottom of
the frame.**

## Gaussian splat backdrop (`BACKDROP_MODE = 'splat'`) — wired, not yet placed

`public/sumi-e-mountain-valley-*.spz` is a real Gaussian-splat capture of the
valley, and `components/SplatBackdrop.jsx` renders it via `@sparkjsdev/spark`.
It **works** — it loads and draws — but it ships **disabled**, because the
capture has not been art-directed into position and unplaced it looks worse
than the painting. Everything below is so the next session does not have to
rediscover it.

**It renders in addition to the painted cylinder, never instead of it.** The
painting is 434 KB and instant; the splat is 32 MB and may never arrive. The
painting is the floor under it, and `SplatBackdrop` never throws upward.

Facts already established, so don't re-derive them:

- The file is SPZ v3, gzipped (36.6 MB inflated), **1,920,000 splats**,
  `shDegree 0` — view-independent colour, which is both cheaper and correct for
  a backdrop. `fractionalBits 14`, so positions are 24-bit fixed point over
  16384.
- **Spark 0.1.10 runs fine against three 0.169** despite being built against
  0.178. Do not bump three for it. Spark 2.x demands three >=0.180, which would
  drag `@react-three/fiber` 8.x / drei 9.x with it — see the pin warning at the
  top of this file. Pin Spark at 0.1.10.
- Spark inlines its sorting WASM as a `new URL("data:application/wasm;base64…")`
  which webpack routes into Next's asset-module rules and dies on
  `generator has an unknown property 'filename'`. `next.config.mjs` disables the
  url parser **for Spark's files only**; that is load-bearing for the build.
- World extent (p01–p99): X -88..69, Y -8.6..60, Z -90..46. Y is up.
- The origin sits inside a 374,160-point clutter cell (a tree, which impales the
  board at scale 1, offset 0). Open ground — near-zero obstruction 1.5–10 units
  above local ground — is around splat X 8..24, Z -24..0, ground Y about -3.4
  to -6.

What was tried and rejected: scale 12 (world blown up ~2000x, a few giant
blobs); scale 2 offset into the clearing (camera buried inside a hillside);
scale 1 offset to dodge the tree (still a close, muddy interior — no vista).

Tune it live — every value in `DEFAULTS` has a URL override, `sp` + the key:
`?spscale=`, `?sprotX=` `?sprotY=` `?sprotZ=` (degrees), `?spposX=` `?spposY=`
`?spposZ=`, `?spopacity=`.

**Do not try to place this from a headless screenshot.** The cost is splat
sorting, not pixels, so shrinking the viewport does not help: a single frame
took 109–114 seconds at both 1280x800 and 560x350. `window.__splat` carries
`{state, error, count}` so a probe can tell "still fetching 32 MB" from
"failed". Real-GPU frame rate for 1.92M splats is **unmeasured** — it is the
thing to check first, along with whether a 32 MB critical-path download is
acceptable at all.

## Plateau

`components/Plateau.jsx` (`SHOW_PLATEAU` to roll it back) is the ground the
board stands on. Without it the board hangs in the void and the scene reads as
a model in a viewer. Three planes instead of two: board -> plateau -> fog ->
painting.

`RADIUS = 10.5` is squeezed between two constraints that nearly conflict:

- Toward the camera it has to reach the bottom of the frame. The bottom-centre
  ray hits the ground at radius 4.7, the bottom corners at 6.8 — 8.7 on 21:9 —
  so the opaque core has to survive to ~7.
- Away from the camera it has to be gone before it eats the painting. Radius
  10.5 sits at -20.8 degrees, which leaves the skyline at -19 in clear air.

A first pass at 15 put the far rim at -16.8, right on the frame top, and the
mountains vanished behind a grey shelf.

The rim dissolves via an **alpha map, not scene fog** — fog in image mode starts
at 44, so the plateau is entirely inside the unfogged zone. Note that
`CircleGeometry` inscribes the disc in its UV square, so **the rim is at UV
radius 0.5, not 1.0**; putting the fade band at 0.5-0.96 (the obvious reading)
leaves it entirely outside the geometry and yields a fully opaque disc with a
hard edge.

Roughness and normal maps come from `components/proceduralTextures.js`, which
builds canvas textures from `lib/noise.js`'s fbm. It lives in `components/`
rather than `lib/` because it constructs `THREE.Texture` objects. fbm is not
tileable, so anything with `repeat > 1` uses `MirroredRepeatWrapping` — plain
repeat leaves a grid of seams.

## Intro

`components/IntroOverlay.jsx` states the one rule that makes the game legible
to a stranger, then gets out of the way. Dismissal is remembered per session
via `sessionStorage`. Fonts come from `next/font/google` (Zen Old Mincho for
display, Inter for UI) and the palette lives in `styles/globals.css` as CSS
custom properties shared with the 3D scene.

## QA hooks

- `npm test` — Node's built-in runner, no extra deps. Asserts the starting
  position gives White exactly 24 visible squares and that pawns do not leak
  their push-square into vision.
- `?fen=<FEN>` on the game page loads a position directly (`useChessGame`
  accepts an optional initial FEN). The random-moving AI will never reach mate
  or stalemate on its own, so this is how the checkmate/draw HUD states get
  verified. `reset` always returns to the standard opening.
- `?debug=1` brings back the HUD's `visible: N / 64` readout, which
  cross-checks the unit test live in the browser. It is off by default
  (`SHOW_DEBUG` in `components/HUD.jsx`).
- `/dev-pieces` — side-on piece inspector, writes real measurements to
  `window.__pieceMeasurements`. Read `halfWidth` from there rather than
  eyeballing the row: the side-on view shows footprint X, and the piece that
  actually limits `PIECE_SCALE` is limited on Z.
- `?fen=4k3/P7/8/8/8/8/8/4K3 w - - 0 1` puts a white pawn on a7, which is the
  fastest way to open the promotion picker. Clicking anything in the 3D scene
  from a headless browser needs the square's *screen* position: build a
  `THREE.PerspectiveCamera` at `[3.5, 7, -8.5]`, fov 42, `lookAt(0,0,0)` in
  Node and `project()` the world coordinate. `CameraRig` leaves that position
  alone at aspect >= 1.3, so the projection is exact.

## Headless browser: the scene runs at ~1 fps

Headless Chromium here has no GPU and falls back to software rasterisation,
which renders this scene at roughly **one frame per second**. That is an
artifact of the test environment, not the product, but it changes how you
verify:

- Timers and CSS transitions are frame-gated. A 900ms fade takes ~6 seconds of
  wall clock. Budget seconds, not milliseconds, for any wait.
- Playwright's `locator.click()` times out on principle — its actionability
  checks need consecutive stable frames. Use `page.mouse.click(x, y)` with the
  element's bounding box instead.
- Do not conclude a control is broken from a click timeout. Trace it: an
  earlier session burned several iterations "fixing" a title-screen button that
  worked correctly the whole time.
- `drawImage` on the WebGL canvas reads back black (no `preserveDrawingBuffer`).
  To sample rendered pixels, screenshot with Playwright and decode the PNG in
  Node instead.

Real-GPU performance cannot be measured from here. The fog shader is the thing
to watch if it ever needs profiling: three fbm evaluations of five octaves each
per pixel, across two stacked sheets.

## Dev-server gotcha

This stack (multi-MB Draco `.glb` + r3f) makes `next dev` HMR unusually
fragile. After a burst of rapid edits it can start serving stale modules,
phantom geometry, or 500s with
`SyntaxError: Unexpected non-whitespace character after JSON` from a
half-written `.next` manifest. **Before debugging a weird visual artifact,
kill the server, `rm -rf .next`, and restart** — that has already resolved
two "bugs" that did not exist in the source.

Run `npm test` (Node's built-in test runner, no extra deps) to check
`lib/visibility.js` — it asserts the starting position gives white exactly
24 visible squares (16 occupied + 8 pawn-attacked) and that pawns don't leak
their push-square into their vision.

Player is always white. `Board.jsx` only lets you select `color === 'w'`
pieces and only while `turn === 'w'` and the game isn't over.
