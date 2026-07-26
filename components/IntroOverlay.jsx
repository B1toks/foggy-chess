import { useEffect } from 'react';

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
 */
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
      <div
        style={{
          fontFamily: 'var(--font-ui), system-ui, sans-serif',
          fontSize: 12,
          letterSpacing: '0.34em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          textShadow: '0 1px 12px rgba(20,18,15,0.5)',
        }}
      >
        Шахи в тумані війни
      </div>

      <div style={{ maxWidth: 620, textAlign: 'center' }}>
        <h1
          id="title-heading"
          style={{
            fontFamily: 'var(--font-display), Georgia, serif',
            fontWeight: 600,
            fontSize: 'clamp(2.6rem, 9vw, 5.2rem)',
            lineHeight: 1.02,
            letterSpacing: '0.01em',
            color: 'var(--lacquer)',
            textShadow: '0 2px 24px rgba(237,231,217,0.55), 0 1px 3px rgba(20,18,15,0.35)',
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
            fontFamily: 'var(--font-display), Georgia, serif',
            fontSize: 'clamp(1.02rem, 3.4vw, 1.3rem)',
            lineHeight: 1.65,
            color: 'var(--lacquer)',
            margin: '0 auto',
            maxWidth: 460,
            textShadow: '0 1px 16px rgba(237,231,217,0.6)',
          }}
        >
          Ти бачиш лише те, що тримають під ударом твої фігури. Решта дошки — туман. Суперник
          у ньому теж.
        </p>

        <button
          onClick={onStart}
          style={{
            marginTop: 40,
            padding: '15px 42px',
            fontFamily: 'var(--font-ui), system-ui, sans-serif',
            fontSize: 15,
            fontWeight: 500,
            letterSpacing: '0.04em',
            color: 'var(--bone)',
            background: 'var(--ember)',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            boxShadow: '0 6px 22px rgba(193, 68, 14, 0.4)',
            pointerEvents: 'auto',
          }}
        >
          Почати партію
        </button>
      </div>

      <div
        style={{
          fontFamily: 'var(--font-ui), system-ui, sans-serif',
          fontSize: 12,
          color: 'var(--muted)',
          textShadow: '0 1px 12px rgba(20,18,15,0.5)',
        }}
      >
        Ти граєш білими
      </div>
    </div>
  );
}
