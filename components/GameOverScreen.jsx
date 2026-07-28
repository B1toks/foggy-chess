import { useEffect, useState } from 'react';

/*
 * Крок 14, Section B: the game's end used to be just HUD's small corner
 * message plus a StatusFlash (see git history on HUD.jsx). This replaces both
 * for every terminal status with a full-screen moment in the same visual
 * language as IntroOverlay — same display type, same thin ember divider, same
 * "text rises in" trick HUD's old flash used, just applied to a dedicated
 * screen instead of a passing flash.
 *
 * Deliberately NOT a second scene: this sits outside <Canvas> exactly like
 * IntroOverlay/PromotionModal, over the still-mounted board/pieces/rock —
 * the live scene, frozen on the final position, shows faintly through the
 * blurred scrim. See CLAUDE.md's "Important" note under "Intro" for why a
 * second scene is never the right move here.
 */

function contentFor(status, turn) {
  switch (status) {
    case 'checkmate': {
      // chess.js leaves `turn` on the side that has been mated.
      const winner = turn === 'w' ? 'Black' : 'White';
      return { title: 'Checkmate', subtitle: `${winner} wins` };
    }
    case 'whiteKingCaptured':
      return { title: 'King Captured', subtitle: 'Black wins' };
    case 'blackKingCaptured':
      return { title: 'King Captured', subtitle: 'White wins' };
    case 'stalemate':
      return { title: 'Stalemate', subtitle: 'Draw' };
    case 'draw':
      return { title: 'Draw', subtitle: '' };
    default:
      return null;
  }
}

export default function GameOverScreen({ status, turn, onPlayAgain, onChangeTheme }) {
  const content = contentFor(status, turn);

  // Mount-triggered CSS transition (0.6s, same duration as the intro's own
  // cut crossfade) rather than the imperative-ref pattern IntroCameraRig's
  // crossfade uses — that one exists to be driven from inside a useFrame loop
  // at 60fps without re-rendering; this is a single one-shot entrance with
  // nothing per-frame to drive, so a plain state flip is simpler and correct.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!content) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gameover-title"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(ellipse at center, rgba(24,21,16,0.55) 0%, rgba(24,21,16,0.86) 100%)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        opacity: entered ? 1 : 0,
        transition: 'opacity 0.6s ease',
      }}
    >
      <style>{`
        @keyframes gameover-rise {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .gameover-btn-primary {
          background: var(--ember);
          color: #F4F1EA;
          border: 1px solid var(--ember);
          transition: background-color 0.2s ease, opacity 0.2s ease;
        }
        .gameover-btn-primary:hover { opacity: 0.85; }
        .gameover-btn-secondary {
          background: transparent;
          color: var(--ember);
          border: 1px solid var(--ember);
          transition: background-color 0.2s ease, color 0.2s ease;
        }
        .gameover-btn-secondary:hover { background: var(--ember); color: #F4F1EA; }
      `}</style>

      <div style={{ textAlign: 'center', maxWidth: 560, padding: '0 24px' }}>
        <h1
          id="gameover-title"
          style={{
            fontFamily: 'var(--font-display), Georgia, serif',
            fontWeight: 400,
            fontSize: 'clamp(2rem, 7vw, 3.8rem)',
            lineHeight: 1.1,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: '#F4F1EA',
            margin: 0,
            animation: 'gameover-rise 0.6s ease 0.2s both',
          }}
        >
          {content.title}
        </h1>

        <div
          style={{
            width: 64,
            height: 2,
            margin: '24px auto',
            background: 'var(--ember)',
            animation: 'gameover-rise 0.6s ease 0.32s both',
          }}
        />

        {content.subtitle && (
          <p
            style={{
              fontFamily: 'var(--font-display), Georgia, serif',
              fontWeight: 400,
              fontSize: 'clamp(1rem, 2.6vw, 1.3rem)',
              letterSpacing: '0.05em',
              color: '#F4F1EA',
              opacity: 0.85,
              margin: 0,
              animation: 'gameover-rise 0.6s ease 0.32s both',
            }}
          >
            {content.subtitle}
          </p>
        )}

        <div
          style={{
            marginTop: 44,
            display: 'flex',
            gap: 20,
            justifyContent: 'center',
            flexWrap: 'wrap',
            animation: 'gameover-rise 0.6s ease 0.42s both',
          }}
        >
          <button
            onClick={onPlayAgain}
            className="gameover-btn-primary"
            style={{
              padding: '15px 38px',
              fontFamily: 'var(--font-ui), system-ui, sans-serif',
              fontSize: 15,
              fontWeight: 500,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Play Again
          </button>
          <button
            onClick={onChangeTheme}
            className="gameover-btn-secondary"
            style={{
              padding: '15px 38px',
              fontFamily: 'var(--font-ui), system-ui, sans-serif',
              fontSize: 15,
              fontWeight: 500,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Change Theme
          </button>
        </div>
      </div>
    </div>
  );
}
