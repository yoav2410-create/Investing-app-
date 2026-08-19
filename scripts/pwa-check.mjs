// Verifies the deployed shape of the app — the thing that ends up on the phone
// when there is no computer in the loop: served from a repo subpath, marked
// installable, routable on a deep link, and remembering the API key across a
// full reload.
//
//   npm run build:pages && node scripts/pwa-check.mjs
//
// It serves `dist/` itself rather than leaning on a static-server package,
// because the behaviour under test *is* server behaviour. GitHub Pages serves a
// project site under /<repo>/ and answers anything with no file behind it using
// the repo's 404.html — at status 404, body intact. A local server that returns
// an empty 404 instead would pass this check while the real thing fails, which
// is worse than not checking.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? 'dist';
const REPO = process.env.EXPO_PUBLIC_BASE_URL ?? 'Investing-app-';
const PORT = 8091;
const BASE = `http://localhost:${PORT}/${REPO}`;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const send = (code, file) => {
    res.writeHead(code, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  };
  if (!path.startsWith(`/${REPO}`)) {
    res.writeHead(404).end();
    return;
  }
  const rel = normalize(path.slice(REPO.length + 1)).replace(/^(\.\.[/\\])+/, '');
  const target = join(OUT, rel);
  if (existsSync(target) && statSync(target).isFile()) return send(200, target);
  const index = join(OUT, rel, 'index.html');
  if (existsSync(index)) return send(200, index);
  // What Pages does for an unknown path.
  const notFound = join(OUT, '404.html');
  if (existsSync(notFound)) return send(404, notFound);
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(PORT, r));

const problems = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true, colorScheme: 'dark',
});

const bad = [];
ctx.on('page', (page) => {
  page.on('pageerror', (e) => problems.push('page error: ' + e.message));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/stock/')) bad.push(`${r.status()} ${r.url()}`);
  });
});

const p = await ctx.newPage();
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);

// 1. A wrong base path shows a white screen and a console full of 404s.
const body = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
if (!body.includes('Portfolio')) problems.push('app did not render at the subpath');
else console.log(`renders under /${REPO} with every asset path resolving`);
if (bad.length) problems.push('failed requests: ' + [...new Set(bad)].slice(0, 5).join(', '));

// 2. The metadata Safari reads when you tap Add to Home Screen.
const meta = await p.evaluate(() => ({
  capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content,
  title: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content,
  manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
  touchIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
  viewport: document.querySelector('meta[name="viewport"]')?.content,
}));
if (meta.capable !== 'yes') problems.push('not web-app-capable — iOS would make a bookmark, not an app');
if (!meta.viewport?.includes('viewport-fit=cover')) problems.push('viewport does not reach under the notch');
if (!meta.manifest?.startsWith(`/${REPO}/`)) problems.push('manifest href is missing the base path');
if (!meta.touchIcon?.startsWith(`/${REPO}/`)) problems.push('apple-touch-icon is missing the base path');
console.log(`installable: capable=${meta.capable}, home-screen name "${meta.title}"`);

// 3. Every icon the manifest promises has to exist, or the home screen shows a
//    grey square with no way to tell why.
const manifest = await (await p.request.get(BASE + '/manifest.json')).json();
for (const icon of manifest.icons) {
  const r = await p.request.get(`${BASE}/${icon.src}`);
  if (!r.ok()) problems.push(`manifest icon ${icon.src} -> ${r.status()}`);
}
const touch = await p.request.get(BASE + '/icon-180.png');
if (!touch.ok()) problems.push(`apple-touch-icon -> ${touch.status()}`);
else console.log(`icons resolve: ${manifest.icons.length} in the manifest plus the 180pt home-screen icon`);
if (manifest.display !== 'standalone') problems.push(`manifest display is "${manifest.display}", not standalone`);

// 4. Without persistence the app asks for an API key on every launch, which
//    makes it unusable as a daily thing. This is the check that matters most.
await p.evaluate(() => localStorage.setItem('anthropic.apiKey', 'sk-ant-test-KEY123'));
await p.goto(BASE + '/settings', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const settings = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
if (!settings.includes('••••Y123')) problems.push('the stored key was not read back after a reload');
else console.log('API key survives a full reload and renders masked (••••Y123)');
if (!settings.includes('Stored in this browser only')) problems.push('settings does not say where the key is kept on web');
else console.log('settings states where the key lives on this platform');
await p.screenshot({ path: 'docs/screenshots/pwa-settings.png' });

// 5. The Face ID lock has no browser implementation. A toggle that looks live
//    but silently does nothing is a lie about what is protecting the book, so
//    on web it reads as unavailable.
const lock = await p.evaluate(() => {
  const nodes = [...document.querySelectorAll('*')].map((n) => n.textContent ?? '');
  return nodes.some((t) => t.trim() === 'Not available in a browser — there is no biometric prompt to unlock with');
});
if (!lock) problems.push('the Face ID toggle is not disabled on web — enabling it would lock the owner out');
else console.log('Face ID lock is disabled on web, with the reason stated');

// 5b. A regression guard, not a fix: the gate already opens on web because
//     `hasHardwareAsync` reports false there. But a book synced from a native
//     session carries the lock setting, and if that branch ever changed the
//     owner would be stuck on an unlock screen with no prompt to satisfy —
//     with no way back in. Cheap to assert, expensive to discover.
const trapped = await ctx.newPage();
await trapped.addInitScript(() => {
  const raw = localStorage.getItem('portfolio-brief-v1');
  const state = raw ? JSON.parse(raw) : { state: {}, version: 0 };
  state.state = { ...state.state, settings: { ...(state.state?.settings ?? {}), biometricLockEnabled: true } };
  localStorage.setItem('portfolio-brief-v1', JSON.stringify(state));
});
await trapped.goto(BASE + '/', { waitUntil: 'networkidle' });
await trapped.waitForTimeout(2500);
const trappedText = (await trapped.locator('body').innerText()).replace(/\s+/g, ' ');
if (trappedText.includes('Unlocking…') || trappedText.includes('Authentication was cancelled'))
  problems.push('a book with the lock already enabled is stuck on the unlock screen in a browser');
else console.log('a book carrying an enabled lock still opens in a browser rather than trapping the owner');
await trapped.close();

// 6. Deep links go through the 404 fallback on Pages. If that is missing, every
//    route except the home screen breaks on refresh.
const deep = await ctx.newPage();
const res = await deep.goto(BASE + '/stock/META', { waitUntil: 'networkidle' });
await deep.waitForTimeout(2000);
const deepText = (await deep.locator('body').innerText()).replace(/\s+/g, ' ');
if (!deepText.includes('META')) problems.push(`deep link did not resolve (HTTP ${res?.status()})`);
else console.log(`deep link /stock/META resolves through the 404 fallback (served ${res?.status()}, as Pages does)`);
await deep.screenshot({ path: 'docs/screenshots/pwa-deeplink.png' });

// 7. The screenshot import is the only way real data gets into this build, so
//    it has to work in a browser. expo-image-picker falls back to a file input
//    on web; if that fallback is missing, the whole app is a demo.
const sync = await ctx.newPage();
await sync.goto(BASE + '/sync', { waitUntil: 'networkidle' });
await sync.waitForTimeout(1500);
const syncText = (await sync.locator('body').innerText()).replace(/\s+/g, ' ');
if (!syncText.includes('Choose a screenshot')) problems.push('the import screen did not render its picker');
else {
  const chooser = sync.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
  await sync.getByText('Choose a screenshot', { exact: false }).first().click();
  const picked = await chooser;
  if (!picked) problems.push('tapping the picker opened no file chooser — import is dead on web');
  else console.log('screenshot import opens a real file picker in the browser');
}
await sync.screenshot({ path: 'docs/screenshots/pwa-import.png' });

await browser.close();
server.close();

if (problems.length) {
  console.error('\nPROBLEMS:\n' + problems.map((x) => ' - ' + x).join('\n'));
  process.exit(1);
}
console.log('\nPWA checks passed.');
