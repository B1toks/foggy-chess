import { useEffect } from 'react';

/*
 * Крок 13: replaces the old 3D PromotionPicker (a floating row of models
 * above the promoting square). That approach fought the camera on the far
 * rank specifically — see the file this superseded for the SCALE/LIFT/PULL
 * derivation it needed just to stay on screen — and needed its own yaw-to-
 * camera logic every frame just to stay legible. A flat HTML modal has none
 * of that: it's always centred, always readable, and always the same size
 * regardless of where on the board the pawn promotes or how the camera is
 * currently oriented.
 *
 * Крок 14: reworked from a 2x2 grid of unicode glyphs into 4 stacked
 * horizontal rows, each with a flat vector icon. Real GLTF models still
 * aren't worth loading here — "which piece" stays a UI decision, not a
 * moment in the 3D scene — but the glyphs read as an afterthought next to
 * this large a button, so each option gets a small hand-drawn flat SVG
 * silhouette instead, `fill="currentColor"` so it inherits the same
 * `#0E0E10` the label text already uses.
 */

const ICON_VIEWBOX = '0 0 100 100';

function QueenIcon(props) {
  return (
    <svg viewBox={ICON_VIEWBOX} width="40" height="40" aria-hidden="true" {...props}>
      <polygon points="22,46 30,18 38,36 50,12 62,36 70,18 78,46" />
      <circle cx="30" cy="18" r="5" />
      <circle cx="50" cy="12" r="5" />
      <circle cx="70" cy="18" r="5" />
      <polygon points="30,80 70,80 62,46 38,46" />
      <rect x="18" y="80" width="64" height="10" rx="2" />
    </svg>
  );
}

function RookIcon(props) {
  return (
    <svg viewBox={ICON_VIEWBOX} width="40" height="40" aria-hidden="true" {...props}>
      <rect x="24" y="18" width="10" height="16" />
      <rect x="45" y="18" width="10" height="16" />
      <rect x="66" y="18" width="10" height="16" />
      <rect x="24" y="30" width="52" height="12" />
      <polygon points="32,42 68,42 62,78 38,78" />
      <rect x="18" y="78" width="64" height="10" rx="2" />
    </svg>
  );
}

function BishopIcon(props) {
  return (
    <svg viewBox={ICON_VIEWBOX} width="40" height="40" aria-hidden="true" {...props}>
      <circle cx="50" cy="17" r="6" />
      <path d="M50 25 C 65 33, 68 54, 58 68 L 62 78 L 38 78 L 42 68 C 32 54, 35 33, 50 25 Z" />
      <rect x="18" y="78" width="64" height="10" rx="2" />
    </svg>
  );
}

function KnightIcon(props) {
  return (
    <svg viewBox={ICON_VIEWBOX} width="40" height="40" aria-hidden="true" {...props}>
      <path
        d="M70 82 L30 82 L32 67 C 19 63, 13 50, 20 39 C 14 35, 13 27, 19 19
           C 25 23, 26 29, 31 27 C 37 16, 49 12, 59 16 C 67 19, 73 27, 75 37
           C 79 47, 77 59, 68 67 Z"
      />
    </svg>
  );
}

const OPTIONS = [
  { code: 'q', label: 'Queen', Icon: QueenIcon },
  { code: 'r', label: 'Rook', Icon: RookIcon },
  { code: 'b', label: 'Bishop', Icon: BishopIcon },
  { code: 'n', label: 'Knight', Icon: KnightIcon },
];

function OptionButton({ option, onPick }) {
  const { Icon } = option;
  return (
    <button
      onClick={() => onPick(option.code)}
      aria-label={option.label}
      title={option.label}
      className="promotion-modal-option"
    >
      <span className="promotion-modal-option-icon">
        <Icon />
      </span>
      <span className="promotion-modal-option-label">{option.label}</span>
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
          width: 320px;
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 10px 18px;
          font-family: var(--font-ui), system-ui, sans-serif;
          font-size: 16px;
          font-weight: 500;
          color: #0E0E10;
          background: #DDD3BE;
          border: 1px solid #C7BCA3;
          border-radius: 10px;
          cursor: pointer;
          transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .promotion-modal-option-icon {
          flex: none;
          width: 40px;
          height: 40px;
          display: grid;
          place-items: center;
        }
        .promotion-modal-option-icon svg {
          fill: currentColor;
        }
        .promotion-modal-option-label {
          flex: 1;
          text-align: left;
        }
        .promotion-modal-option:hover,
        .promotion-modal-option:focus-visible {
          border-color: #C1440E;
          transform: translateX(4px);
          box-shadow: 0 6px 18px rgba(0,0,0,0.25);
          outline: none;
        }
      `}</style>

      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: 22,
          background: 'rgba(237, 231, 217, 0.97)',
          border: '1px solid #D6CDBA',
          borderRadius: 14,
          boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
        }}
      >
        <div
          style={{
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
