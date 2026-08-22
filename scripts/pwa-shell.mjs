// Turns the exported web build into something an iPhone will install to the
// home screen, and into something GitHub Pages can serve.
//
//   node scripts/pwa-shell.mjs dist [base-path]
//
// Why this is a post-process rather than `app/+html.tsx`: expo-router only
// honours +html.tsx when `web.output` is `static`, which pre-renders every
// route at build time. This app is a single-page build on purpose — its state
// is a persisted store read on mount, and there is nothing to gain from
// pre-rendering fourteen screens of it. Rewriting the one emitted document is
// the smaller, more predictable change, and it keeps the deployment concern out
// of the app code.
//
// Three things happen here:
//   1. Head tags, so Safari installs it as an app instead of bookmarking it.
//   2. `404.html`, because Pages serves static files and a deep link like
//      /stock/META has no file behind it — serving the app as the 404 page
//      hands the route back to the router, which does know what to do with it.
//   3. `.nojekyll`, or Pages drops every directory starting with an underscore
//      and Expo emits `_expo`.

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'dist';
const rawBase = process.argv[3] ?? process.env.EXPO_PUBLIC_BASE_URL ?? '';
const base = rawBase ? '/' + rawBase.replace(/^\/+|\/+$/g, '') : '';
const asset = (f) => `${base}/${f}`;

const indexPath = join(out, 'index.html');
if (!existsSync(indexPath)) {
  console.error(`No ${indexPath}. Run the export first.`);
  process.exit(1);
}

let html = readFileSync(indexPath, 'utf8');

// The default viewport does not reach under the notch, and a standalone app
// that stops at the safe area looks like a web page in a frame.
html = html.replace(
  /<meta name="viewport"[^>]*>/,
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />',
);

const head = `
    <!-- The only origins this app is allowed to talk to, enforced by the
         browser. The keys live in localStorage, where any script running on
         this origin could read them; this is the fence that says no script
         from anywhere else runs here, and nothing exfiltrates to a host that
         is not one of the data providers. connect-src is the working list:
         the app's own origin (bundle + quotes.json), Finnhub for live marks,
         Anthropic for research, Alpha Vantage for the optional technicals.
         Widening it is a decision, not a tweak. style-src needs
         'unsafe-inline' because react-native-web styles by injected <style>
         tags and inline attributes; script-src does not, and that is the
         directive doing the guarding. -->
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://finnhub.io wss://ws.finnhub.io https://api.anthropic.com https://www.alphavantage.co; worker-src 'self' blob:; manifest-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'" />
    <!-- Installed to the home screen, this is the app. Without
         apple-mobile-web-app-capable, "Add to Home Screen" makes a Safari
         bookmark that opens with browser chrome instead. -->
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Brief" />
    <meta name="description" content="Account snapshot, per-stock analysis, sector concentration and a Monte Carlo projection for a single owner's equity book." />
    <link rel="manifest" href="${asset('manifest.json')}" />
    <link rel="apple-touch-icon" sizes="180x180" href="${asset('icon-180.png')}" />
    <link rel="icon" type="image/png" sizes="192x192" href="${asset('icon-192.png')}" />
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#F4F6F9" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0B0F14" />
    <link rel="preload" href="${asset('fonts/PlexSansVar.woff2')}" as="font" type="font/woff2" crossorigin />
    <style id="pwa-shell">
      /* The app's face. Self-hosted because the CSP admits no font host, and
         variable so one 45KB file carries every weight the type scale uses.
         The fallback stack below matches the metrics closely enough that the
         swap does not reflow the hero number. */
      @font-face {
        font-family: 'Plex Sans Var';
        src: url('${asset('fonts/PlexSansVar.woff2')}') format('woff2-variations');
        font-weight: 100 700;
        font-style: normal;
        font-display: swap;
      }
      /* The document background shows through overscroll, outside anything
         React Native can style. Unset it is white, which flashes against the
         dark theme on every bounce. */
      :root { color-scheme: light dark; }
      html, body { background-color: #F4F6F9; }
      @media (prefers-color-scheme: dark) {
        html, body { background-color: #0B0F14; }
      }
      body { overscroll-behavior-y: none; -webkit-tap-highlight-color: transparent; }
      /* Long-press offering "Copy"/"Look Up" on every label reads as a web
         page, not an app. Inputs keep selection. */
      @media (display-mode: standalone) {
        body { user-select: none; -webkit-user-select: none; }
        input, textarea { user-select: text; -webkit-user-select: text; }
      }
    </style>
`;

if (html.includes('id="pwa-shell"')) {
  console.error('index.html already carries the shell — refusing to double-inject.');
  process.exit(1);
}
html = html.replace('</head>', `${head}  </head>`);
writeFileSync(indexPath, html);

copyFileSync(indexPath, join(out, '404.html'));
writeFileSync(join(out, '.nojekyll'), '');

// Assert rather than announce: a silent no-op here is a blank screen on the
// phone, and the only symptom would be an app that will not install.
const written = readFileSync(indexPath, 'utf8');
const required = [
  'apple-mobile-web-app-capable',
  `href="${asset('manifest.json')}"`,
  `href="${asset('icon-180.png')}"`,
  'viewport-fit=cover',
  'id="pwa-shell"',
  'Content-Security-Policy',
  // The two connections that make the app worth opening. A CSP that quietly
  // dropped one would look like a provider outage, not a config mistake.
  'https://finnhub.io',
  'https://api.anthropic.com',
];
const missing = required.filter((r) => !written.includes(r));
if (missing.length) {
  console.error('Shell did not apply:\n' + missing.map((m) => ' - ' + m).join('\n'));
  process.exit(1);
}

// Every absolute reference in the document must carry the base path, or the
// page loads to a white screen under a subpath.
const wrongBase = [...written.matchAll(/(?:src|href)="(\/[^"]*)"/g)]
  .map((m) => m[1])
  .filter((href) => base && !href.startsWith(base + '/'));
if (wrongBase.length) {
  console.error(`Not prefixed with ${base}: ${wrongBase.join(', ')}`);
  process.exit(1);
}

console.log(`PWA shell applied to ${indexPath}${base ? ` (base ${base})` : ''}`);
console.log(`Wrote ${join(out, '404.html')} and ${join(out, '.nojekyll')}`);
