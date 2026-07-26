// Pure fog config + mask math. No three.js imports allowed in this file.

// Switch to 'tier1' to fall back to the plain per-square planes in
// components/FogLayer.jsx if the shader ever misbehaves. Both implementations
// are kept working on purpose.
export const FOG_MODE = 'tier2';

export const FOG_COLOR = '#EDEBE3';
export const FOG_OPACITY = 0.85;
export const FOG_LERP_SPEED = 3;

/*
 * Крок 10, Section A: the Крок 9.5 fix (FOG_TINT_COLOR multiplying the
 * framebuffer, FOG_STRAND_COLOR painted over it) made fog *visible* on every
 * tile — measured -54/-28 luma at the time — but visible is not the same as
 * blind. Multiply blending can only ever scale what's underneath; it cannot
 * reach true opacity, so even the deepest fog still let a player tell light
 * tiles from dark ones by eye. In fog of war, deep fog has to be a wall:
 * looking at a square 3+ ranks away, a player should not be able to tell its
 * colour at all.
 *
 * The fix drops multiply blending as the *primary* mechanism entirely and
 * goes back to plain alpha — but this time actually reaching near-total
 * opacity in the deep field (FOG_MAX_ALPHA = 0.94) instead of stopping at
 * FOG_OPACITY's old 0.85 with a colour too pale to matter. At 0.94 alpha,
 * whatever tile colour is underneath contributes at most 6% of the final
 * pixel — that 6% ceiling is where the "< 6 luma difference" verification
 * criterion actually comes from, not a number picked to sound precise.
 *
 * FOG_ALPHA_KNEE (0.38) is where the smoothstep ramp saturates: below it,
 * alpha rises smoothly from 0 (this is what still tells the "a boundary is
 * here" story); at and above it, alpha sits flat at FOG_MAX_ALPHA. A knee
 * this low means most of the fogged field is already at full opacity, not
 * just its deepest interior — "deep" starts close to the frontier, which is
 * the point: half-fogged is not a state this game wants to spend much visual
 * area on.
 *
 * FOG_DEPTH_COLOR_LOW/HIGH replace the old FOG_STRAND_COLOR: a cool grey pair
 * (not the old pale near-white) that the noise field mixes between for
 * texture. They matter far less than they used to, precisely because alpha
 * is now doing the readability work on its own — colour is texture, not the
 * mechanism, which is the "math, not tricks" the brief asked for.
 *
 * FOG_TINT_COLOR survives, demoted: it's now only the *edge*-band multiply
 * pass (density 0.15-0.5, see FogShader.jsx) that adds a little extra depth
 * right at the frontier, on top of what the primary alpha layer already
 * carries — not the thing making fog visible at all anymore.
 *
 * Tier 1 (FogLayer.jsx) is unaffected and keeps using plain FOG_COLOR — it's
 * the rollback path, deliberately kept simple.
 */
export const FOG_MAX_ALPHA = 0.94;
export const FOG_ALPHA_KNEE = 0.38;
export const FOG_DEPTH_COLOR_LOW = '#B4B9BA';
export const FOG_DEPTH_COLOR_HIGH = '#DCDEDB';
// The neutral core tone. Крок 10 made the deep interior converge on this flat,
// with all noise-driven variation faded out (see the Крок 12 Section C note
// below for why that turned out to make the deep field a literal constant
// fill). It survives as the *anchor* the lit/shadow pair is balanced around —
// FOG_SHADOW_COLOR and FOG_LIT_COLOR straddle it, so the deep field's mean tone
// still lands here. #C4C8C7 is the brief's own reference fog colour.
export const FOG_DEPTH_COLOR_MID = '#C4C8C7';
export const FOG_TINT_COLOR = '#B8BDC2';

/*
 * Крок 12, Section C: THE FOG HAD NO VOLUME BECAUSE IT HAD NO VARIATION AT ALL.
 *
 * Not "too little" — none. Trace the old maths for a settled, fully fogged cell,
 * which is the majority of the fogged field:
 *
 *   ownVisible = 0.0                       (exactly; only mid-wave is it partial)
 *   density    = pow(1 - 0, 1.35) = 1.0
 *   alpha      = smoothstep(0, 0.38, 1.0) * 0.94 = 0.94        <- constant
 *   colorVariance = 1 - smoothstep(0.38, 1.0, 1.0) = 0
 *   color      = mix(uColorMid, noisyColor, 0) = uColorMid     <- constant
 *
 * Both channels are constants. The three noise fields (mass/wisps/detail) were
 * computed per pixel on five slices and then multiplied by zero. The deep field
 * was a flat #C4C8C7 fill, which is exactly what it looked like. This is the
 * same saturated-density trap Крок 11 Section D found and fixed for the
 * *boundary position* — it was never fixed for the fog's appearance.
 *
 * The fix separates the two jobs the old single `density` was doing:
 *
 *   OCCLUSION stays keyed off the mask alone. The base slice still reaches
 *   FOG_MAX_ALPHA over any fogged cell, so the fog-of-war guarantee ("you
 *   cannot tell a light tile from a dark one under deep fog") is untouched —
 *   it was always alpha's job, never colour's.
 *
 *   APPEARANCE becomes a function of the noise field again, through two cues
 *   that actually read as volume rather than as a grey card:
 *
 *   1. Self-shading. Sampling the cloud field one short step TOWARD the light
 *      and comparing gives a directional derivative: where the fog is denser
 *      between here and the light, this pixel sits in the shadow of its own
 *      billow. That single extra sample per slice is what turns a flat field
 *      into rounded, lit forms. FOG_SHADE_GAIN scales it, FOG_LIGHT_UV is the
 *      direction, FOG_LIGHT_STEP how far.
 *   2. A vertical lift. Real cloud reads as volume mostly because its top is
 *      bright and its underside is dark. FOG_HEIGHT_LIFT brightens each slice
 *      toward FOG_LIT_COLOR in proportion to its height in the stack, so the
 *      base slice is the shadowed underside and the top slice catches the sky.
 *
 * FOG_LIGHT_UV is derived, not chosen: Lighting.jsx's key light sits at world
 * [4, 6, 3] aimed at the origin. The fog plane maps world x = -4 + 8u and
 * world z = 4 - 8v, so +x is +u and +z is -v; the horizontal direction toward
 * the light is therefore normalize(vec2(+4, -3)) = (0.8, -0.6). If the key light
 * ever moves, this moves with it or the fog will be lit from the wrong side.
 *
 * FOG_BODY_KNEE is the other half of "volume": on the RAISED slices, alpha is
 * now noise-driven rather than flat, so a slice only exists where the cloud
 * field is strong enough. The stack's silhouette billows instead of being five
 * stacked slabs of identical outline. The base slice deliberately does NOT get
 * this — it is the one carrying occlusion.
 */
export const FOG_SHADOW_COLOR = '#A3AAAF';
export const FOG_LIT_COLOR = '#E6E9E5';
export const FOG_LIGHT_UV = [0.8, -0.6];
export const FOG_SHADE_GAIN = 2.8;

/*
 * NOISE SAMPLING SCALES — and why none of them is a round number.
 *
 * These were 3.0 / 4.0 / 11.0 with a 3.2 vertical stretch. Round numbers, and on
 * an 8x8 board sampled through a noise texture whose lattice periods are powers
 * of two (4/8/16/32, see getFogNoiseTexture), that is a resonance waiting to
 * happen. It did:
 *
 *   mass sampled at vUv * 3.0 => 3 texture tiles x 4 lattice cells = 12 cells
 *   across 8 board squares = 1.5 lattice cells per square. A 1.5-cell period
 *   repeats exactly every TWO squares — which is precisely the checkerboard's
 *   own period.
 *
 * So the fog's brightness locked to square parity. Measured with
 * tools/fogdiag.mjs before the fix: over 40 fully fogged squares, the mean luma
 * of fog above light squares was 19.1 higher than above dark squares. That is
 * not a tile leak — `accum.a` was verified at 0.94-0.96, so at most ~5% of the
 * tile can show through, worth about 1.9 luma — it was the fog's own noise
 * drawing a grid aligned to the board.
 *
 * lib/noise.js already documents this exact class of bug for the same reason
 * ("an integer lacunarity lines every octave up on the same lattice and leaves a
 * visible grid"); these are the same fix applied one level up. The values are
 * chosen to be mutually non-harmonic and to give a non-terminating cells-per-
 * square ratio, so no short spatial period can align with the 8x8 grid.
 *
 * FOG_LIGHT_STEP is the self-shading sample's offset, in UV. It is deliberately
 * small: multiplied by FOG_NOISE_SCALE_MASS it lands about a fifth of a lattice
 * cell away, so `mass - massToLight` is a genuine local gradient. At the 0.05 it
 * started at, the step was 0.6 of a lattice cell — far enough that the two
 * samples were effectively independent noise, which produces sparkle rather than
 * shading.
 */
export const FOG_NOISE_SCALE_MASS = 1.87;
export const FOG_NOISE_SCALE_WISPS = 3.29;
export const FOG_NOISE_SCALE_DETAIL = 10.73;
export const FOG_NOISE_STRETCH_V = 2.11;
export const FOG_LIGHT_STEP = 0.02;

/*
 * Крок 12, Section C2: THE FOG IS A VOLUME NOW, NOT A PAINTED PLANE.
 *
 * Section C above fixed the fog's *colour* being a literal constant, and the
 * result did show structure — but it read as mottled stone, not as fog, and the
 * reason is structural rather than a tuning miss:
 *
 *   Every one of FOG_LAYERS "slices" was composited into ONE flat plane lying on
 *   the board. Крок 11 Section A had replaced five real planes at five heights
 *   with a single plane whose slices fake their height through a UV parallax
 *   shift. That bought a big draw-call win and it kept the top-down read
 *   identical — but a shape painted inside a flat 8x8 rectangle cannot stand up
 *   out of it. No amount of colour work inside that rectangle produces volume,
 *   because there is no vertical extent anywhere in the model. Which is exactly
 *   the reported symptom, twice.
 *
 * So the fog gets geometry: a box 8 x FOG_SLAB_HEIGHT x 8 sitting on the board,
 * raymarched in its fragment shader. Per pixel the shader intersects the view ray
 * with the box analytically, walks FOG_MARCH_STEPS samples through the interior,
 * and accumulates density with Beer-Lambert extinction. That gives, for free and
 * correctly rather than as an approximation:
 *
 *   - a real silhouette: fog banks visibly rise above the board and occlude
 *     along the line of sight, instead of being clipped to the board rectangle
 *   - real parallax as the camera orbits, from real geometry
 *   - genuine depth accumulation: a long grazing path through the slab is denser
 *     than a short overhead one, which is what "thick" actually means
 *
 * The occlusion guarantee is NOT left to the raymarch. FogShader keeps computing
 * the old mask-driven alpha at the point where the view ray crosses the slab's
 * base plane, and the final alpha is the max of that and the volume's own. So
 * "deep fog hides the tile underneath" is still carried by the same expression
 * Крок 10 Section A tuned and verified, and the raymarch can only ever add
 * silhouette on top of it — it cannot subtract occlusion. See FogShader.jsx.
 *
 * FOG_SLAB_HEIGHT is 1.1 world units — a bit over one board square.
 *
 * It started at 0.55 and that was measurably too thin. Combined with the density
 * falloff below, essentially all of the fog sat in the bottom fifth of the slab,
 * so from a shallow camera (where volume should be most obvious, since you are
 * looking THROUGH the bank rather than down onto it) the fog presented as a flat
 * tilted sheet of frosted glass. There has to be enough vertical room for the
 * billows to actually differ in height before any of the shading work can read.
 *
 * The ceiling on this value is the camera: the shader uses a FrontSide box, so
 * the camera must stay outside the slab or the near faces get culled and the fog
 * vanishes. The shallowest legal camera (MAX_POLAR_ANGLE 1.25 rad at CameraRig's
 * resting distance) sits at y = 11.55 * cos(72 deg) = 3.57; the slab tops out at
 * FOG_HEIGHT + this = 1.12. Comfortable, but do not raise this past ~3 without
 * switching the material to DoubleSide.
 *
 * Note the tallest piece (the king, 1.45) now stands through the slab. That is
 * fine and needs no special handling: a square holding one of your own pieces is
 * always visible so its column carries no fog, and enemy pieces inside fog are
 * not rendered at all. Where a piece does overlap, the depth test does the right
 * thing — the fog is depthWrite:false but still depth-TESTED.
 *
 * FOG_MARCH_STEPS 12 is the cost knob, and it replaces FOG_LAYERS as the first
 * perf lever: a straight linear trade against fragment cost. Per pixel it is ~12
 * mask fetches plus ~12-24 noise fetches, against the ~24 the five-slice version
 * used, and it is still one draw call.
 */
export const FOG_SLAB_HEIGHT = 1.1;
// Крок 13 raised this 12 -> 16 for "a bit more detail" in the volume's own
// billow shape, flagging it explicitly as "the first lever to pull back down"
// if a real GPU ever showed the cost wasn't worth it. Крок 14: it wasn't —
// reported as the frame cost roughly doubling, and a triangle/draw-call
// measurement (tools/perf-probe.mjs) confirmed the *geometry* budget hadn't
// moved at all (160,112 vs the documented 160,102 baseline), which points
// straight at the two fragment-shader-side additions from Крок 12/13: this
// value, and BONE's clearcoat (components/PieceModel.jsx). Back to 12.
// FogShader.jsx's marchStepsForDevice() drops it further still (10) on the
// mobile/low-power tier specifically.
export const FOG_MARCH_STEPS = 12;
// Optical depth per world unit of full-density fog. At FOG_SLAB_HEIGHT this
// saturates well past FOG_MAX_ALPHA, so the volume is opaque wherever the mask
// says the column is fully fogged even on the shortest (straight down) path.
export const FOG_EXTINCTION = 9.0;

/*
 * DENSITY SHAPE — and a modelling dead end worth not repeating.
 *
 * The first two raymarch attempts defined a fog SURFACE and filled everything
 * below it: ceiling = base + cloud * billow, then density = 1 below that height
 * and 0 above, with a soft skin across it. Both read as a solid object — first as
 * a slab of ice (base 0.30, narrow skin: a flat lid plus a hard vertical wall at
 * the frontier), then, after widening the skin and dropping the base to 0.10, as
 * a translucent plate hovering over the board with its bounding box plainly
 * visible.
 *
 * The reason is structural, not tuning. "Filled below a surface" is a model of a
 * SOLID with a lumpy top. Widening the skin to hide the lid just smears partial
 * density through the whole slab, which is worse: a uniform block of haze whose
 * silhouette is the bounding box itself. There is no setting of base/billow/skin
 * that turns that model into fog.
 *
 * Fog is a density field with no surface at all. So:
 *
 *   vertical = pow(1 - h, FOG_VERTICAL_FALLOFF)   dense on the board, thinning up
 *   shape    = cloud * vertical
 *   d        = smoothstep(KNEE, KNEE + SOFT, shape)
 *
 * The threshold is what matters: subtracting a floor from a field that is already
 * decaying with height means only the strongest cloud values survive high up, so
 * the fog resolves into separate billows that taper off and end at different
 * heights in different places — and reaches exactly zero before the slab top, so
 * there is no top edge to see. Gaps between billows are real holes, not thin
 * spots, which is what lets the shape read against the sky.
 */
// 0.95, not the 1.6 it started at: a steep falloff crushes all the density into
// the bottom of the slab, which is the other half of why the bank read as a flat
// sheet. Near-linear keeps fog present high enough for the billows to have
// visibly different heights.
export const FOG_VERTICAL_FALLOFF = 0.95;
export const FOG_DENSITY_KNEE = 0.17;
export const FOG_DENSITY_SOFT = 0.34;
/*
 * How much darker the bottom of the fog is than its top. Light arrives from
 * above, so the crowns are lit and the base sits in the shadow of everything
 * above it. This is the single strongest volume cue in the shader — more than the
 * directional term, and more than the geometry itself.
 *
 * 0.38, not the 0.72 it was first set to. The vertical falloff concentrates most
 * of the density at LOW h, so almost every sample that contributes meaningfully
 * is a low one — meaning a large depth shade darkens the fog's dominant mass
 * rather than just its undersides. At 0.72 the fogged field measured a mean luma
 * of 100 against tiles at 161-198: the fog had gone darker than the board it was
 * supposed to be a pale mist over. This keeps the top-lit gradient legible while
 * leaving the overall tone where FOG_DEPTH_COLOR_MID puts it.
 */
export const FOG_DEPTH_SHADE = 0.38;

/*
 * The volume extends this far past the board's own 8x8 footprint on every side,
 * fading out across the overhang.
 *
 * Two jobs. First, without it the slab's side walls are hard-clipped at x,z =
 * +/-4, so fog covering a border square ends in a straight vertical cut at the
 * board edge. Second, it starts delivering the thing Крок 10 Section E listed as
 * not attempted — "the fog's lower layers should visibly flow over the rock's
 * outer edge, to hide where it drops off". Board UVs outside 0..1 land on the
 * mask's ClampToEdge border, so the spill inherits the fogged-ness of whichever
 * border square it is flowing off, which is the correct behaviour for free.
 *
 * Kept modest: the slab's screen area, and therefore the march's total fragment
 * cost, grows with the square of this.
 */
export const FOG_SLAB_OVERHANG = 1.0;
// Ceiling on what the raymarched volume alone may contribute over a square the
// mask says is VISIBLE. Fog banks legitimately rise into the line of sight at
// shallow angles, but the "visible squares stay absolutely clean" rule from Крок
// 10 Section B still has to hold at the default view, so this bounds the haze a
// grazing ray can lay over clear ground.
export const FOG_VOLUME_MAX_ALPHA = 0.72;

/*
 * SUPERSEDED by Крок 12, Section C2 — kept only for the tier-1 rollback.
 *
 * FOG_LAYERS/FOG_LAYER_HEIGHTS/FOG_LAYER_ALPHA_MULT described a stack of
 * horizontal fog sheets: five real planes in Крок 10 Section B, then five virtual
 * slices inside one plane in Крок 11 Section A. The tier-2 fog is a raymarched
 * volume now (see FOG_SLAB_HEIGHT below) and reads none of them; FOG_LAYERS is no
 * longer the perf lever either — FOG_MARCH_STEPS is.
 *
 * FOG_LAYER_HEIGHTS[0] survives as the source of FOG_HEIGHT, which both tiers
 * still use as the fog's resting height above the tiles, so this array is not
 * dead. The other two are unread; they are left in place rather than deleted
 * because components/FogLayer.jsx (tier 1, the documented rollback, which must
 * keep working) is the thing that would need rewriting to drop them cleanly, and
 * that is not this pass's job.
 */
export const FOG_LAYERS = 5;
export const FOG_LAYER_HEIGHTS = [0.02, 0.07, 0.14, 0.23, 0.34];
export const FOG_LAYER_ALPHA_MULT = [1.0, 0.55, 0.35, 0.2, 0.1];

// The fog's base sits just above the tiles. Nothing pokes through at this
// height: a square holding one of your own pieces is always visible (so never
// fogged), and enemy pieces inside the fog are not rendered at all.
export const FOG_HEIGHT = FOG_LAYER_HEIGHTS[0];
/*
 * Крок 11, Section B: highlights used to ride above the *tallest* fog layer
 * (a formula derived from FOG_LAYER_HEIGHTS) so a legal-move marker on an
 * unexplored square wouldn't be buried under the raised silhouette sheets.
 * That's no longer needed: a square a piece can legally move to is by
 * definition inside that piece's zone of control, which is exactly the
 * definition of visible (lib/visibility.js) — so a legal-move target is
 * never fogged in the first place, on any layer. Highlights now sit right on
 * the tile (0.011, just above the 0.004 grid lines and the 0.012 contact
 * shadow's own plane), under every fog layer including the base one, instead
 * of floating above the whole stack.
 */
export const HIGHLIGHT_HEIGHT = 0.011;

/*
 * Крок 11, Section D: the fog's frontier "breathes" — a slow tidal
 * thickening/thinning of the soft transition band only, never the hard
 * visible/fogged boundary the mask encodes. Two superimposed ripples so the
 * whole board doesn't pulse in lockstep (see FogShader.jsx's breathGLSL).
 * FOG_WAVE_DURATION (already defined above, 0.8s) doubles as the breathing
 * suppression window: an actively-travelling reveal/conceal wave gates
 * breathing amplitude to 0 and eases it back in over that same span, so the
 * two motions never read as one blurred mess.
 */
/*
 * Крок 13: amplitudes raised from 0.06/0.02 — at the old values the frontier
 * still read as a clean 8x8 grid line with only a faint wobble on it, because
 * the boundary sample never moved more than ~6% of a cell off the true mask
 * edge. 0.16/0.05 pushes the tested boundary up to ~20% of a cell off-axis,
 * which is enough for the edge to visibly fray and bulge between squares
 * instead of tracing the grid. Still gated to 0 for FOG_WAVE_DURATION after a
 * square's own visibility flips (see breathAmpMult in FogShader.jsx), so a
 * bigger wobble still never fights an in-flight reveal/conceal wave.
 */
export const FOG_BREATH_PERIOD_SLOW = 0.28;
export const FOG_BREATH_AMPLITUDE_SLOW = 0.16;
export const FOG_BREATH_PERIOD_FAST = 0.73;
export const FOG_BREATH_AMPLITUDE_FAST = 0.05;

/*
 * Крок 10, Section C: a move is an event, not an instant mask swap.
 *
 * FOG_WAVE_DURATION is the fade itself, per square, once it starts —
 * FOG_WAVE_DELAY_PER_CELL is what staggers *when* each square starts,
 * proportional to its board distance from the wave's origin square (see
 * FogShader.jsx's `revealOrigin`/`concealOrigin`). Together they turn a flat
 * crossfade into an outward-travelling wave: near squares begin (and finish)
 * first, far squares catch up later, without either number needing to know
 * about the other.
 *
 * FOG_REVEAL_THICKEN_DURATION is added on top of the distance delay
 * specifically for a square that both (a) just entered visibility and
 * (b) holds an enemy piece — it holds that square at its old, still-fogged
 * value for an extra beat before the dispersal wave is allowed to start,
 * which is what turns a plain reveal into "thicken, then burst open."
 *
 * FOG_PIECE_REVEAL_FADE_DURATION is Pieces.jsx's own number, not read here —
 * it lives in lib/fog.js anyway so the two durations that have to feel like
 * one event (fog bursting open, piece fading in) are declared next to each
 * other instead of drifting apart in separate files.
 */
export const FOG_WAVE_DURATION = 0.8;
export const FOG_WAVE_DELAY_PER_CELL = 0.05;
export const FOG_REVEAL_THICKEN_DURATION = 0.2;
export const FOG_PIECE_REVEAL_FADE_DURATION = 0.3;

const FILES = 'abcdefgh';

export const ALL_SQUARES = FILES.split('').flatMap((file) =>
  [1, 2, 3, 4, 5, 6, 7, 8].map((rank) => `${file}${rank}`),
);

// Chebyshev distance in board cells (a king's-move metric) — what the wave
// delay above is proportional to. Chebyshev rather than Euclidean because a
// wave spreading from a square should reach an entire ring around it
// together, and a ring under this metric is exactly a square outline, which
// matches how the 8x8 mask itself is laid out.
export function squareChebyshevDistance(a, b) {
  const fileA = FILES.indexOf(a[0]);
  const fileB = FILES.indexOf(b[0]);
  const rankA = Number(a[1]);
  const rankB = Number(b[1]);
  return Math.max(Math.abs(fileA - fileB), Math.abs(rankA - rankB));
}

/*
 * Крок 13: squares a piece's own move animation physically flies over.
 *
 * Bug: an own piece sliding across several ranks/files (Pieces.jsx animates a
 * straight lerp from its old square to its new one, arcing up to
 * MOVE_ARC_HEIGHT at the midpoint) is rendered every frame regardless of fog —
 * "a square holding your own piece is never fogged" — but that rule is only
 * ever applied to the piece's RESTING square. Mid-flight it also passes over
 * whatever squares sit between old and new, and those can be genuinely
 * fogged (outside `visibility`, no piece of yours currently attacks or
 * occupies them). FogShader has no idea a piece is passing overhead — it
 * marches real volumetric density there — and since the fog box's own
 * surface is geometrically nearer the overhead camera than a piece flying
 * below the slab top, the fog fragment isn't discarded and paints straight
 * over the piece for that instant. Reported as "fog jumps in front of and
 * covers a piece."
 *
 * The fix (GameCanvas.jsx) temporarily unions these squares into the Set fed
 * to <Fog> — never into the Set fed to <Pieces>, which stays strictly
 * game-accurate — for the duration of the flight, so the fog simply doesn't
 * exist over the piece's flight path while it's in the air. Only a straight
 * rank/file/diagonal path is well-defined (rook/bishop/queen/king/pawn
 * slides); a knight's hop isn't collinear, so this returns just its two
 * endpoints and accepts the brief in-air flicker as a knight-specific edge
 * case not worth a curved-path special case for a ~0.35s animation.
 */
export function squaresBetween(from, to) {
  const fileA = FILES.indexOf(from[0]);
  const fileB = FILES.indexOf(to[0]);
  const rankA = Number(from[1]);
  const rankB = Number(to[1]);
  const dFile = fileB - fileA;
  const dRank = rankB - rankA;
  const isStraightLine =
    dFile === 0 || dRank === 0 || Math.abs(dFile) === Math.abs(dRank);
  if (!isStraightLine) return [from, to];

  const steps = Math.max(Math.abs(dFile), Math.abs(dRank));
  const stepFile = Math.sign(dFile);
  const stepRank = Math.sign(dRank);
  const squares = [];
  for (let i = 0; i <= steps; i++) {
    squares.push(FILES[fileA + stepFile * i] + (rankA + stepRank * i));
  }
  return squares;
}

/**
 * Index into the 8x8 fog mask texture for a square.
 *
 * Derivation: the fog plane is a PlaneGeometry rotated -90deg about X, which
 * maps local (x, y) -> world (x, -y). So world x = -4 + 8*uv.x and world
 * z = 4 - 8*uv.y. Matching those against squareToWorld (x = file - 3.5,
 * z = rank - 1 - 3.5) gives column = file and row = 8 - rank. DataTexture
 * keeps flipY false, so data row 0 is v = 0.
 */
export function squareToMaskIndex(square) {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return (8 - rank) * 8 + file;
}
