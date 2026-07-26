import { useEffect, useState } from 'react';
import { isAudioEnabled, setAudioEnabled } from './audio';

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
      title={on ? 'Вимкнути звук' : 'Увімкнути звук'}
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
      title="Нова гра"
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
      Перетягніть, щоб обертати · Колесо — масштаб
    </div>
  );
}

/** The large check/checkmate flash — same ember as the board's own move highlight. */
function StatusFlash({ text }) {
  return (
    <div
      key={text}
      aria-live="polite"
      style={{
        position: 'absolute',
        top: 28,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        fontFamily: 'var(--font-display), Georgia, serif',
        fontWeight: 600,
        fontSize: 'clamp(28px, 5vw, 48px)',
        color: 'var(--ember)',
        textShadow: '0 2px 24px rgba(237,231,217,0.7), 0 1px 3px rgba(20,18,15,0.25)',
        pointerEvents: 'none',
        animation: 'hud-status-flash 0.5s ease',
      }}
    >
      {text}
    </div>
  );
}

export default function HUD({ turn, status, visibleCount, onNewGame, showGameplay = true }) {
  const showDebug =
    SHOW_DEBUG ||
    (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug'));

  const turnLabel = turn === 'w' ? 'White (you)' : 'Black (AI)';
  const isOver = status === 'checkmate' || status === 'draw';

  let message;
  if (status === 'checkmate') {
    // chess.js leaves `turn` on the side that has been mated.
    const winner = turn === 'w' ? 'Black (AI)' : 'White (you)';
    message = `Checkmate — ${winner} wins`;
  } else if (status === 'draw') {
    message = 'Draw';
  } else if (status === 'check') {
    message = `Check — ${turnLabel} to move`;
  } else {
    message = `${turnLabel} to move`;
  }

  return (
    <>
      <style>{`
        @keyframes hud-status-flash {
          from { opacity: 0; transform: translate(-50%, -6px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>

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
                visible: {visibleCount} / 64
              </div>
            )}
          </div>

          {status === 'check' && <StatusFlash text="Шах" />}
          {status === 'checkmate' && <StatusFlash text="Мат" />}
        </>
      )}
    </>
  );
}
