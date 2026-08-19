# Handoff

## What this is

A real Expo/React Native iPhone app — not a WebView around the HTML report.
Every screen is native, every chart is hand-drawn SVG, and the analytics are a
pure TypeScript layer with no React in it, unit tested independently of the UI.

## Install it today

```bash
npm install
npx expo start
```

Scan the QR code with the iPhone Camera app; Expo Go opens it. No Mac, no
developer account, no build step.

Then set your **Anthropic API key** in Settings → Claude. That is the only
required setup.

## The data flow you asked for

**You screenshot your broker's positions; Claude reads it; the app updates.**

Portfolio → *Update from a screenshot* → pick the image → Claude transcribes
every row → **you review a diff** → apply.

The review step is not ceremony. An OCR pass over a screenshot is the one place
where a confident wrong answer would quietly corrupt the position data
everything else is built on, so:

- The model is instructed to return `null` rather than guess a number it cannot
  read clearly.
- Each row carries a confidence; anything under 70% is flagged in the review.
- Rows can be individually excluded before applying.
- A `null` from the model never overwrites a value the app already has.

New tickers that appear in a screenshot are added and automatically queued for
research.

## What is on each stock page

Beyond what the brief specified, in the order the page presents them:

| Card | What it answers |
| --- | --- |
| Position | Shares, market value, unrealised P&L, average cost, weight vs the 15% cap |
| Verdict | Buy/add/hold/trim/sell with the full reasoning, and a staleness flag if the name has reported since |
| **Valuation** | The multiple that is actually right for *this* business, benchmarked against its own history and its peer median, with a cheap/fair/expensive read and a range meter |
| **Trend** | 0–5 score, the six checks with pass/fail, and a moving-average-distance chart |
| **Business quality** | ROE, ROIC, gross margin, FCF margin, net debt/EBITDA, revenue CAGR, revenue and EPS growth, share count change, ownership |
| **Momentum** | 1M / 3M / 6M / 1Y / YTD, plus distance from the 52-week high and low |
| Options | Put/call by volume and open interest with a bullish/neutral/bearish read |
| Earnings call | Date, quarter, the hard numbers, what management said, guidance, what to watch next |
| **Fundamentals charts** | Revenue, operating income, **net income**, diluted EPS — eight quarters |
| **Multiple history charts** | Trailing P/E, EV/EBITDA, P/S — ten quarters, with today marked on the line |
| The case | Catalyst, key risk, bull case, bear case, and **what would change the verdict** |
| In the plan | Every tranche leg touching this ticker |
| Provenance | Source and timestamp for each data block |

Bold rows are things added beyond the original brief because they change what an
investor can actually decide: net income alongside operating income, quality
metrics that separate "good business" from "cheap stock", momentum windows, and
a `whatWouldChangeMyMind` field that forces the verdict to name something
observable rather than hedge.

## Everything else

Portfolio overview (account tiles, headline, concentration, movers, needs-attention),
Stocks list with search and seven filters and five sorts, Sectors (concentration
plus current-vs-target), Plan action board, Market overview with the book-wide
put/call table sorted most-bearish-first, Returns and attribution, Watchlist,
History, Data sources, Settings.

Full light and dark. Dynamic Type honoured everywhere. Every chart exposes a
spoken summary to VoiceOver — a chart a screen reader cannot read is a chart
half the owners cannot use.

**The action board is interactive.** Tap a tranche to project it: the cash
percentage, floor headroom, position count, sector mix and constraint breaches
all recompute. Tap a leg to mark it done and the projection moves with it.
Verified: as things stand the book is 11.7 points under the cash floor;
projecting tranche A takes that to −0.1; through tranche C it clears the floor.

## Extras built

Local threshold alerts (50-day touch, trend break, options flipping bearish,
earnings approaching, cash floor breach) with a digest notification · Face ID
lock that re-arms on backgrounding · daily portfolio snapshots with a history
screen showing verdict and trend changes over time · share/export a stock brief
as text · optional Alpha Vantage path for precise technicals with a budget-aware
scheduler.

## Verification actually run

- `npm run typecheck` — clean, strict mode, `noUncheckedIndexedAccess` on.
- `npm test` — 26 tests over the analytics, the plan engine and the Claude merge
  rules.
- `npm run build:web` — bundles clean.
- **Every route rendered in both themes at 375pt and 440pt** (iPhone SE through
  16 Pro Max) with zero page errors and zero console errors. Screenshots in
  `docs/screenshots/`.
- **Interaction check**: tranche projection recomputes, marking a leg done moves
  the counter, five detail screens navigate in and back out correctly, search
  and filters narrow the list, and the no-API-key path explains itself instead
  of crashing.
- **Edge cases exercised on real screens**: `SMH` (an ETF — no P/E, no earnings,
  no fundamentals; renders "An ETF does not report earnings" and "No revenue
  reported for this security"), `TSSI` (nulls inside the quarterly history),
  `PLTR` (no −DI, so the trend score reports 5 of 6 checks measurable),
  watchlist names with no share count, and `MCD` (negative shareholder equity,
  so debt/equity is labelled as not comparable rather than shown bare).

One caveat on the screenshots: they are from the web build driven by Playwright,
because this environment is Linux and cannot run an iOS simulator. The layouts
are the same React Native components, but you should open it in Expo Go before
trusting the pixel-level result on device.

## A bug worth telling you about

An early build read **10 of 17 names as "cheap"**, which is not information. The
cause was real: comparing a *forward* P/E against a *trailing* P/E history reads
cheap almost by construction, since forward earnings are higher.

Fixed by comparing like with like — the headline still leads with forward P/E,
but the band is computed from trailing P/E against the trailing history, and the
sentence says which number was placed in the range. It now reads 2 of 17 cheap.
Written up in `docs/DATA.md`.

## What is seed data, and what to do about it

Because the app now takes prices from your screenshots rather than a data feed,
the bundled dataset is a **starting point, not your book**. Specifically:

- **META is real.** Price, valuation, technicals, options, the Q2-2026 reported
  figures and quality metrics were pulled live from Alpha Vantage on 2026-08-18.
  PLTR's moving averages, RSI and +DI are real from the same pull.
- **Everything else is realistic seed data**, marked `Seed` on the Data sources
  screen. It is internally consistent — the account tiles are derived from the
  holdings and quotes rather than hard-coded — but the share counts, costs and
  prices are not yours.
- **Two holdings are invented.** Your brief named twelve tickers across a
  fourteen-holding book; I filled the gap with `LLY` (which gives the healthcare
  bucket something in it) and `LMT` (a low-beta defense anchor). Replace them.
- **The plan is at zero legs done.** Your brief said "mid-way through", but every
  leg I could mark done would have removed a holding the brief also named as
  currently held. I left them all open so the two do not contradict each other —
  mark off what you have already executed on the Plan tab.

**Fixing all of this is one action**: import a screenshot of your real positions.
That replaces holdings, share counts, costs, prices and cash in one pass. Then
open each stock and tap Re-research to replace the seeded analysis.

## Costs

Claude Opus 5 is $5/M input, $25/M output.

- A screenshot read is roughly 2–4K tokens in and under 1K out — a fraction of a
  cent each. Daily use is negligible.
- A per-stock research pass uses web search and adaptive thinking; expect a few
  cents per stock. Refreshing all 17 is a small number of dollars, and you only
  need it when something has actually reported.

Alpha Vantage is optional. Your current key is the **free tier: 25 requests a
day**, which is fewer than one per tracked ticker — that is why the scheduler is
budget-aware and rotates across days. The paid tier that would cover the whole
book comfortably is the 75 requests/minute plan at about $50/month, and it is
genuinely optional given the screenshot flow.

## What I would do next

1. Import your real positions and re-research the book — that removes every
   seed caveat above in two actions.
2. A home-screen widget for NLV and day P&L. It needs a native config-plugin
   build rather than Expo Go, which is why it is not here.
3. Batch "research everything that reported this week" rather than per-stock.
4. Persist the screenshot images alongside the snapshots, so a position history
   can be audited back to the statement it came from.
