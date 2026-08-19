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

**Applying an import kicks off research automatically.** Every position whose
size changed — plus anything new — goes into a queue, and Claude works through
it one at a time in the background: the latest earnings call and what was
actually said on it, current analyst targets and revisions, and news coverage
from the last month. The Portfolio screen shows what it is working on.

A position that moved is a position worth a fresh read, because the reason it
moved is usually news the write-up on file predates.

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
| **What the market is saying** | Sentiment score and label, what is driving the tone, analyst revisions, and recent coverage with source, date and why a holder should care |
| Earnings call | Date, quarter, the hard numbers, **the call in brief**, what management said, **verbatim quotes with attribution**, guidance, the share reaction, what to watch next |
| **Fundamentals charts** | Revenue, operating income, **net income**, diluted EPS — eight quarters |
| **Multiple history charts** | Trailing P/E, EV/EBITDA, P/S — ten quarters, with today marked on the line |
| The case | Catalyst, key risk, bull case, bear case, and **what would change the verdict** |
| In the plan | Every tranche leg touching this ticker |
| Provenance | Source and timestamp for each data block |

Bold rows are things added beyond the original brief because they change what an
investor can actually decide: net income alongside operating income, quality
metrics that separate "good business" from "cheap stock", momentum windows, news
sentiment with sourced coverage, and a `whatWouldChangeMyMind` field that forces
the verdict to name something observable rather than hedge.

### Every metric explains itself

Each one carries a **"?"** that opens a plain-English explanation in three parts:
what it is, how to read the number in front of you, and — where it applies — the
specific way that metric misleads.

They sit beside every complex term, not only on table rows: section headings,
chart captions like **EV / EBITDA** and **Net income**, the verdict pill, the
bull and bear cases, each trend check, the plan's tranches, sector targets and
the market instruments. The stock detail page carries **63**; the glossary holds
81 entries.

That third part is the point. A tooltip that explains P/E without saying that a
company whose earnings just collapsed shows its highest multiple exactly when it
is cheapest is worse than no tooltip. Same for beta breaking down in the selloffs
you wanted it for, EBITDA flattering businesses that must keep spending to stand
still, and put/call ratios rising because holders are hedging rather than because
anyone is bearish.

## AI insights

A portfolio-level page, split deliberately in two.

**The computed half always works and needs no API key**: concentration including
an effective-position count, weighted beta, weighted valuation percentile against
each name's own history, weighted trend, drawdown, leverage, ROE and sentiment,
breadth bars for trend/valuation/options flow, earnings clustering in the next 30
days, sector drift, and what carries the book. Every weighted average shows how
much of the book it actually covers, and says the average is thin below 60%
rather than reasoning confidently from it.

**Claude's read sits on top**, and is told not to recompute any of it. Its job is
what arithmetic cannot do: naming what the book is actually betting on, spotting
positions that would move together despite sitting in different sectors, calling
the single biggest risk specifically rather than saying "market risk", and saying
what it cannot know from the data on file.

Seed book, computed offline: 14 holdings but an effective count of 10.9, weighted
beta 1.30, 10 names in uptrend against 2 in downtrend, 3 bearish on options flow,
Tech/AI +8.1pp over target and cash 11.7pp under.

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
- **Interaction check** (`npm run verify:interaction`): tranche projection
  recomputes (cash headroom −11.7pp → −0.1pp), marking a leg done moves the
  counter, five detail screens navigate in and back out correctly, search and
  filters narrow the list, and the no-API-key path explains itself instead of
  crashing.
- **Feature check** (`npm run verify:features`): the "?" sheet opens with all
  three sections and dismisses on tap-away, the detail page carries 33
  explainers, the insights page computes entirely offline, and the sentiment card
  states it has no coverage yet rather than implying it has none to find.
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
