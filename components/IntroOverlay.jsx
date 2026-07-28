import { useEffect } from 'react';
import { THEMES, themeKeyFromUrl } from '../lib/themes';

/*
 * Крок 8, Section B: replaces the old TitleScreen. That version carried its
 * own background art and fully occluded the canvas underneath; this one is
 * transparent — the live scene (already mounted, already running its own
 * camera moves via IntroCameraRig) IS the background. This component only
 * owns the text, which stays completely still while the camera moves under
 * it: an eyebrow label, the title, one line on the mechanic, the start
 * button, and a footer note.
 *
 * No pointer-events on the container itself — only the button is clickable —
 * so the cinematic underneath is never dimmed by a modal scrim.
 *
 * Крок 9.6, Section A: the project ships to an English-speaking client, so
 * every string here is English now. This pass also fixed a real readability
 * bug — the background behind this text is a moving camera shot, not a
 * fixed image, so a plain text-shadow (which only has to beat one static
 * backdrop) isn't reliable: it reads fine against fog and washes out against
 * a light sky, or the reverse, depending on which frame of the loop is
 * showing. TextScrim below fixes the contrast at its source (a soft, blurred
 * dark patch under the text that moves with it) instead of chasing it with a
 * shadow that only sometimes wins.
 */

/**
 * A soft, heavily-blurred dark patch sized a little larger than its content,
 * painted first so normal DOM order puts the text on top of it — no z-index
 * needed. This is what lets every text block below drop its text-shadow
 * entirely: contrast no longer depends on what happens to be behind it in
 * the live scene at a given moment, because this patch travels with the
 * text and is always there.
 */
function TextScrim({ children, inset = '-28px -56px' }) {
  return (
    <div style={{ position: 'relative' }}>
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset,
          background:
            'radial-gradient(ellipse at center, rgba(20,18,14,0.55) 0%, rgba(20,18,14,0) 70%)',
          filter: 'blur(28px)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  );
}

// Reused for both the title's own size and the gap above the description, so
// that gap stays at least as tall as the title itself at every viewport
// width without hardcoding a second breakpoint ladder.
const TITLE_SIZE = 'clamp(1.9rem, 7vw, 3.6rem)';

/*
 * Крок 14, Section B: "Change Theme" (GameOverScreen.jsx) sends the player
 * back here, to the one screen that offers a theme choice. Themes are read
 * once at module load across lib/fog.js, PieceModel.jsx, RockIsland.jsx etc.
 * (see lib/themes.js's own header comment), so picking one is a real page
 * navigation with `?theme=` set, not a React state change — nothing here
 * tries to hot-swap live.
 */
function setThemeAndReload(key) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('theme', key);
    window.location.href = url.toString();
  } catch {
    // Non-fatal — worst case the picker just doesn't navigate.
  }
}

function ThemePicker() {
  const active = themeKeyFromUrl();

  return (
    <div
      style={{
        marginTop: 14,
        display: 'flex',
        gap: 10,
        justifyContent: 'center',
        flexWrap: 'wrap',
        pointerEvents: 'auto',
      }}
    >
      {Object.entries(THEMES).map(([key, theme]) => (
        <button
          key={key}
          onClick={() => setThemeAndReload(key)}
          className={`intro-theme-button${key === active ? ' active' : ''}`}
          style={{
            fontFamily: 'var(--font-ui), system-ui, sans-serif',
            fontSize: 11,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            padding: '6px 14px',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {theme.label}
        </button>
      ))}
    </div>
  );
}

export default function IntroOverlay({ onStart }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') onStart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStart]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="title-heading"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '48px 24px',
        pointerEvents: 'none',
      }}
    >
      <style>{`
        .intro-begin-button {
          background: transparent;
          color: #C1440E;
          border: 1px solid #C1440E;
          transition: background-color 0.2s ease, color 0.2s ease;
        }
        .intro-begin-button:hover {
          background: #C1440E;
          color: #F4F1EA;
        }
        .intro-theme-button {
          background: transparent;
          color: rgba(244,241,234,0.75);
          border: 1px solid rgba(244,241,234,0.35);
          transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease;
        }
        .intro-theme-button:hover {
          border-color: #C1440E;
          color: #F4F1EA;
        }
        .intro-theme-button.active {
          background: #C1440E;
          color: #F4F1EA;
          border-color: #C1440E;
        }
      `}</style>

      <TextScrim inset="-16px -32px">
        <div
          style={{
            fontFamily: 'var(--font-ui), system-ui, sans-serif',
            fontSize: 12,
            letterSpacing: '0.34em',
            textTransform: 'uppercase',
            color: '#F4F1EA',
          }}
        >
          Chess in the fog of war
        </div>
      </TextScrim>

      <TextScrim>
        <div style={{ maxWidth: 620, textAlign: 'center' }}>
          <h1
            id="title-heading"
            style={{
              fontFamily: 'var(--font-display), Georgia, serif',
              fontWeight: 400,
              fontSize: TITLE_SIZE,
              lineHeight: 1.1,
              letterSpacing: '0.25em',
              textTransform: 'uppercase',
              color: '#F4F1EA',
            }}
          >
            Dead Reckoning
          </h1>

          <div
            style={{
              width: 64,
              height: 2,
              margin: '26px auto',
              background: 'var(--ember)',
            }}
          />

          <p
            style={{
              // marginTop carries the "gap >= title height" rule; kept
              // separate from the marginLeft/Right auto-centering below
              // rather than the `margin` shorthand, which would silently
              // reset this back to 0.
              marginTop: TITLE_SIZE,
              marginLeft: 'auto',
              marginRight: 'auto',
              marginBottom: 0,
              fontFamily: 'var(--font-display), Georgia, serif',
              fontWeight: 400,
              fontSize: 'clamp(0.9rem, 2.3vw, 1.05rem)',
              letterSpacing: 'normal',
              lineHeight: 1.65,
              opacity: 0.85,
              color: '#F4F1EA',
              maxWidth: 460,
            }}
          >
            You see only what your own pieces hold under threat.
            <br />
            The rest of the board is fog — and so is your opponent.
          </p>

          <button
            onClick={onStart}
            className="intro-begin-button"
            style={{
              marginTop: 40,
              padding: '15px 42px',
              fontFamily: 'var(--font-ui), system-ui, sans-serif',
              fontSize: 15,
              fontWeight: 500,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              borderRadius: 4,
              cursor: 'pointer',
              pointerEvents: 'auto',
            }}
          >
            Begin
          </button>
        </div>
      </TextScrim>

      <TextScrim inset="-14px -28px">
        <div
          style={{
            fontFamily: 'var(--font-ui), system-ui, sans-serif',
            fontSize: 12,
            color: '#F4F1EA',
          }}
        >
          You play White
        </div>
        <ThemePicker />
      </TextScrim>
    </div>
  );
}
