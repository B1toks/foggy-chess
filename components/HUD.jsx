import { useEffect, useState } from 'react';
import { isAudioEnabled, setAudioEnabled } from './audio';
import { GAME_OVER_STATUSES } from '../lib/useChessGame';
import { THEMES } from '../lib/themes';
import { preloadThemeModels } from './PieceModel';

// Flip to true (or append ?debug=1) to bring back the vision readout.
const SHOW_DEBUG = false;
// Set to false to drop the sound toggle and leave the game silent.
export const SHOW_SOUND_TOGGLE = true;

// Крок 8, Section C: how long the control hint stays up before fading, and
// how slow that fade is. Long enough to actually be read once, gone well
// before it starts feeling like a nag.
const HINT_VISIBLE_MS = 8000;
const HINT_FADE_MS = 1200;

/*
 * Sound toggle and "new game" share one corner and one visual language — a
 * small, semi-transparent square icon button — per the brief ("в одному
 * кутку, однакового стилю"). Both live here so the shared style only exists
 * once.
 */
const CORNER_BUTTON_STYLE = {
  width: 40,
  height: 40,
  display: 'grid',
  placeItems: 'center',
  fontSize: 16,
  lineHeight: 1,
  background: 'rgba(237, 231, 217, 0.92)',
  border: '1px solid #D6CDBA',
  borderRadius: 8,
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  transition: 'opacity 0.3s ease, color 0.3s ease',
};

function SoundToggle() {
  const [on, setOn] = useState(isAudioEnabled);

  return (
    <button
      onClick={() => setOn(setAudioEnabled(!on))}
      aria-pressed={on}
      title={on ? 'Mute sound' : 'Unmute sound'}
      style={{
        ...CORNER_BUTTON_STYLE,
        color: on ? 'var(--ember)' : 'var(--muted)',
      }}
    >
      {on ? '🔊' : '🔇'}
    </button>
  );
}

/**
 * Deliberately understated while a game is in progress — a restart is a
 * destructive, rarely-wanted action mid-game — and brought to full strength
 * once the game is actually over, when it's the obvious next thing to reach
 * for.
 */
function NewGameButton({ onNewGame, prominent }) {
  return (
    <button
      onClick={onNewGame}
      title="New game"
      style={{
        ...CORNER_BUTTON_STYLE,
        color: prominent ? 'var(--ember)' : 'var(--muted)',
        opacity: prominent ? 1 : 0.55,
      }}
    >
      ⟲
    </button>
  );
}

/*
 * Крок 16, Section D: theme switching mid-game, not just from the title or
 * game-over screens (ThemePicker in IntroOverlay.jsx / GameOverScreen.jsx's
 * "Change Theme" — both unchanged, both still reset to a brand new game on
 * purpose, since that's the point of "change theme" from either of those
 * screens). This is a THIRD, additive entry point: pick a theme without
 * losing the game in progress.
 *
 * Крок 19: this used to be a full page reload (see git history) — every
 * themed module read `themeKeyFromUrl()` once at its own module load, so a
 * URL change alone couldn't reach any of them. That is no longer true: theme
 * is now a plain `themeKey` prop threaded down from GameCanvas
 * (`onThemeChange` here is that state's setter), so picking one just
 * re-renders the scene with a new prop — no navigation, no reload, and
 * nothing about the game (history, camera, selection) is lost, because
 * nothing ever unmounts.
 *
 * The cooldown is much shorter now (was 10s, covering full-reload latency
 * that no longer exists) and is plain component state instead of
 * sessionStorage-backed — there is no reload for it to need to survive
 * anymore. It still exists at all only to stop rapid re-clicking from
 * queueing overlapping GLTF/texture loads for several themes at once.
 */
const THEME_SWITCH_COOLDOWN_MS = 2000;

function ThemeSwitcherButton({ activeTheme, onThemeChange }) {
  const [open, setOpen] = useState(false);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (remaining <= 0) return undefined;
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 100)), 100);
    return () => clearInterval(id);
  }, [remaining > 0]);

  useEffect(() => {
    if (!open) return undefined;
    const onClickAway = () => setOpen(false);
    // Deferred a tick so the click that OPENED the panel doesn't also close
    // it via this same listener.
    const id = setTimeout(() => window.addEventListener('click', onClickAway), 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('click', onClickAway);
    };
  }, [open]);

  // Крок 19: warm every other theme's piece GLBs into drei's loader cache
  // the instant the panel opens — by the time the player actually clicks an
  // option a beat later, the model swap resolves near-instantly instead of
  // visibly re-suspending. Harmless to call repeatedly (useGLTF.preload is
  // itself idempotent against its own cache).
  useEffect(() => {
    if (!open) return;
    for (const key of Object.keys(THEMES)) {
      if (key !== activeTheme) preloadThemeModels(key);
    }
  }, [open, activeTheme]);

  const onCooldown = remaining > 0;
  const secondsLeft = Math.ceil(remaining / 1000);

  function pick(key) {
    if (key === activeTheme) {
      setOpen(false);
      return;
    }
    onThemeChange(key);
    setOpen(false);
    setRemaining(THEME_SWITCH_COOLDOWN_MS);
  }

  return (
    <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <style>{`
        .hud-theme-button { background: transparent; color: var(--muted); border: 1px solid rgba(0,0,0,0.15); transition: background-color 0.2s ease, color 0.2s ease; }
        .hud-theme-button:hover { border-color: var(--ember); color: var(--ember); }
        .hud-theme-button.active { background: var(--ember); color: #F4F1EA; border-color: var(--ember); }
      `}</style>
      <button
        onClick={() => !onCooldown && setOpen((o) => !o)}
        disabled={onCooldown}
        aria-pressed={open}
        title={onCooldown ? `Change theme (${secondsLeft}s)` : 'Change theme'}
        style={{
          ...CORNER_BUTTON_STYLE,
          color: onCooldown ? 'var(--muted)' : 'var(--lacquer)',
          opacity: onCooldown ? 0.55 : 1,
          cursor: onCooldown ? 'default' : 'pointer',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {onCooldown ? (
          <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{secondsLeft}</span>
        ) : (
          '🎨'
        )}
        {/* The countdown ring — depletes clockwise as `remaining` counts down,
            gone the instant the button becomes usable again. */}
        {onCooldown && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 8,
              background: `conic-gradient(rgba(193,68,14,0.45) ${(1 - remaining / THEME_SWITCH_COOLDOWN_MS) * 360}deg, transparent 0deg)`,
              pointerEvents: 'none',
            }}
          />
        )}
      </button>

      {open && !onCooldown && (
        <div
          style={{
            position: 'absolute',
            bottom: 48,
            right: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: 8,
            borderRadius: 8,
            background: 'rgba(237, 231, 217, 0.96)',
            border: '1px solid #D6CDBA',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            minWidth: 132,
          }}
        >
          {Object.entries(THEMES).map(([key, theme]) => (
            <button
              key={key}
              onClick={() => pick(key)}
              className={`hud-theme-button${key === activeTheme ? ' active' : ''}`}
              style={{
                fontFamily: 'var(--font-ui), system-ui, sans-serif',
                fontSize: 11,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                padding: '6px 10px',
                borderRadius: 4,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {theme.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ControlHint() {
  const [visible, setVisible] = useState(true);

  // Ties to this component's own mount time, which is exactly "the first 8
  // seconds of the game" — HUD only renders this once phase is 'playing'
  // (see GameCanvas), so mount time IS gameplay start.
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), HINT_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 18,
        transform: 'translateX(-50%)',
        zIndex: 10,
        fontFamily: 'var(--font-ui), system-ui, sans-serif',
        fontSize: 11,
        letterSpacing: '0.03em',
        color: 'var(--muted)',
        textShadow: '0 1px 10px rgba(237,231,217,0.8), 0 1px 10px rgba(237,231,217,0.8)',
        opacity: visible ? 1 : 0,
        transition: `opacity ${HINT_FADE_MS}ms ease`,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      Drag to orbit · Scroll to zoom
    </div>
  );
}

/*
 * Fog-of-war onboarding — the mechanic this whole game is built around is
 * genuinely non-standard (a chess player has never had to reason about
 * "which squares can I currently see") and nothing in the HUD explained it
 * before this: a first-time player's own pieces would vanish into fog, or
 * get captured by something that was never on screen, with no framing for
 * why. Minesweeper's own "here's what a flag/number means" blurb is the
 * model — a couple of short explanations up front, not a tutorial that has
 * to be clicked through before playing.
 *
 * Centred, on a scrim, same pattern as PromotionModal.jsx: a click anywhere
 * on the scrim dismisses (stopPropagation on the card group itself keeps a
 * click ON the cards from bubbling to it), and there's also an explicit
 * "Got it" button for a deliberate confirm rather than an accidental
 * click-through. Both read as the same action — dismiss — so both just call
 * the same handler.
 *
 * `localStorage`, not `sessionStorage` (contrast `INTRO_SEEN_KEY`, which is
 * deliberately per-tab-session): this is "have you ever been told the rule,"
 * not "did you see the intro this session" — a returning player a week later
 * doesn't need it re-explained every session the way the intro cinematic is
 * fine to repeat.
 */
const FOG_ONBOARDING_SEEN_KEY = 'dead-reckoning:fog-onboarding-seen';

const FOG_ONBOARDING_CARDS = [
  {
    id: 'vision',
    icon: '🌫️',
    title: 'Fog of war',
    body: 'You only see squares your own pieces currently control. Everything else on the board is hidden.',
  },
  {
    id: 'ambush',
    icon: '⚔️',
    title: 'Hidden danger',
    body: "An enemy piece you've never seen can still capture you from inside the fog — losing a piece to \"nowhere\" is expected, not a bug.",
  },
];

function hasSeenFogOnboarding() {
  try {
    return window.localStorage.getItem(FOG_ONBOARDING_SEEN_KEY) === '1';
  } catch {
    // Storage disabled/unavailable (private mode, etc.) — treat every visit
    // as first-time rather than throwing; worst case the cards reappear.
    return false;
  }
}

function markFogOnboardingSeen() {
  try {
    window.localStorage.setItem(FOG_ONBOARDING_SEEN_KEY, '1');
  } catch {
    // Non-fatal — the cards would just show again next visit.
  }
}

function FogOnboardingCard({ card }) {
  return (
    <div
      role="note"
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: '14px 16px',
        borderRadius: 10,
        background: 'rgba(237, 231, 217, 0.97)',
        border: '1px solid #D6CDBA',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        fontFamily: 'var(--font-ui), system-ui, sans-serif',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1.3 }}>
        {card.icon}
      </span>
      <div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--ember)',
            marginBottom: 4,
          }}
        >
          {card.title}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--lacquer)' }}>{card.body}</div>
      </div>
    </div>
  );
}

function FogOnboarding() {
  // Lazy init so a returning player (localStorage already set) never even
  // mounts the dialog for one frame before disappearing.
  const [dismissed, setDismissed] = useState(hasSeenFogOnboarding);

  function dismiss() {
    if (dismissed) return;
    setDismissed(true);
    markFogOnboardingSeen();
  }

  useEffect(() => {
    if (dismissed) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissed]);

  if (dismissed) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Fog of war rules"
      // A click anywhere on the scrim (i.e. not on the cards themselves,
      // which stop it below) dismisses — same convention PromotionModal.jsx
      // already uses for "click past it costs nothing."
      onClick={dismiss}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 25,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(20, 18, 15, 0.35)',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          maxWidth: 380,
          padding: '0 16px',
        }}
      >
        {FOG_ONBOARDING_CARDS.map((card) => (
          <FogOnboardingCard key={card.id} card={card} />
        ))}
        <button
          onClick={dismiss}
          style={{
            alignSelf: 'center',
            marginTop: 4,
            padding: '8px 28px',
            fontFamily: 'var(--font-ui), system-ui, sans-serif',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#F4F1EA',
            background: 'var(--ember)',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}

/*
 * Крок 11, Section A: this environment's headless browser renders at ~1fps
 * regardless of scene complexity (see CLAUDE.md's "Headless browser"
 * section) — real GPU frame rate can only be checked in an actual browser.
 * This is that check: a plain DOM-level requestAnimationFrame counter,
 * outside the r3f tree entirely, so it measures the browser's real paint
 * rate rather than anything the Canvas's own render loop reports. Averaged
 * over a rolling 500ms window and only committed to React state on that
 * cadence — updating every rAF tick would itself be the kind of per-frame
 * setState this codebase avoids elsewhere (CameraRig, FogLayer, the
 * hover-lift) for the same reason.
 */
function FpsCounter() {
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let frames = 0;
    let windowStart = performance.now();
    let rafId;

    const tick = (now) => {
      frames += 1;
      const elapsed = now - windowStart;
      if (elapsed >= 500) {
        setFps(Math.round((frames * 1000) / elapsed));
        frames = 0;
        windowStart = now;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return <>{fps} fps</>;
}

export default function HUD({
  turn,
  status,
  visibleCount,
  onNewGame,
  showGameplay = true,
  themeKey,
  onThemeChange,
}) {
  const showDebug =
    SHOW_DEBUG ||
    (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug'));

  const turnLabel = turn === 'w' ? 'White (you)' : 'Black (AI)';
  const isOver = GAME_OVER_STATUSES.includes(status);

  // Check is deliberately not surfaced anywhere in the HUD: telling the
  // player their king is under attack is exactly the kind of information the
  // fog is supposed to withhold when the attacker itself is unseen. Every
  // status that actually ends the game (checkmate, stalemate, draw, a
  // captured king) still gets a corner message here, but the dedicated
  // full-screen announcement now lives in GameOverScreen.jsx, not a HUD
  // flash — see GameCanvas.jsx.
  let message;
  if (status === 'checkmate') {
    // chess.js leaves `turn` on the side that has been mated.
    const winner = turn === 'w' ? 'Black (AI)' : 'White (you)';
    message = `Checkmate — ${winner} wins`;
  } else if (status === 'whiteKingCaptured') {
    message = 'White’s king was captured — Black (AI) wins';
  } else if (status === 'blackKingCaptured') {
    message = 'Black’s king was captured — White (you) wins';
  } else if (status === 'stalemate') {
    message = 'Stalemate';
  } else if (status === 'draw') {
    message = 'Draw';
  } else {
    message = `${turnLabel} to move`;
  }

  return (
    <>
      {/* One corner, one style, per the brief: sound is always here, "new
          game" joins it once gameplay starts (it has nothing to reset
          before then). Siblings rather than nested, since both are
          independently absolutely-positioned. */}
      {SHOW_SOUND_TOGGLE && (
        <div
          style={{
            position: 'absolute',
            right: 16,
            bottom: 16,
            zIndex: 10,
            display: 'flex',
            gap: 8,
          }}
        >
          <SoundToggle />
          {showGameplay && <NewGameButton onNewGame={onNewGame} prominent={isOver} />}
          {/* Крок 16, Section D: mid-game theme switching, gated the same way
              "new game" already is (nothing to switch before gameplay
              starts). Sits behind GameOverScreen's z-index once the game
              actually ends — that screen has its own "Change Theme", which
              resets to a new game on purpose, a different action from this
              one. */}
          {showGameplay && <ThemeSwitcherButton activeTheme={themeKey} onThemeChange={onThemeChange} />}
        </div>
      )}

      {showGameplay && <ControlHint />}
      {showGameplay && <FogOnboarding />}

      {showGameplay && (
        <>
          {/* No card, no border — plain text on the scene, per the brief
              ("прибрати рамку-картку"). A text-shadow does the legibility
              work a background chip used to. */}
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: 16,
              zIndex: 10,
              fontFamily: 'var(--font-ui), system-ui, sans-serif',
              color: 'var(--lacquer)',
              textShadow: '0 1px 10px rgba(237,231,217,0.8), 0 1px 10px rgba(237,231,217,0.8)',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>{message}</div>

            {showDebug && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: 'var(--muted)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                visible: {visibleCount} / 64 · <FpsCounter />
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
