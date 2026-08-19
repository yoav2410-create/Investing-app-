// Coverage, measured rather than assumed.
//
//   FINNHUB_API_KEY=... npm run verify:coverage
//
// The scheduled feed cannot ever be complete: Finnhub lists 30,982 US symbols
// and the free tier allows 60 calls a minute, so one full sweep would take
// eight and a half hours. data/universe.txt is a convenience, not a guarantee.
// The guarantee is that the app prices exactly what is held, so this plants a
// book of names deliberately absent from that file and requires every one of
// them to come back correct.
// It reads the store rather than the screen. Scraping "$95.62" off a page
// cannot tell a price from a cost basis sitting two lines above it - an earlier
// version of this check did exactly that and reported a number that happened to
// be right for the wrong reason. quote.value.price and quote.source cannot be
// misread that way.
import { launch } from './browser.mjs';

const KEY = process.env.FINNHUB_API_KEY ?? '';
if (!KEY) {
  console.error('FINNHUB_API_KEY is not set, so there is nothing to measure against.');
  process.exit(1);
}
const BASE = process.env.APP_URL ?? 'http://localhost:8080/Investing-app-';
const STORE = 'portfolio-brief-v1';

// Names a broker screenshot could plausibly contain, none of them in
// data/universe.txt: recent IPOs, momentum names, ADRs, REITs, leveraged ETFs.
const SAMPLE = [
  'HOOD', 'ASTS', 'IONQ', 'RKLB', 'SOFI', 'CELH', 'ELF', 'DUOL', 'TOST', 'NBIS',
  'VRT', 'POWL', 'CLS', 'GEV', 'OKLO', 'LEU', 'NVO', 'BABA', 'SE', 'GRAB',
  'TEVA', 'NICE', 'WIX', 'MNDY', 'O', 'VICI', 'IRM', 'MSTR', 'TQQQ', 'IBIT',
];

// What Finnhub itself says, so the app is compared to truth rather than to
// "some number appeared".
const truth = {};
for (const s of SAMPLE) {
  try {
    const r = await (await fetch(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${KEY}`)).json();
    truth[s] = typeof r.c === 'number' && r.c > 0 ? r.c : null;
  } catch { truth[s] = null; }
  await new Promise((r) => setTimeout(r, 1100));
}
const priceable = SAMPLE.filter((s) => truth[s] != null);
console.log(`Finnhub can price ${priceable.length}/${SAMPLE.length}`);
const unpriceable = SAMPLE.filter((s) => truth[s] == null);
if (unpriceable.length) console.log(`  no price from Finnhub: ${unpriceable.join(', ')}`);

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
  ([storeKey, tickers, key]) => {
    const raw = JSON.parse(localStorage.getItem(storeKey));
    const s = raw.state;
    const template = s.stocks.META;
    s.holdings = [];
    s.stocks = {};
    for (const t of tickers) {
      s.stocks[t] = { ...template, ticker: t, name: t, quote: { value: null, asOf: null, source: 'unavailable' } };
      s.holdings.push({ ticker: t, shares: 10, costBasis: 1, openedAt: '2026-01-01' });
    }
    localStorage.setItem(storeKey, JSON.stringify(raw));
    localStorage.setItem('finnhub.apiKey', key);
  },
  [STORE, SAMPLE, KEY],
);

// Reload so the launch refresh runs against the planted book, then wait long
// enough for a paced sweep of every name.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000 + SAMPLE.length * 1400);

const got = await page.evaluate(
  ([storeKey, tickers]) => {
    const s = JSON.parse(localStorage.getItem(storeKey)).state;
    const out = {};
    for (const t of tickers) {
      const q = s.stocks[t]?.quote;
      out[t] = { price: q?.value?.price ?? null, source: q?.source ?? null, asOf: q?.asOf ?? null };
    }
    return out;
  },
  [STORE, SAMPLE],
);

let hit = 0;
const misses = [];
const wrong = [];
for (const t of priceable) {
  const g = got[t];
  if (g.price == null) { misses.push(t); continue; }
  if (Math.abs(g.price - truth[t]) > Math.max(0.02, truth[t] * 0.001)) {
    wrong.push(`${t}: app ${g.price} vs Finnhub ${truth[t]}`);
    continue;
  }
  if (g.source !== 'finnhub') { wrong.push(`${t}: priced but stamped "${g.source}"`); continue; }
  hit++;
}

const pct = priceable.length ? ((hit / priceable.length) * 100).toFixed(1) : '0.0';
console.log(`\nApp priced ${hit}/${priceable.length} of the priceable names  ->  ${pct}%`);
if (misses.length) console.log(`  no price in the app: ${misses.join(', ')}`);
if (wrong.length) for (const w of wrong) console.log(`  WRONG ${w}`);
if (pageErrors.length) console.log(`  page errors: ${[...new Set(pageErrors)].slice(0, 3).join(' | ')}`);

// Nothing may be invented for a name Finnhub could not price.
const invented = unpriceable.filter((t) => got[t].price != null);
console.log(invented.length ? `  INVENTED a price for: ${invented.join(', ')}` : '  nothing invented for unpriceable names');

await browser.close();
process.exit(hit === priceable.length && invented.length === 0 ? 0 : 1);

