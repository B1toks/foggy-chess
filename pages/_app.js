import { Zen_Old_Mincho, Inter } from 'next/font/google';
import '../styles/globals.css';

// Mincho serif for display text — it carries the same Japanese-armour register
// as the piece models (kabuto, naginata, tenshu).
// Cyrillic is not optional here: the interface copy is Ukrainian, and without
// the subset every Cyrillic glyph silently falls back to a system serif.
const display = Zen_Old_Mincho({
  weight: ['400', '600'],
  subsets: ['latin', 'cyrillic'],
  variable: '--font-display',
  display: 'swap',
});

const ui = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-ui',
  display: 'swap',
});

export default function App({ Component, pageProps }) {
  return (
    <div className={`${display.variable} ${ui.variable}`}>
      <Component {...pageProps} />
    </div>
  );
}
