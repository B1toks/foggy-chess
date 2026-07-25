import { useState } from 'react';
import { isAudioEnabled, setAudioEnabled } from './audio';

// Flip to true (or append ?debug=1) to bring back the vision readout.
const SHOW_DEBUG = false;
// Set to false to drop the sound toggle and leave the game silent.
export const SHOW_SOUND_TOGGLE = true;

function SoundToggle() {
  const [on, setOn] = useState(isAudioEnabled);

  return (
    <button
      onClick={() => setOn(setAudioEnabled(!on))}
      aria-pressed={on}
      title={on ? 'Вимкнути звук' : 'Увімкнути звук'}
      style={{
        position: 'absolute',
        right: 16,
        bottom: 16,
        // Above the vignette overlay (z-index 5), below the title screen (20).
        zIndex: 10,
        width: 40,
        height: 40,
        display: 'grid',
        placeItems: 'center',
        fontSize: 16,
        lineHeight: 1,
        background: 'rgba(237, 231, 217, 0.92)',
        border: '1px solid #D6CDBA',
        borderRadius: 8,
        color: on ? 'var(--ember)' : 'var(--muted)',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      {on ? '🔊' : '🔇'}
    </button>
  );
}

export default function HUD({ turn, status, visibleCount, onNewGame }) {
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
    {/* The toggle is a sibling of the status panel, not a child: the panel is
        itself absolutely positioned, so a nested absolute child would anchor to
        the panel rather than to the viewport corner. */}
    {SHOW_SOUND_TOGGLE && <SoundToggle />}

    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        // Above the vignette overlay (z-index 5), below the title screen (20).
        zIndex: 10,
        padding: '12px 16px',
        background: 'rgba(237, 231, 217, 0.92)',
        border: '1px solid #D6CDBA',
        borderRadius: 8,
        fontFamily: 'var(--font-ui), system-ui, sans-serif',
        color: 'var(--lacquer)',
        minWidth: 220,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600 }}>{message}</div>

      {isOver && (
        <div style={{ fontSize: 12, marginTop: 4, color: '#5A5346' }}>Game over</div>
      )}

      <button
        onClick={onNewGame}
        style={{
          marginTop: 10,
          padding: '6px 12px',
          fontSize: 13,
          fontFamily: 'inherit',
          background: '#C1440E',
          color: '#EDE7D9',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        New game
      </button>

      {showDebug && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: '1px solid #D6CDBA',
            fontSize: 11,
            color: 'var(--muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          visible: {visibleCount} / 64
        </div>
      )}
    </div>
    </>
  );
}
