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
| White piece ("bone") | `#DDD3BE`, roughness `0.58`, metalness `0`, clearcoat `0.8` (Крок 13 — see "3D models") |
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

`components/PromotionModal.jsx` — a plain HTML modal (2x2 grid of buttons,
one per promotion piece), rendered in `GameCanvas.jsx` outside the `<Canvas>`
tree, the same layer HUD lives in. The player's promoting move is **not
played when the square is clicked** — `Board` holds it in `pendingPromotion`
and the pawn stays put, so Esc or a click past (or a click on the modal's own
scrim) costs nothing. The AI still auto-queens (`makeMove`'s `promotion`
defaults to `'q'`), which is what a greedy AI would pick anyway.

**Крок 13: replaced the old 3D `PromotionPicker`** (a floating row of real
piece models above the promoting square, yawing to face the camera every
frame). That component needed a real derivation just to stay on screen — see
git history on the deleted file for the `SCALE`/`LIFT`/`PULL` reasoning it
took to keep it from being cropped by the frame on the far rank — and still
had to fight the camera on every move. A flat HTML modal has none of that: it
is always centred and always the same size regardless of where on the board
the pawn promotes or how the camera happens to be oriented. `Board.jsx` still
owns `pendingPromotion` state and the actual `makeMove`/`clearSelection`
closures — it just hands the whole `{square, onPick, onCancel}` bundle
upward via `onPendingPromotionChange`, mirroring how `onSelectedChange`/
`onHoveredChange` already lift selection state to `GameCanvas`, rather than
`GameCanvas` trying to re-derive Board's own completion logic.

The modal's four options use the "black chess piece" Unicode glyphs
(♛♜♝♞), not "white" (♕♖♗♘), despite every option being one of the
player's own (white) pieces — purely a rendering choice: in essentially every
font implementing this block, the "white" code points render as hollow
outlines and the "black" ones render as solid silhouettes, independent of CSS
`color`. A solid dark glyph is what actually reads clearly against the modal's
light bone-coloured buttons.

`useChessGame.isPromotion(from, to)` reads chess.js' `flags` for `'p'`. Deriving
it from the destination rank instead would also fire for a rook or queen simply
arriving on the back rank. `lib/rules.test.js` pins both that flag and the
`promotion:` code -> piece mapping.

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
module-level material singletons (`BONE`/`LACQUER`, see "3D models") — cheap,
but it means animating opacity on one piece would fade every piece of that
colour.
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
- **Checkmate gets a dedicated flash** — `StatusFlash` — the board's own ember
  (`#C1440E`), large, centred at the top of the frame, with a brief
  `hud-status-flash` keyframe fade-in.
- **Крок 13: there is deliberately no "Check" flash, and no "Check — X to
  move" status text either** — both existed before this pass and were
  removed. The fog hides enemy pieces the player hasn't seen move; a check
  warning announces "something you can't see is attacking your king"
  regardless of whether the attacker itself is actually visible, which leaks
  exactly the information fog of war exists to withhold. A player who never
  spots the attacker can now walk straight into a checkmate — status
  `'check'` still exists in `useChessGame`'s state machine (chess.js's own
  legal-move filtering already prevents a player from making a move that
  leaves their own king in check, so the state is still needed for that), it
  is just never surfaced in the HUD. `status === 'checkmate'` still gets the
  flash and the status line's win message, since the game has genuinely ended
  at that point and there is nothing left to withhold.
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

### Крок 16, Section D: theme switching mid-game

Before this pass, a theme could only be picked from `IntroOverlay`'s
`ThemePicker` (title screen) or reached again via `GameOverScreen`'s "Change
Theme" (which routes back to the title screen and starts a brand new game).
Both of those still exist and still reset to a new game on purpose — Section
D adds a **third**, additive entry point: a small palette-icon button
(`ThemeSwitcherButton`, `HUD.jsx`) in the same bottom-right corner cluster as
sound/new-game, visible whenever `showGameplay` is true, that switches the
visual theme **without** starting over.

**Why this is still a full page navigation, and why that isn't a compromise
on "the game state is preserved".** Every themed module in this codebase —
`lib/fog.js`, and `lib/themes.js`'s own consumers (`PieceModel.jsx`,
`RockIsland.jsx`, `Board.jsx`, `Backdrop.jsx`) — reads `themeKeyFromUrl()`
exactly once, at module load, into a module-level constant (`lib/themes.js`'s
own header comment already documents this as deliberate: "picking one is a
real page navigation... not a React state change"). A `history.pushState`
without a reload would leave every one of those modules holding the *old*
theme's colors/models forever; making them reactive instead is a real
architectural change (context or props threaded through every themed file)
and not what this task is. So the button still navigates — but it now carries
the **current position** across as `?fen=` (chess.js's own FEN string,
`game.fen()`, threaded from `GameCanvas.jsx` into `<HUD fen={...}>`), reusing
`useChessGame`'s existing `initialFen` QA hook (see "QA hooks") rather than
adding a second mechanism. The reload lands on a fresh `Chess()` at the same
position, same turn, same castling/en-passant rights — everything that's
either visible on the board or affects legal moves going forward.

**What does *not* survive is chess.js's own move-history array — and nothing
downstream needs it to.** It only ever feeds two things: the move/capture
sound trigger (`GameCanvas.jsx` compares `history.length` against its own
last-seen ref, which also resets to 0 on the fresh mount, so no false
triggers) and the fog wave's origin square (`lastMove` is `null` right after
the reload, which the wave-scheduling code already treats as an ordinary,
handled case — "no wave origin, just settle in place" — not an error; see
"Fog" -> Крок 10 Section C). `INTRO_SEEN_KEY` in `sessionStorage` is untouched
by this reload, so the player lands straight back on `phase: 'playing'`, not
the intro cinematic — the switch reads as "the world changed," not as "the
game restarted."

**The fresh Fog mount this produces is exactly the case Крок 16 Section A
was built for.** A theme switch's reload gives `FogShader` an empty
`prevVisible` (a fresh mount), the same `isInitialReveal` path a first game
start or "Play Again" takes — and Section A's seeded-mask fix means that
reveal is no longer a flash of full fog before settling, it's already close
to correct on the very first frame. These two sections compound for free,
not by coincidence.

**The cooldown survives the reload on purpose — it has to.** Storing "last
switched at" only in React state would reset to zero on every remount,
making a cooldown that's defeated by the very navigation it's supposed to
gate pointless. `THEME_SWITCH_COOLDOWN_KEY` in `sessionStorage` holds a wall-
clock timestamp; `remainingThemeSwitchCooldownMs()` re-derives the remaining
time from `Date.now()` on a 100ms poll rather than counting down a local
timer, so it stays correct across a backgrounded tab and, critically, across
the reload the button itself triggers. The button shows a numeral
(`Math.ceil(remaining/1000)`) in place of the 🎨 glyph and a `conic-gradient`
ring that depletes clockwise over `THEME_SWITCH_COOLDOWN_MS` (10s), and is
`disabled` for the same span — the panel can't even be opened mid-cooldown,
not just "clicking a theme does nothing."

Picking the theme that's already active is a no-op (closes the panel,
doesn't navigate or spend the cooldown) — `ThemeSwitcherButton` checks the
clicked key against `themeKeyFromUrl()` before calling `switchThemeMidGame`.

## Asset budget (Крок 12, Section A) — read this before profiling anything else

**Every model Mint delivered was exactly 500,000 triangles.** That is a cap on
Mint's side, not a number anyone chose. Measured straight off the `.glb` JSON
chunks (accessor `count`s stay correct under Draco):

```
bishop 499,998   king 499,998   knight 500,000   pawn 499,998
queen  500,000   rook 500,000   granite-pine-aerie 500,000
```

32 pieces on the board = 16,000,000 triangles, plus 500k for the rock, and that
geometry is submitted **three times per frame**: the key light's shadow map, drei
`<ContactShadows>`' depth pass (which re-renders continuously), and the colour
pass. **~49.5 million triangles per frame**, ~3.0 billion/second at 60fps, for a
chess set where no piece is more than a couple of hundred pixels tall. That —
not the fog shader — is why a 4060 sat pinned at 90%. The scene was
geometry-bound, and no amount of shader tuning touches it.

`tools/decimate-models.mjs` fixes it. Measured in-browser via `window.__scene`
traversal, opening position: **8,502,106 → 160,102 triangles per pass** (the
start position renders 16 white pieces + rock; Black's are inside fog and not
drawn). Download: **32 MB → 1.9 MB**.

Two things about that tool are load-bearing:

- **The `Permissive` simplifier flag.** These exports are not clean manifolds.
  `tools/diagnose-mesh.mjs` measures it: the knight welds to 418,533 verts for
  500,000 triangles (a closed manifold would be ~250,000), shatters into
  **38,146 disconnected components of which 37,251 have under 10 vertices**, and
  carries 269,120 boundary edges. Ordinary edge-collapse has almost nothing it
  is allowed to collapse, so it stalls at ~21% and `error` makes no difference
  whatsoever past 0.001 (knight at ratio 0.006: error 0.001 → 111,268 tris;
  error 0.3 → 107,784, a hard topological floor). `@gltf-transform/functions`'
  `simplify()` only surfaces `lockBorder` and never passes meshopt's other flags
  through, so the tool wraps the simplifier to inject them. With `Permissive` the
  target is reached exactly. **If a regenerated export won't decimate, this is
  why.**
- **Pieces drop TANGENT, TEXCOORD_0 and all three baked textures.**
  `PieceModel.jsx` replaces every piece material with the shared BONE/LACQUER
  `MeshStandardMaterial`, which has no normal map — so those were downloaded,
  decoded, and uploaded to the GPU purely to be discarded. The **rock is
  deliberately excluded**: Section D below now *uses* its baked maps.

Originals are preserved in `assets-src/models-original/` — gitignored and
outside `public/`, like `mountains-source.png`. The tool refuses to run twice
(a second pass would decimate the already-decimated file) and never overwrites
a backup. `node tools/decimate-models.mjs` alone is a dry run; `--write` applies.

Also `next.config.mjs` now pins `outputFileTracingRoot` to the project. Without
it Next found an unrelated lockfile in a parent directory, handed that to
Watchpack, and Watchpack recursively scanned the whole `D:` drive — producing
`lstat 'D:\System Volume Information'` errors and then killing the dev server
outright with `RangeError: Array buffer allocation failed`. It presents exactly
like the flaky-HMR failure in "Dev-server gotcha" below and is **not** fixed by
clearing `.next`, because the cause is outside the project.

## 3D models

Six Draco-compressed `.glb` files in `public/models/`, named exactly
`king|queen|rook|bishop|knight|pawn.glb`. **There is one file per piece
type — both colors reuse the same geometry**, cloned per instance and
re-materialed. If a piece looks "wrong" on one square but right on another,
it is the viewing azimuth, not a second model; verify with `md5sum` before
chasing a phantom duplicate.

They are ~8,000 triangles each as of Крок 12 — see "Asset budget" above before
concluding a silhouette looks wrong for some other reason.

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
  shared `BONE` / `LACQUER` material and sets castShadow + receiveShadow.
  Mint's own textures/materials are always discarded.

Board position goes on a wrapping `<group>`, never on the `<primitive>`
itself — the primitive carries the normalization transform and must not have
it overwritten.

**Крок 13: BONE is `MeshPhysicalMaterial` now, not `MeshStandardMaterial`,**
specifically for a thin `clearcoat` layer (`0.8`, `clearcoatRoughness 0.08`).
White pieces were reported as looking "raw" next to the black ones — the
LACQUER material already looks finished because a specular highlight is
visually loud against its near-black diffuse base; the same highlight on
BONE's light base just blends into the colour already there. Lowering
`roughness` alone (tried down to 0.34) barely helped for that reason. A
clearcoat is a second, independent Fresnel reflection on top of the diffuse/
roughness response, so it reads as a polished-ivory skin regardless of how
light the material under it is. `roughness` stays fairly high (0.58) so the
body of the material is still matte bone/stone, not plastic; `metalness`
stays `0` — bone is a dielectric, clearcoat is what's doing the work.
**`flatShading` stays `true`** — also tried `false` (letting the model's own
imported normals drive smooth shading) on the theory that BONE's visible
facet edges read as more "unfinished" than LACQUER's; screenshot proved the
opposite, since the decimated mesh is exactly as non-manifold as "Asset
budget" documents (the knight alone has 38,146 disconnected components) and
smooth shading across it produced mottled dark blotches on every piece,
worse than flat. flatShading is not the source of the raw-vs-finished gap.

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

## Крок 13: theme system (Mist / Ocean Depths / Snow Blizzard)

Two more Mint-generated piece sets shipped, alongside a snow-themed Gaussian
splat. This pass turned the previously-hardcoded Mist look into three
selectable themes rather than bolting a second set on next to it.

**`lib/themes.js` is the registry.** One entry per theme (`mist`/`ocean`/
`snow`), each carrying: `modelDir` (`/models/<theme>/`), `board.light`/
`board.dark`, `accent` (the move/check highlight), `pieceWhiteColor` (the
BONE-equivalent body tint), `rockTint`, `fog` (`shadow`/`lit`/`tint`/`color`),
and `backdrop` (`{ mode: 'image' | 'splat', splatUrl? }`). `themeKeyFromUrl()`
reads `?theme=` once — same read-once-at-module-load convention every other
tuning hook in this codebase already uses (`PieceModel.jsx`'s
`boneTuningFromUrl`, `Backdrop.jsx`'s `readTuning`) — and every themed module
(`PieceModel.jsx`, `RockIsland.jsx`, `Board.jsx`, `lib/fog.js`,
`Backdrop.jsx`) calls it independently at module scope rather than threading
a prop through the tree. There is no live in-session theme switch; picking a
theme is a page-load decision, same as every other `?`-prefixed tuning knob
here. `?theme=` absent or unrecognized falls back to `mist`
(`DEFAULT_THEME`).

**Asset layout**: `public/models/<theme>/{king,queen,rook,bishop,knight,pawn,
rock-island}.glb` — one directory per theme, identical basenames across all
three. `lib/pieces.js` no longer owns model paths at all; it only keeps
`PIECE_SCALE` and `PIECE_HEIGHTS` (renamed from `PIECE_CONFIG`, dropped the
per-type `model` field), the proportion ladder derived against Mist's own
models (see "3D models" above) and **deliberately reused as-is** for the new
sets rather than re-derived — per Крок 13's own brief. Verified via
`/dev-pieces?theme=ocean` / `?theme=snow`'s `window.__pieceMeasurements`: every
piece's `halfWidth` stays well under the 0.5 clearance ceiling (worst case
0.401 today, Mist's own knight), so the shared ladder does not reopen the
knight-clearance problem "3D models" documents for a different geometry.

**Both new sets arrived as raw ~500,000-triangle Mint exports** (matching
"Asset budget"'s Крок 12 numbers exactly), not pre-decimated the way Mist's
`public/models/mist/*.glb` already were — `tools/decimate-models.mjs` only
ever knew about one flat `public/models/` directory. It's now theme-aware
(`THEME_DIRS`, mirrored into `assets-src/models-original/<theme>/` so the
identical basenames across themes don't collide in one backup folder) and the
guard that refuses to double-decimate is now evaluated **per theme**, not
globally, so re-running it after adding a fourth theme only touches the new
one. `node tools/decimate-models.mjs --write` was run once for this pass:
ocean and snow's 12 pieces went 500,000 → 8,000 triangles each (~4-6 MB →
~30-40 KB) and their rocks went 500,000 → 30,000 (~5.5/6.5 MB → ~500 KB/2.4
MB, the rock keeping Mint's baked textures same as Mist's — see "Крок 12,
Sections B & D"). Skipping this would have reintroduced the exact
geometry-bound problem "Asset budget" fixed, times two more sets.

**Rock basin fit is per-theme, not shared.** `RockIsland.jsx`'s
`ROCK_FIT_HALF_WIDTH`/`ROCK_FLOOR_Y_RAW` (now `ROCK_FIT`, keyed by theme) came
from Mist's own `granite-pine-aerie` basin geometry and do not transfer to
`basalt-kelp-ledge` (ocean) or `frosted-granite-ledge` (snow) — different
models, different basin shape. Re-measured each with `tools/measure-rock.mjs
public/models/<theme>/rock-island.glb` (same "rasterise triangles into a
top-surface heightfield, not a Box3, not vertex binning" method as Mist's
original derivation):

| theme | half-width | floor Y | note |
|---|---|---|---|
| mist | 0.46 | 0.417 | original derivation |
| ocean | 0.37 | 0.271 | much shallower relief than mist (raw rim only ~0.07 above floor) — reads as a flat kelp-covered ledge, not a deep bowl |
| snow | 0.41 | 0.577 | closer to mist's own proportions (X/Z aspect 1.161 vs mist 1.164) |

`ROCK_SCALE_Y` for ocean/snow reuses Mist's own Y/XZ **anisotropy ratio**
(0.7785), not Mist's absolute `ROCK_SCALE_Y` — copying the raw number would
not preserve the same "wide, shallow bowl" proportions on a differently-scaled
basin. This is a **proportionate default, not a re-derivation**: unlike
Mist's `ROCK_SCALE_Y` (independently checked against `MAX_POLAR_ANGLE`'s
camera clearance — see "RockIsland" above), ocean/snow's Y scale has not been
verified against that clearance the same way. Both landed with generous
headroom by inspection (ocean's rim sits only ~0.65 world units above the
board; snow's is proportionally similar), but flag this before relying on it
if a rim ever reads wrong at a shallow camera angle in either theme.

**Board/fog/accent colors came from the user, piece/rock tint did not.**
Given palette:

| theme | light square | dark square | accent | fog anchor |
|---|---|---|---|---|
| ocean | `#B8CCC8` | `#3C5A56` | `#4FD0C4` (pale cyan "bioluminescence", not cinnabar — reads better against a cold palette) | `#2A4A48` |
| snow | `#E8EEF0` | `#7A8A94` | `#C1440E` (same ember as mist — warm against a cold world is a deliberate contrast, not a mismatch) | `#DDE6E8` |

Piece white-body color reuses each theme's own light-square hex (confirmed
with the user rather than inventing a third independent value); black pieces
stay `#0E0E10` LACQUER everywhere, unthemed — legibility of "which color is
which" was judged more important than per-theme tinting the AI's pieces.

**Fog color derivation (`fogPaletteFor` in `lib/themes.js`) is a hue/
saturation retint, not four hand-picked hex values.** The fog shader only has
three *live* color uniforms left after Крок 12's rework — `FOG_SHADOW_COLOR`,
`FOG_LIT_COLOR`, `FOG_TINT_COLOR` (`FOG_DEPTH_COLOR_LOW/HIGH/MID` are dead,
superseded, unread by `FogShader.jsx` — confirmed by grepping the shader
file, not assumed). Rather than pick three new hex values per theme and risk
breaking the SHADOW-darker-than-LIT ordering or the luma budget
`tools/fogdiag.mjs` verifies, `fogPaletteFor(anchorHex)` takes each of Mist's
own three constants, keeps its **lightness** exactly as Mist tuned it, and
replaces only hue/saturation with the anchor color's. `tools/fogdiag.mjs`'s
occlusion/leak test is alpha-driven and measures luma, not hue, so this is
safe by construction — re-verified after wiring:

| theme | fogged mean / max luma leak | clear-square light/dark delta |
|---|---|---|
| mist (baseline, unchanged) | 2.17 / 4.49 | 36.69 |
| ocean | 3.54 / 3.89 | 52.85 |
| snow | 2.70 / 4.99 | 24.18 |

All comfortably inside the ≤6-luma occlusion budget (`FOG_MAX_ALPHA` 0.94),
and every theme's board still reads as an obvious chessboard. Rerun with
`THEME=ocean node tools/fogdiag.mjs` (the script now takes a `THEME` env var,
defaulting to mist so existing invocations are unchanged).

**Rock tint** (`RockIsland.jsx`'s `applyRockMaterial` multiply color, `#B9B4A8`
for Mist) is retinted the same way, anchored to each theme's own dark-square
hex — not given by the user, a judgment call to keep the rock coherent with
its board rather than universally warm-grey.

**A pre-existing discrepancy, left alone on purpose**: `PieceModel.jsx`'s live
BONE color is `#a08c55` (changed in the Крок 14 commit, apparently
undocumented — Крок 14's own written notes don't mention a color change), not
the `#DDD3BE` the "Palette" table above still documents. `lib/themes.js`'s
`mist.pieceWhiteColor` mirrors the live `#a08c55` value deliberately (the
registry describes what ships, not what the palette table says) — the
discrepancy itself is a separate, not-yet-investigated question, flagged here
so it isn't rediscovered as a surprise.

### Крок 13: a second splat — snow, and this one shipped enabled

`public/ink-wash-snow-plateau-f20dac755e66664b.spz` — Mint's delivered
filename, **not** renamed to the brief's assumed `public/world/snow.spz`, kept
at the `public/` root next to the existing mountain-valley splat
(`sumi-e-mountain-valley-*.spz`) for the same reason that one lives there. At
33,359,263 bytes (~31.8 MB) it lands in the brief's own "flag and wait, don't
auto-integrate" band (25-60 MB) — flagged, and the user chose to integrate it
anyway rather than defer.

**Wiring reuses the exact `SplatBackdrop.jsx` pattern Mist's own (disabled)
valley splat already established** (see "Gaussian splat backdrop" above) —
`SplatBackdrop` just gained a `url` prop (default preserved for backward
compatibility) instead of a hardcoded `SPLAT_URL` constant, so both splats
share one component. `Backdrop.jsx`'s `BACKDROP_MODE` constant is now scoped
to **Mist's own content only** (the painted valley segments + Mist's splat
rollback) rather than a global switch; any theme other than mist always
renders the procedural `Mountains` shells as its base regardless of that
constant, and a theme's own splat (`THEMES[key].backdrop`) layers on top of
that base — never replacing it, same "never throw upward" contract. Ocean's
`backdrop.mode` is `'image'` (i.e., just the procedural floor, no splat this
pass — the `ink-wash-sea-canyon-*.spz` file present in `public/` is out of
scope for Крок 13 and untouched).

**The brief's 4-second load budget is implemented as a mechanism, not
verified against a real device.** `ThemedSplatBackdrop` (`Backdrop.jsx`)
starts a timer on mount; if `window.__splat` hasn't reached `state: 'ready'`
within `SPLAT_LOAD_BUDGET_MS` (4000), the component unmounts itself and the
procedural floor already underneath is what stays on screen. This environment
cannot produce a real measurement — see "Headless browser" below, the
software rasterizer here runs at ~1fps regardless of payload and cannot
distinguish a fast load from a slow one — so the number is unverified against
"production, cold cache" the way the brief asked. `window.__splat` (already
exposed by `SplatBackdrop.jsx`) confirmed a full local load reaching
`{state: 'ready', count: 1920000}` in this environment, which at minimum
proves the mechanism itself (fetch, decode, upload, `ready` promise) is wired
correctly — not that it lands inside 4 real seconds on a cold cache.

**No bespoke painted snow frame exists for the `'image'` fallback path.** The
brief suggested extracting a preview frame from the same `.spz` as a `.jpg`;
there is no frame-extraction tooling in this pass, so `THEMES.snow.backdrop.
fallbackMode` is `'procedural'` — the generic `Mountains` ridge shells, not a
snow-specific painting. Worth a real Mint-generated still frame later if the
generic fallback (visible whenever the splat times out or errors) reads as a
mismatch.

## Крок 17: fog flashed fully-fogged specifically on the Start-button transition

Reported as "own pieces briefly appear under fog when starting a new game."
Крок 16 Section A's fix (seed the mask's `effective` array from the real
starting `visibility` instead of a blanket "everything hidden" fill) held up
for a fresh page load with the intro pre-skipped, but not for the actual
everyday path: clicking "Begin" on the intro screen. Reproduced identically
against both `next dev` and a production `next build` via a real Start-
button click (`.intro-begin-button`, dispatched programmatically per the
"Headless browser" section below), so this is not a Strict Mode artifact.

The cause: `<Fog>` doesn't exist in the tree during `'intro'`/
`'transitioning'` (Крок 12, Section B — no fog on the intro) and mounts for
the first time exactly when phase flips to `'playing'`, **into an r3f render
loop that has already been ticking `useFrame` for several seconds** (the
intro camera rig's own animation). A fresh page load has enough natural
startup latency (WebGL context setup, model loading via Suspense) that
`FogShader`'s mount-time wave-scheduling `useEffect` reliably runs before the
first `useFrame` tick. Mounting into an already-spinning loop has no such
guarantee — a `useFrame` call landing before that `useEffect` reads the
untouched `Float32Array` defaults (`oldValue`/`newValue` both 0) for every
square, including ones just seeded to `effective = 1`, and overwrites them
back to 0. By the time the scheduling effect *does* run, it reads that
already-corrupted 0 as the wave's `oldValue`, schedules a real 1.4s
reveal-from-black, and the player's own pieces spend that whole span under
fog. Confirmed empirically via `window.__fogWave` (see "QA hooks"): a real
Start click showed `oldValue: 0, newValue: 1` for a starting-visible square,
where a plain page load showed `oldValue: 1, newValue: 1` (a no-op) for the
same square.

Fixed by making the mask-building `useMemo` fully self-sufficient: it already
runs synchronously during render, strictly before any paint or `useFrame`
callback can fire, so it now seeds `oldValue`/`newValue`/`prevVisible` there
too, not just `effective`. With `prevVisible` pre-populated to match the real
starting `visibility`, the scheduling effect's `wasVisible === isVisible`
check skips every square on its first run — nothing is scheduled, because
the seed already put every square exactly at its target. Verified fixed
against a production build via the same real Start-click method: `oldValue:
1, newValue: 1, effective: 1` on the very first readable frame.

## Крок 18: the splat/painted-backdrop question resolved per theme

Ocean and Snow briefly gained Gaussian-splat backdrops during this pass
(matching Snow's existing one), diagnosed and fixed two real issues along
the way — Mist's own splat capture is actually Y-up already (unlike Snow's,
which needed the documented `rotX -90` fix), so copying Snow's correction
onto Mist was itself the bug, not a fix; and post-load splat count reduction
via Spark's `constructSplats` hook (`SplatBackdrop.jsx`'s `downsampleSplats`,
default keeps 35%, `?spkeep=` overrides) is a real, verified VRAM/perf lever
that survives for any splat re-enabled later.

Both were reverted anyway before shipping: a real device reported 20fps and
90% VRAM usage with a splat active, a cost this headless environment cannot
verify or contradict (see "Headless browser"), and Mist's own capture was
independently found to have already been attempted and abandoned three
times before the theme system even existed (see the Gaussian splat backdrop
section above — scale 12, 2, and 1 all rejected). Two more reasoned
placement attempts this pass (identity rotation, scale/offset aimed at the
capture's own documented open-ground region) still read as cluttered rather
than a clean vista under the island. Not worth further time under a real
performance signal already pointing away from splats as the default for
three themes at once.

**Instead, every theme now has its own painted panorama**, closing the gap
where only Mist had one and Ocean/Snow fell back to the generic procedural
`Mountains` ridges. Two new Mint-generated sumi-e images
(`public/textures/ocean-valley.png`, `public/textures/snow-valley.png`,
matching Mist's `mountains.jpg` in style but not in aspect ratio — Mint
doesn't guarantee one across separate generations) plug into the *same*
segment mechanism Mist's painting already used (`BACKDROP_SEGMENTS`, two
mirrored copies of one frame to close the full 360-degree orbit — see
"Крок 9.5, Section B" above), which `Backdrop.jsx` generalized from
Mist-only to theme-generic: `USES_PAINTING` now checks
`ACTIVE_THEME.backdrop.image` instead of `ACTIVE_THEME_KEY === 'mist'`, and
`ImageBackdropSegment` derives its cylinder height from the *loaded
texture's own* `image.width`/`image.height` instead of one hardcoded
`IMAGE_ASPECT` constant, since the three images are no longer the same
shape. `BACKDROP_MODE`, `IS_MIST`, and `USES_MIST_SPLAT` are gone — a single
`USES_THEME_SPLAT` check (still `mode === 'splat'`, currently true for no
theme) covers every theme uniformly now.

All three themes' `backdrop.splat` transforms are left in `lib/themes.js`
as a starting point, not deleted — re-enabling any one of them later is a
one-line `mode: 'image' -> 'splat'` change, same as before this pass, should
a real-device perf budget ever justify it.

## Крок 19: theme is a live prop now, not a frozen module constant

Reported as "switching themes mid-game freezes the page — needs a manual
refresh." The mechanism (HUD.jsx's mid-game switcher, `IntroOverlay.jsx`'s
own picker) was always `window.location.href = url` — a genuine full browser
navigation, not a bug in the navigation call itself. Every themed module
(`lib/fog.js`, `PieceModel.jsx`, `RockIsland.jsx`, `Board.jsx`,
`Backdrop.jsx`) read `themeKeyFromUrl()` exactly once, at its own module
load, into a frozen constant — a `pushState`/`replaceState`-only change
could never have reached any of them, so a real reload was the only way a
picked theme actually took effect. That architecture is what Крок 13/16's
own comments already flagged as deliberate: "a real page navigation... not a
React state change... converting every module into a reactive read is a
real architectural change, not this task." This pass is that change.

**`themeKey` now lives in `GameCanvas.jsx` as plain `useState`, threaded down
as a prop exactly the way `selectedSquare`/`hoveredSquare`/
`pendingPromotion` already are** — not React Context, deliberately: r3f
mounts `<Canvas>`'s children through a second, separate reconciler root, and
plain React Context does not cross that boundary unless re-provided inside
it. Prop drilling through `GameCanvas` (which already sits above both the
DOM/HUD tree and the `<Canvas>` tree) sidesteps the question entirely and
matches this codebase's own established convention for exactly this kind of
cross-cutting state.

**Every module that used to freeze `ACTIVE_THEME`/`ACTIVE_THEME_KEY` at
import time now derives the same values from a `themeKey` prop, memoized
with `useMemo`/`useEffect` instead of computed once:**

- `lib/fog.js` exports a new `fogColorsForTheme(themeKey)` alongside the old
  frozen `FOG_COLOR`/`FOG_TINT_COLOR`/`FOG_SHADOW_COLOR`/`FOG_LIT_COLOR` —
  the frozen ones are kept only for `FogLayer.jsx` (tier 1, the documented
  non-live rollback); `FogShader.jsx` (tier 2, the active implementation)
  calls the function instead. The fog's three colour uniforms
  (`uColorShadow`/`uColorLit`/`uTint`) are genuinely cheap to update in
  place — no shader recompile, no material recreation — so a theme switch
  just calls `.set()` on each in a `useEffect` keyed on `themeKey`.
- `PieceModel.jsx` takes `themeKey` as a prop (threaded through
  `Pieces.jsx`'s `AnimatedPieceGroup`/`CaptureGhost`). `pieceModelPath
  (themeKey, type)` changing is what actually swaps the geometry — `useGLTF`
  is keyed by URL in drei's own loader cache and already suspends/resolves
  through React Suspense, which is exactly the reactive path a changing URL
  prop needs, no different in kind from the very first mount. The shared
  `BONE` material singleton (every white piece points at the same object) is
  recoloured in place via `syncBoneColorToTheme(themeKey)`, called from a
  `useEffect` in every mounted `PieceModel` — redundant across up to 32
  pieces, but the assignment itself is a trivial `THREE.Color.set`, not
  worth hoisting to one shared call site for this.
- `RockIsland.jsx`'s `deriveRockConfig(themeKey)` replaces five frozen
  constants (`ROCK_FIT_HALF_WIDTH`, `ROCK_SCALE_XZ`, `ROCK_SCALE_Y`,
  `ROCK_Y_OFFSET`, plus the emissive/tint pair) with one function indexing
  the *same* per-theme lookup tables (`ROCK_FIT`, `ROCK_ALBEDO_MEAN_LUMA`,
  `ROCK_THEME_EMISSIVE_FLOOR`) that already existed keyed by theme — this is
  a mechanical "look the value up with a variable key instead of a frozen
  one" change, not a re-derivation of any of the fit/tint numbers themselves.
- `Board.jsx`'s LIGHT/DARK/HIGHLIGHT colours are computed in a `useMemo`
  keyed on `themeKey` instead of at module load.
- `Backdrop.jsx`'s `USES_PAINTING`/`USES_THEME_SPLAT`/segment array are all
  now derived via `deriveBackdropConfig(themeKey)`/`backdropSegmentsFor(...)`
  inside the component, memoized on `themeKey`. The image-readiness probe
  (`imagesReady`) resets to `false` and re-probes whenever the theme's own
  segments change, so a switch shows the fast `Mountains` fallback for the
  brief window before the new theme's painting is confirmed loaded, rather
  than either flashing the previous theme's painting or skipping the
  fallback window entirely.

**Verified this is a genuine live switch, not just "the freeze went away,"**
using the same kind of internal-state read this codebase already relies on
for the fog wave system (see "QA hooks"): `window.__fogWave.current.clock`
was read immediately before and after a live switch and found to have kept
increasing continuously across it (3.05s -> 7.36s in one run) — a real page
reload, or even a React-level remount of the fog tree, would have reset that
clock to ~0. Also confirmed via Playwright's own `framenavigated` event and
`window.__phase`: a `history.replaceState` call (the URL-sync side effect,
kept purely so the page stays bookmarkable at its current theme) does fire a
same-document `framenavigated` event, but `window.__phase` never became
`undefined` at any point — the tell a real full-page reload would leave,
since that destroys and recreates the whole JS context. Checked against both
directions (mist -> ocean, ocean -> snow) and against a `next build`
production bundle, not just `next dev`.

The mid-game switcher's cooldown (`HUD.jsx`) dropped from 10s to 2s and from
`sessionStorage`-backed to plain component state — the old duration and
persistence-across-reload existed specifically to survive the *reload the
switch itself used to trigger*, which no longer happens; the cooldown that's
left only exists to stop rapid re-clicking from queueing overlapping
GLTF/texture loads for several themes at once.

## Крок 19: fog-of-war onboarding

First-time players had no in-game explanation for why pieces disappear or
get captured by something never seen on screen — `HUD.jsx`'s new
`FogOnboarding` shows two short, dismissible cards (top-right, matching the
existing corner-panel visual language) the first time `showGameplay` becomes
true: one on the vision rule ("you only see squares your own pieces
control"), one on the ambush rule ("a hidden enemy can still capture you").
Persisted via `localStorage` (`dead-reckoning:fog-onboarding-seen`), not
`sessionStorage` like `INTRO_SEEN_KEY` — this is "has this player ever been
told the rule," which shouldn't re-fire every session the way the intro
cinematic is fine to repeat. Marked seen only once BOTH cards are gone
(dismissed individually or auto-faded together after 16s), not per-card, so
a reload mid-read (a theme switch, an accidental refresh) can't mark it
"seen" after only the first card ever rendered.

## Architecture

```
pages/_app.js, _document.js, index.js   — Pages Router shell; index.js dynamic-imports GameCanvas (ssr:false)
pages/dev-pieces.js        — dev-only piece inspector route (not part of the game)
components/GameCanvas.jsx  — Canvas, camera, lights, OrbitControls; owns useChessGame(), computeVisibility(), and the intro/transitioning/playing phase state (see "Intro")
components/IntroCameraRig.jsx — scripted camera for the intro's three shots + the hand-off transition into gameplay (see "Intro")
components/IntroOverlay.jsx — the intro's stable text (title, tagline, start button); transparent, no background art of its own, each text block sits on its own blurred scrim (see "Intro" -> "Крок 9.6")
components/Board.jsx       — 64 tile meshes, click-to-select/move, legal-move highlight, pending-promotion state; reports selected/hovered squares upward
components/PromotionModal.jsx — HTML modal (2x2 grid) for the promotion choice, rendered outside <Canvas> (see "Promotion")
components/RockIsland.jsx  — what the board sits on: a small floating rock (real GLB model, temporary pedestal is the rollback) — see "RockIsland"
components/SkyDome.jsx     — full sphere behind everything, gradient + faint fbm haze (see "Camera and environment")
components/proceduralTextures.js — canvas noise -> roughness/alpha maps for the backdrop edge fade and board tiles
components/audio.js        — synthesised SFX + wind bed, off by default
components/Pieces.jsx      — reconciles chess.js's board into identity-stable piece instances; owns move/hover/capture animation (see "Piece interaction")
components/PieceModel.jsx  — GLTF load + height normalization + material override (see "3D models")
components/DevPieceRow.jsx — dev-only side-on comparison row + measurement probe
components/FogShader.jsx   — tier 2 fog: one raymarched box over the board (see "Fog" -> Крок 12 Section C)
components/FogLayer.jsx    — tier 1 rollback: 64 persistent fog planes, opacity lerped imperatively in useFrame (never via React state)
tools/                     — checked-in measurement/asset scripts; see "QA hooks"
components/HUD.jsx         — plain DOM overlay (turn/status, sound + new-game corner, control hint), absolutely positioned over the canvas
lib/coords.js              — squareToWorld/worldToSquare, board centered at origin, a1 at the corner, 1 unit/cell
lib/easing.js              — easeInOutCubic (intro camera + board move), easeOutCubic (fog wave + piece reveal, Крок 10 Section C)
lib/pieces.js              — PIECE_SCALE + PIECE_HEIGHTS (shared height ladder, theme-independent) and CODE_TO_PIECE ('n' -> 'knight')
lib/themes.js              — THEMES registry (mist/ocean/snow: model paths, board/fog/accent colors, backdrop config); themeKeyFromUrl() (see "Крок 13: theme system")
lib/useChessGame.js        — chess.js wrapper hook; isPromotion(); owns the AI-move effect (setTimeout keyed off turn/status)
lib/visibility.js          — computeVisibility(game, color) -> Set<string>; unit-tested (lib/visibility.test.js)
lib/ai.js                  — pickGreedyMove(game): highest-value capture, else random legal move
```

## Fog

`lib/fog.js` holds the shared config; `FOG_MODE` picks the implementation and
`components/Fog.jsx` dispatches. Tier 1 (`components/FogLayer.jsx`, one plane
per square) is kept working as a rollback — do not delete it.

Tier 2 (`components/FogShader.jsx`) drives an 8x8 RGBA `DataTexture` mask.
`LinearFilter` on that mask is what turns per-square 0/1 into smooth gradients;
without it the fog is a visible grid of squares.

### Крок 12, Section C: the fog is a raymarched volume, and why the flat versions could never work

**Two separate bugs, found in this order. Both were structural, not tuning.**

**C1 — the deep field was a literal constant.** Not "too uniform" — a constant.
Trace the pre-Крок-12 maths for a settled fogged cell, which is most of the
fogged area:

```
ownVisible    = 0.0                      (exactly; only mid-wave is it partial)
density       = pow(1 - 0, 1.35) = 1.0
alpha         = smoothstep(0, 0.38, 1.0) * 0.94 = 0.94      <- constant
colorVariance = 1 - smoothstep(0.38, 1.0, 1.0) = 0
color         = mix(uColorMid, noisyColor, 0) = uColorMid    <- constant
```

Three noise fields were computed per pixel on five slices and then **multiplied
by zero**. Крок 10's "converge on a flat MID deep in the field" decision, plus a
density that saturates at exactly 1.0, made the deep field a flat `#C4C8C7`
fill. Same saturated-density trap Крок 11 Section D found for the *boundary
position*; it was never fixed for the fog's *appearance*.

**C2 — a flat plane cannot have volume.** Крок 11 Section A had replaced five
real planes at five heights with one plane whose slices fake height via UV
parallax. Great draw-call win, identical top-down read — but a shape painted
inside a flat 8x8 rectangle has no vertical extent, so no amount of colour work
inside that rectangle produces volume. Reported twice as "no volume".

**The fog is now a box, raymarched.** An 8+overhang × `FOG_SLAB_HEIGHT` ×
8+overhang slab; the fragment shader intersects the view ray with it
analytically and marches `FOG_MARCH_STEPS` (12) samples through a 3D density
field with Beer-Lambert extinction. Still **one draw call**. That buys, properly
rather than as an approximation: a real silhouette (banks visibly rise off the
board and spill over its rim), real parallax from real geometry, and genuine
depth accumulation so a grazing path reads thicker than an overhead one.

**The occlusion guarantee is NOT left to the march.** `baseAlpha` is still
computed from the mask alone — the same expression Крок 10 Section A tuned,
evaluated at the texel-snapped cell where the view ray crosses the slab's base
plane — and the final alpha is `max(baseAlpha, volAlpha)`. The volume can only
ever *raise* alpha, so "you cannot tell a light tile from a dark one under deep
fog" cannot regress from anything the raymarch does. Do not restructure that
into a single blended term.

**`baseAlpha` must stay gated by `onBoard`.** The ground UV is clamped to
`[0,1]`, so without the gate every fragment out in the overhang resolves to some
board-border square and inherits its full 94% opacity — painting a hard
rectangular apron of flat grey around the board on all four sides. That is what
"a translucent plate hovering over the board" looked like, and its cause is the
clamp, not the march.

#### Two density models that were tried and are dead ends

Both defined a fog **surface** and filled below it
(`ceiling = base + cloud * billow`, density 1 below, 0 above, soft skin across):

1. `base 0.30`, narrow skin → a slab of ice: flat lid, plus a hard vertical wall
   wherever the fogged region ended.
2. `base 0.10`, wide skin → worse: widening the skin to hide the lid just smears
   partial density through the whole slab, giving a uniform block of haze whose
   silhouette *is* the bounding box.

"Filled below a surface" models a **solid with a lumpy top**. There is no
setting of base/billow/skin that turns it into fog. What works is a density
field with no surface at all:

```
vertical = pow(1 - h, FOG_VERTICAL_FALLOFF)   // dense on the board, thinning up
shape    = cloud * vertical * fogAmount * spill
d        = smoothstep(KNEE, KNEE + SOFT, shape)
```

The **threshold** is the point: subtracting a floor from a field already
decaying with height means only the strongest cloud values survive high up, so
the fog resolves into billows that end at different heights with real *holes*
between them, and reaches exactly 0 before the slab top so there is no top edge
to see. Scaling by `fogAmount` makes the bank taper down to nothing at the
frontier instead of ending in a cliff.

Two sizing mistakes worth not repeating: `FOG_SLAB_HEIGHT 0.55` with
`FOG_VERTICAL_FALLOFF 1.6` crushed all density into the bottom fifth of the
slab, so from a shallow camera — where volume should be *most* obvious — the fog
was a flat tilted sheet of frosted glass. 1.1 and 0.95 give the billows room to
actually differ in height. The ceiling on slab height is the camera: the
material is `FrontSide`, so the camera must stay outside the box or the near
faces get culled and the fog vanishes; shallowest legal camera is y≈3.57, slab
tops out at 1.12.

Shading, in order of how much it matters: **height in the slab** (light comes
from above, so a sample's height *is* how much fog is stacked above it absorbing
that light — crowns bright, base dark; `FOG_DEPTH_SHADE`), then one extra cloud
sample toward the light for a consistent direction. `FOG_DEPTH_SHADE` is 0.38,
not the 0.72 first tried: the vertical falloff puts most density at low `h`, so a
large value darkens the fog's *dominant mass* — at 0.72 the fogged field measured
mean luma 100 against tiles at 161–198, i.e. the mist had gone darker than the
board it sits over.

#### The noise lattice must not resonate with the board grid

`FOG_NOISE_SCALE_*` are 1.87 / 3.29 / 10.73 with a 2.11 V-stretch — deliberately
not round. They were 3.0 / 4.0 / 11.0, and on an 8x8 board sampled through a
noise texture whose lattice periods are powers of two (4/8/16/32), that resonates:
`mass` at `vUv * 3.0` gave 3 tiles × 4 cells = 12 lattice cells across 8 squares
= **1.5 cells per square, which repeats exactly every two squares — the
checkerboard's own period.** The fog's brightness locked to square parity.

Measured: mean luma of fog over light squares ran **19.1 higher** than over dark
ones. That is *not* a tile leak — `accum.a` was verified at 0.94–0.96, worth at
most ~1.9 luma of leak — it was the fog's own noise drawing a grid aligned to the
board. After the fix: 1.65. `lib/noise.js` already documents this exact class of
bug for the same reason (lacunarity 2.03, not 2.0); this is the same fix one
level up.

#### How to actually measure the occlusion guarantee

`tools/fogdiag.mjs`. The light-vs-dark mean comparison is a **useful signal but
not a valid measurement** — as above, any spatial correlation between the noise
and square parity shows up in it and looks exactly like a tile leak.

The authoritative test renders once normally, then repaints **every tile a flat
`#808080`** and renders again, touching nothing else. Whatever the fog hides
cannot change between the two frames, so per fogged square
`|luma_before - luma_after|` **is** the leak, independent of where the noise
happens to sit. Clear squares are the control and must change a lot.

Current: fogged **2.18 luma mean, 4.44 max** against a 6-luma budget
(`FOG_MAX_ALPHA` 0.94 ⇒ ≤6% leak); clear squares' light/dark delta **37.2**,
unchanged from before the rework, so no milkiness regression.

`gl.readPixels` returns all zeros unless you `window.__gl.render(...)`
**synchronously in the same `page.evaluate`** — the context has no
`preserveDrawingBuffer`, so by the time an ordinary evaluate runs the back buffer
is already presented and cleared. Same trap as `drawImage`.

`FOG_MARCH_STEPS` replaces `FOG_LAYERS` as the first perf lever — a straight
linear trade against fragment cost. `FOG_LAYERS`/`FOG_LAYER_ALPHA_MULT` are
unread by tier 2 now (only `FOG_LAYER_HEIGHTS[0]` survives, as `FOG_HEIGHT`);
they are kept because tier 1 is the documented rollback.

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
tried, in order, three separate times.** Flat `FOG_COLOR` with plain alpha;
then (Крок 8) colour varied by cloud density; then (Крок 9.5) `groundMultiply`
+ `groundStrands`, `THREE.MultiplyBlending` as the primary readability
mechanism instead of alpha. Крок 9.5 fixed light-tile readability (measured
-54/-28 luma at the time) but not *occlusion*: multiply can only ever scale
what's underneath, never truly hide it, so a careful look could still tell a
light tile from a dark one even under "readable" fog — tinted glass, not fog
of war. See git history on this file for the full account of the first two
attempts; both are superseded, not just tuned further.

**Крок 10, Section A rebuilt the curve around real opacity.** Alpha is the
primary mechanism again, but this time reaching `FOG_MAX_ALPHA` (0.94) in the
deep field: `alpha = smoothstep(0.0, FOG_ALPHA_KNEE, density) * FOG_MAX_ALPHA
* uOpacity`. At 0.94, whatever's underneath contributes at most 6% of the
final pixel — that 6% ceiling is where the verification bar ("< 6 luma
difference between adjacent deep-fogged tiles") actually comes from, not a
number picked to sound precise. `FOG_ALPHA_KNEE` (0.38) is low on purpose:
most of the fogged field sits at full opacity, not just its deepest interior
— half-fogged is deliberately not a state this game spends much visual area
in. `FOG_TINT_COLOR` survives, demoted to a single subtle multiply pass
(`density` 0.15-0.5 only) that adds a little extra depth right at the
frontier on top of what the alpha layer already carries — no longer the
mechanism, just an accent.

**Two real bugs surfaced during verification, both worth knowing about before
touching this curve again:**

1. *Noise-driven colour variance can itself blow the readability budget.*
   `FOG_DEPTH_COLOR_LOW`/`HIGH` (`#B4B9BA`/`#DCDEDB`) span ~37 luma, and
   mixing across that full range at every density meant two *adjacent*
   deep-fog pixels could differ by more than "< 6 luma" purely from noise
   phase — independent of which tile was underneath, and bigger than the
   underlying-tile leak the alpha fix was built to solve. The brief's own
   colour range is for the frontier ("на межі — м'який градієнт, це те, що
   розповідає історію"); the deep interior is supposed to be "глухо" —
   muffled, uniform — so `colorVariance` in `FogShader.jsx` fades the
   LOW/HIGH mix out as `density` rises past the knee, converging on a flat
   `FOG_DEPTH_COLOR_MID` (`#C4C8C7`, the brief's own reference tone) deep in
   the field. Verified after the fix: four separate adjacent light/dark pairs
   scattered across the fogged half, luma delta of **1** on every one.
2. *`LinearFilter` on the mask bleeds fog onto technically-visible squares.*
   Sampling the mask at the live, freely-varying `vUv` blends in whichever
   neighbouring texel is closer whenever a fragment lands anywhere near a
   texel boundary — which is most of a boundary square's own area, not just
   its edge pixels. At the old, gentler alpha ceiling this was invisible; at
   0.94 it alone washed a fully *visible* rank-3 square down by 70+ luma,
   failing "visible squares stay absolutely clean" outright, and could even
   flip a light tile's measured luma below an adjacent dark one. Fixed by
   snapping to the containing texel's exact centre before the "am I on a
   visible square" sample — bilinear weights are exactly `(1,0,0,0)` at a
   texel centre, so that read (`ownVisible` in the shader) is the true
   discrete state of *this* square, never a neighbour's blend. The frontier
   gradient term (`edge`) gets the same treatment via a `(1.0 - ownVisible)`
   gate — it's genuinely nonzero on *both* sides of a boundary, but the
   thickening effect belongs only on the fogged side.

**Крок 10, Section B gave fog height.** Originally `FOG_LAYERS` (5) real
planes instead of one; **Крок 11, Section A made the height virtual** — one
plane now, with `FOG_LAYER_HEIGHTS` (0.02/0.07/0.14/0.23/0.34) driving a
per-slice view-direction parallax shift inside a single fragment shader
instead of five real mesh positions (see "Крок 11, Section A" further down
for why). `FOG_LAYER_ALPHA_MULT` (1.0/0.55/0.35/0.2/0.1) still applies the
same way — the base slice alone reproduces Section A's curve exactly and
carries all of the readability guarantee; every slice above it is
silhouette, never a second source of occlusion. Per-slice variation
(`layerParams()` in `FogShader.jsx`, derived from index, not hand-picked, so
`FOG_LAYERS` can drop 5→2 without leaving orphaned config):

- **Noise scale grows with height** (`1.0 + index * 0.35`) — higher layers
  read finer-grained.
- **Drift direction and speed differ per layer** — `uDriftAngle` rotates the
  three drift vectors (never the static anisotropic sampling grid itself,
  which would fight the "horizontal streak, not isotropic speckle" design);
  `uDriftScale` alternates sign and grows slightly with index.
- **`uUvOffset`, proportional to height**, shifts each layer's whole noise
  field so five layers never sample the *identical* pattern stacked directly
  on top of each other (which would silhouette as one layer, not five). Real
  geometric parallax between layers — the point where "shift with the
  camera" actually happens — falls out for free from them being genuine
  planes at different Y as the camera orbits; this offset is a *static*
  complement to that, not a substitute for it.
- **`uSurfaceStart`/`uSurfaceEnd`** gate each raised layer's alpha by an
  extra `smoothstep` on `density`, stepping up with index (`index * 0.1` to
  `index * 0.1 + 0.22`) — "top surface": a raised layer only appears where
  the fog beneath it is *already* substantially deep, tapering the whole
  stack's silhouette to nothing at the frontier instead of a hard-edged wall
  of planes. The base layer's gate is `[0, 0]` (unrestricted).

**Milkiness at shallow camera angles was the standing risk from Крок 8/9's
own drift-sheet history** — anything raised above the board can occlude far
squares when several stacked semi-transparent planes compound in screen
space, which is exactly what "visible squares stay absolutely clean" would
catch first. Verified at `MIN_POLAR_ANGLE` (22 degrees, the steepest/most
overhead angle in range and the one Крок 8 fought hardest to unlock) with the
same adjacent-pair pixel method: visible squares read within a few luma of
their unfogged base colours (light > dark, correctly ordered), deep-fog pairs
still delta 1. The `ownVisible`/`edge`-gating fix above is *why* this holds
regardless of how many layers are stacked overhead — each layer
independently zeroes out over a genuinely visible square, so stacking more
of them adds silhouette over fog, never haze over clarity.

**Superseded by Крок 11, Section A (see below):** this paragraph originally
described a performance ladder built around `FOG_DETAIL_OCTAVES` and
`FOG_ENABLE_DETAIL`, which no longer exist — fog noise is a baked texture
now (`getFogNoiseTexture()`), not a GLSL octave loop with a tunable count,
and fog is already one draw call, not five, so `FOG_LAYERS` no longer trades
against draw-call count either. If frame rate still drops on real hardware,
`FOG_LAYERS` 5 -> 2 remains the lever (fewer slices composited per pixel in
the single shader), just for a smaller win than it used to be, since the
expensive part (from-scratch noise) is already gone. **Real-GPU frame rate
is unmeasured from this environment** — see "Headless browser" below; the
software rasterizer here renders at roughly 1 fps regardless of scene
complexity, so it cannot distinguish 30 fps from 60. A `requestAnimationFrame`
counter behind `?debug=1` (`HUD.jsx`'s `FpsCounter`) exists specifically so
this can be checked on real hardware without a rebuild.

**The fog's base layer sits at y=0.02, just above the tiles — not above the
pieces.** Floating it over the pieces (the obvious reading of "above the
pieces") means a shallow camera looks through every fogged square between it
and a distant piece, washing the whole board out. Nothing ever pokes through
at ground level: a square holding one of your own pieces is always visible so
never fogged, and enemy pieces inside fog are not rendered at all.
**Крок 11, Section B moved `HIGHLIGHT_HEIGHT` down to 0.011** — right on the
tile, under every fog layer — but kept the highlight mesh's `renderOrder`
*above* the fog's own (`Board.jsx`: highlight 4, fog mesh 3). Both alpha
layers have `depthWrite: false`, so with no depth conflict between them,
render order — not world Y — is what actually decides whether fog can paint
over the highlight; the height move alone would have done nothing either
way. This isn't just future-proofing: the brief's own justification for
"safe to hide the highlight under fog" ("a legal target is always inside the
mover's zone of control, so it's always visible") is false for a pawn's
double-push — `lib/visibility.js` builds `visibility` from `attackers()`,
and a pawn doesn't attack two ranks ahead, only diagonally. Verified with a
headless-Playwright pixel sample: selecting e2 and sampling the rendered
frame, e3 read as clear ember but e4 (the double-push target, buried under
fog's 0.94 max alpha) read as flat fog grey with the old renderOrder — fixed
once the highlight was guaranteed to composite on top regardless of fog
state.

**Крок 10, Section C made a move an event instead of an instant mask swap.**
The mask `DataTexture` grew a second channel (`THREE.RGFormat`, not `RedFormat`
— R stays "current eased visibility", G is "when this square's reveal wave was
scheduled to start"). The old CPU-side exponential lerp (`FOG_LERP_SPEED`) is
gone from `FogShader.jsx` entirely, replaced by a per-square wave that
`useFrame` writes into R every frame:

```
t = clamp((now - startTime[square]) / FOG_WAVE_DURATION, 0, 1)
R[square] = mix(oldValue[square], newValue[square], easeOutCubic(t))
```

`startTime` is computed once, in a `visibility`-content-diffing `useEffect`
(NOT a reference check — `GameCanvas` recomputes `visibility` fresh every
render, including hover/select changes that never touch game state, so a
naive `[visibility]` dependency would refire constantly for no reason; the
effect diffs Set *contents* against a `prevVisible` ref and only schedules a
new wave when a square's target state actually flipped):

```
delay = squareChebyshevDistance(square, origin) * FOG_WAVE_DELAY_PER_CELL
      + (revealing && enemyPieceSquares.has(square) ? FOG_REVEAL_THICKEN_DURATION : 0)
startTime[square] = now + delay
```

**Reveal and conceal use different origins on purpose** — `revealOrigin =
lastMove.to`, `concealOrigin = lastMove.from`. A square becomes visible
because a piece just arrived somewhere with a new sightline; a square goes
dark because a piece just left the square that used to see it. "You retreat,
and the darkness follows" falls out of using the vacated square as the
close-in wave's own origin — no separate nearest-visible-square search needed.
Verified empirically (`squareChebyshevDistance` + the formula above, read
directly off `window.__fogWave.current.startTime` mid-scheduling): a queen
move that opened one file and closed another produced exactly the predicted
per-square delay, matched to floating-point precision, for every affected
square in both directions simultaneously.

**A wave, once scheduled, restarts from the square's current *effective*
value, not its last discrete target.** `oldValue[square] = effective[square]`
(the live, already-blended value) rather than `0`/`1` — a second move landing
before the first wave finishes retargets smoothly instead of popping.

**The enemy-piece reveal drama is `FOG_REVEAL_THICKEN_DURATION` (0.2s) added
on top of the distance delay, nothing more exotic.** A square that's both
newly visible and holds a black piece just holds its old (fogged) value
longer before the same dispersal wave starts — thicken-then-burst falls out
of one extra term in the delay formula, not a separate animation. The G
channel (`revealTime`) is separate from this: it drives a small, bounded,
decaying turbulence pulse in the shader
(`exp(-abs(uTime - revealTime) * 3.0)`, folded into the wisp noise's
amplitude only — never `ownVisible`/`density` directly) so the frontier
visibly "boils" right as a wave passes through a square, on top of the alpha
motion the CPU-side blend already provides. This is a flourish, not a second
source of readability — the core open/close mechanic is fully carried by the
R-channel blend and needs no shader-side timing at all.

**`Pieces.jsx` computes the *same* delay formula independently** (own
`squareChebyshevDistance` + `lastMove.to`, always with the thicken duration
since any freshly-mounted non-white piece is by construction a reveal — see
`AnimatedPieceGroup`'s `revealDelay` prop) rather than reading fog's own
state, so the piece and the fog it emerges from read as one event without the
two components sharing a ref. It relies on an enemy piece's first mount
*already being* its reveal (`Pieces` returns `null` for an invisible enemy
instance, so React actually unmounts/remounts the component on each
visibility transition — true before Section C existed, just newly load-
bearing) — `revealFade` is captured once via a `useRef` lazy initializer
specifically so it can never flip mid-life for one mounted instance. The fade
itself reuses `PieceModel`'s existing `fade` prop (clones BONE/LACQUER
per-instance so opacity can animate without touching every piece of that
colour) — the same mechanism `CaptureGhost` already used for fade-*out*.

**Крок 10, Section D (partial): the frontier boils, piece-proximity swirl was
not attempted.** The boundary gradient sample (`gx`/`gy` in
`densityAndShapeGLSL`) is now offset by a small warp built from `detail`
(the finest, fastest-drifting of the three noise scales already computed for
`clouds`) instead of sampling at a fixed `vUv` — free wobble with no fourth
noise evaluation, and it inherits `detail`'s own time-drift rather than
needing a separate clock term. Verified this doesn't reopen either of Section
B's bugs: deep-fog adjacent pairs still delta 1, visible squares still read
clean at both the default view and `MIN_POLAR_ANGLE` (both gated by
`ownVisible`/`(1 - ownVisible)` exactly as before — the boil only perturbs
*where* the gradient samples, never whether a visible square gets any edge
term at all). The brief's second half of this section — pieces near the
frontier locally dispersing the fog around them via a per-move "closeness to
pieces" texture — was skipped: it needs piece world positions plumbed into
the shader (a new input, not just a reused noise term) and this is explicitly
the brief's lowest-priority ask ("якщо лишиться час"). Worth doing later, not
worth rushing after A/B/C/E were already the higher-priority asks.

Mask orientation is easy to get subtly wrong (mirrored/transposed) and hard to
spot on a symmetric start position. `/dev-fog?visible=a1` renders top-down
with only the listed squares cleared and paints them orange — the clear hole
must land on the orange square. Corners alone do not prove it (they are
invariant under mirroring); use a single asymmetric square.

### Крок 11, Section A: one draw call instead of six

The diagnosis going in: five fog planes, each computing three from-scratch
noise functions (one fbm + two ridged, five octaves each) per pixel, plus a
sixth mesh for the edge-multiply tint — six draw calls, ~15 noise-octave
evaluations per pixel per plane before transparent overdraw even multiplies
it further. Two structural changes, not tuning:

- **Noise from a texture, not from scratch.** `getFogNoiseTexture()`
  (`proceduralTextures.js`) bakes a 256x256 RGBA texture once at module
  load: each channel is an independently *seamless* tileable value-noise
  field (hash taken modulo a per-channel lattice period that evenly divides
  the sampling range — R/G/B/A at periods 4/8/16/32, i.e. doubling
  frequency). `FogShader.jsx`'s `fbmTex`/`ridgedTex` replace the old GLSL
  octave loops with **one texture2D fetch** each — the four channels of a
  single sample already *are* four pre-computed octaves, combined with the
  same 0.5/0.25/0.125/0.0625 amplitude falloff the loop used. Visually the
  same lattice, just baked instead of computed; doesn't survive a
  screenshot comparison.
- **One plane, five virtual slices.** `FOG_LAYERS` "planes" (still the same
  `lib/fog.js` constant, still drives everything, still safe to drop 5->2)
  are now one mesh, sliced inside a single fragment shader. A slice's old
  real height — which used to buy real geometric parallax as the camera
  orbited — is faked with a UV shift along the camera's own view direction
  (`FOG_PARALLAX_STRENGTH`). `sliceGLSL()` JS-templates one unrolled block
  per slice (same pattern `ridgedGLSL` used to be), composited into `accum`
  with the exact src-over recurrence (`rgb*a + accum.rgb*(1-a)`, `a +
  accum.a*(1-a)`) that stacking N real transparent draws would already have
  produced — same math, one draw call. Verified via a headless-Playwright
  scene traversal counting meshes carrying the fog material: 1 (was 6). The
  old edge-multiply mesh's tint is folded into slice 0's own colour instead
  of surviving as a second `MultiplyBlending` draw — an approximation (a
  direct colour mix, not a true multiply of the framebuffer beneath it),
  acceptable since Крок 10 had already demoted it to "a little extra depth
  at the frontier," not the readability mechanism.
- `ownVisible`/`edge`'s safety property (Крок 10 Section B) is unchanged:
  both still key off the true, texel-snapped `vUv` (never the
  parallax-shifted noise sample), so a visible square reads density 0 on
  every slice regardless of how far a raised slice's noise field has
  drifted.

Also (`GameCanvas.jsx`/`Lighting.jsx`): `dpr={[1, 1.5]}` (was unclamped —
a 2x/3x-density display was rendering 4x-9x the pixels a 1x display does
for an identical frame), key light `shadow-mapSize` 2048->1024 (it was
already the only shadow-casting light), `gl={{ powerPreference:
'high-performance' }}`.

**Real-hardware FPS is unmeasured from this environment**, same limitation
as everywhere else in this file that touches frame rate — the headless
software rasterizer here renders at ~1fps regardless of scene complexity
and cannot distinguish 30 from 60. A plain `requestAnimationFrame`-based
counter now sits next to the `?debug=1` vision readout in `HUD.jsx`
(`FpsCounter`, a rolling 500ms window, deliberately outside the r3f tree so
it measures the browser's real paint rate) specifically so this can be
checked in a real browser without a rebuild — read it there, don't trust a
number reported from this environment.

### Крок 11, Section D: a breathing frontier, and why the obvious approach doesn't work here

The brief's own sketch was `density += edgeShift * band` where `band` is a
smoothstep window on `density` itself, assuming `density` ramps smoothly
through 0..1 near a boundary. It doesn't, in this codebase's model: a
*settled* (non-transitioning) fogged cell has `ownVisible` pinned at exactly
0.0 — only mid-wave does the R channel take intermediate values — which
puts baseline `density` at exactly 1.0 or above, already past
`FOG_ALPHA_KNEE` and therefore already saturating both
`smoothstep(0, KNEE, density)` (alpha) and `smoothstep(KNEE, 1.0, density)`
(colour variance). Adding a small oscillation on top of an already-saturated
value changes nothing. This was **verified empirically, not assumed**: a
headless-Playwright session forced `uTime` 500 units apart and read back raw
pixels via `gl.readPixels` (bypassing PNG/screenshot entirely) at the exact
frontier band — byte-identical output. The same method also suggests the
Крок 10 Section D "boiling edge" may have had the identical characteristic
(never rigorously checked for temporal variation at the time, only for the
adjacent-pixel luma bars) — worth keeping in mind if it's ever revisited.

The fix moves *where* the boundary is tested, not the density value at a
fixed position: `breathedUv = vUv + vec2(breathShift) / 8.0` (breathShift in
fractions-of-a-cell, matching the brief's own units) is what gets sampled
for `ownVisible` and the edge gradient, in place of plain `vUv`. Only pixels
already within about that same tiny distance of a *true* mask boundary can
have their `ownVisible` read flip to a different texel as a result — a
cell's own centre would need a shift past half its width to ever reach a
neighbouring texel, far more than `breathShift` produces, so "density at
cell centres stays exactly as the mask says" holds by construction. Two
superimposed ripples (`FOG_BREATH_PERIOD_SLOW` 0.28, `FOG_BREATH_PERIOD_FAST`
0.73 with a `dot(vUv, vec2(13,7))` phase offset so it ripples rather than
pulsing in lockstep) combine into one `breathShift`, gated to 0 for the
first `FOG_WAVE_DURATION` (0.8s, reusing the existing constant rather than
adding a second one) after *this square's own* last visibility change —
read from the mask's own B channel (`ownMask0.b`, now the third channel:
the mask `DataTexture` is RGBA, not RG, as of this pass) — and eased back in
over that span, so breathing never fights the Крок 10 Section C reveal wave.
Verified with the same forced-`uTime`/`gl.readPixels` method: comparing
render output across ten different `uTime` values against a fixed baseline
all showed substantial, non-trivial pixel diffs (1,200-9,000 pixels, colour
delta up to 225/255) at the frontier band specifically.

### Крок 13: the frontier still read as a clean 8x8 grid, and a genuine occlusion bug

Two separate fixes, both small in diff but worth recording precisely so the
tuned numbers aren't re-derived from scratch.

**The wobble existed but was too small to read.** Крок 11 Section D's breathing
and Крок 10 Section D's boil warp were both real and both verified with
`gl.readPixels`, but their amplitudes (`FOG_BREATH_AMPLITUDE_SLOW/FAST` 0.06/
0.02, `boil` magnitude 0.07 of a cell in `FogShader.jsx`) only ever moved the
tested boundary a few percent of a cell off the true mask edge — enough to
prove the mechanism worked, not enough to visibly break the frontier's
grid-aligned read. Raised to 0.16/0.05 and 0.15 respectively: still gated to 0
for `FOG_WAVE_DURATION` after a square's own visibility flips (unchanged, see
Крок 11 Section D above), so a bigger wobble still never fights an in-flight
reveal/conceal wave — only the steady-state amplitude changed.
`FOG_MARCH_STEPS` also went 12 -> 16 for finer volumetric step resolution, and
`cloudField`'s mass/wisps mix nudged from 0.74/0.26 to 0.70/0.30 for a touch
more visible wisp detail, per the same "трішки деталей" ask. `FOG_MARCH_STEPS`
is still the first lever to pull back down if a real GPU ever shows this is
too expensive — see "Headless browser" below; none of this was measurable
from this environment beyond "it still renders and passes `tools/fogdiag.mjs`'s
occlusion budget."

**A genuine bug, not a tuning gap: an own piece's move animation could get
hidden behind the fog mid-flight.** `Pieces.jsx` animates a move as a straight
lerp from the old square to the new one, arcing up to `MOVE_ARC_HEIGHT` (0.32)
at the midpoint — and "a square holding your own piece is never fogged" (see
"The fog's base layer..." above) was only ever being applied to the piece's
*resting* square. A slide across several ranks/files (a queen d1-d8, say)
visibly flies over whatever squares sit between, and those can be genuinely
fogged — outside `visibility`, no piece of yours currently attacks or occupies
them. `FogShader` has no notion that a piece is passing overhead: it marches
real volumetric density there, and because the fog box's own near surface
(typically its top, at `FOG_HEIGHT + FOG_SLAB_HEIGHT`) is geometrically nearer
an overhead camera than a piece flying below the slab top, the fragment isn't
discarded and paints straight over the piece for that instant. Reported as
"fog jumps in front of and covers a piece."

Fixed in `GameCanvas.jsx`, not in the shader: `squaresBetween(from, to)`
(`lib/fog.js`) computes the straight rank/file/diagonal path between a move's
two squares (a knight's hop isn't collinear, so it just returns the two
endpoints — a knight's brief in-air flicker is accepted as an edge case, not
worth a curved-path special case for a ~0.35s animation). Whenever the most
recent move is White's own, those squares are temporarily unioned into the
`visibility` Set passed to `<Fog>` **only** — never to `<Pieces>`, which stays
strictly game-accurate — for `MOVE_DURATION` (now exported from `Pieces.jsx`)
seconds, via a plain `setTimeout`. Because this flows through the same
`visibility`-diffing wave-scheduling effect Крок 10 Section C already has, the
fog doesn't just stop rendering over the path — it visibly parts (a reveal
wave) and then closes back in (a conceal wave) a beat after the piece lands,
which reads as an intentional effect rather than a hidden hack. Enemy piece
reveals deliberately do **not** get the same exemption: an enemy piece only
starts rendering once its destination square is already visible, and it's
fine for its arrival animation to flicker under fog along a path the player
never had eyes on anyway.

### Крок 14: a piece just standing still could get fogged too, not only a moving one

The Крок 13 fix above only ever exempted squares along one piece's own
straight-line *move* — it did nothing for a piece that was simply standing
still elsewhere on the board, and the underlying bug is more general than
"mid-flight": it's that `FogShader`'s ray-to-the-base-plane math has no idea
an opaque piece's body is sitting between the camera and that base plane at
all. For a camera ray through any point on a piece's body below the slab's
own top (`FOG_HEIGHT + FOG_SLAB_HEIGHT`, ~1.12 — true for most of every
piece, since only the tips of king/queen/bishop poke above it), continuing
that ray on to the base plane sails straight past the piece and can land a
full rank or more beyond it. If *that* square is fogged, the shader painted
fog across the piece itself even though the piece's own square was never
fogged. Worked out analytically for a resting-camera view of a king (camera
`[3.5, 7, -8.5]`, king on e1): the unobstructed ray hit e2, one rank deeper,
not e1 — and reproduced empirically with a lone knight on an otherwise-empty
board (visibly fog-washed on `master`, clean after the fix; see git history
for the A/B screenshots this was verified against).

Squares-based exemption (Крок 13's fix) can't generalise to this — it would
mean tracking a "shadow square" per piece per frame, re-derived every time
the camera orbits (full 360°, unclamped azimuth), and rescheduling it through
the reveal/conceal wave machinery would spam wave restarts on every camera
tick. The fix instead gives `FogShader` a small scene-depth prepass (a
`useFBO`-backed `DepthTexture`, resolution 512 desktop / 256 on the same
low-power tier `marchStepsForDevice` already targets) rendered once a frame
—same technique, and the same cost class, `ContactShadows` already pays for
its own continuously-refreshed depth pass. The fog's own box mesh hides
itself for that one render (cheap visibility toggle) so it isn't shading its
own expensive march into a depth buffer nobody reads, and isn't polluting
its own occlusion input.

The fragment shader reconstructs the opaque surface's world position from
that depth texture (`worldPosFromDepth`, standard NDC → view → world
unprojection via `uProjectionMatrixInverse`/`uViewMatrixInverse`) and turns
it into `dOpaque`, a distance directly comparable to the ray parameter `t`
(both measured from `cameraPosition` along the same unit ray). Both the
ground-hit search (`tGroundHit = min(tGroundRaw, dOpaque)`) and the march's
own loop (`if (t > dOpaque) break;`) are clamped to it: when nothing opaque
is nearer than the base plane, `dOpaque` sits far past the far clip and
every existing computation is untouched; when a piece *is* nearer, the
ground hit collapses onto the piece's own surface, so `boardUv` of that
point resolves to the square the piece is actually standing on — which, by
the game's own render rule, is always either White's own (always visible) or
a currently-visible enemy piece, so `baseAlpha` comes out ~0 by construction.

This does not touch the occlusion-guarantee invariant documented above
`fragmentShaderSource` in `FogShader.jsx`: it can only ever make
`baseAlpha`/`volAlpha` *smaller* at a pixel where fog was over-painting an
opaque piece, never larger over a genuinely empty fogged square (`dOpaque`
there is effectively infinite, so the clamp is a no-op). Verified with
`tools/fogdiag.mjs` after the change: fogged-tile leak 2.17 luma mean / 4.50
max (documented baseline 2.18 / 4.44 — unchanged within noise), clear-square
light/dark delta 36.69 (baseline ~37.2) — the occlusion guarantee and tile
readability both hold exactly as before, on top of the piece fix.

### Крок 16, Section A: the mask must never exist in an "everything hidden" state

**Not a shader change — the bug was in the mask's own starting values.**
`FogShader.jsx`'s mask `DataTexture` used to be filled with a blanket `r = 0`
(maximally fogged) for all 64 texels at mount, and the wave-scheduling effect
(Крок 10 Section C's `isInitialReveal` branch, still used for a fresh mount
or a "Play Again"/theme-switch remount) started every square's wave from
whatever was already in `wave.current.effective` — which, for a brand new
`Float32Array(64)`, also defaults to 0. So a currently-*visible* square's
value climbed from 0 up to 1 over the whole `FOG_INITIAL_REVEAL_DURATION`
(1.4s) + its own distance-from-centre delay, not just the newly-fogged ones —
meaning the **entire board**, including squares that should already read
clear, displayed as fully fogged for a real, human-visible span after every
fresh mount (game start, "Play Again", and now Крок 16 Section D's mid-game
theme switch too), not just for one throwaway frame.

The fix seeds both the raw `DataTexture` content and `wave.current.effective`
directly from the **real starting `visibility` Set**, computed synchronously
before the first paint, instead of a blanket "hidden" fill —
`FOG_INITIAL_SEED_FRACTION` (`lib/fog.js`, 0.8) is the knob: a square that's
already visible seeds at exactly its target (`r = 1`, so its wave — if one
even gets scheduled — is a mathematical no-op, 1→1) and a square that starts
fogged seeds at `1 - FOG_INITIAL_SEED_FRACTION` (`r = 0.2`, i.e. density 0.8,
not the full 1.0) rather than the opposite extreme. Both read as correct —
clear vs. fogged — from the literal first rendered frame; only the fogged
squares have anything left to visibly settle, and it's a small remaining step
(density 0.8 → 1.0), not a full sweep from black. `FogShader.jsx`'s mask-
building `useMemo` runs exactly once at mount and captures whatever
`visibility` the very first render passed in via closure — the same lazy-
init-capture pattern this codebase already uses elsewhere (`depthSizeRef` in
the same file, `tuningRef`/`lowPowerRef` in `GameCanvas.jsx`).

**A subtlety worth knowing, not a bug**: fogged squares are *skipped* by the
`isInitialReveal` scheduling loop entirely (`wasVisible === isVisible ===
false` → `continue`, unchanged from before this pass), so their `oldValue`/
`newValue` stay at the `Float32Array` default (0/0) and the very next
`useFrame` tick snaps their `effective` value straight to 0 — the seeded 0.2
only survives for the literal first paint. This is fine and expected: at
`FOG_ALPHA_KNEE` (0.38), density 0.8 and density 1.0 both already saturate
`baseAlpha` to `FOG_MAX_ALPHA`, so the two are visually indistinguishable:
the seed's only job was to avoid a shared, uniform "everything is fogged"
read at frame one, not to hold a specific value past it.

The per-move dispersal wave (Крок 10, Section C) is completely unchanged —
this only touches a freshly-mounted mask's *starting* values, never how a
wave animates once scheduled.

Verified two ways: (1) `window.__fogWave`/`__fogMaterials` (`?debug=1`) read
immediately after mount show `r = 1.00` for every one of the real starting
24 visible squares and `r = 0.00` for the rest (already snapped past the
one-paint seed by the time a script can read it, per the subtlety above —
consistent, not a discrepancy); (2) a screenshot taken as early as the
`window.__fogMaterials` hook exists (before any deliberate settle time) shows
White's near half of the board already clean and only Black's far half
fogged — never a uniform grey wash. `tools/fogdiag.mjs`'s occlusion numbers
are unchanged (see the Крок 14 entry just above), confirming this doesn't
touch the occlusion guarantee, only the starting point of what eases into it.

## Крок 20: Ocean's splat re-enabled — and a Mint export format that doesn't work here

A fresh Mint export of "Ink Wash Sea Canyon" arrived as
`public/ink-wash-sea-canyon-71b2169540978d28-lod.rad` — **not usable**.
Its header is a custom container (`RAD0` magic + a JSON manifest declaring
`"type": "gsplat", "lodTree": true, "chunkSize": 65536`, followed by chunked
binary data), not any of the formats Spark 0.1.10 actually parses (`.spz`,
`.ply`, `.splat`, `.ksplat` — confirmed by grepping the installed package's
own dist bundle, not assumed from its docs). It's Mint's own LOD/streaming
container; there is no public decoder for it. Left in `public/` untracked
rather than deleted — it costs nothing until `git add`, and Mint may add
`.spz` export for LOD packs later.

**A standard-format export of the same capture was already sitting in the
repo, unused**: `public/ink-wash-sea-canyon-4b924cffda141b26.spz` (Крок 13),
already wired into `lib/themes.js`'s `ocean.backdrop.splatUrl` with a starting
`splat` transform carried over from Snow's own corrected placement — flagged
at the time as "never independently checked against this specific capture."
This pass flipped `ocean.backdrop.mode` from `'image'` to `'splat'` (the only
change `lib/themes.js` needed at first — `Backdrop.jsx`'s `usesThemeSplat`
branch was already theme-generic, unchanged since Крок 16 Section B).

**First attempt at verifying the carried-over rotation was wrong, and here's
why the method itself was the problem.** A `?sprotX=` sweep (the same method
that diagnosed Snow's upside-down splat) was screenshotted in this headless
environment and `-90` (the existing value, copied from Snow) was read as "a
coherent canyon." It wasn't — the very next real-hardware test (a live user
report: 100% CPU while the splat loads, 90% GPU once it renders, FPS down to
30, **and** "the scene is still perpendicular to the board") showed the
capture standing up as a wall, exactly the "wall standing next to the island"
failure Mist's own capture hit for the identical reason (see Mist's own
`backdrop` comment) — copying Snow's Z-up correction onto a capture that was
actually already Y-up. This headless environment's software rasteriser
renders busy ink-wash splat noise chaotically enough that a genuinely broken
orientation and a genuinely correct one were **not visually distinguishable
in a screenshot** here. Don't trust an orientation call made from a
screenshot taken in this environment again — verify from the data instead
(next paragraph), and treat any headless "looks fine" on a splat as
provisional until a real device confirms it.

**The fix: decode the raw point positions and measure the up-axis directly,
instead of eyeballing a render.** `tools/probe-splat-axes.mjs` gunzips a
`.spz` and parses its header + centers exactly the way `@sparkjsdev/spark`'s
own `SpzReader` does (confirmed by reading `dist/spark.module.js` directly,
not assumed) — magic `1347635022`, version 3, 24-bit fixed-point per axis at
`fractionalBits` from the header. A plain min/max or std-dev per axis came
back too close to call (X/Y/Z std within 8% of each other — some far-flung
clutter splats were skewing it). Switching to **p01-p99 percentile extent**
(the same method CLAUDE.md's own mountain-valley derivation already used, see
the Gaussian splat backdrop section above) gave a clean answer: local Y
range 14.46 vs X 25.08 / Z 26.23 — Y is unambiguously the capture's own "up."
So the correct rotation is `[0, 0, 0]` (identity — same as Mist's own
capture), not `[-90, 0, 0]`. Re-verified visually after the fix, still inside
this environment's known limitation: the corrected orientation shows a
distinct ground band below a differently-toned band above (sky/far cliff),
where the wrong orientation showed one uniform texture filling the whole
frame top-to-bottom with no horizon — a coarser signal than "does this look
like a canyon," and one this environment's rasteriser can actually carry.

**The CPU/GPU cost report is real and Крок 16 Section B's existing levers
don't touch it, because they run too late.** `downsampleSplats`
(`SplatBackdrop.jsx`) only executes inside Spark's `constructSplats` hook,
called *after* the full file is fetched and decoded into a `PackedSplats` —
its own comment already said as much ("the full file still has to be
downloaded and decoded... there is no way around that without a second,
pre-shrunk .spz asset"), which is exactly what the 100%-CPU-while-loading
report is: decode cost scales with the source file's splat count, not with
whatever fraction gets kept afterward. `tools/shrink-spz.mjs` is the fix —
an offline, one-time tool, not a runtime cost. SPZ is a structure-of-arrays
format (all centers, then all alphas, then all rgb/scale/quaternion, never
interleaved per splat — confirmed the same way, from `SpzReader`/`SpzWriter`'s
own source), so downsampling is a pure byte-copy at a fixed stride: no value
is ever decoded or re-encoded, so the splats that survive have **zero**
precision loss versus the original file, only fewer of them. Verified by
running `tools/probe-splat-axes.mjs` against the shrunk output too — p01/p50/
p99 per axis matched the source file to two decimal places, confirming the
distribution wasn't corrupted, just thinned.

`public/ink-wash-sea-canyon-shrunk.spz` (kept untracked, like the source
`.rad`, pending the user's own call on committing it): **1,920,000 -> 288,000
splats (15%), 32.5 MB -> 4.9 MB**. Крок 16 Section B's client-side
`SPLAT_KEEP_FRACTION` (0.35) still applies on top after load — verified via
`window.__splat`: `{state: 'ready', count: 100800}`, i.e. 288,000 * 0.35 —
so the two levers compound to **100,800 splats actually resident on the GPU,
5.25% of the original 1.92M**, and the network payload alone is down 85%.
Decode cost (the CPU-bound part of the original report) scales with the
288,000 the browser now actually parses, not the original 1.92M — an
~6.7x cut there specifically, independent of whatever the GPU-side levers
already did.

**What this still does NOT establish: that Ocean's splat is now cheap enough
for this project's real target hardware.** Крок 17/18 reverted splats for all
three themes on an *identical* real-device signal (20fps, 90% VRAM) before
any of Крок 16 Section B's levers or this shrink existed, and this headless
environment provably cannot be trusted to make that call on its own (see two
paragraphs up) — a single splat frame here still costs 100+ seconds
regardless of viewport size, dominated by CPU/WASM sort time, not GPU raster,
so it can't stand in for a real FPS/VRAM reading either. The right next step
is the same real-device test that surfaced the original problem: check
`FpsCounter` (`?debug=1`) and real GPU/CPU load with this build. If the
~19x-fewer-splats-resident, ~85%-smaller-download version still isn't enough,
the lever to pull next is a lower `?spkeep=`/shrink ratio, and if that still
isn't enough, `ocean.backdrop.mode` back to `'image'` is still a one-line
revert onto a floor that was already proven fast (Крок 17/18's own
conclusion) — don't chase a fourth splat placement past the point real
hardware says no.

## Крок 21: splat reduction is importance-ranked now, and splat quality is measurable offline

Reported as "uniform random point removal destroys visual coherence at high
compression ratios." Correct, and the fix is not a better random.

**The enabling change is `tools/splat-raster.mjs`: a CPU EWA splat rasterizer
in Node.** Every previous splat pass in this file hit the same wall — "real
placement tuning needs a real GPU", "do not try to place this from a headless
screenshot", "this environment cannot verify a 4-second budget", and Крок 20's
own hard lesson that a correctly-oriented capture and a broken one were *not
visually distinguishable* in a screenshot here. All of those limits are about
the **browser**. Rendering the splats on the CPU instead — standard 3DGS/EWA
projection, analytic 2D covariance, front-to-back compositing, ~1.5s a frame
against the browser's 100+ — turns "does this look right" into a number. It
models Spark's own `minAlpha`/`minPixelRadius`/`maxStdDev` so what it measures
is what the app draws, and it counts fragment evaluations so GPU cost can be
traded against quality. **This is the tool to reach for before any future splat
question, ahead of a screenshot.**

### Why the old stride was losing almost everything

`tools/analyze-spz.mjs` on the sea-canyon capture: the top **15% of splats by
contribution carry 92.7% of the rendered image**. A 15% stride keeps 15% of it.
Also 9.3% of splats sit below Spark's own `minAlpha` and 94.8% project
sub-pixel — the file is mostly splats that cannot paint anything.

The second failure is the one that actually produces the reported symptom. A
3DGS surface is opaque only because many Gaussians *overlap*. Remove 85% of
them uniformly and the surface stops being opaque: the capture goes
transparent and speckled rather than soft. **The artifact is missing opacity,
not missing detail** — which is why no amount of blurring or dithering fixes
it, and why "a bit soft is an acceptable price" (Крок 17's framing) was never
the trade actually on offer.

### What replaced it

`tools/shrink-spz.mjs`, three mechanisms, each measured:

1. **Importance ranking** (LightGaussian, arxiv 2311.17245 — scores a Gaussian
   by rays-that-hit-it x opacity x volume). The hit-count term is projected
   area, so the view-independent form is `opacity * s_largest * s_second` —
   the two largest axes, because 3DGS fits surfaces with flattened disc-shaped
   Gaussians and the third axis is disc thickness. `--theme=<key>` additionally
   weights by real projected pixel area over this project's own reachable
   camera clamps, but that makes the asset **placement-locked**, so it is opt-in.
2. **Spatial stratification** (Mini-Splatting, arxiv 2403.14166). Pure global
   ranking would empty a whole low-contrast region to fund one high-contrast
   ridge. A voxel grid guarantees **at least one survivor per occupied cell**.
3. **Coverage compensation.** Survivors grow by `sqrt(areaBefore/areaKept)` per
   cell to restore lost overlap, capped by `--maxgain`.

Three things here were wrong on the first attempt and are worth not
re-deriving:

- **A large per-cell floor is harmful.** The min-one-per-cell rule is the whole
  coverage guarantee; an *extra* `--floor` on top spends budget forcing 25% of
  every cell of junk splats. Measured 35.9 -> 27.5 dB at fixed budget going
  from floor 0 to 0.15. Default is now **0**.
- **The voxel grid must be calibrated to the budget, not hardcoded.** Occupied
  cells are a floor on the output count, so too fine a grid makes every cell
  keep exactly its one splat and the importance ranking has no budget left to
  express itself. At 256 cells the grid had 337,577 occupied cells against a
  261,215 budget: output overshot to 337,577 splats **and** quality dropped to
  32.9 dB, worse than the 192-cell grid's 35.1 dB with 29% fewer splats. The
  grid is now binary-searched to put occupied cells at `--occupancy` (0.65) of
  the budget; measured flat between 0.4 and 0.85.
- **Compensation is worth only +0.24 dB, and that is the proof the diagnosis
  was right.** Importance ranking keeps the big splats, so it retains the area
  for free and has almost nothing to put back. A stride retains area in
  proportion to count and would need a 2.6x gain at 15%.

### The numbers

`tools/splat-compare.mjs`, full 1.92M cloud as ground truth, matched counts:

| kept | count | stride PSNR | importance PSNR | gain |
|---|---|---|---|---|
| 4.5% | 87,071 | 12.10 dB | **28.38 dB** | +16.3 |
| 9.1% | 174,143 | 14.12 dB | **32.86 dB** | +18.7 |
| 13.6% | 261,215 | 15.49 dB | **35.87 dB** | +20.4 |
| 22.7% | 435,359 | 17.59 dB | **40.05 dB** | +22.5 |

**The new method at 87k splats beats the old at 435k** — 5x fewer, better
looking. Against what actually shipped (288k stride file, then client-strided
to 35% = 100,800 resident), at the identical 100,800:

| | PSNR | mean luma error | download |
|---|---|---|---|
| shipped before | 12.94 dB | 37.5 / 255 | 4.88 MB |
| importance | **29.55 dB** | **4.0 / 255** | 1.76 MB |

**One honest caveat, do not lose it: importance selection keeps the LARGE
splats, so at matched count it costs ~2.9x the fragment/overdraw work**
(7.11M vs 2.47M evaluations per frame). Splat count is not the GPU cost here;
covered area is. The equal-GPU-cost operating point is roughly 40-60k splats
with `--maxgain=1.0` and `maxStdDev` sqrt(3), which still lands +8 to +11 dB
over what shipped while using 40-60% fewer splats. Shipping 60,000
(`public/ink-wash-sea-canyon-opt.spz`, **1.05 MB**, down from 4.88 MB and from
32.5 MB raw).

### The Spark levers, finally measured (`tools/spark-levers.mjs`)

| setting | PSNR | drawn | fragments |
|---|---|---|---|
| `minAlpha` 0.02 | inf | 100.0% | 100.0% |
| `minPixelRadius` 1.0 | inf | 100.0% | 100.0% |
| `maxStdDev` sqrt(5) | 37.8 dB | 99.9% | 69.5% |
| `maxStdDev` sqrt(3) | 28.5 dB | 99.8% | 47.5% |

**`minAlpha` and `minPixelRadius` are now completely inert** — the offline
pruner already removed everything they would have culled, so Крок 16 Section
B's writeup of them as the perf story no longer holds (they culled 9.3% and
94.8% of the *raw* file; they are kept only as a guard for an unpruned
capture). `maxStdDev` is the only lever that does anything and it moves
fragment cost, which is the cost that matters. Lowered to **sqrt(3)**: 32% less
fragment work for 1.6 dB on a backdrop sitting behind fog. `?spstddev=`
overrides it live.

**`SPLAT_KEEP_FRACTION` in `SplatBackdrop.jsx` is now 1.0 and must stay there
for a pre-pruned asset.** Striding an importance-selected cloud discards the
chosen splats at the same rate as any others and puts the speckle straight
back — the two policies do not compose. `?spkeep=` survives as a runtime
emergency lever only; the real fix for "still too heavy" is a smaller
`--count` when regenerating.

### Ocean's placement is broken, and that is a bigger cost than any of the above

Found while building the measurement, not looked for. `tools/place-splat.mjs`
scores placements over the reachable orbit — nearest in-frame splat, frame
coverage, and luma std dev ("detail", the number that separates a real vista
from a uniform wall, which is exactly what a screenshot here cannot resolve):

| placement | nearest splat | coverage | detail | fragments/frame |
|---|---|---|---|---|
| **shipped ocean** (s12, [0,0,0]) | 14.7 | 0.93 | 0.045 | **36.0M** |
| mist-style (s3, [-48,-5.9,36]) | 17.8 | 0.71 | 0.046 | 21.3M |
| landmass (s3, [-48,-12,36]) | 17.9 | 0.83 | **0.064** | 23.1M |
| surround (s12, y-40) | 51.7 | 0.95 | 0.056 | 42.2M |

At the shipped transform the capture is scaled 12x around the board's own
origin, so the camera sits **inside** it: a CPU render of the full cloud there
is a literally flat teal wall (`tools/shots/place-shipped-ocean--v0.png`),
coverage 0.93-1.0, and **~880 fragment evaluations per pixel**. That is the
90%-GPU report's actual source — overdraw from a capture at point-blank range,
not point count. It is also the same "camera buried inside a hillside" failure
this file already records for mist at scales 12, 2 and 1.

The capture is a roughly circular *island* ~25 local units across, not a
panoramic surround, so it can only ever read as a landmass at backdrop
distance — which is what mist's own placement already does. **This was not
changed**, because which placement looks right is an art-direction call and
Крок 17/18 already reverted splats once on a real-device signal. But the
placement scan is now a 2-minute offline command instead of impossible, so the
next attempt should start there rather than from `?sp*=` sweeps in a browser.

### What was verified in the browser, and the trap that made it look broken

Verified end-to-end against a production `next build`: `window.__splat` reaches
`{state: 'ready', count: 60000}` with no console/page errors, and the live
`SparkRenderer` reads back `minAlpha 0.02, minPixelRadius 1, maxStdDev 1.7321`
— i.e. the new asset loads at exactly the count the tool produced (proving no
client-side stride ran on top of it) and the levers are actually applied. The
file was independently validated by parsing it with **Spark's own `SpzReader`**:
60,000 splats, zero invalid centers/scales/quaternions, mean scale 5.2x the
source's (it kept the big splats, as designed).

**Two environment traps cost real time here; don't repeat them.** A headless
run will report `window.__splat` as `null` or stuck at `'loading'` forever, and
neither means the splat is broken:

1. **`isLowPowerDevice()` in `Backdrop.jsx` is `(max-width: 768px), (pointer:
   coarse)`, and a splat NEVER mounts on a match** (Крок 17). A 400x300 or
   480x320 headless viewport silently skips the splat entirely and
   `window.__splat` stays `null`. Use a viewport wider than 768px.
2. **`SPLAT_LOAD_BUDGET_MS` is 4000**, and nothing loads that fast in this
   environment, so `ThemedSplatBackdrop` always unmounts before ready — which is
   why an earlier attempt saw `'loading'` and then nothing. Raise it temporarily
   to verify a splat in a headless run, and put it back.

Load time is **not** differentiated by this test: old (4.88 MB) and new (1.05 MB)
both reached ready in 8s over localhost, where there is no bandwidth
constraint. The 4.6x download cut is real but only shows on a real network —
and it is what makes the 4-second budget above plausible at all, which 32.5 MB
never was.

Real fps/VRAM remains unmeasured here, as everywhere else in this file. Check
`?debug=1`'s `FpsCounter` on real hardware; `?spstddev=` and `?spkeep=` tune it
without a rebuild, and `ocean.backdrop.mode` back to `'image'` remains the
one-line revert onto a floor already proven fast.

### Snow: enabled, decluttered, and its placement solved rather than inherited

Snow was still on `mode: 'image'` from Крок 17, so none of the above was
visible in the theme this project's own notes called the successfully-placed
one. Turning it on surfaced two things.

**"Snow's splat WAS successfully placed (Крок 16 Section B)" does not survive
measurement.** At its old transform (scale 12 at the origin)
`tools/place-splat.mjs` scores the nearest in-frame splat at **2.1 world
units** — inside the board, half-width 4.3 — coverage 0.998, and **~3,690
fragment evaluations per pixel**, four times worse than ocean's already-bad
880. That is where the 20fps/90%-VRAM report came from. It had been judged
from two screenshots, in the environment this file now documents as unable to
tell a good splat placement from a broken one.

The replacement transform is **solved, not swept**: the body centroid is put
at world `[4, -32, 60]`, inside the elevation band the resting camera actually
frames — it pitches 37.3 degrees down, so at that distance the visible band is
world y `-10.5 .. -25.3`, the same derivation `Backdrop.jsx`'s own `TOP_Y`
already uses for the painting. Measured: nearest splat 2.1 -> 32.0, fragments
per frame **151M -> 5.4M (28x less overdraw)**. `rotX -90` is kept and is
independently confirmed by `tools/probe-splat-axes.mjs` (p01-p99 spread 86.6
on Z vs 104.1/118.5 on Y/X — this capture really is Z-up, unlike mist's).

**`--declutter` is new, and it is the one place PSNR-to-original is the wrong
metric.** Every Mint capture here carries a tail of detached splats flung
clear of the body (the isolated blobs in `tools/shots/wide-*.png`). Importance
ranking makes them *worse*, not better, which is not obvious: clutter splats
are large and opaque, exactly what the score rewards, so they survive
preferentially while real surface detail is culled around them — and a single
stray speck is what sets the "nearest splat" distance and reads as dirt
floating over the board. `--declutter=N` drops splats whose voxel cell holds
fewer than N others, i.e. it tests local density rather than distance from a
centroid, so a far-but-solid ridge survives and a nearby speck does not.

Measured on snow at 60,000 splats, against the full cloud:

| | PSNR | fragments | reads as |
|---|---|---|---|
| stride | 22.20 dB | 1.16M | speckle |
| importance, no declutter | **34.47 dB** | 13.7M | featureless white blob |
| importance, `--declutter=100` | 19.52 dB | **5.4M** | snowy ridge with real structure |

The importance-vs-stride result is the same +12.3 dB as ocean's. But declutter
*lowers* PSNR monotonically, and that is correct and expected: it deliberately
removes content that exists in the original, so a fidelity-to-original metric
can only punish it. The visual check decides it, and decides it clearly
(`tools/shots/fin-*.png`) — the undecluttered file's own clutter blobs
dominate the silhouette into an amorphous cloud, while the decluttered one
shows the ridge. **Do not "fix" the declutter default by chasing the PSNR
number**; it is measuring faithfulness to garbage. Ocean's shipped asset is
built without declutter, snow's with `--declutter=100`.

Both themes verified in the browser against a production build:
`{state: 'ready', count: 60000}`, `maxStdDev 1.7321`, no console or page
errors, snow in 10s and ocean in 8s.

## Крок 22: Mist's splat, and what that capture actually is

The third splat — `public/sumi-e-mountain-valley-6472fa791839e183.spz`, the
one this file has recorded as "wired, not yet placed" since before the theme
system existed — got Крок 21's pipeline and is **on** now, at a placement
that is solved rather than swept. Ships as
`public/sumi-e-mountain-valley-opt.spz`: **1,920,000 -> 60,000 splats, 33.26 MB
-> 1.08 MB**, importance-ranked (26.43 dB / 4.31 luma MAE against the full
cloud, where the old fixed-stride policy measures **16.94 dB / 17.10 MAE** at
the identical count — the same ordering ocean and snow showed).

**The structural finding, which is why three previous placement attempts
failed: this capture is a panorama shot from the INSIDE.** Not a landmass.
`tools/analyze-spz.mjs` plus an importance-weighted XZ mass map put its local
radius at ~116 with **no open interior** — the nearest splat in the low
elevation band is 0.1-1.5 local units at every candidate clearing centre
tested. There is nowhere in it to stand. That is the whole content of this
file's own "camera buried inside a hillside" / "close, muddy interior — no
vista" history (scale 12, 2 and 1, then two more reasoned attempts in Крок
18), and it is not a tuning gap: any placement that puts the camera inside
this cloud is inside geometry.

Two consequences worth not rediscovering:

- **From outside, this capture is a soft pale ink-wash mass, not a ridge.**
  Rendered wide with `tools/splat-raster.mjs` (`tools/shots/wide-mist-*.png`),
  the full 1.92M cloud and the 60k pruned one look the same — so this is not a
  pruning artifact. Its solid content is one small ridge and a couple of rock
  clumps; everything else is diffuse haze.
- **Therefore mist ships WITHOUT `--declutter`, unlike snow.** Declutter tests
  local density, and here the haze *is* the backdrop: `--declutter=300` takes
  rest-view frame coverage from 0.313 to 0.020 and leaves two small clumps
  reading as floating debris. `--declutter=30` is the honest middle (drops
  7.5%, coverage 0.313 -> 0.273, fragments -26%, PSNR 26.43 -> 20.07) and is
  the lever to reach for if real-hardware fps ever demands it. Snow's
  `--declutter=100` is right for snow's capture and wrong for this one; the
  flag is per-capture, not a house style.

### The placement, and the trap that nearly picked a placement of nothing

`{ scale: 0.42, rotation: [0, -196.6, 0], position: [-22.8, -38.7, 55.5] }`.
Every number is derived:

- **`rotY -196.6`** swings the capture's own densest region (importance-weighted
  centroid local `[10, 35, -98]`, azimuth 174.2 deg) round to the direction the
  resting camera looks — which is the painted main segment's own azimuth,
  `HOME_AZIMUTH - PI` = -22.4 deg. Rotation about Y only: `tools/probe-splat-
  axes.mjs` re-confirms this capture is Y-up (p01-p99 spread 68.2 on Y vs
  134.5 / 158.8 on Z / X), so snow's `rotX -90` correction stays off it.
- **`position`** is 60 world units out along that azimuth, sunk so the ridge
  tops (local y ~ +60) land 19 deg below horizontal from the resting camera at
  y=7 — the same visible-band derivation `Backdrop.jsx`'s own `TOP_Y` uses for
  the painting.
- **`scale 0.42`** sets the range's height to 45% of its distance. Appearance
  is **invariant under a rigid scale-and-push** (only `s/D` matters), so this
  is one point on a line; the D=140 / scale 0.76 twin renders pixel-identically
  and was scored to confirm it.

**The trap: a placement can score well on `tools/place-splat.mjs` and be
invisible in the game.** That tool's view ring is deliberately shallow-biased
(the right bias for "is the camera buried"), and a shallow camera sees above
the horizon. The resting camera does not — it pitches 37.3 deg down, so its
frame *top* is already 16.3 deg below horizontal. A candidate at `posY 0`
scored coverage 0.21 and 4.6M fragments on the ring, looking like the cheapest
winner, and measured **rest-view coverage 0.000**: the entire capture sat above
the resting frame. Score the resting camera explicitly before believing a ring
number; the derivation above is what actually decides visibility.

Measured with `tools/place-splat.mjs` (8 views, 224px) and a rest/shallow/behind
render at 320x200, against snow's shipped placement as the reference this
project already accepts:

| placement | nearest splat | rest coverage | rest detail | rest Mfrag |
|---|---|---|---|---|
| **snow SHIPPED** (reference) | 35.6 | 0.418 | 0.108 | 5.5 |
| ocean SHIPPED (the known-broken one) | 15.5 | — | 0.169 | — |
| mist's old s3 transform | 28.6 | 0.743 | 0.173 | **31.6** |
| sunk valley, camera inside the bowl | 20.5 | 0.817 | 0.091 | **25.3** |
| **mist SHIPPED (this pass)** | **45.5** | **0.410** | **0.100** | **2.7** |

So the shipped placement frames like snow's (coverage within 1%) at **half the
fragment cost**, and both enclosing alternatives cost 9-12x it — the Ocean cost
profile a real device already rejected at 20fps. Coverage 180 deg away is
exactly **0.000**, so the painted segments still carry the rest of the orbit
unaided; the splat is a one-sided horizon band, not a dome.

### Verified in the browser, and the A/B that makes a headless check meaningful

Against a production `next build`: `window.__splat` reaches `{state: 'ready',
count: 60000}` in 11s over localhost, no console or page errors, and the live
`SplatMesh` reads back `scale 0.42 / position [-22.8, -38.7, 55.5] / rotY
-196.6` with `SparkRenderer` at `minAlpha 0.02, minPixelRadius 1, maxStdDev
1.7321` — i.e. the transform and the levers are really applied and no
client-side stride ran on top of the pruned asset.

**The useful check here is not a screenshot, it is a screenshot diff.** Крок 20
established that this environment cannot judge a splat by eye; but `?spopacity=0`
turns the splat off without changing anything else, so shooting the same shallow
camera twice and differencing the PNGs measures exactly which pixels the splat
contributes. Result: **43,622 pixels, 4.3% of the frame, max channel delta 109**,
concentrated in frame rows 20-60% from the top — the horizon band above and
behind the rock, spread across most columns. Far less than the CPU raster's
unoccluded 0.44 coverage, because in the real scene the rock, board, fog and
painting sit in front of it; it reads as a horizon band rather than a wall,
which is the intended backdrop role. Prefer this A/B over "does it look right"
for any future splat question this environment is asked to answer.

Real fps/VRAM is unmeasured here as always — `?debug=1`'s `FpsCounter` on real
hardware is the check, `?spstddev=` / `?spkeep=` tune it without a rebuild, and
`mist.backdrop.mode` back to `'image'` is the one-line revert onto a floor
already proven fast.

`tools/place-splat.mjs` gained `--candidates=list.json` so a scan against a
capture the built-in list wasn't written for is reproducible instead of a
throwaway edit to that array. `tools/splat-importance.mjs`'s `THEME_PLACEMENTS`
was **stale** for mist and snow (it still held pre-Крок-21 transforms while
claiming to mirror `lib/themes.js`); it is corrected, and it matters because
`--theme=` weighting is placement-locked.

## Крок 23: splats off, painted panoramas ship

> **Superseded for Ocean by Крок 24 below** — ocean is on `mode: 'splat'` now,
> at a derived placement, on the strength of a visual A/B this pass did not
> have. Mist and snow are still exactly as this section leaves them, and
> everything below about *why* the painted floor is the safe default still
> stands. This section's original title called this "the final state"; it was
> the final state of the splat *investigation*, not a permanent verdict.

**All three themes were put on `backdrop.mode: 'image'`.** Splat work is
stopped; this is the shipping configuration, not another revert
mid-investigation.

The reasoning is the one this file already establishes and never resolved: the
only real-hardware signal any splat placement ever produced was **20fps / 90%
VRAM** (Крок 17/18), and every improvement since — Крок 21's importance-ranked
pruning, Крок 22's solved placements — is measured **offline, by
`tools/splat-raster.mjs`**, against PSNR and fragment counts. Those numbers are
real and the pipeline is genuinely good, but not one of them is an fps or a
VRAM reading on the target device, and this environment provably cannot produce
one (see "Headless browser", and Крок 20's finding that a correctly-oriented
capture and a broken one are not visually distinguishable in a screenshot
here). The painted panorama is the only backdrop path with a real-device pass
behind it, every theme has its own (Крок 18), and it costs 434 KB–1.6 MB
against a splat's 1.05 MB plus per-frame sort and overdraw.

Nothing was deleted. Every theme keeps its `splatUrl` and its measured `splat`
transform, `SplatBackdrop.jsx` and all of `tools/`'s splat tooling are
untouched, and `?sp*=` still works — **re-enabling any one theme is flipping
that theme's own `mode` back to `'splat'`**, exactly as it was before this pass.
If that ever happens, mist is the one to try first (Крок 22's placement: rest
coverage matching snow's at half the fragment cost) and **ocean is the one to
try last** — its shipped transform scales the capture 12x around the board's
own origin, putting the camera inside it at ~880 fragment evaluations per pixel,
which is a placement this file measured as broken and never fixed.

Also removed: `THEMES.snow.backdrop.fallbackMode: 'procedural'`, dead since
Крок 18 gave snow a real painting. Nothing ever read it — `Backdrop.jsx` keys
off `image` + `mode` alone — and it read as "snow ships the procedural ridges",
which was never true after Крок 18 and is definitely not true now.

Verified: `npm test` 17/17, `next build` clean (5 static pages, 84.8 kB first
load on `/`), and a production `npm start` serves `/`, `/?theme=ocean` and
`/?theme=snow` at 200 with all three paintings fetching 200.

**Two loose ends left deliberately, both flagged rather than changed:**

- `public/` still carries **~102 MB of `.spz`** (three raw ~31 MB captures,
  three pruned `-opt.spz`, plus older `-shrunk`/`.rad` intermediates). Nothing
  fetches any of it now, but everything under `public/` deploys, and the three
  raw captures are **git-tracked**. Untracking those three and moving them to
  `assets-src/` (where `mountains-source.png` and `models-original/` already
  live, gitignored and outside `public/`) is the cleanup — it needs a call on
  whether to rewrite history for the already-committed blobs, so it wasn't done
  unasked.
- Ocean's and snow's paintings are **~1.6 MB PNGs** against mist's 434 KB JPEG.
  Same content type, ~3.7x the bytes, on the critical path for two of three
  themes. Re-encoding both to JPEG at mist's quality is the obvious win and
  needs no code change (just the `backdrop.image` extension).

## Крок 24: Ocean's splat back on, at a derived placement

**Ocean is `mode: 'splat'`; mist and snow stay on `'image'`.** Крок 23's "final
state" held for the two themes that were never re-tested; ocean's was revisited
because a splat-lab A/B judged the 60,000-splat importance-pruned sea-canyon
asset near-indistinguishable from the full 1.92M cloud, which is the visual
evidence Крок 23 said it did not have.

**The asset did not change and did not need to.**
`public/ink-wash-sea-canyon-opt.spz` is Крок 21's file, unmodified: importance-
ranked, **no `--declutter`**, 60,000 splats, 1.05 MB. Re-confirmed before use
with `tools/probe-splat-axes.mjs` — 60,000 splats, Y-up (p01-p99 spread 14.89 on
Y vs 27.58/27.71 on X/Z), so snow's `rotX -90` correction stays off it, per Крок
20's own lesson about copying that onto an already-Y-up capture.

`SPARK_MAX_STD_DEV_DEFAULT` went **sqrt(3) -> sqrt(5)** (`SplatBackdrop.jsx`).
Крок 21 lowered it to buy fragment cost back at ocean's *old* placement and its
~880 evaluations per pixel; that placement is gone, the new one costs ~3.0M
fragments a frame, and sqrt(5) is both the 37.8 dB row in that file's own table
and what `tools/splat-raster.mjs`'s `SPARK_DEFAULTS` already model — so the
offline numbers now describe what ships. `?spstddev=` still overrides it.

### The placement, derived the same way Крок 22 derived mist's

`{ scale: 1.847, rotation: [0, 135, 0], position: [-17.33, -45.17, 53.25] }`,
replacing `scale 12` at the origin — the transform this file has recorded as
broken since Крок 21 (camera *inside* the cloud, ~880 fragment evaluations per
pixel). Position is 60 world units out along the painted main segment's own
azimuth (`HOME_AZIMUTH - PI` = -22.4 deg), sunk so the body spans 21..38 degrees
below horizontal from the resting camera at y=7 — the same visible-band
derivation `Backdrop.jsx`'s `TOP_Y` uses. `rotY 135` is measured, not chosen by
eye: of eight rotations scored it gave the highest rest coverage at essentially
the best nearest-splat distance with zero coverage 180 degrees away.

Крок 22's trap applies here too and was avoided the same way — candidates were
scored against the **resting camera explicitly**, not just `place-splat.mjs`'s
shallow-biased ring. Distance is confirmed to be one point on a line: D=45/60/75
at the same angular band scored identical coverage and detail, exactly the
scale-and-push invariance Крок 22 documents.

| placement | nearest | rest cov | rest detail | rest Mfrag | behind cov |
|---|---|---|---|---|---|
| mist (Крок 22 reference) | 45.5 | 0.410 | 0.100 | 2.7 | 0.000 |
| snow (Крок 21 reference) | 35.6 | 0.418 | 0.108 | 5.5 | — |
| **ocean SHIPPED (this pass)** | **50.5** | **0.440** | **0.216** | **3.0** | **0.000** |
| ocean OLD (scale 12 at origin) | 14.4 | 0.383 | 0.232 | 21.9 | — |

**One derivation detail worth not re-deriving: fit the band to the body's
UNWEIGHTED positional p01..p99 (height 14.89), not an importance-weighted
extent.** Importance-weighting reports height 51 and collapses the island to 2%
frame coverage, because importance ranking *favours* this capture's detached-
clutter tail — those splats are large and opaque, the same property that makes
`--declutter` matter for snow. This cost a full scoring pass before it was spotted.

### `--declutter` stays off, and this is now measured for ocean specifically

The no-declutter call came from the lab A/B; it is independently confirmed here.
Built a `--declutter=100` variant at the identical count and rendered both at the
resting camera: it takes frame coverage **0.435 -> 0.105** and leaves scattered
fragments rather than an island (`tools/shots/ab-declutter100.png`). Same
per-capture result mist showed — `--declutter` is right for snow's capture and
wrong for this one; the flag is per-capture, never a house style.

**The residual cosmetic issue, flagged not fixed:** that clutter tail is still
present, and at rest it reads as a few soft dark blobs floating in the sky at the
frame corners. It is in the full 1.92M cloud too, so it is the capture's own
content rather than a pruning artifact — which is exactly why the lab A/B scored
the pruned file as faithful. Declutter is not the fix (above). A milder
`--declutter=20..30` is the untested middle if it ever matters enough.

### Verified

`npm test` 17/17; `next build` clean (84.9 kB first load on `/`, Spark still a
lazy async chunk); production `npm start` serves `/`, `/?theme=ocean`,
`/?theme=snow`, the `.spz` and the painting all 200.

In-browser against the production build, `?theme=ocean&debug=1`: `window.__splat`
reaches `{state: 'ready', count: 60000}` — the pruned count exactly, proving no
client-side stride ran on top of it (`SPLAT_KEEP_FRACTION` is 1.0 and must stay
there for a pre-pruned asset) — with no console or page errors, and the live
`SplatMesh` reads back `scale 1.847 / position [-17.33, -45.17, 53.25] / rotY
135` with `SparkRenderer` at `minAlpha 0.02, minPixelRadius 1, maxStdDev 2.2361`
(= sqrt(5)), i.e. transform and levers really applied.

Two environment notes, both already documented and both hit again: the splat
never mounts below a 768px-wide viewport (`isLowPowerDevice`), and
`SPLAT_LOAD_BUDGET_MS` (4000) must be raised temporarily for a headless run or
`ThemedSplatBackdrop` unmounts before ready — **it was raised to 120000 for this
verification and put back to 4000**.

The painting still renders underneath (`usesPainting` is true whenever `image` is
set and `mode` is not `'procedural'`), so this is a horizon band layered on the
proven-fast floor, never a replacement for it — and coverage 180 degrees away is
0, so the painted segments carry the rest of the orbit unaided.

**Real fps/VRAM remains unmeasured here**, as everywhere else in this file.
`?debug=1`'s `FpsCounter` on real hardware is the check; `?spstddev=` (try
sqrt(3) first) and `?spkeep=` tune it without a rebuild, and
`ocean.backdrop.mode` back to `'image'` is the one-line revert onto a floor
already proven fast.

### An enclosing placement was investigated and is NOT viable with a pruned asset

Asked for directly: make the capture a surrounding environment (cave/canyon
walls around the play area) with the camera inside it, using the 60,000-splat
pruned asset rather than the raw 1.92M file that caused the original
20fps/90%-VRAM report. Measured, not argued — and the premise turns out to be
inverted, so record the result rather than retrying it.

**This capture does have an interior, unlike mist's.** An importance-weighted
radial mass profile over the standing elevation band puts only 8.1% of mass
inside local r<5.7, with 53% concentrated in a rim at r 11.4..15.7 — a genuine
shell with a clearing. So "camera inside" is geometrically possible here, which
is why this was worth measuring instead of dismissing on mist's precedent.

**But importance pruning is the wrong optimisation for close range, and it is
wrong by construction.** The pruner keeps the LARGE splats (the shipped file's
mean scale is 5.2x the source's — CLAUDE.md's Крок 21 says so explicitly). At
backdrop distance those carry the image; with the camera inside them they smear
into blobs. Same placement (scale 2.5, rotY 135, body median at camera height),
same raster, rest view:

| asset | splats | MB | coverage | detail | frag/px | reads as |
|---|---|---|---|---|---|---|
| pruned (shipped) | 60,000 | 1.0 | 0.787 | 0.188 | 531 | smeared blur |
| re-pruned `--maxgain=1.0` | 200,000 | 3.3 | 0.920 | 0.100 | 1088 | speckled, some structure |
| re-pruned `--maxgain=1.0` | 600,000 | 9.9 | 0.987 | 0.071 | 1506 | **real cave interior** |
| full cloud | 1,920,000 | 31.0 | 0.990 | 0.071 | 1580 | real cave interior |
| **shipped BACKDROP placement** | 60,000 | 1.0 | 0.319 | 0.203 | **33** | horizon band |

Two things fall out, and they close the question:

1. **The look requires ~600,000 splats** — the 60k asset cannot produce it at any
   scale/position. Every enclosing candidate swept with it (scales 1.5-16, three
   height offsets, plus eye-level variants) scored coverage 0.79-0.98 against
   detail 0.026-0.13, which is `place-splat.mjs`'s own documented signature for a
   flat wall rather than a vista, and every render confirmed it.
2. **At that count it costs ~1506 frag/px, ~45x the shipped backdrop's 33** — and
   ~4.4x the old broken scale-12 placement (342 frag/px measured the same way),
   which is the placement that already produced 20fps/90% VRAM on real hardware.

So pruning that makes the enclosing placement affordable destroys the look, and
pruning that preserves the look does not make it affordable. **Do not re-attempt
this with a different scale/position** — the sweep above already covers the range,
and the binding constraint is covered area per pixel, which placement cannot
change while keeping the camera inside. A genuinely enclosing splat world for
this scene needs a capture authored as an interior (dense, small Gaussians near
the viewer), not a re-placement of this one.

Note also `detail` *inverts* its usual meaning here: the 60k blur scores the
highest detail (0.188) of the enclosing candidates because its speckle is
high-variance noise, while the good 600k cave scores 0.071. Luma std dev
separates a vista from a wall at backdrop distance; it does not separate
structure from noise at point-blank range. Use the renders for that.

**In the real scene it looks better than the CPU raster alone suggests**, and
that is worth knowing before judging the numbers above too harshly: the raster
renders the splats unoccluded, but in the game the board, rock, pieces and fog
fill the middle of the frame, so the 600k enclosing placement reads as genuine
cave walls wrapping the play area (`tools/shots/enc-browser-rest.png`, shot
against a production build). The look is not in question — only the cost is.

**Two URL knobs exist so that cost can be settled on a real device without a
rebuild or a committed default**, since that is the one measurement this
environment cannot make:

- **`?spurl=`** (`SplatBackdrop.jsx`) swaps the capture. Restricted to
  same-origin absolute paths — the value goes straight into a fetch.
- **`?spbudget=`** (`Backdrop.jsx`) raises `SPLAT_LOAD_BUDGET_MS` (4000) for a
  deliberate experiment. Needed because a heavier capture routinely takes longer
  than 4s to fetch and decode, and the guard firing silently unmounts it —
  which reads as "the splat is broken" rather than "the guard worked". This was
  confirmed both ways here: at the stock budget the headless run reports
  `state: 'loading'` with a null mesh, and with `?spbudget=240000` the same run
  reaches `{state: 'ready', count: 600000}`.

The test asset ships in `public/` as `ocean-close-600k.spz` (10.4 MB,
`--count=600000 --maxgain=1.0`, no declutter). **It is a test artifact, not a
shipped one** — nothing references it, and it should be deleted along with the
other unreferenced `.spz` files (Крок 23's loose end) once the real-device
question is settled either way.

The full enclosing test URL, for the record:

```
/?theme=ocean&debug=1&spurl=/ocean-close-600k.spz
  &spscale=2.5&sprotY=135&spposX=7.46&spposY=-16.9&spposZ=-3.01&spbudget=240000
```

**Ocean's shipped default is unchanged by any of this** — still the Крок 24
backdrop placement at 33 frag/px. Nothing about the enclosing experiment is
committed to the theme registry.

## Крок 25: the enclosing placement, tested on real hardware, and reverted

Continuing straight from Крок 24's enclosing-placement investigation, three
more iterations happened before a real-device test settled it:

1. **A clearance fix.** The first enclosing candidate (scale 2.5, anchored at
   the capture's own mass centroid) measured only 2.59 world units of
   clearance between the board+rock cylinder and the nearest opaque splat —
   confirmed both numerically and visually (an edge-camera screenshot showed
   the misty wall starting right at the board's back rank, no gap). The fix
   was changing *which* local point gets anchored to the board's floor, not
   the scale: the capture's vertical mass profile put 21.6% of its content in
   one dense top band (its ceiling), so anchoring a lower local point (`floor
   = 6.6`, versus the centroid's `9.56`) sinks the whole cave and moves the
   camera into a sparser band. Three candidates (A/B/C) were offered; the user
   picked **B** (scale 4, `floor 6.6`) as "closest so far" after a live check.
2. **A 2-3x scale-up request, checked before running.** The transform is a
   rigid dilation about a fixed anchor that maps exactly to the board's own
   centre: `world = scale * R * (local - anchor)`. Two things followed from
   that algebraically and were confirmed numerically before handing over a
   URL (`tools/_tmp-scaleup-check.mjs`, not kept): clearance can only improve
   with scale (content far from the anchor is pushed proportionally farther
   away), and fragment cost stays roughly flat across scale — measured 386 →
   464 → 435 → 396 → 415 frag/px for scale 4 → 6 → 8 → 10 → 12, because a pure
   dilation keeps splats' angular size roughly constant as seen from a fixed
   camera (world size and distance from camera both scale by the same
   factor). Scale 10 (2.5x variant B) was handed over as a single URL on that
   basis — clearance 25.4, wall radius 125 (vs B's 51), at 396 frag/px
   (essentially B's own 386).
3. **Real-device result: 165fps on the on-screen counter, 95% GPU, and
   visible stutter — and the world did not read as farther away despite the
   2.5x scale-up.** Both observations are real and both are explained by the
   same thing, not two separate problems:
   - **The fps counter and the actual experience disagreeing is the far more
     important signal, and the counter is the one to distrust.**
     `HUD.jsx`'s `FpsCounter` counts `requestAnimationFrame` callbacks; on a
     saturated GPU with vsync/compositor behaviour that decouples the
     callback rate from actually-presented frames, that count can read high
     while the user visibly experiences stutter. 95% GPU utilisation plus
     visible stutter is the ground truth here — a high number on a counter
     that measures callback frequency, not presented frames, does not
     override what the eye and the GPU meter both reported. This is the same
     class of caution CLAUDE.md already carries for this environment's OWN
     `FpsCounter` reading 60 regardless of real cost (see "Headless
     browser") — the lesson generalises: an FPS counter is only as
     trustworthy as its relationship to the compositor, on any device.
   - **The world not appearing to recede is the direct, predictable
     consequence of the placement being a dilation about a point the camera
     is (relatively) close to.** As scale grows, both a splat's world size
     and its distance from the fixed camera position grow by the same
     factor, so its *angular* size — how big it looks on screen — stays
     roughly constant. Geometric radius genuinely doubled (measured: wall
     radius 51 → 125), but perceived distance does not track geometric
     radius here the way it would for a placement where the camera sits
     outside the dilated body (which is exactly what the Крок 24 backdrop
     placement does, and exactly why doubling THAT placement's distance
     really would read as "farther away"). This was flagged as a
     risk during Крок 24's own reasoning about far-field angular-size
     invariance but not surfaced to the user at the time; the real-device
     report confirms it as an actual, not just theoretical, effect.

**Decision: stop iterating, revert Ocean's default to `mode: 'image'`, keep
the enclosing placement reachable via an explicit saved link.** This was the
user's own call, made in advance ("if scaling up pushes cost or complexity
into diminishing returns, tell me honestly and we'll cut losses... I don't
want to keep iterating indefinitely on this one theme") and confirmed once
the real-device result came back exactly as that clause anticipated.

**The saved link needed one more piece of machinery, not just flipping
`mode` back.** `Backdrop.jsx`'s `usesThemeSplat` was gated purely by
`theme.backdrop.mode === 'splat'` — every other `?sp*=` knob (`spurl`,
`spscale`, `spstddev`, …) only has any effect once `SplatBackdrop` actually
mounts, so reverting `mode` to `'image'` would have silently broken every
previously-working test URL, including the one about to be handed over as
"the saved link." Added **`?spforce=1`** (`Backdrop.jsx`, same
read-once-at-module-load convention as `IS_LOW_POWER` right next to it):
mounts a theme's splat regardless of its own `backdrop.mode`, still gated by
`IS_LOW_POWER` (a forced splat is still an explicit test, not a reason to
skip the mobile/coarse-pointer safety net). Verified both directions against
a production build: `/?theme=ocean&debug=1` now reports `window.__splat ===
null` (nothing mounts), and the saved link below reaches `{state: 'ready',
count: 600000}` with no console errors.

The saved link, for reproducing variant B scaled to 10 (2.5x):

```
/?theme=ocean&debug=1&spforce=1&spurl=/ocean-close-600k.spz
  &spscale=10&sprotY=135&spposX=29.84&spposY=-66&spposZ=-12.02
  &spstddev=1.732&spbudget=240000
```

`spbudget` (Крок 24) is required in this URL specifically because the
600,000-splat test asset (10.4 MB) routinely takes longer than the
production `SPLAT_LOAD_BUDGET_MS` (4000) to fetch and decode; without it the
splat silently times out and unmounts. `public/ocean-close-600k.spz` is
**committed** (not left untracked like the earlier `ocean_scene.spz`
duplicate) specifically so this link keeps working once deployed — Vercel
only serves what's actually pushed.

`lib/themes.js`'s `ocean.backdrop.mode` is `'image'` again; `splatUrl` and
`splat` (still the Крок 24 horizon-band placement, 33 frag/px, unaffected by
any of this section) stay wired, same convention as mist/snow — re-enabling
is still `mode: 'image' -> 'splat'` on one field if a real-device signal ever
justifies it again. The enclosing-placement family (variant B, scale 10, or
anything derived the same way) is not wired into the registry at all and was
never meant to be — it lives only behind `?spforce=1` and its own explicit
`?sp*=` parameters.

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

## Gaussian splat backdrop — the mist capture's own history

**Placement and enabling are settled by Крок 22 above; read that first.** The
`BACKDROP_MODE` constant this section was named for is gone (Крок 18), the
capture ships pruned as `public/sumi-e-mountain-valley-opt.spz`, and mist's
`backdrop.mode` is `'splat'`. What survives here is the per-capture forensics
below — file format, extent, the clutter cell at the origin, the Spark/three
pinning constraints, and the placements that were tried and rejected — none of
which Крок 22 invalidates. The paragraph that follows is the pre-Крок-22 state,
kept because its reasoning is why three attempts failed.

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

### Крок 16, Section B: the snow splat was upside down, `SplatBackdrop.jsx` is now theme-agnostic, and a real perf lever

**The snow splat (`ink-wash-snow-plateau-*.spz`, shipped enabled per Крок
13) rendered as a pale, frayed rectangle filling most of the frame — not a
landscape.** Reusing Mist's own tuned `DEFAULTS` (`scale: 12, rotX: 180`)
verbatim for a completely different capture was the immediate cause, and the
specific symptom (a "carpet" that reads as neither ground nor sky) is the
classic signature of an up-axis mismatch: SPZ captures are commonly
photogrammetry/COLMAP-sourced and store **Z as up**, not three.js's Y-up.
Swept live via the existing `?sprotX=` override (no code change needed to
test) rather than guessed once: `rotX -90` (rotating the Z-up capture down
onto Y-up) turns it into a recognisable snowy rock plateau, verified from
both a far corner shot and a shallow, near-level one (the angle that most
exposes a bad placement, per the Gaussian-splat section above). Scale and
position are still Mist's own numbers, unverified beyond "doesn't look
broken from two angles" — real placement tuning needs a real GPU and an eye
per this file's own standing policy on splat placement, not this headless
environment (a single frame still costs 100+ seconds here; see "Headless
browser").

**`SplatBackdrop.jsx` no longer hardcodes one capture's placement.** Its old
module-level `DEFAULTS` is now `FALLBACK_DEFAULTS` (used only if a caller
passes neither `defaults` nor a URL override), and every theme's own
placement lives in `lib/themes.js`'s own `backdrop.splat` field
(`{ scale, rotation: [x,y,z], position: [x,y,z] }`), next to that theme's
`splatUrl` — `Backdrop.jsx` passes `THEMES[key].backdrop.splat` straight
through as `<SplatBackdrop defaults={...}>`. This is what makes Section B's
"prepare Ocean's splat, don't enable it" ask a one-line change later:
`ink-wash-sea-canyon-*.spz` (already sitting in `public/`, untouched since
Крок 13) has a `splatUrl` and a starting `splat` transform (snow's own
corrected rotation, as a reasonable starting guess — **not independently
verified**, same "flag before relying on it" caveat this file already
carries for ocean/snow's rock `ROCK_SCALE_Y` anisotropy) sitting ready in
`THEMES.ocean.backdrop`, but `mode` stays `'image'` — turning it on is
flipping that one field once the capture is actually placed and checked, not
a second wiring pass. `?sp*=` URL overrides still work exactly as before,
applied per-mount on top of whichever theme's `defaults` are active.

Also fixed in passing: `tuning.opacity` was read from the URL/`defaults` but
**never actually applied to the mesh** — `mesh.opacity` (a real, live
`SplatMesh` property) is now set in the same effect that applies scale/
rotation/position, so `?spopacity=` finally does something.

**Performance: two real, documented `SparkRenderer` levers, plus a
visibility-based skip — not a downsample, which this version of Spark
doesn't expose for a pre-baked file.** `PackedSplats`/`SplatMesh`'s own
`maxSplats` option (checked directly against `node_modules/@sparkjsdev/
spark`'s source, not just its `.d.ts`) is a *preallocation* hint that grows
to fit whatever the loaded file actually contains — passing a smaller value
than the file's own splat count does not drop points, so it is not the
downsampling knob the brief was hoping for. What Spark does expose, on the
single shared `SparkRenderer` it auto-attaches to the scene the first time
any `SplatMesh` renders (`createRendererDetectionMesh` in Spark's own
source — one instance total, found via `scene.traverse` + `instanceof
SparkRenderer` since nothing in this codebase constructs one explicitly):

- `minAlpha` (default ≈0.002) → raised to **0.02**: splats below this opacity
  are skipped before sorting or rasterising at all. A backdrop was never
  going to read the near-invisible tail of a 1.9M-point cloud as detail.
- `minPixelRadius` (default 0) → raised to **1.0**: skips splats that would
  rasterise sub-pixel — the majority of a dense cloud at backdrop distance.
- `maxStdDev` (default √8 ≈ 2.83) → lowered to **√5 ≈ 2.24**, a value the
  library's own docs call out by name as a visually-safe performance trade
  (smaller per-splat footprint, less overdraw).

Set once these become available (`SparkRenderer` doesn't exist yet on the
frame a `SplatMesh` first mounts; `SplatBackdrop`'s own `useFrame` finds and
sets it, harmlessly redundantly, until it does).

**Measured before/after in this headless environment** (`?theme=snow`,
camera at the `shallow` shot placement, a plain `requestAnimationFrame`
counter over a 12s window, same method `HUD.jsx`'s own `FpsCounter` uses):
**46.3 fps before → 50.5 fps after**, ~9% faster. This number is more
meaningful here than the normal-scene case this file's "Headless browser"
section warns about — splat cost in this environment is dominated by CPU/
WASM sort time, not GPU rasterisation (the same reason a single splat frame
costs 100+ seconds regardless of viewport size), so the software rasteriser's
usual ~1fps ceiling doesn't apply and a real delta is visible. Still not a
substitute for a real device/GPU measurement.

**The visibility skip** (`SplatBackdrop`'s own `useFrame`) hides the mesh
(`mesh.visible = false`, not just zero opacity — this drops it from the main
draw call and, since Spark gates its own per-mesh update on object
visibility the same way every three.js pass does, from its per-frame sort
too) whenever the camera is BOTH close (`distance < 9.5`, inside this
project's own `MIN_DISTANCE` of 8) AND steep/overhead (`polarAngle < 0.65`
rad, toward `MIN_POLAR_ANGLE`'s 0.38) — deliberately narrow, both conditions
required: a close-but-overhead view is mostly board and has little sky in
frame, but a close-and-shallow view still looks straight across the horizon
at the backdrop even zoomed in, so that case is excluded on purpose. Verified
directly (not just by inspection) by driving `window.__camera`/`__controls`
to both a far/shallow and a close/steep placement and reading the live
mesh's own `.visible` back: `true` at the former, `false` at the latter.

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

`TemporaryPedestal` (small, **sharp-edged** dark disc, `#241F19`,
`PEDESTAL_RADIUS` = board half-width `4.3` * 1.1 = `4.73`, `receiveShadow` so
it isn't flat-shaded paper under the board's own shadow) stays in the file as
the rollback if `ROCK_MODEL` is ever cleared — deliberately not pretty on its
own, the brief was explicit this should read as an honest, unfinished
pedestal rather than a second attempt at a polished-but-wrong shape ("дошка
на постаменті — некрасиво, але чесно").

**Крок 10, Section E: `ROCK_MODEL` now points at Mint's delivered export**
(`public/models/granite-pine-aerie-optimized.glb` — a low-poly rock formation
with pine-tree silhouettes growing off its sides, per the model's own name).
`RockModel` loads and normalizes it the same way `PieceModel.jsx` handles a
piece: Mint's own materials are discarded for one shared procedural granite
`MeshStandardMaterial` (`#6E6A62`, roughness 0.95, `flatShading: true`),
`castShadow` stays off (it's the lowest thing in the scene, nothing below it
to shadow), `receiveShadow` stays on (it needs to catch the board's own
shadow).

**The fit is measured, not guessed** — a `Box3` alone isn't enough here,
because this model's usable surface is *not* its bounding-box max: a raised
rim sits above the flat inner area, exactly the thing the brief warned not to
let the board overlap. A one-time raycast grid (40 radii x 6 angles, downward
rays against the raw model, run once behind `?debug=1` and then deleted —
see `git log` on this file for the throwaway measurement code if it ever
needs re-running against a regenerated export) found the flat plateau at
local Y=0.417, constant out to radius 0.65 in every direction sampled; by
radius 0.70 some samples had already climbed to 0.46-0.47 — the rim
starting. `ROCK_SCALE` puts that flat radius at `BOARD_HALF_WIDTH * 1.1`
(4.73) — the *same* margin `PEDESTAL_RADIUS` already uses, so "a little wider
than the board" means the identical thing for the temporary disc and the real
model. `ROCK_Y_OFFSET` then drops the scaled model so its flat top lands
exactly at `Y`, the pedestal's own resting height. Verified visually at a
shallow orbit (30 degrees) and from the far side of the rock (200 degrees
azimuth): the board sits well inside the flat top with visible margin on
every side, never touching the rim.

**Not attempted this pass:** the brief also asks for the fog's lower layers
to visibly flow over the rock's outer edge, to hide where it drops off. The
fog plane is, and has always been, sized to the board itself (8x8, matching
the mask texture) — it doesn't extend past the board edge onto the rest of
the flat top, so there's no fog-over-the-rim effect currently. The exposed
rock margin around the board reads fine on its own in practice (see the
screenshots from this pass), so this wasn't blocking, but extending fog
geometry to cover the rock's full flat top (and ideally drape down its outer
face) is the natural next step if that specific composition beat matters
enough to revisit.

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

### Крок 12, Sections B & D: the rock wears its own texture, and the board actually fits

**D — use Mint's baked maps; stop guessing at contours.** Крок 11 Section C
(below) replaced Mint's material with procedural granite plus a *geometric*
foliage guess: green where `radius > 0.6..0.8 * maxRadius` **and** `height >
0.5..0.65`. That guess failed in the most visible way possible — a basin's raised
rim is by construction both high and at large radius, so the mask fired across
the entire rim and **the whole formation rendered as one flat green bowl**, with
the stone gradient never visible at all.

There was never a need to guess. The `.glb`'s own JSON chunk shows the material
carries three baked textures the old code threw away:
`baseColorTexture` (webp via `EXT_texture_webp` — grey granite, **green foliage
on the pine canopies, brown bark on the trunks**, exactly what the brief asks
for, already authored), `normalTexture`, `metallicRoughnessTexture`.
`RockIsland.jsx` now keeps the loaded material's maps and overrides only the
response. Two consequences: `flatShading` must be **off** (it fights the normal
map and destroys the baked detail), and `side` is forced to `FrontSide` because
Mint marks the material `doubleSided`, which shades every covered pixel twice on
the largest object on screen. The brief's fallback ("if you can't see the
contours, just paint it all grey") is not needed — the contours are in the
texture, not the geometry.

The rock keeps `TEXCOORD_0` and its textures through decimation, and gets a
gentler ratio (30,000 tris) than the pieces: it is one instance rather than 32,
it is the largest object on screen by area, and it is the only model whose
silhouette is seen against open sky at every orbit angle.

**B — the board was fitted to a radius, but a board is a square.** The old
`ROCK_SCALE` put the basin floor's *flat radius* (0.65 local) at
`BOARD_HALF_WIDTH * 1.1`. A square of half-width `s` reaches `s*√2` at its
corners, so fitting the half-width to a radius leaves the four corners hanging
over whatever lies between `s` and `1.414*s` — which is where the rim is.

`tools/measure-rock.mjs` measures it properly. It **rasterises the model's
triangles** into a 128×128 top-surface heightfield rather than binning vertices:
vertex binning reports narrow floor cracks as ~1-unit-deep holes, so the "spread"
over any footprint is dominated by that artifact and the numbers look confident
and are wrong. Counting cells that poke >0.01 above the basin floor inside a
square footprint of half-width `s`:

| s | maxTopY | cells above floor |
|---|---|---|
| 0.450 | 0.417 | 0 |
| **0.475** | **0.417** | **0** ← last fully clean footprint |
| 0.500 | 0.460 | 2 |
| 0.591 | 0.469 | ~380 ← what the old ROCK_SCALE produced |
| 0.675 | 0.718 | 1125 |

At the old effective `s` of 0.591, ~380 cells of rock stood above the basin floor
*inside the board's own footprint*, by up to 0.052 local = 0.38 world units —
more than the board slab's 0.30 thickness, so rock genuinely pushed up past the
playing surface at the edges. `ROCK_FIT_HALF_WIDTH` is now 0.46.

**Y is scaled separately from XZ, on purpose.** Widening the footprint 28% to
seat the board would have raised the rim and pines by the same 28%, taking the rim
from y=+2.85 to +3.75 — and the shallowest legal camera sits at
`11.55*cos(72°) = 3.57`, i.e. *below* the rim, looking at the outside of the bowl
instead of across the board. Holding `ROCK_SCALE_Y` at the previous 7.277 keeps
every height exactly where the existing camera clamps were verified, so this
cannot reopen that question: the rock just becomes a wider, shallower bowl. On an
irregular formation the anisotropy is not readable as one.

Verified from overhead and from a low corner azimuth: all four corners sit on the
flat floor with even margin, nothing intrudes over the board.

The fog's 1.0-unit overhang (see "Fog" above) also finally delivers the thing
Крок 10 Section E listed as not attempted — fog visibly spilling over the rock's
outer rim, hiding where it drops off. Board UVs outside 0..1 land on the mask's
`ClampToEdge` border, so the spill inherits the fogged-ness of whichever border
square it flows off, correctly and for free.

**Крок 11, Section C colours the rock.** *(Superseded by Section D above — kept
for the reasoning about single-mesh models.)* Inspecting the glTF JSON directly
(reading `meshes`/`materials` out of the `.glb`'s own JSON chunk — no loader
needed) confirmed one mesh, one material: the "все одним мешем" case, not a
per-part material swap. `ROCK_MATERIAL.onBeforeCompile` injects a geometry
mask into `MeshStandardMaterial`'s own fragment shader (`vLocalPos`, the raw
pre-transform `position` attribute, carried through via a new varying) —
`STONE_DEEP`->`STONE_TOP` vertical gradient by local Y, `FOLIAGE` where
`radius > 0.6..0.8 * maxRadius` (smoothstepped, not a hard cutoff — a binary
threshold on flat-shaded low-poly geometry facets visibly) `&& heightFrac >
0.5..0.65`. `ROCK_MIN_Y`/`ROCK_HEIGHT`/`ROCK_MAX_RADIUS` come straight from
the position accessor's own declared `min`/`max` (glTF requires these stay
correct even under Draco compression), not a second raycast pass. This keeps
real PBR lighting (environment reflections, the rim light, shadow
receiving) — only where the diffuse colour itself comes from is overridden.

Roughness/normal-map generation (fbm-based canvas textures) still lives in
`components/proceduralTextures.js` for the backdrop's edge alpha map, the
board tile roughness, and (Крок 11, Section A1) the fog noise texture — even
though the plateau-specific maps are gone. It's in `components/` rather than
`lib/` because it constructs `THREE.Texture` objects, and fbm itself is not
tileable, so anything with `repeat > 1` there uses `MirroredRepeatWrapping` —
plain repeat leaves a grid of seams. (The fog noise texture is the
exception: it's tileable by construction — see "Fog" below — so it uses
plain `RepeatWrapping`.)

### Крок 16, Section C: the island rendered fully black on Ocean, and why a tint alone could never fix it

**Reported as "the island is solid black," reproduced exactly** (screenshot,
`?theme=ocean`): the whole rock formation rendered as a near-featureless dark
shape, not the "dark blue-green" the theme's own palette calls for. It was
tempting to assume `rockTint` wasn't reaching the material at all (the
literal brief's own first guess) — it was: `RockIsland.jsx`'s
`applyRockMaterial` was already reading `ACTIVE_THEME.rockTint` correctly,
confirmed live (`material.color` read back as `#a1c0bc`, the correct
retinted value for Ocean's anchor). Forcing `material.side = DoubleSide`
live via `?debug=1`'s `window.__scene` (ruling out a backface/winding issue,
which would have shown *something* lit on the reverse faces) made no visual
difference at all, and geometry-level checks (vertex normal magnitudes,
`matrixWorld` determinant — confirmed positive, ~1222, matching the expected
`ROCK_SCALE_XZ² × ROCK_SCALE_Y`) came back clean. The tint, the geometry, and
the normals were all correct.

**The actual cause: `tools/measure-rock-albedo.mjs` (decodes each theme's
baked `baseColorTexture` exactly as the browser does, via a live page +
canvas readback, and reports mean/max luma):**

| theme | mean luma | max luma |
|---|---|---|
| mist | 103 | 169 |
| ocean | **15** | **71** |
| snow | 121 | 241 |

Ocean's `Basalt Kelp Ledge` texture is **authentically dark basalt** — real
volcanic rock is dark, and that's correct art direction, not a broken asset.
The bug is downstream: `MeshStandardMaterial.color` only ever *multiplies*
the sampled texture. Its maximum effective value is white (i.e. no
darkening at all) — there is no tint, however light, that can brighten a
15/255-mean texture into a visibly blue-green rock. Multiplying can only push
it further toward literal `(0, 0, 0)`, which is what "solid black" actually
was. Snow's own texture (mean 121) is close enough to Mist's (103) that the
same multiply pipeline was never actually broken for it — the "остров чорний
на Snow" half of the brief's own diagnosis turned out to be Крок 16 Section
B's splat orientation bug obscuring the whole scene, not a rock problem at
all; once the splat is oriented correctly, Snow's rock was never black.

**The fix is a themed, additive EMISSIVE floor, not a brighter multiply
(which doesn't exist).** Emissive stacks on top of the diffuse/specular
response instead of replacing it, so the baked texture's own contours still
read as relative light/dark variation above the floor — Крок 12 Section D's
whole point ("the contours are in the texture, not the geometry") still
holds; only the absolute minimum ever gets lifted.
`ROCK_ALBEDO_MEAN_LUMA` (the table above, hardcoded — measured once, like
every other rock-fit constant in this file) and `ROCK_ALBEDO_FLOOR_LUMA`
(55) together give `ROCK_EMISSIVE_INTENSITY = max(0, (55 - meanLuma) / 255)`:
**0 for Mist and Snow** (already above the floor, so this is a no-op —
verified byte-identical screenshots before/after for both) and **≈0.157 for
Ocean**, tinted with the same `rockTint` the multiply color already uses so
a lifted-black pixel still reads as this theme's own hue, not a neutral grey
glow. Verified visually: Ocean's rock now reads as a dark, clearly
blue-green formation from the same camera angle that previously showed flat
black.

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

### Крок 12, Section B: NO FOG ON THE INTRO

The intro used to run the real fog-of-war machinery with a per-shot `visibility`
Set (`introVisibilityFor`, now gone). That architecture — reuse the mechanic
rather than mock it — is still right and is not what changed. The *brief*
changed: the loading/intro screen should not be under fog at all. It is the first
thing anyone sees, and three shots of a near-uniform grey sheet is a bad first
frame that hides the board, the pieces, and the rock the whole composition rests
on.

So during `'intro'` and `'transitioning'`, `showFog` is false and the `Fog` mesh
is **not mounted**, while `visibility` is `ALL_VISIBLE`. **Both halves matter.**
Dropping the fog alone would leave `Pieces`' own rule in force ("an enemy piece
outside `visibility` is not rendered"), so Black's entire side would simply be
missing from the intro — an empty half-board with nothing covering it, which
reads worse than the fog did.

Not mounting the mesh (rather than mounting it with a full-visibility mask) also
means the first fog the player ever sees is a freshly-mounted mask settling into
the real starting position, not a 64-square dissolve firing on the hand-off frame.

`IntroCameraRig`'s `onFrameIndexChange` is now optional and unconsumed; it is
kept as a hook since "which shot is on screen" is the natural key for a future
per-shot effect.

The subsection below describes the superseded per-shot fog approach. Frame 0's
"фігур майже не видно, тільки силуети" is no longer what happens — the intro shows
the complete set on a clear board.

### Reusing the real fog-of-war instead of mocking it *(superseded — see above)*

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

### `tools/` — checked-in measurement scripts (Крок 12)

These encode how the fog and rock numbers above were derived, so they can be
re-run against a regenerated asset instead of re-derived from scratch. They need
dev-only packages that are **not** in `package.json` — install them together in
one command, because `npm install --no-save X` re-resolves from `package.json`
and **prunes** anything installed by a previous `--no-save` call:

```
npm install --no-save @gltf-transform/core @gltf-transform/extensions \
  @gltf-transform/functions meshoptimizer draco3dgltf playwright
```

| script | what it does |
|---|---|
| `decimate-models.mjs` | the asset budget fix. Dry run by default, `--write` applies. Крок 13: iterates `public/models/{mist,ocean,snow}/`; refuses to run twice **per theme** (backup presence in `assets-src/models-original/<theme>/` gates each theme independently). |
| `measure-rock.mjs` | triangle-rasterised top-surface heightfield → the basin floor fit table. Takes an optional file arg (defaults to Mist's rock); re-run per theme — see "Крок 13: theme system" for ocean/snow's own numbers. |
| `measure-rock-albedo.mjs` | Крок 16: decodes each theme's rock `baseColorTexture` via a live page + canvas readback, reports mean/max luma — how the black-island bug (Section C, "RockIsland") was diagnosed as a too-dark source texture, not a broken tint. Optional theme arg, defaults to all three. |
| `diagnose-mesh.mjs` | why a mesh won't simplify: component count, boundary/non-manifold edges |
| `sweep-simplify.mjs` | which meshopt flags unlock a given mesh |
| `shoot.mjs` | screenshots at named camera placements (`shot=shallow\|overhead\|corner\|far\|behind`, `--intro`) |
| `probe.mjs` | live world-space AABBs of the big meshes, for "does X actually fit Y" |
| `fogdiag.mjs` | the fog occlusion test + parity stats + dumps the generated fragment shader. Крок 13: takes a `THEME` env var (`THEME=ocean node tools/fogdiag.mjs`), defaulting to mist. |
| `check-mask.mjs` | shoots `/dev-fog?visible=` for a1/b1/g8/c6 — the mask-orientation check |
| `probe-splat-axes.mjs` | Крок 20: decodes a `.spz`'s raw centers and reports p01-p99 extent per axis, to determine a capture's real up-axis from data instead of eyeballing a screenshot (this environment's software rasteriser can't reliably tell a correctly- from incorrectly-oriented splat apart — see Крок 20) |
| `shrink-spz.mjs` | **Крок 21 rewrote this.** Importance-ranked, spatially stratified, coverage-compensated `.spz` reducer (was a fixed stride, which measured 12.9 dB against the new method's 29.6 dB at the same splat count). `--stride` keeps the old policy for A/B. Use before enabling any large splat capture; client-side downsampling runs after decode and does nothing for load-time CPU cost |
| `spz-io.mjs` | Крок 21: shared SPZ v3 decode/encode for the splat tooling, with every quantization rule taken from Spark's own `SpzReader`/`SpzWriter` source. Not a CLI |
| `splat-importance.mjs` | Крок 21: LightGaussian-style per-splat significance, evaluated against this project's real OrbitControls clamps rather than training views. Not a CLI |
| `splat-raster.mjs` | Крок 21: **a CPU EWA splat rasterizer in Node.** ~1.5s a frame against the browser's 100+, deterministic, models Spark's own cost levers and counts fragment evaluations. This is what makes splat quality/placement measurable at all here — reach for it before a screenshot. Not a CLI |
| `analyze-spz.mjs` | Крок 21: opacity/scale/spatial distributions plus the contribution-concentration table (top 15% of splats carry 92.7% of the image) — how a reduction target gets chosen from data |
| `splat-compare.mjs` | Крок 21: renders the full cloud as ground truth and reports PSNR / luma error / fragment cost for each candidate `.spz`. `--mode=outside` (default) grades the reduction policy alone; `--mode=theme` grades it in the scene |
| `spark-levers.mjs` | Крок 21: sweeps `minAlpha`/`minPixelRadius`/`maxStdDev` against measured quality and fragment cost — found the first two inert on a pruned asset |
| `place-splat.mjs` | Крок 21: scores candidate splat placements (nearest in-frame splat, frame coverage, luma std dev, fragment cost) over the reachable orbit. Replaces "do not try to place this from a headless screenshot" — it is a 2-minute offline command now. `--candidates=list.json` supplies a candidate set for a capture the built-in list wasn't written for. Its view ring is shallow-biased, so it does NOT answer "is this inside the resting camera's band" — see Крок 22 |

Output goes to `tools/shots/`, which is gitignored.

- `npm test` — Node's built-in runner, no extra deps. Asserts the starting
  position gives White exactly 24 visible squares and that pawns do not leak
  their push-square into vision. 11 tests, all passing after this pass.
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
- `?theme=ocean` / `?theme=snow` (any page — `/`, `/dev-pieces`) switches the
  active theme; see "Крок 13: theme system". Read once at module load
  (`lib/themes.js`'s `themeKeyFromUrl()`), same convention as every other
  `?`-prefixed tuning hook here — no live in-session switch.
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
- `?debug=1` also exposes `window.__fogMaterials` (`{ layers, edgeMultiply,
  mask }`, live `THREE.ShaderMaterial`/`DataTexture` refs) and
  `window.__fogWave` (the Крок 10 Section C wave-state ref: `effective`/
  `oldValue`/`newValue`/`startTime`/`revealTime` `Float32Array(64)`s, indexed
  by `squareToMaskIndex`, plus `clock`). Reading `__fogWave.current` directly
  is how the wave's per-square delay formula got verified to floating-point
  precision — screenshot pixel-timing is unreliable for this (see "Headless
  browser" below): a single simulated frame's `delta` can be large enough to
  finish an entire 0.8s wave in one tick, so the *data*, not a mid-animation
  screenshot, is the thing to read.

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

Real-GPU frame rate cannot be measured from here — the `?debug=1` `FpsCounter`
reads 60 in this environment regardless, so do not trust a number reported from
it. **What can be measured from here is geometry and draw calls**, via
`window.__scene` traversal and `gl.info` (see `tools/shoot.mjs`), and after Крок
12 that is where the real win was: 8,502,106 → 160,102 triangles per pass. Read
"Asset budget" — the scene was geometry-bound by two orders of magnitude, which
is not something a shader-cost estimate would ever have surfaced.

If the fog shader does need profiling, `FOG_MARCH_STEPS` is the lever and it is a
straight linear trade. Per pixel the march is ~12 mask fetches plus ~12–24 noise
fetches, against ~24 for the five-slice version it replaced — comparable, still
one draw call, and still unverified on real hardware.

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
