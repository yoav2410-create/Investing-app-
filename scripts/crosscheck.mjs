// Corroborates the published marks against a second, independent source.
//
// The owner asked whether the prices can be trusted, naming Yahoo Finance.
// Yahoo turned out to be the wrong instrument twice over: it refuses browsers
// (no CORS header) and it refuses datacenter IPs. Locally it answered curl
// and the check passed 12 of 12 — on GitHub's runners every request came back
// 429 and the check logged "skipped" on every publish. A check that only ever
// runs on the author's laptop is not a check.
//
// So the corroboration comes from CBOE's delayed-quote CDN: the exchange's own
// numbers, no key, and the same host that already serves this pipeline's VIX
// history from CI — proven reachable from the machine that actually runs it.
//
// The feed being compared is real-time and CBOE's is delayed, so a few tenths
// of a percent apart is normal and expected. The tolerance is set wide enough
// that ordinary delay never trips it and narrow enough to catch what matters:
// a wrong symbol mapping, a stale file, a corrupt price. A halved price shows
// up as 50%.

const TOLERANCE_PCT = 3;
const SOURCE = 'cboe-delayed';

async function cboePrice(symbol) {
  const res = await fetch(
    `https://cdn.cboe.com/api/global/delayed_quotes/quotes/${encodeURIComponent(symbol)}.json`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return null;
  const body = await res.json();
  const price = body?.data?.current_price;
  return typeof price === 'number' && price > 0 ? price : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Returns the crosscheck block for quotes.json. Never null: when the check
 * cannot run it says so in the payload, because a missing attestation
 * rendered as blank space reads as "nothing wrong" — which is a claim the
 * run did not earn.
 */
export async function crosscheckQuotes(quotes, { log = console.log, fetchPrice = cboePrice } = {}) {
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
  let refusals = 0;
  for (const symbol of sampled) {
    try {
      const theirs = await fetchPrice(symbol);
      if (theirs == null) {
        refusals++;
      } else {
        const feed = quotes[symbol].price;
        results.push({ symbol, feed, theirs, diffPct: Math.abs((feed - theirs) / theirs) * 100 });
      }
    } catch {
      refusals++;
    }
    await sleep(250);
  }

  const base = { source: SOURCE, checkedAt: new Date().toISOString(), tolerancePct: TOLERANCE_PCT };

  // Below three answers the sample proves nothing either way, and publishing
  // an attestation built on one price would be the pretence this exists to
  // stop. Say which it was rather than going quiet.
  if (results.length < 3) {
    const skipped = `${SOURCE} answered ${results.length} of ${sampled.length} sampled symbols`;
    log(`cross-check could not run: ${skipped}`);
    return { ...base, checked: 0, agreed: 0, worst: null, disagreements: [], skipped };
  }

  const disagreements = results.filter((r) => r.diffPct > TOLERANCE_PCT);
  const worst = results.reduce((a, b) => (a.diffPct >= b.diffPct ? a : b));
  const crosscheck = {
    ...base,
    checked: results.length,
    agreed: results.length - disagreements.length,
    worst: { symbol: worst.symbol, diffPct: Number(worst.diffPct.toFixed(3)) },
    disagreements: disagreements.map((r) => ({
      symbol: r.symbol,
      feed: r.feed,
      other: r.theirs,
      diffPct: Number(r.diffPct.toFixed(2)),
    })),
    skipped: null,
  };
  log(
    `cross-check vs ${SOURCE}: ${crosscheck.agreed} of ${crosscheck.checked} within ${TOLERANCE_PCT}% (largest gap ${crosscheck.worst.diffPct}% on ${crosscheck.worst.symbol}${refusals ? `, ${refusals} symbol${refusals === 1 ? '' : 's'} not quoted` : ''})`,
  );
  for (const d of crosscheck.disagreements) {
    log(`  !! ${d.symbol}: feed ${d.feed} vs ${SOURCE} ${d.other} (${d.diffPct}%)`);
  }
  return crosscheck;
}
