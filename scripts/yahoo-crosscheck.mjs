// Samples the feed's prices against Yahoo Finance and reports the agreement.
//
// The owner's question — "can I rely on these numbers?" — deserves evidence,
// not a shrug. Yahoo refuses browsers (no CORS header; measured, see
// CLAUDE.md) and it turns out it also refuses Node's fetch: the same request
// that curl answers 200 comes back 429 from undici, which means Yahoo is
// fingerprinting the TLS handshake, not reading the headers. So this shells
// out to curl — present on the GitHub runner and on any Windows 10+ box —
// rather than pretending a header tweak would fix a fingerprint.
//
// During a session two reads minutes apart legally differ; past 1.5%
// something is actually wrong and the feed says so out loud.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';

async function yahooPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const { stdout } = await run('curl', ['-sf', '--max-time', '15', '-A', UA, url], {
    maxBuffer: 4 * 1024 * 1024,
  });
  const price = JSON.parse(stdout)?.chart?.result?.[0]?.meta?.regularMarketPrice;
  return typeof price === 'number' && price > 0 ? price : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Returns the crosscheck block for quotes.json, or null when Yahoo would not answer. */
export async function crosscheckQuotes(quotes, { log = console.log } = {}) {
  const priced = Object.keys(quotes);
  // The book's likely names first, then a spread across the rest of the
  // universe so drift in an unheld symbol still gets caught eventually.
  const anchors = ['AAPL', 'MSFT', 'NVDA', 'META', 'SPY', 'PLTR'].filter((s) => priced.includes(s));
  const rest = priced.filter((s) => !anchors.includes(s));
  const sampled = [...anchors];
  for (let i = 0; i < 6 && rest.length; i++) {
    sampled.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
  }

  const results = [];
  for (const symbol of sampled) {
    try {
      const yahoo = await yahooPrice(symbol);
      if (yahoo != null) {
        const feed = quotes[symbol].price;
        results.push({ symbol, feed, yahoo, diffPct: Math.abs((feed - yahoo) / yahoo) * 100 });
      }
    } catch {
      /* one refusal is not evidence of anything */
    }
    await sleep(400);
  }

  // Below three answers the sample proves nothing either way; publishing an
  // attestation built on one price would be the pretence this exists to stop.
  if (results.length < 3) {
    log('cross-check skipped: Yahoo answered fewer than 3 of the sampled symbols');
    return null;
  }

  const disagreements = results.filter((r) => r.diffPct > 1.5);
  const worst = results.reduce((a, b) => (a.diffPct >= b.diffPct ? a : b));
  const crosscheck = {
    source: 'yahoo-finance',
    checkedAt: new Date().toISOString(),
    checked: results.length,
    agreed: results.length - disagreements.length,
    tolerancePct: 1.5,
    worst: { symbol: worst.symbol, diffPct: Number(worst.diffPct.toFixed(3)) },
    disagreements: disagreements.map((r) => ({
      symbol: r.symbol,
      feed: r.feed,
      yahoo: r.yahoo,
      diffPct: Number(r.diffPct.toFixed(2)),
    })),
  };
  log(
    `cross-check vs Yahoo Finance: ${crosscheck.agreed} of ${crosscheck.checked} within 1.5% (largest gap ${crosscheck.worst.diffPct}% on ${crosscheck.worst.symbol})`,
  );
  for (const d of crosscheck.disagreements) {
    log(`  !! ${d.symbol}: feed ${d.feed} vs Yahoo ${d.yahoo} (${d.diffPct}%)`);
  }
  return crosscheck;
}
