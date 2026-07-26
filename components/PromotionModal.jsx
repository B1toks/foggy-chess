import { useEffect } from 'react';

/*
 * Крок 13: replaces the old 3D PromotionPicker (a floating row of models
 * above the promoting square). That approach fought the camera on the far
 * rank specifically — see the file this superseded for the SCALE/LIFT/PULL
 * derivation it needed just to stay on screen — and needed its own yaw-to-
 * camera logic every frame just to stay legible. A flat 2x2 HTML modal has
 * none of that: it's always centred, always readable, and always the same
 * size regardless of where on the board the pawn promotes or how the camera
 * is currently oriented.
 *
 * Glyphs, not the real GLTF models: the choice is a UI decision ("which
 * piece"), not a moment in the 3D scene, so it doesn't need to spend a model
 * load to make it. Only the player's own pawns ever reach this picker (the AI
 * auto-queens, see useChessGame's makeMove), so every option is implicitly
 * White's — but the glyphs used are the "black chess piece" Unicode code
 * points (♛♜♝♞), not "white" (♕♖♗♘): in essentially every font that
 * implements this block, the "white" variants render as hollow outlines and
 * the "black" variants render as solid silhouettes, independent of CSS
 * `color`. A solid dark glyph is what actually reads clearly against the
 * light bone-coloured button; the outline variants looked washed out.
 */

const OPTIONS = [
  { code: 'q', label: 'Queen', glyph: '♛' },
  { code: 'r', label: 'Rook', glyph: '♜' },
  { code: 'b', label: 'Bishop', glyph: '♝' },
  { code: 'n', label: 'Knight', glyph: '♞' },
];

function OptionButton({ option, onPick }) {
  return (
    <button
      onClick={() => onPick(option.code)}
      aria-label={option.label}
      title={option.label}
      className="promotion-modal-option"
    >
      {option.glyph}
    </button>
  );
}

export default function PromotionModal({ onPick, onCancel }) {
  // Esc cancels — same behaviour the 3D picker had. The pawn hasn't moved
  // yet (Board.jsx holds the move pending until a piece is chosen), so
  // cancelling costs nothing.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose promotion"
      // A click on the scrim (anywhere but the card itself) cancels, same
      // as the 3D picker's onPointerMissed.
      onClick={onCancel}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 30,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(20, 18, 15, 0.4)',
      }}
    >
      <style>{`
        .promotion-modal-option {
          width: 88px;
          height: 88px;
          display: grid;
          place-items: center;
          font-size: 44px;
          line-height: 1;
          color: #0E0E10;
          background: #DDD3BE;
          border: 1px solid #C7BCA3;
          border-radius: 10px;
          cursor: pointer;
          transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .promotion-modal-option:hover,
        .promotion-modal-option:focus-visible {
          border-color: #C1440E;
          transform: translateY(-3px);
          box-shadow: 0 6px 18px rgba(0,0,0,0.25);
          outline: none;
        }
      `}</style>

      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 14,
          padding: 22,
          background: 'rgba(237, 231, 217, 0.97)',
          border: '1px solid #D6CDBA',
          borderRadius: 14,
          boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
        }}
      >
        <div
          style={{
            gridColumn: '1 / -1',
            fontFamily: 'var(--font-ui), system-ui, sans-serif',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
            textAlign: 'center',
            marginBottom: 2,
          }}
        >
          Promote to
        </div>
        {OPTIONS.map((option) => (
          <OptionButton key={option.code} option={option} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}
