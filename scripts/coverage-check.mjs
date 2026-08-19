// Coverage, measured rather than assumed.
//
//   FINNHUB_API_KEY=... npm run verify:coverage
//
// The scheduled feed can never be complete: Finnhub lists 30,982 US symbols and
// the free tier allows sixty calls a minute, so one full sweep would take eight
// and a half hours. data/universe.txt is a convenience, not a guarantee. The
// guarantee is that the app prices whatever is in the book, so this plants a
// book made entirely of names absent from that file and requires every one of
// them to come back.
//
// Two things this check learned the hard way, both worth keeping:
//
// It reads the store, not the screen. Scraping "$95.62" off a page cannot tell
// a price from a cost basis rendered two lines above it; an earlier version did
// exactly that and passed on a number that was right by accident.
//
// It does not race the app for the rate limit. The checker and the thing being
// checked draw on the same sixty-a-minute allowance, and an earlier version
// spent it on itself — which made the *app* fail, and reported that as a
// coverage bug. So the app sweeps first, undisturbed, and only a few names are
// spot-checked live afterwards.

import { launch } from './browser.mjs';

const KEY = process.env.FINNHUB_API_KEY ?? '';
if (!KEY) {
  console.error('FINNHUB_API_KEY is not set, so there is nothing to measure against.');
  process.exit(1);
}
const BASE = process.env.APP_URL ?? 'http://localhost:8080/Investing-app-';
const STORE = 'portfolio-brief-v1';

// Names a broker screenshot could plausibly contain, none of them in
// data/universe.txt when this was written: recent IPOs, momentum names, ADRs,
// REITs, leveraged ETFs.
const SAMPLE = [
  'HOOD', 'ASTS', 'IONQ', 'RKLB', 'SOFI', 'CELH', 'ELF', 'DUOL', 'TOST', 'NBIS',
  'VRT', 'POWL', 'CLS', 'GEV', 'OKLO', 'LEU', 'NVO', 'BABA', 'SE', 'GRAB',
  'TEVA', 'NICE', 'WIX', 'MNDY', 'O', 'VICI', 'IRM', 'MSTR', 'TQQQ', 'IBIT',
];

// Planted with no holding row - present in `stocks`, absent from `holdings` -
// because that is the shape a screenshot import produces for a name that has
// just arrived. If coverage is genuinely self-healing it needs no holding and
// no list edit to be priced.
const WATCH_ONLY = SAMPLE[SAMPLE.length - 1];

const browser = await launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

await page.evaluate(
  ([storeKey, tickers, key, watchOnly]) => {
    const raw = JSON.parse(localStorage.getItem(storeKey));
    const s = raw.state;
    const template = s.stocks.META;
    s.holdings = [];
    s.stocks = {};
    for (const t of tickers) {
      s.stocks[t] = { ...template, ticker: t, name: t, quote: { value: null, asOf: null, source: 'unavailable' } };
      if (t !== watchOnly) s.holdings.push({ ticker: t, shares: 10, costBasis: 1, openedAt: '2026-01-01' });
    }
    localStorage.setItem(storeKey, JSON.stringify(raw));
    localStorage.setItem('finnhub.apiKey', key);
  },
  [STORE, SAMPLE, KEY, WATCH_ONLY],
);

// Reload so the launch refresh runs against the planted book, then leave it
// alone for a paced sweep of every name plus a margin.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000 + SAMPLE.length * 1500);

const got = await page.evaluate(
  ([storeKey, tickers]) => {
    const s = JSON.parse(localStorage.getItem(storeKey)).state;
    const out = {};
    for (const t of tickers) {
      const q = s.stocks[t]?.quote;
      out[t] = { price: q?.value?.price ?? null, source: q?.source ?? null };
    }
    return out;
  },
  [STORE, SAMPLE],
);

const priced = SAMPLE.filter((t) => got[t].price != null && got[t].price > 0);
const unpriced = SAMPLE.filter((t) => got[t].price == null);
const badSource = priced.filter((t) => got[t].source !== 'finnhub');

console.log(`App priced ${priced.length}/${SAMPLE.length} of the planted book`);
if (unpriced.length) console.log(`  no price: ${unpriced.join(', ')}`);
if (badSource.length) console.log(`  wrong source stamp: ${badSource.map((t) => `${t}=${got[t].source}`).join(', ')}`);
if (pageErrors.length) console.log(`  page errors: ${[...new Set(pageErrors)].slice(0, 3).join(' | ')}`);

// Spot-check a few against Finnhub directly, now that the app has finished and
// the allowance is free again. Checking all thirty would starve the app on the
// next run for no extra confidence.
await new Promise((r) => setTimeout(r, 5000));
const spot = priced.slice(0, 4);
const wrong = [];
for (const t of spot) {
  try {
    const r = await (await fetch(`https://finnhub.io/api/v1/quote?symbol=${t}&token=${KEY}`)).json();
    if (typeof r.c === 'number' && r.c > 0) {
      // A tolerance, not equality: the mark may have come from the published
      // feed minutes ago while this call is live. A different number is fine;
      // a different order of magnitude is not.
      const drift = Math.abs(got[t].price - r.c) / r.c;
      console.log(`  spot ${t}: app ${got[t].price} vs live ${r.c} (${(drift * 100).toFixed(2)}% apart)`);
      if (drift > 0.05) wrong.push(`${t}: app ${got[t].price}, live ${r.c}`);
    }
  } catch { /* a failed spot call is not evidence about the app */ }
  await new Promise((r) => setTimeout(r, 1200));
}

const healed = got[WATCH_ONLY].price != null;
console.log(
  healed
    ? `  self-healed: ${WATCH_ONLY} arrived with no holding row and was priced anyway`
    : `  DID NOT self-heal: ${WATCH_ONLY} was in the book but never priced`,
);

await browser.close();

const ok = unpriced.length === 0 && badSource.length === 0 && wrong.length === 0 && healed;
if (!ok && wrong.length) for (const w of wrong) console.error(`  WRONG ${w}`);
console.log(ok ? '\nEvery name in the book was priced, correctly stamped, and self-healing holds.' : '\nCoverage is not complete.');
process.exit(ok ? 0 : 1);
