import { useEffect, useState } from 'react';
import { BACKDROP_IMAGE, BACKDROP_MODE } from './Backdrop';

const SEEN_KEY = 'dead-reckoning:intro-seen';
const FADE_MS = 900;

/**
 * A full title screen rather than a floating dialog: it owns the whole
 * viewport, carries its own art and a darkened scrim, and hands off to the
 * game with a fade. The scene is already mounted and running underneath, so
 * dismissal drops straight into a live board with the camera in place.
 */
export default function TitleScreen() {
  // Start hidden so the first client paint matches the server markup; the
  // effect decides whether this session has already seen it.
  const [mounted, setMounted] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.sessionStorage.getItem(SEEN_KEY) === '1';
    } catch {
      // Private mode / blocked storage — just show the title.
    }
    if (!seen) setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function dismiss() {
    setLeaving(true);
    try {
      window.sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Non-fatal: the title will simply appear again next reload.
    }
    setTimeout(() => setMounted(false), FADE_MS);
  }

  if (!mounted) return null;

  const art =
    BACKDROP_MODE === 'image'
      ? `linear-gradient(180deg, rgba(20,18,15,0.55) 0%, rgba(20,18,15,0.30) 42%, rgba(233,226,213,0.92) 100%), url(${BACKDROP_IMAGE})`
      : // Until the painting exists, stand in with a wash in the same key so the
        // screen still reads as composed rather than empty.
        'radial-gradient(120% 85% at 50% 12%, #F6F2E9 0%, #E6DDCC 45%, #C6B9A2 100%)';

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
        justifyContent: 'center',
        padding: '32px 24px',
        background: art,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        opacity: leaving ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: leaving ? 'none' : 'auto',
      }}
    >
      <div style={{ maxWidth: 620, textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--font-ui), system-ui, sans-serif',
            fontSize: 12,
            letterSpacing: '0.34em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
            marginBottom: 18,
          }}
        >
          Шахи в тумані війни
        </div>

        <h1
          id="title-heading"
          style={{
            fontFamily: 'var(--font-display), Georgia, serif',
            fontWeight: 600,
            fontSize: 'clamp(2.6rem, 9vw, 5.2rem)',
            lineHeight: 1.02,
            letterSpacing: '0.01em',
            color: 'var(--lacquer)',
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
          }}
        >
          Ти бачиш лише те, що тримають під ударом твої фігури. Решта дошки — туман. Суперник
          у ньому теж.
        </p>

        <button
          onClick={dismiss}
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
            boxShadow: '0 6px 22px rgba(193, 68, 14, 0.3)',
          }}
        >
          Почати партію
        </button>

        <div
          style={{
            marginTop: 22,
            fontFamily: 'var(--font-ui), system-ui, sans-serif',
            fontSize: 12,
            color: 'var(--muted)',
          }}
        >
          Ти граєш білими
        </div>
      </div>
    </div>
  );
}
