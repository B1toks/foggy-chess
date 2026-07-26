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

## Piece interaction (Крок 8, Section C)

Before this pass, `Pieces.jsx` mapped `board.flat().filter(Boolean)` straight
to `<PieceModel key={cell.square}>` every render. That's fine for a static
board, but it makes a *move* look like the old instance at square A vanishing
and a brand-new one appearing already in place at square B — React remounts
on a key change, and a remount can't animate a value it never held. Getting a
piece to visibly travel from A to B needed identity that survives the move,
not just a snapshot of where everything currently sits.

**`Pieces.jsx`'s `useAnimatedInstances` hook is the reconciliation layer.** It
keeps its own `instances` state — `{id, type, color, square}` per piece, `id`
stable across moves — separate from chess.js's own square-indexed board, and
updates it from the *actual move object* (`history`'s last entry) rather than
diffing the whole board, because chess.js already tells us exactly which
square moved to which. Two cases a plain `from`/`to` can't cover on their own
are resolved with the standard rule for them: **en passant** (the captured
pawn sits behind `to`, not on it — `to[0] + from[1]`) and **castling** (the
only move chess.js's `Move` gives us is the king's own hop; the rook's silent
second one is filled in from `CASTLE_ROOK_HOPS`, the four fixed
from/to squares). A defensive sync pass against the real board follows every
reconciliation, so a missed edge case just snaps a piece into place instead of
ever rendering the wrong thing.

**Move animation is imperative, not React state**, matching the convention
`CameraRig`/`FogLayer` already established: `AnimatedPieceGroup` sets its
wrapping `<group>`'s position directly via a ref on mount, then only ever
touches it again from inside `useFrame` — never a re-declared `position` prop,
which would just snap the group to the new square before the animation had a
chance to run. When the `square` prop it's fed changes, an effect records a
`{from, to}` arc; `useFrame` walks it forward over `MOVE_DURATION` (0.35s)
with `easeInOutCubic` (`lib/easing.js`) and adds `Math.sin(p * π) *
MOVE_ARC_HEIGHT` on top of the interpolated Y, so the piece rises and falls
across the move instead of sliding flat. Because each `AnimatedPieceGroup` is
keyed by the piece's persistent `id` (not its square), React keeps the *same*
component mounted across the move and the animation runs; a piece that was
outside `visibility` (an unseen enemy move) and only becomes visible again
later mounts fresh at its current square instead — correct, since the player
never saw whatever it did while hidden.

**Captures fade instead of vanishing.** A displaced piece doesn't just drop
out of `instances` — it moves into a separate `ghosts` list and renders as a
short-lived `<CaptureGhost>` that fades its own opacity to 0 over
`CAPTURE_FADE_DURATION` (0.4s) before calling back to remove itself. This
needed one change to `PieceModel.jsx`: every *live* piece shares one of two
module-level `MeshStandardMaterial` singletons (`BONE`/`LACQUER`) — cheap, but
it means animating opacity on one piece would fade every piece of that colour.
`PieceModel`'s new `fade` prop clones the shared material once for that
instance instead of reusing it, so `CaptureGhost` can drive its own opacity
independently. Ghosts are short-lived (one fade, then unmounted), so the extra
material instance per capture never accumulates. A ghost only spawns for a
capture that was actually on screen a moment before — White's own pieces
always are, an enemy piece only if it was inside `visibility` — a capture on a
square the player never saw shouldn't flash a piece into view just to fade it
back out.

**Hover/selected lift is a second, separate imperative animation**, riding on
its own inner `<group>` so it never fights the move animation over one
`Vector3`. `Board.jsx` already owned the pointer handlers; it now also tracks
`hovered` (mirroring `selected`) and reports both upward via
`onHoveredChange`/`onSelectedChange` callback props, since `Pieces.jsx` is a
sibling of `Board`, not a child, and needs the values lifted into
`GameCanvas.jsx` to receive them. Only the player's own piece on the
hovered/selected square lifts (`HOVER_LIFT = 0.03`), exponentially smoothed
(`1 - Math.exp(-HOVER_LERP_SPEED * delta)`) toward the target each frame
rather than snapping, which is what makes it read as "rises, and returns" —
the brief's "фігура ледь підіймається і повертається" — instead of a toggle.

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

## HUD

`components/HUD.jsx`, reworked in Крок 8 Section C toward "less interface":

- **No card.** The status text used to sit in a bordered, backgrounded panel;
  it's now plain text directly on the scene, legibility carried by a
  text-shadow instead of a background chip.
- **Check/checkmate get a dedicated flash** — `StatusFlash` — the board's own
  ember (`#C1440E`), large, centred at the top of the frame, with a brief
  `hud-status-flash` keyframe fade-in. Text is Ukrainian ("Шах"/"Мат")
  specifically because that's what the brief asked for there, even though the
  smaller ongoing status line next to it is still English — a pre-existing
  inconsistency this pass didn't take on fixing everywhere.
- **Sound and "New game" share one corner and one visual style** (the
  `CORNER_BUTTON_STYLE` object both buttons spread) — small, semi-transparent
  square icon buttons, bottom-right. "New game" only renders once
  `showGameplay` is true (nothing to restart before then) and is deliberately
  understated mid-game (`opacity: 0.55`) versus full strength once the game is
  actually over (`prominent` prop) — a restart is a destructive, rarely-wanted
  action while a game is still live.
- **A control hint** (`ControlHint`, "Перетягніть, щоб обертати · Колесо —
  масштаб") appears bottom-centre for `HINT_VISIBLE_MS` (8s) and fades over
  `HINT_FADE_MS` (1.2s). It ties to its own mount time via a plain
  `useEffect`/`setTimeout` — since `HUD` only renders it once `phase` reaches
  `'playing'` (see "Intro"), mount time already *is* "the first 8 seconds of
  the game," no extra clock needed.

`showGameplay` (passed from `GameCanvas.jsx` as `phase === 'playing'`) gates
everything except the sound toggle, which stays available through the intro
too — it's a global preference, not part of the game state, and the intro's
own wind-bed ambience is worth being able to turn on before the board is even
interactive.

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
components/GameCanvas.jsx  — Canvas, camera, lights, OrbitControls; owns useChessGame(), computeVisibility(), and the intro/transitioning/playing phase state (see "Intro")
components/IntroCameraRig.jsx — scripted camera for the intro's three shots + the hand-off transition into gameplay (see "Intro")
components/IntroOverlay.jsx — the intro's stable text (title, tagline, start button); transparent, no background art of its own, each text block sits on its own blurred scrim (see "Intro" -> "Крок 9.6")
components/Board.jsx       — 64 tile meshes, click-to-select/move, legal-move highlight, pending-promotion state; reports selected/hovered squares upward
components/PromotionPicker.jsx — 3D piece choices above the promoting square; camera-facing, self-cancelling
components/RockIsland.jsx  — what the board sits on: a small floating rock (temporary dark pedestal until the real model exists) — see "RockIsland"
components/SkyDome.jsx     — full sphere behind everything, gradient + faint fbm haze (see "Camera and environment")
components/proceduralTextures.js — canvas noise -> roughness/alpha maps for the backdrop edge fade and board tiles
components/audio.js        — synthesised SFX + wind bed, off by default
components/Pieces.jsx      — reconciles chess.js's board into identity-stable piece instances; owns move/hover/capture animation (see "Piece interaction")
components/PieceModel.jsx  — GLTF load + height normalization + material override (see "3D models")
components/DevPieceRow.jsx — dev-only side-on comparison row + measurement probe
components/FogLayer.jsx    — 64 persistent fog planes, opacity lerped imperatively in useFrame (never via React state)
components/HUD.jsx         — plain DOM overlay (turn/status, sound + new-game corner, control hint), absolutely positioned over the canvas
lib/coords.js              — squareToWorld/worldToSquare, board centered at origin, a1 at the corner, 1 unit/cell
lib/easing.js              — easeInOutCubic, shared by the intro camera and the board's move animation
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
squares.

### Wisp structure (ridged noise, not fbm)

Plain fbm gives soft blobs; the fog is meant to read as fibrous wisps and gaps.
Each octave is folded around its midpoint (`n = 1.0 - abs(n*2.0-1.0)`, then
squared) — this turns fbm's zero-crossings into sharp ridges. The function is
generated per-material by `ridgedGLSL(name, octaves)` (a JS template, not a
runtime uniform loop bound — GLSL loop counts are simplest as compile-time
constants, and octave count is a thing a developer dials in `lib/fog.js`
(`FOG_WISP_OCTAVES`, `FOG_DETAIL_OCTAVES`, `FOG_ENABLE_DETAIL`), never a
player-facing knob).

Three scales are composited: `mass` (plain fbm, large and slow — the general
haze), `wisps` (ridged, medium scale — the visible threads), `detail` (ridged,
fine and faint, `* 0.35` then `* 0.25` again in the mix — deliberately
double-attenuated so it frays edges rather than adding its own visible shape).
Before sampling the ridged layers, the UV is stretched `vec2(vUv.x, vUv.y *
3.2)` — compressing V makes the noise argument change fast along "into the
board" and slow along "across the board", so the ridges read as horizontal
streaks, not an isotropic speckle. All three scales drift on **three
non-parallel, non-proportional vectors** (not one vector negated/scaled) so
the structure keeps reconfiguring rather than translating as a rigid pattern.

**Alpha compositing alone cannot carry the wisp structure over every tile —
this was tried twice and failed twice.** The first attempt used a flat
`FOG_COLOR` with plain alpha; the second (Крок 8) varied the colour by cloud
density (`fogColor = mix(uColor * 0.74, uColor, shaped)`, denser/greyer
between wisps) to at least give dark tiles a strong signal. Both still failed
on light tiles specifically: `FOG_COLOR` (`#EDEBE3`) is a pale near-white
close enough to the light squares' own tone (`#E0D6C0`) that painting it
*over* the tile at any alpha barely moves the result — confirmed by direct
pixel diffs at the time: dark tiles shifted +18 to +39 luma, light tiles
barely -5. Alpha compositing is fundamentally the wrong operation for this:
it can only pull a pixel *toward* FOG_COLOR, and FOG_COLOR was already close
to where light tiles start.

**Крок 9.5's fix is two separate layers with two different blend modes, not
one layer with a better colour.** `FogShader.jsx` now renders three meshes
instead of two:

- **`groundMultiply`** — `THREE.MultiplyBlending`, `FOG_TINT_COLOR`
  (`#B8BDC2`, cool grey-blue). Multiply *scales* whatever is already in the
  framebuffer instead of painting over it: `base = mix(vec3(1.0), uTint,
  density * uOpacity)`, so a fully visible square (`density == 0`) multiplies
  by literal white — a no-op, the tile's own colour passes through completely
  unchanged — and a fogged square multiplies toward the tint regardless of
  whether the tile started light or dark. This is the layer that actually
  fixes the readability bug; it does not care what colour the destination
  pixel was, which alpha compositing structurally cannot say.
- **`groundStrands`** — ordinary alpha blending, `FOG_STRAND_COLOR`
  (`#F4F1EA`, pale), `alpha = shaped * density * 0.5 * uOpacity`. The visible
  wisp threads, laid on top of the base the multiply layer already darkened.
  This is close to what the old single-layer shader painted, but it no longer
  has to also carry "is this square fogged at all" — that job now belongs
  entirely to the multiply layer — so it can stay a pale, high-contrast
  overlay without disappearing into a light tile itself.
- **`driftStrands`** — the existing second, higher parallax sheet, unchanged
  in role: still strands-only (no multiply pass of its own), since its job is
  faint drifting detail on a base the ground layer already darkened, not
  readability on its own.

`sharedUniformsAndNoiseGLSL()` and `densityAndShapeGLSL()` in `FogShader.jsx`
hold the code both the multiply and the strands fragment shader need (mask
sampling, the three noise scales, `density`, `shaped`) as one piece of
template text, not two independently-maintained copies — the two shaders
differ only in their last few lines.

Verified with real pixel measurements, not the `visible=1.0` trick this
section used to recommend (that baseline compares "fog on" to "fog config
forced off," which conflates the readability question with the shader
existing at all): sampled a fogged, empty light square (a8) against a clean,
*visible*, empty light square (b3, a rank-3 pawn-attack square) on the same
rendered frame. **Light tile: -54 luma. Dark tile (e7 vs a3): -28 luma.**
Both obviously darker, not "a few units." If a future session sees "fog looks
broken, board reads perfectly crisp," sample two real, currently-rendered
squares this way — one fogged, one visible, same tile colour — rather than
toggling fog off entirely; the multiply layer only exists on fogged pixels
(`if (density < 0.002) discard;`), so a broken multiply pass and a working one
look identical on a `visible=1.0` baseline that never had any fog to begin
with.

Performance ladder, in order, if frame rate drops below 50: `FOG_DETAIL_OCTAVES`
5 -> 3, then `FOG_ENABLE_DETAIL` -> false (drops the third scale entirely, and
its GLSL function is not even included in the shader source when false), then
`FOG_DRIFT_OPACITY` -> 0 (the second sheet's `<mesh>` is skipped from the JSX
entirely when this is 0 — not rendered at zero alpha — so it saves the second
draw call and shader compile, not just fill rate). **Real-GPU frame rate is
unmeasured from this environment** — see "Headless browser" below; the
software rasterizer here renders at roughly 1 fps regardless of scene
complexity, so it cannot distinguish 30 fps from 60. Complexity is comparable
to what shipped before this pass (three multi-octave noise evaluations per
pixel per sheet, same as the old fbm-plus-domain-warp version), so it should
not be a *new* regression, but verify on real hardware before trusting that.

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

## Camera and environment

The player is always White and rank 1 sits at z = -3.5, so the camera starts
at **negative Z, behind White's own pieces**, looking up-board into the fog.
A camera at +Z looks from Black's side and puts the player's pieces at the far
edge — wrong, and easy to do by accident.

`components/CameraRig.jsx` pulls the camera back on narrow/portrait viewports.
A single fixed position framed for a landscape window crops the board badly on
a phone — production showed exactly that on a 390x844 screen.

### Distance and polar clamps (GameCanvas.jsx)

`MIN_DISTANCE = 8`, `MAX_DISTANCE = 14` (landscape/aspect>=1.3 values).
Derived from the same ray-to-ground-plane method used for Plateau's `RADIUS`
and Backdrop's skyline, not picked by feel — but the derivation had to bend
around one constraint: the brief's literal target ("board occupies ~65% of
frame at minDistance") solves to d~15 using the board's own AABB height /
frame height, and that is *farther* than CameraRig's resting distance (11.55).
A minDistance greater than the resting distance would make OrbitControls shove
the default view backward on load. 8 instead clears the tallest piece (king,
1.45) without cropping it at the frame edge, verified by screenshot at
2200x920 and 390x844. 14 keeps the 21:9 bottom-corner ground-hit ray inside
Plateau's radius (10.5) — the old value (17) put that ray at radius 12.6,
already past the plateau's edge.

**These are NOT declared as `<OrbitControls minDistance={} maxDistance={}>`
props.** `CameraRig` owns them exclusively: on every resize it scales both by
the same `pullbackFor(aspect)` factor applied to the resting position, and
writes them directly onto the controls object. A portrait phone (pullback
~1.6x) needs both the resting distance *and* the zoom bounds pulled back
together, or minDistance stays put while the resting view moves — which let a
portrait screen zoom in relatively tighter than landscape, cropping pieces at
the frame edge. Declaring the unscaled values as JSX props *in addition to*
CameraRig's imperative override is exactly the bug to avoid: drei re-applies
declared props on some later re-render and would stomp the scaled values back
to the landscape numbers.

`MIN_POLAR_ANGLE = 0.38` rad (~22 degrees). It used to be 0.838 rad (48
degrees) — not an aesthetic call but a hard geometric requirement, found
empirically: Plateau's disc (radius 10.5) and the painted backdrop cylinder
(radius 46) never touched, leaving a bare annulus of ground between them that
nothing was drawn to cover. With the old flat CSS sky this was invisible (a
gap showing uniform pale "sky" just reads as more sky); SkyDome's directional
gradient turned that same gap into a distinctly domed, wrong-toned bulge the
instant the camera pitched shallow enough to see across it — visible through
40 degrees, gone by 45.

**Крок 8, Section A closed the gap for good instead of just clamping around
it** — see "Plateau" below for the large radial-gradient disc that now
reaches all the way to the backdrop's own radius. With no gap left to hide,
0.38 rad is the value the brief asked for, and it's also what the cinematic
intro needs: its top-down shot sits at ~45 degrees (comfortably inside this
bound) and its low, near-level opening shot needs the shallowest angle of any
camera position in the scene, scripted or player-driven (see "Intro"). If a
future change moves the plateau or backdrop radius and a seam reappears,
raise this in 2-degree steps rather than jumping back to 48 — the ground fix
is the more robust lever now that it exists.

`MAX_POLAR_ANGLE = 1.25` rad (72 degrees), tightened from the old 1.4 (80) so
the camera can't dip low enough to see up through the board's underside at the
plateau's backface.

Azimuth is **unclamped** — full 360 degrees. It used to be limited to the
sector the painted backdrop segment covers; SkyDome (below) now closes the
rest of the sphere, and the segment itself fades into the dome at its own
edges, so there is no longer an edge to hide from.

Verified: OrbitControls' own `update()` clamps the spherical position on
every call, including mid-damping-inertia — a fast drag/wheel-flick sampled
every `requestAnimationFrame` during and after release never showed
polarAngle or distance outside bounds, even transiently. No overshoot guard
was needed beyond what OrbitControls already does.

### QA hook: exact camera placement from a script

`GameCanvas.jsx`'s `DebugHooks` component (gated behind `?debug=1`, same
convention as HUD's vision counter) exposes `window.__scene`, `window.__camera`,
`window.__gl`, `window.__controls`, and `window.__phase` (the intro/
transitioning/playing state machine — see "Intro"). This is what makes
camera-limit testing possible at all without approximating a position via
imprecise mouse drags:

```js
// in a Playwright page.evaluate:
window.__camera.position.set(x, y, z);   // any point relative to target (0,0,0)
window.__controls.update();               // reads it into spherical, CLAMPS it, repositions
// window.__controls.getDistance() / .getPolarAngle() / .getAzimuthalAngle() to verify
```

Setting `camera.position` directly and calling `controls.update()` is exactly
what `CameraRig` already does every resize — proven safe. `update()` clamps
against whatever `minDistance`/`maxDistance`/`minPolarAngle`/`maxPolarAngle`
are *currently* set to, so requesting a value beyond a limit is itself a valid
test (confirms the clamp, rather than just confirming the requested value).

### SkyDome — closes the environment on every axis

A painted backdrop or procedural ridge shells only cover a slice of the world
around the camera's resting direction. `components/SkyDome.jsx` is what's
*behind* them: a full sphere (radius 180, `BackSide`), so there is no longer a
way to orbit into open space regardless of the camera's azimuth or pitch.

Vertical gradient (`DOME_TOP_COLOR` #F0EBDE, `DOME_HORIZON_COLOR` #DCD6C8,
`DOME_LOW_COLOR` #CFC7B6) is keyed off the sphere-local position's own Y
(equivalent to elevation angle, correct regardless of dome radius since the
sphere is centred on the origin and unscaled). A very faint fbm haze rides on
top (`HAZE_AMOUNT = 0.035`), sampled directly off `vDir.xz` rather than an
azimuth angle — `vDir.xz` is already a smooth, continuous parametrisation of
direction with no wraparound, so there is no seam to special-case at any
azimuth.

**Deliberately not tonemapped and not fogged.** The dome doesn't include the
`tonemapping_fragment`/fog chunks a raw `ShaderMaterial` needs explicitly (built
-in materials get them automatically); leaving both out means the dome's own
gradient is what's on screen, at the radius it's drawn, rather than being
crushed to a single flat tint past `fog.far` or recompressed by ACES a second
time. Scene fog color (`BACKDROP_FOG.color` in Backdrop.jsx) is set to
`DOME_HORIZON_COLOR` exactly — the elevation band where the painting's own
distance-fog fades out sits close to the dome's horizon stop, so matching them
removes what would otherwise be a visible tone seam right at that dissolve.

### Backdrop edge fade — the painting dissolves into the dome, not a hard clamp

`getBackdropEdgeAlphaMap()` in `proceduralTextures.js` bakes a static analytic
gradient (both azimuth edges fade over the first/last 12% of U, the mesh
bottom fades over the first 18% of V) and applies it as an `alphaMap` on the
existing `MeshBasicMaterial` (with `transparent: true` added). Baked rather
than computed live in a custom shader on purpose: the gradient is a pure
function of UV with nothing animated, so a texture produces an identical
result to a live `smoothstep` while keeping `MeshBasicMaterial`'s built-in
scene-fog blending, which the painting already relies on for its own distance
fade. Matches `CylinderGeometry`'s UV convention (`v=1` is the mesh **top**) —
get this backwards and the sky fades out instead of the foreground.

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

It is **one frame, not a seamless 360 panorama**, so it's mapped onto a
cylinder *segment*, not a full wraparound cylinder. `AZIMUTH_SWING` (still
exported from `Backdrop.jsx`) is a leftover from when `OrbitControls` used to
be clamped to keep the segment's open ends off screen — azimuth has been
unclamped since SkyDome shipped (see "Camera and environment"), and since
Крок 9.5 Section B a *second* segment covers the rest of the circle (see
"Multiple segments (Крок 9.5, Section B)" below), so nothing reads that
export anymore. It's dead, not dangerous; left alone rather than cleaned up
as part of an unrelated change.

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

### Multiple segments (Крок 9.5, Section B)

A single 200-degree segment left ~160 degrees of a full orbit showing open
`SkyDome` with nothing painted in it — azimuth has been unclamped since
SkyDome shipped (Крок 8), so that gap was always reachable, just not always
dressed. `BACKDROP_SEGMENTS` in `Backdrop.jsx` is the fix: an array of `{id,
src, azimuth, arcDeg, flip}`, one entry per painted cylinder segment, each
independently placed and each fading into `SkyDome` (or another overlapping
segment) at its own edges through the *same* `getBackdropEdgeAlphaMap`
mechanism the original single segment already had. `Backdrop()` maps over the
array and renders one `<ImageBackdropSegment>` per entry; nothing about the
per-segment geometry math changed from the original single-segment version
(`ImageBackdropSegment` is the old `ImageBackdrop`, parametrised by `segment`
instead of hardcoding one azimuth/arc/flip) — only `azimuth` is new: it's the
segment's own centre, in place of the old hardcoded `HOME_AZIMUTH - Math.PI`.

**Segments are plain alpha-blended transparent meshes, so an overlap is just
two fading edges compositing on top of each other** — not a seam that needs
solving. Verified by sweeping the camera through 8 azimuths 45 degrees apart:
mountains at every angle, no gap, no hard edge.

**Today's two segments are both the same painting** (`BACKDROP_IMAGE`) —
`valley-main` at its original azimuth, `valley-mirror-placeholder` rotated
180 degrees and with the opposite `flip`, which is what makes it read as a
mirrored variant rather than the identical frame pasted twice. This already
closes the circle completely: two 200-degree arcs (+/-100 from their own
centre) placed 180 degrees apart overlap by ~20 degrees on each side, so
every azimuth falls inside at least one segment. It's a stand-in for two more
Mint-generated frames of the same valley, not a placeholder for any specific
future segment — replacing it is a matter of swapping `src`/`azimuth`/`arcDeg`
on that array entry (and adding a third for the brief's eventual "three
~140-degree segments with overlap"), nothing structural.

**Cloning the texture per segment is load-bearing, not decoration.**
`useTexture` (drei) caches by URL through r3f's loader cache — two segments
that reference the same `src` get back the exact same `THREE.Texture`
instance, not two independent ones. Since each segment needs its own
`repeat.x`/`offset.x` (the main segment is U-flipped, the mirror placeholder
deliberately isn't), mutating the shared instance directly would make
whichever segment's effect ran last win for *both* of them — the mirror
would either not be a mirror, or the main segment would lose its correct
orientation, depending on render order. `ImageBackdropSegment` clones the
texture once per instance (`rawTexture.clone()`) specifically to give each
segment independent `wrapS`/`wrapT`/`repeat`/`offset` while still sharing the
one decoded image (no second fetch, no second decode) — and disposes its own
clone on unmount, leaving the cached original alone for the other segment (or
a future remount) to clone again.

**The readiness probe is all-or-nothing across every segment's `src`.** A
partial state — some segments showing the painting, others falling back to
procedural `Mountains` — would read as two different worlds stitched
together, worse than a full fallback. `Backdrop()` HEAD-probes the set of
*unique* `src` values (one request today, since both segments share a
source) and only mounts any image segments once all of them resolve; if any
fails, every segment falls back to `Mountains` together.

`?bdr=` `?bda=` `?bdt=` `?bde=` `?bdflip=` still work and now apply to every
segment at once (each falls back to its own config value when a given
override isn't present in the URL) — useful for sweeping radius/arc/skyline
across the whole array while tuning, not for pointing at one segment
individually.

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

## RockIsland (formerly Plateau — replaced in Крок 9.6, Section C)

**What the board sits on is a different concept now, not just a different
implementation.** Крок 8 introduced a rocky plateau disc under the board, then
spent two more passes (Крок 9, Крок 9.6) fighting the same failure mode: a
disc large enough to hide the gap between the board and the painted backdrop
kept becoming a flat grey shape blocking the backdrop itself, because "close
the gap" and "don't block the view past it" pull the disc's required radius
in opposite directions at different camera angles (see git history on the
now-deleted `Plateau.jsx` for the full back-and-forth, including the ray/plane
math from the Крок 9 correction — it's a real, previously-useful derivation,
just for a concept this section retires).

Крок 9.6 stopped trying to fake a continuous horizon and changed the picture
instead: the board sits on a **small floating rock**, the way a board might in
a shan-shui painting, and the emptiness around and under it is the
composition, not a gap to hide. `components/RockIsland.jsx` is the new home
for this (`SHOW_ROCK_ISLAND` to roll it back) — `Plateau.jsx` and its three
plateau-only procedural textures (`getStoneRoughnessMap`/`getStoneNormalMap`/
`getPlateauAlphaMap` in `proceduralTextures.js`) are gone, not superseded in
place.

**`ROCK_MODEL` is not set yet.** Mint is generating a rock formation with a
flat, round top sized for the board. Until it exists, `RockIsland` renders
`TemporaryPedestal`: a small, **sharp-edged** dark disc (`#241F19`,
`PEDESTAL_RADIUS` = board half-width `4.3` * 1.1 = `4.73`) directly under the
board, `receiveShadow` so it isn't flat-shaded paper under the board's own
shadow. Deliberately not pretty on its own — the brief was explicit that this
should read as an honest, unfinished pedestal rather than a second attempt at
a polished-but-wrong shape ("дошка на постаменті — некрасиво, але чесно").

**When `ROCK_MODEL` is set**, `RockModel` loads and normalizes it the same
way `PieceModel.jsx` handles a piece: Mint's own materials are discarded for
one shared procedural granite `MeshStandardMaterial` (`#6E6A62`, roughness
0.95, `flatShading: true`), `castShadow` stays off (it's the lowest thing in
the scene, nothing below it to shadow), `receiveShadow` stays on (it needs to
catch the board's own shadow). The actual fit — scaling so the model's flat
top sits exactly at the pedestal's `Y` and is a little wider than the board —
is a `TODO` in the file: measure the model's own geometry via `Box3` the way
`normalizeHeight()` in `PieceModel.jsx` does, rather than guessing constants
that would only happen to fit one specific export.

**Camera clamps are unaffected by design, not because nothing changed.**
`MIN_POLAR_ANGLE`'s whole history (0.838 rad down to 0.38 rad) was about a
fake continuous horizon showing its own edge at shallow angles — see
`GameCanvas.jsx`'s own comment on that constant. That horizon is gone on
purpose now; there is no ground-gap bulge left to clamp around at any angle,
because open sky beneath a floating rock is the intended read, not a bug.
The value is kept at 0.38 rad because the cinematic intro's low opening shot
and the original brief still want it, not because anything would break at a
smaller one.

**Untested against this change:** `IntroCameraRig.jsx`'s first shot
("Крізь туман") positions the camera outside the new pedestal's tiny radius
(~4.7, versus the old plateau's ~10.5-18) — flagged in that file's own
comment. If that shot reads as floating in open void rather than pushing low
across a landscape, it needs revisiting once the real rock model (or even
just the temporary pedestal) has been checked from that exact angle.

Roughness/normal-map generation (fbm-based canvas textures) still lives in
`components/proceduralTextures.js` for the two things that still use it — the
backdrop's edge alpha map and the board tile roughness — even though the
plateau-specific maps are gone. It's in `components/` rather than `lib/`
because it constructs `THREE.Texture` objects, and fbm itself is not tileable,
so anything with `repeat > 1` there uses `MirroredRepeatWrapping` — plain
repeat leaves a grid of seams.

## Intro

Крок 8, Section B replaced the old static title screen (a full-viewport dialog
with its own background art, blocking the canvas underneath) with a short,
looping cinematic. **The game is already mounted and running underneath from
the first frame** — the intro is a different camera and a transparent text
overlay on top of the exact same scene, not a second one. Doubling the scene
would double the load; see "Important" further down.

`GameCanvas.jsx` owns a three-state machine — `phase`: `'intro'` ->
`'transitioning'` -> `'playing'` — read once at mount from `sessionStorage`
(`initialPhase()`), so a repeat visit within the same session skips straight
to `'playing'`, same as the old title screen's dismissal memory. The two
non-`'playing'` states swap which camera owns the frame:

- **`'intro'` / `'transitioning'`**: `components/IntroCameraRig.jsx` mounts
  inside `<Canvas>` and drives `camera.position`/`camera.lookAt()` directly
  every frame — the same imperative-in-`useFrame` convention `CameraRig.jsx`
  already uses, and for the same reason (a per-frame `setState` would
  re-render the whole tree for the intro's 14-second loop). Real
  `OrbitControls` + `CameraRig` are **not mounted at all** during these two
  phases — not disabled, absent — because the three shots are scripted cuts
  (frame 2 orbits *around a piece*, not the board's centre) that a spherical
  orbit around one fixed target can't produce.
- **`'playing'`**: the usual `CameraRig` + `OrbitControls`, exactly as before
  Section B.

### The three shots

`IntroCameraRig.jsx`'s `FRAMES` array is three shots, each a straight
`lerpVectors` between a `from` and a `to` position/target pair, eased with
`easeInOutCubic` (`lib/easing.js` — shared with the board's own move
animation, see "Piece interaction"), not linear:

1. **"Крізь туман"** (0-5s) — low (`y ≈ 0.5-0.6`), near-level, pushing forward
   over the board. This is the shot Section A's ground extension exists for:
   at this height and pitch the camera looks almost straight across the
   plateau toward the horizon, which is exactly the angle that used to expose
   the bare-ground gap (see "Camera and environment" -> "Distance and polar
   clamps"). It would not have been possible to frame this shot cleanly before
   that fix.
2. **"Фігура виринає"** (5-10s) — close and side-on to the black knight on
   g8, a slow lateral drift around it.
3. **"Дошка згори"** (10-14s) — rises to a near-45-degree bird's-eye that
   reads the whole board: White's near half clear, Black's far half fogged.

The cut *between* shots is a 0.6-second crossfade through a warm near-black
wash (`#181510`, "чорно-кремовий" in the brief — a dark warm tone, not pure
RGB black), not a camera pan — panning smoothly from "close on a piece" to
"bird's-eye pull-back" would just be a fast, disorientating swoop, and a
hidden cut reads as intentional editing instead. `crossfadeAlpha(t)` computes
a triangular pulse (0.3s each side) centred on every boundary in
`CROSSFADE_BOUNDARIES` (`[0, 5, 10]`, plus the wraparound from 14 back to 0 —
the loop point is a cut too), and `IntroCameraRig` writes it straight onto a
DOM node's `style.opacity` via a ref (`overlayRef`) passed in from
`GameCanvas.jsx`, the same "mutate a DOM ref from inside `useFrame`, never
React state" pattern the crossfade and the hover-lift both use. That DOM node
(the actual wash `<div>`) lives in `GameCanvas.jsx`, *outside* the `<Canvas>` —
crossing the React-DOM/R3F boundary through a plain ref is fine, it's still
just a ref.

### Reusing the real fog-of-war instead of mocking it

The three shots don't get a separate, hand-authored "looks foggy" scene —
`GameCanvas.jsx` feeds `Fog` and `Pieces` a different `visibility` Set
per intro frame (`introVisibilityFor`), and the *real* fog shader and the
*real* piece-visibility rule (an enemy piece outside `visibility` isn't
rendered at all) do the rest:

- **Frame 0** uses an **empty** Set. Every square reads as fogged, including
  the ones holding White's own pieces (which always render regardless of
  visibility) — that's what gives "фігур майже не видно, тільки силуети"
  (pieces barely visible, only silhouettes) for free.
- **Frame 1** uses a Set containing exactly one square: `g8`, the black
  knight's home square. That makes the knight the *only* enemy piece that
  renders, sitting right at the fog mask's frontier — and the fog shader
  already thickens the visible/fogged boundary there (see "Fog" ->
  "Wisp structure"), which is exactly the "half in mist, half lit" edge the
  brief asked for. No extra shader work needed for it.
- **Frame 2** uses the real, live starting-position `visibility` computed the
  normal way in `GameCanvas.jsx`. The near-clear/far-fogged bird's-eye read
  isn't a mockup of the mechanic — it's the mechanic, rendered a beat before
  the player ever touches the board.

### The hand-off into gameplay

Clicking "Почати партію" (`components/IntroOverlay.jsx`'s button; `Escape`,
`Space`, and `Enter` do the same) sets `phase` to `'transitioning'`. An effect
in `IntroCameraRig.jsx` fires on that exact transition and captures wherever
the camera/target happened to be that instant as the start of a 1.2-second
`easeInOutCubic` move to `CameraRig.jsx`'s `basePositionFor(aspect)` /
`[0, 0, 0]` — the same resting position and target the game always opens on.
Once that move completes (`p >= 1`), `onTransitionComplete` sets `phase` to
`'playing'`, which unmounts `IntroCameraRig` and mounts real
`CameraRig`/`OrbitControls` in the same commit. Both sides target the exact
same `basePositionFor(aspect)`, so there is no pop at the hand-off.

`IntroOverlay.jsx` itself carries no background art (the old `TitleScreen.jsx`
did, and fully occluded the canvas — this is what "the intro is the same
scene, not a second one" meant to fix). It's a transparent, mostly
`pointer-events: none` layer — only the button is clickable — with the title,
a one-line statement of the mechanic, and a footer, all in fixed screen
position so the text stays completely still while the camera moves under it.
Dismissal is remembered per session via the same `sessionStorage` key the old
title screen used. Fonts come from `next/font/google` (Zen Old Mincho for
display, Inter for UI) and the palette lives in `styles/globals.css` as CSS
custom properties shared with the 3D scene.

### English, and a scrim instead of a shadow (Крок 9.6, Section A)

**The whole UI is English now** — the project ships to an English-speaking
client. `IntroOverlay.jsx`, `HUD.jsx`'s hint/tooltips/status-flash text are
all translated; check any new user-facing string against that before adding
Ukrainian anywhere outside code comments (comments documenting a Ukrainian
brief's own wording, e.g. quoting what a brief literally asked for, are fine
and already exist throughout this codebase — it's *player-visible* text that
has to be English).

**A `text-shadow` was never reliable here, and this pass replaced it with
something that is.** The intro's background is a moving camera shot (three
different scripted shots looping), not one static image — a shadow tuned to
read against fog might wash out against a bright sky frame, or the reverse.
`TextScrim` in `IntroOverlay.jsx` fixes contrast at its source instead: a
soft, heavily-blurred dark radial-gradient patch, sized a little larger than
its text and positioned first in DOM order (so normal paint order puts the
text on top with no `z-index` needed), that travels with the text rather than
depending on what's behind it at a given moment. Every text block in the
overlay (eyebrow, title+description+button, footer) gets its own `TextScrim`
wrapper; none of them carry a `text-shadow` anymore.

Typography follows the brief specifically: the title is uppercase, wide
letter-spacing (`0.25em`), weight 400 (not bold — restraint reads better
here than emphasis); the description is smaller, weight 400, normal tracking,
`opacity: 0.85`; the gap between them is tied to `TITLE_SIZE` (the same
`clamp()` expression reused for both the title's `fontSize` and the
description's `marginTop`) so the gap scales with the title rather than
needing a second breakpoint ladder. The "Begin" button is a thin 1px
`#C1440E` outline on a transparent background, filling solid on hover — a
small `<style>` block with a `.intro-begin-button:hover` rule, the same
"inject a scoped `<style>` tag" pattern `HUD.jsx` already uses for its status
flash keyframe, since inline styles can't express `:hover` on their own.

## The painted backdrop's top edge (Крок 9.6, Section B)

The backdrop segments (see "Multiple segments" above) faded at their sides
and bottom from the start, but not their top — `getBackdropEdgeAlphaMap` in
`proceduralTextures.js` only had `edgeFade` (U) and `bottomFade` (V near 0).
That read as a visible horizontal seam where the painting's top edge met
`SkyDome` behind it. `topFade = smoothstep(1.0, 0.82, v)` closes it,
symmetric to the existing bottom fade (also 18% of V). The 0.82 cutoff isn't
arbitrary: the source image's own flat sky only extends to ~20% down from its
top edge before the far ridges break in (the same luminance-profile
measurement `SKYLINE_FRACTION` was derived from), so fading out the top 18%
(down to V=0.82) stays inside that flat-sky band with a couple of percent to
spare — the fade dissolves empty sky, never a ridge line. If a future image
swaps in with a shorter flat-sky margin, the fix is widening the mesh's own
height, not pushing this fraction past ~0.8 (which would fade out actual
mountain silhouette instead of sky). Verified clean at both `minPolarAngle`
and `maxPolarAngle`, eight azimuths each.

### Important

Never build a second scene, mock board, or standalone camera rig for a future
cinematic moment (a win screen, a replay, anything like it). Reuse the
mounted `Board`/`Pieces`/`Fog`/`Backdrop` tree and drive it with a different
camera and a different `visibility` Set, the way this section does — that is
the entire reason the intro doesn't cost a second load.

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
- **The cinematic intro (see "Intro") now plays on every fresh session**,
  which means every other QA flow below that needs the live board — clicking
  a square, reading `visible: N / 64`, opening the promotion picker — has to
  get past it first. The fastest way in a script: navigate once, set
  `sessionStorage.setItem('dead-reckoning:intro-seen', '1')`, then navigate
  again (a plain in-page write doesn't retroactively change the phase this
  render already committed to). `window.__phase` (exposed under the same
  `?debug=1` hook as the camera/controls, see below) confirms which state a
  script actually landed in — `'intro'`, `'transitioning'`, or `'playing'` —
  without guessing from the camera position.
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
- `?debug=1` also exposes `window.__scene`/`__camera`/`__gl`/`__controls`/
  `__phase` (see "Camera and environment" -> "QA hook: exact camera placement
  from a script") — set `camera.position` directly and call `controls.update()`
  to test an exact spherical position, including ones that should get clamped.
  Note `__controls` is only populated once `__phase` reaches `'playing'` — see
  the bullet above.
- `?fen=4k3/8/8/8/8/8/8/4K3 w - - 0 1` (kings only) fogs 58 of 64 squares —
  the fastest way to get a large, clean area of deep fog to inspect the wisp
  shader's actual structure rather than guessing from the ~24-square starting
  position.

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
- Крок 8 found a second, sharper version of the same trap: even
  `page.mouse.click(x, y)` can freeze the whole R3F render loop dead in this
  environment (`useFrame` simply stops ticking — not the animation, everything)
  after landing on a real click, for no error the page or console ever surfaces.
  It reproduced on the intro's "Почати партію" button specifically: `phase`
  correctly flipped to `'transitioning'` (proven by reading `window.__phase`),
  but the camera stayed frozen at its exact pre-click position for 15+ seconds
  afterward. Confirmed environment-only, not a real bug: dispatching the same
  click **programmatically** — `button.click()` via `page.evaluate`, or raw
  `PointerEvent`/`MouseEvent` dispatch on `document.elementFromPoint(x, y)` for
  a canvas target that isn't a DOM element — completes normally every time,
  transition included. If a real user gesture needs to be simulated here,
  prefer a programmatic dispatch over `page.mouse.click` and don't conclude a
  hand-off or button is broken just because the mouse-driven version stalled.
- `drawImage` on the WebGL canvas reads back black (no `preserveDrawingBuffer`).
  To sample rendered pixels, screenshot with Playwright and decode the PNG in
  Node instead.
- `page.screenshot()`'s default 30s timeout is sometimes not enough even for
  an ordinary (non-splat) view under load from repeated navigations in the
  same session — pass an explicit longer `timeout` rather than assuming a
  timeout means the page hung.

Real-GPU performance cannot be measured from here. The fog shader is the thing
to watch if it ever needs profiling: one fbm plus two ridged-noise evaluations
(five octaves each) per pixel, across two stacked sheets — the same order of
cost as the fbm-plus-domain-warp version it replaced, not a new regression on
its face, but unverified on real hardware.

## Dev-server gotcha

This stack (multi-MB Draco `.glb` + r3f) makes `next dev` HMR unusually
fragile. After a burst of rapid edits it can start serving stale modules,
phantom geometry, or 500s with
`SyntaxError: Unexpected non-whitespace character after JSON` from a
half-written `.next` manifest. **Before debugging a weird visual artifact,
kill the server, `rm -rf .next`, and restart** — that has already resolved
three "bugs" that did not exist in the source. The third, from Крок 9: an
entire session's worth of screenshots showed `SkyDome`, the painted backdrop,
and `Plateau`'s stone all rendering as a single flat, uniform grey — read at
the time as "this headless environment's software rasterizer can't shade
these," and written up as such. It wasn't that. A `rm -rf .next` + restart
later in a subsequent session, prompted by unrelated repeated
`page.evaluate: Execution context was destroyed` errors (themselves caused by
Fast Refresh full-reloads mid-script), made the exact same background
suddenly render its real gradients and the painted valley in full colour, no
code changes involved. **Don't trust a "the renderer can't do this" verdict
reached without first ruling out a stale `.next` build** — it's a much
cheaper thing to eliminate than it is to design around.

Run `npm test` (Node's built-in test runner, no extra deps) to check
`lib/visibility.js` — it asserts the starting position gives white exactly
24 visible squares (16 occupied + 8 pawn-attacked) and that pawns don't leak
their push-square into their vision.

Player is always white. `Board.jsx` only lets you select `color === 'w'`
pieces and only while `turn === 'w'` and the game isn't over.
