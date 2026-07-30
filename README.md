# Dead Reckoning

3D chess with fog of war: you only see the squares your own pieces hold under
attack. Everything else is fog — and your opponent is somewhere inside it.

**Play: https://foggy-chess-9gif.vercel.app/**

You are White. Black is a greedy AI that takes the most valuable capture on
offer and otherwise moves at random. Vision is recomputed after every move, so
the fog opens and closes as the position shifts.

## Stack

- Next.js 15 (Pages Router) + React 18
- three.js via @react-three/fiber 8 and @react-three/drei
- chess.js for rules, move generation and end-state detection
- Piece models are Draco-compressed glTF; the backdrop is a painted sumi-e
  panorama; the board, fog, plateau and stone surfacing are generated
  procedurally in code
- Sound is synthesised through Web Audio — no audio files, and off by default

The Pages Router is deliberate: Next's App Router bundles its own React copy
for the client, which @react-three/fiber 8.x cannot run against. See
`CLAUDE.md` for the full reasoning.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
```

```bash
npm test         # visibility + chess-rule unit tests (Node's built-in runner)
npm run build    # production build
```

## Notes

- `?fen=<FEN>` loads a specific position — used to test checkmate, stalemate,
  promotion, castling and en passant, which a random AI would rarely reach.
- `/dev-pieces` and `/dev-fog` are development inspectors: a side-on piece
  measurement rig and a fog-mask alignment harness. Neither is linked from the
  game.
- The painted backdrop is a single frame rather than a seamless 360 panorama,
  so the camera's azimuth is clamped to the sector it covers. Set
  `BACKDROP_MODE = 'procedural'` in `components/Backdrop.jsx` to swap back to
  the generated ridge shells and regain the full orbit.
- Promotion asks: the move is held until you pick a piece from the four models
  that appear over the square. Esc or a click elsewhere cancels it.
