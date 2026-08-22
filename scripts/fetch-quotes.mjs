// Publishes live marks next to the app, so the phone never asks anyone for a
// price and never holds a key.
//
//   FINNHUB_API_KEY=... node scripts/fetch-quotes.mjs [outDir]
//
// Why this runs in CI rather than in the app. The app is a static site with no
// server, so anything it calls has to allow a cross-origin read *and* be
// callable without a secret — and a key shipped in a public bundle is a key
// given away. Running here solves both at once: the key lives in a GitHub
// secret, and the phone reads the result from its own origin, where no
// permission is needed from anybody.
//
// It also solves the thing the app cannot: the owner should not have to open
// the app for its numbers to be current. This runs on a schedule.
//
// What it does NOT do is decide what is held. The book is read from a broker
// screenshot and lives only on the phone. data/universe.txt is a wide enough
// net that an imported holding is almost always already priced; one that is not
// keeps the mark it had, and the app says so rather than showing a stale number
// as though it were fresh.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crosscheckQuotes } from './crosscheck.mjs';

const OUT_DIR = process.argv[2] ?? fileURLToPath(new URL('../public', import.meta.url));
const UNIVERSE = fileURLToPath(new URL('../data/universe.txt', import.meta.url));
const TOKEN = process.env.FINNHUB_API_KEY;

if (!TOKEN) {
  console.error('FINNHUB_API_KEY is not set. Nothing fetched.');
  process.exit(1);
}

// Finnhub's free tier reports 60 a minute in X-Ratelimit-Limit, so one call a
// second is the ceiling. Pacing just under it is the difference between a full
// sweep and half a book of 429s; going below it buys nothing, because the
// retry it triggers costs more time than the gap saved.
const GAP_MS = 1050;

const symbols = readFileSync(UNIVERSE, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readOne(symbol, attempt = 1) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${TOKEN}`;
  const res = await fetch(url);
  if (res.status === 429) {
    if (attempt > 4) throw new Error('rate limited after 4 attempts');
    await sleep(attempt * 4000);
    return readOne(symbol, attempt + 1);
  }
  if (res.status === 401 || res.status === 403) {
    // Every remaining symbol would fail identically; stopping says so once.
    const e = new Error('Finnhub rejected the key');
    e.fatal = true;
    throw e;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const q = await res.json();
  // Finnhub answers 200 with every field zeroed for a symbol it does not know.
  // A mark of $0.00 would render as fact and wipe the book's value on screen,
  // so "the request worked" is not the same question as "there is a price".
  if (typeof q.c !== 'number' || !Number.isFinite(q.c) || q.c <= 0) {
    throw new Error('no usable price');
  }
  const previousClose = typeof q.pc === 'number' && q.pc > 0 ? q.pc : null;
  return {
    symbol,
    price: q.c,
    previousClose,
    change: typeof q.d === 'number' && Number.isFinite(q.d) ? q.d : previousClose == null ? null : q.c - previousClose,
    changePct: typeof q.dp === 'number' && Number.isFinite(q.dp) ? q.dp : null,
    high: q.h > 0 ? q.h : null,
    low: q.l > 0 ? q.l : null,
    open: q.o > 0 ? q.o : null,
    // The day the price belongs to, not the moment this ran. Dating a Friday
    // mark as Sunday would make a stale price look fresh.
    tradingDay: typeof q.t === 'number' && q.t > 0 ? new Date(q.t * 1000).toISOString().slice(0, 10) : null,
    asOf: typeof q.t === 'number' && q.t > 0 ? new Date(q.t * 1000).toISOString() : null,
  };
}

const quotes = {};
const failures = [];
let fatal = null;

for (let i = 0; i < symbols.length; i++) {
  const symbol = symbols[i];
  try {
    quotes[symbol] = await readOne(symbol);
  } catch (e) {
    if (e.fatal) { fatal = e.message; break; }
    failures.push({ symbol, reason: e.message });
  }
  if (i < symbols.length - 1) await sleep(GAP_MS);
}

// The VIX, from CBOE's own published history — the exchange that computes the
// index, no key, plain CSV. One request; a miss drops the block rather than
// the run, and the app renders "no VIX on file" instead of a stale pretence.
let vix = null;
try {
  const res = await fetch('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv', {
    // A plain browser UA. This block was written referencing a constant a
    // previous rewrite had deleted; the try/catch dutifully reported
    // "UA is not defined" as a skip, and the only place that ever ran the
    // real script end to end was CI. Checks that exercise a stand-in copy of
    // the logic prove the logic, not the script.
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
  });
  if (res.ok) {
    const rows = (await res.text()).trim().split('\n').slice(1);
    const parsed = rows
      .map((r) => {
        const [date, , , , close] = r.split(',');
        const [m, d, y] = date.split('/');
        const value = Number(close);
        return Number.isFinite(value) && value > 0 ? { date: `${y}-${m}-${d}`, value } : null;
      })
      .filter(Boolean);
    // A year of context, thinned to weekly closes — the ladder is about
    // regimes, not daily wiggles — with the exact latest point kept.
    const year = parsed.slice(-260);
    const series = year.filter((_, i) => i % 5 === 0);
    const last = parsed[parsed.length - 1];
    if (last && series.length > 10) {
      if (series[series.length - 1].date !== last.date) series.push(last);
      vix = { last: last.value, date: last.date, series };
      console.log(`VIX ${last.value.toFixed(2)} as of ${last.date}, ${series.length} weekly points`);
    }
  } else {
    console.log(`VIX history skipped: CBOE answered ${res.status}`);
  }
} catch (e) {
  console.log(`VIX history skipped: ${e.message}`);
}

// Every publish samples its own prices against the exchange's own delayed
// feed and records the agreement in the payload, so the app can show evidence
// instead of asking for trust. Lives in its own module so the check exercises
// the real code, not a stand-in copy.
let crosscheck = null;
try {
  crosscheck = await crosscheckQuotes(quotes);
} catch (e) {
  crosscheck = {
    source: 'cboe-delayed',
    checkedAt: new Date().toISOString(),
    tolerancePct: 3,
    checked: 0,
    agreed: 0,
    worst: null,
    disagreements: [],
    skipped: e.message,
  };
  console.log(`cross-check could not run: ${e.message}`);
}

const ok = Object.keys(quotes).length;
console.log(`priced ${ok} of ${symbols.length}${failures.length ? `, ${failures.length} without a price` : ''}`);
if (failures.length) for (const f of failures.slice(0, 12)) console.log(`  - ${f.symbol}: ${f.reason}`);

// A run that priced nothing must not replace a good file with an empty one:
// the phone would show the whole book as unpriced because of one bad minute,
// which is worse than yesterday's marks with yesterday's date on them.
if (ok === 0) {
  console.error(`\nNothing could be priced${fatal ? ` (${fatal})` : ''}. Leaving the published quotes alone.`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  join(OUT_DIR, 'quotes.json'),
  JSON.stringify(
    {
      version: 1,
      source: 'finnhub',
      fetchedAt: new Date().toISOString(),
      count: ok,
      quotes,
      failures,
      vix,
      crosscheck,
    },
    null,
    2,
  ),
);
console.log(`wrote ${join(OUT_DIR, 'quotes.json')}`);
