// Does the app actually take its marks from the published feed, with no key?
// The test is the change: read a price, rewrite quotes.json to a different one,
// reload, and require the new number on screen. "A price renders" would pass
// with the bundled seed still in force, which is the thing being replaced.
import { launch } from './browser.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.APP_URL ?? 'http://localhost:8080/Investing-app-';
const FILE = fileURLToPath(new URL('../dist/quotes.json', import.meta.url));
const problems = [];

const original = readFileSync(FILE, 'utf8');
const feed = JSON.parse(original);
const feedPrice = feed.quotes.META.price;

const browser = await launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

const priceOnScreen = async () => {
  await page.goto(`${BASE}/stock/META`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  const t = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  return t.match(/\$([\d,]+\.\d\d)/)?.[1]?.replace(/,/g, '');
};

const first = await priceOnScreen();
console.log(`feed says ${feedPrice}, screen shows ${first}`);
if (Math.abs(Number(first) - feedPrice) > 0.02) {
  problems.push(`the published price did not reach the screen (feed ${feedPrice}, screen ${first})`);
}

// Change the feed underneath it. Nothing else changes.
const planted = 111.11;
feed.quotes.META.price = planted;
feed.quotes.META.previousClose = 100;
feed.quotes.META.change = 11.11;
feed.quotes.META.changePct = 11.11;
feed.fetchedAt = '2026-08-19T12:00:00.000Z';
writeFileSync(FILE, JSON.stringify(feed, null, 2));

const second = await priceOnScreen();
console.log(`after rewriting the feed to ${planted}, screen shows ${second}`);
if (Math.abs(Number(second) - planted) > 0.02) {
  problems.push(`the app did not follow the feed (wanted ${planted}, got ${second})`);
}

writeFileSync(FILE, original);
await browser.close();
console.log(problems.length ? '\nPROBLEMS:\n - ' + problems.join('\n - ') : '\nThe app takes its marks from the published feed, with no key on the device.');
process.exit(problems.length ? 1 : 0);

