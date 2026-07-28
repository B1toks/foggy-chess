import { useEffect, useState } from 'react';
import { isAudioEnabled, setAudioEnabled } from './audio';
import { GAME_OVER_STATUSES } from '../lib/useChessGame';
import { THEMES, themeKeyFromUrl } from '../lib/themes';

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
 * game-over screens (Крок 14/15's ThemePicker in IntroOverlay.jsx /
 * GameOverScreen.jsx's "Change Theme" — both unchanged, both still reset to
 * a brand new game on purpose, since that's the point of "change theme" from
 * either of those screens). This is a THIRD, additive entry point: pick a
 * theme without losing the game in progress.
 *
 * WHY THIS IS STILL A FULL RELOAD, and why that's not a compromise on "the
 * game state is preserved": every themed module in this codebase
 * (lib/fog.js, lib/themes.js's own consumers — PieceModel.jsx,
 * RockIsland.jsx, Board.jsx, Backdrop.jsx) reads `themeKeyFromUrl()` ONCE at
 * module load and holds it in a module-level constant, by design (see
 * lib/themes.js's own header comment and CLAUDE.md's Крок 13 notes) — a
 * pushState-only URL change would not cause any of them to re-evaluate.
 * Converting every one of those into a reactive (context/prop-driven) read
 * is a real architectural change, not this task.
 *
 * So this navigates, same as the existing "Change Theme" flows — but carries
 * the CURRENT position across as `?fen=`, which useChessGame already
 * supports as an initial-state hook (see its own `initialFen` param). The
 * reload lands on a fresh chess.js instance at the same position, same turn,
 * same castling/en-passant rights — everything a player can actually see or
 * that affects legal moves going forward. The one thing that does NOT
 * survive is chess.js's own move-history array, which nothing downstream
 * depends on for correctness: it only ever feeds the move/capture SOUND
 * trigger (compares history.length against its own last-seen value, which
 * also resets to 0 on the fresh mount, so no false triggers) and the fog
 * wave's origin square (lastMove null after a reload just means "no wave
 * origin, settle in place" — already a handled, ordinary case, not an
 * error). `INTRO_SEEN_KEY` is untouched by this reload, so it lands straight
 * on 'playing', not the intro cinematic.
 */
const THEME_SWITCH_COOLDOWN_KEY = 'dead-reckoning:theme-switch-at';
const THEME_SWITCH_COOLDOWN_MS = 10000;

function remainingThemeSwitchCooldownMs() {
  try {
    const at = Number(window.sessionStorage.getItem(THEME_SWITCH_COOLDOWN_KEY));
    if (!at) return 0;
    return Math.max(0, THEME_SWITCH_COOLDOWN_MS - (Date.now() - at));
  } catch {
    return 0;
  }
}

function switchThemeMidGame(key, fen) {
  try {
    window.sessionStorage.setItem(THEME_SWITCH_COOLDOWN_KEY, String(Date.now()));
    const url = new URL(window.location.href);
    url.searchParams.set('theme', key);
    url.searchParams.set('fen', fen);
    window.location.href = url.toString();
  } catch {
    // Non-fatal — worst case the button just doesn't navigate, and the
    // cooldown timestamp (if it did get written) self-expires in 10s.
  }
}

function ThemeSwitcherButton({ fen }) {
  const [open, setOpen] = useState(false);
  // Lazy init from sessionStorage so a page reloaded mid-cooldown (exactly
  // what switching theme itself does) keeps counting down instead of
  // resetting the button to immediately-usable — the whole point of a
  // cooldown that survives the very action it's gating.
  const [remaining, setRemaining] = useState(remainingThemeSwitchCooldownMs);

  // Ticks every 100ms off the stored timestamp rather than a local counter,
  // so it stays correct even if the tab was backgrounded (setInterval drift)
  // — re-reading sessionStorage each tick is cheap and self-correcting.
  useEffect(() => {
    const id = setInterval(() => setRemaining(remainingThemeSwitchCooldownMs()), 100);
    return () => clearInterval(id);
  }, []);

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

  const onCooldown = remaining > 0;
  const activeTheme = themeKeyFromUrl();
  const secondsLeft = Math.ceil(remaining / 1000);

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
              onClick={() => (key === activeTheme ? setOpen(false) : switchThemeMidGame(key, fen))}
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

export default function HUD({ turn, status, visibleCount, onNewGame, showGameplay = true, fen }) {
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
          {showGameplay && <ThemeSwitcherButton fen={fen} />}
        </div>
      )}

      {showGameplay && <ControlHint />}

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
