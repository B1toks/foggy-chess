import Head from 'next/head';
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
    <>
      {/* Крок 14: moved here from pages/_document.js's <Head> — Next 15 warns
          that a viewport meta tag in _document.js's Head "should not be
          used" (it's the server-only shell, not reconciled per-navigation),
          and this project actually needs it to take effect on real mobile
          browsers, not just silence the warning. next/head's Head is the
          per-page-tree one that does. */}
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className={`${display.variable} ${ui.variable}`}>
        <Component {...pageProps} />
      </div>
    </>
  );
}
