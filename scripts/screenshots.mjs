import { chromium } from 'playwright';

const OUT = '/home/user/Investing-app-/docs/screenshots';
const BASE = 'http://localhost:8080';

// iPhone SE (smallest current) and iPhone 16 Pro Max (largest).
const DEVICES = [
  { name: 'small', width: 375, height: 667 },
  { name: 'large', width: 440, height: 956 },
];

const ROUTES = [
  ['portfolio', '/'],
  ['stocks', '/stocks'],
  ['sectors', '/sectors'],
  ['plan', '/plan'],
  ['more', '/more'],
  ['insights', '/insights'],
  ['stock-META', '/stock/META'],
  ['stock-SMH', '/stock/SMH'],
  ['stock-TSSI', '/stock/TSSI'],
  ['sync', '/sync'],
  ['market', '/market'],
  ['returns', '/returns'],
  ['watchlist', '/watchlist'],
  ['history', '/history'],
  ['sources', '/sources'],
  ['settings', '/settings'],
];

const errors = [];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const scheme of ['light', 'dark']) {
  for (const device of DEVICES) {
    const ctx = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: 2,
      colorScheme: scheme,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${scheme}/${device.name} ${page.url()}: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console ${scheme}/${device.name} ${page.url()}: ${m.text()}`);
    });

    for (const [name, route] of ROUTES) {
      // Only screenshot the large/light and small/dark matrix in full to keep
      // the count sane, but VISIT every combination so errors surface.
      await page.goto(BASE + route, { waitUntil: 'networkidle' });
      await page.waitForTimeout(700);
      const full = scheme === 'light' ? device.name === 'large' : device.name === 'small';
      await page.screenshot({
        path: `${OUT}/${scheme}-${device.name}-${name}.png`,
        fullPage: full,
      });
    }
    await ctx.close();
  }
}
await browser.close();

if (errors.length) {
  console.log('ERRORS:');
  for (const e of [...new Set(errors)]) console.log(' -', e);
} else {
  console.log('No page errors on any route in either theme at either width.');
}
