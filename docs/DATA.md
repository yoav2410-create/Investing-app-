# Where every number comes from

The app is explicit about provenance because a portfolio tool that blurs
"measured", "researched" and "made up" is worse than no tool. Every data block
on every stock carries a source and a timestamp, and the **Data sources** screen
shows the whole matrix.

| Source tag | What it means |
| --- | --- |
| `Claude` | Read from your screenshot, or researched by Claude with web search |
| `Alpha Vantage` | Fetched from the Alpha Vantage API (optional, technicals only) |
| `Computed` | Derived in-app from data already present |
| `Seed` | Bundled starting value — has never been refreshed |
| `None` | No source; the screen prints an em dash rather than a guess |

## Prices and positions

Prices come from **your own broker screenshot**, transcribed by Claude Opus 5
using the Messages API with a strict tool schema (`src/data/provider/claude.ts`).
The system prompt is written to make the model prefer a `null` over a plausible
guess, because these numbers get traded on.

Two deliberate rules in `src/data/claudeSync.ts`:

1. **A null never overwrites a known value.** A null from the model means "I
   could not read this", not "this is now unknown".
2. **Nothing merges until you approve the diff.** The review screen shows
   added / removed / changed / unchanged per ticker, with a warning on any row
   the model read at under 70% confidence.

When a broker shows a day-change percentage but not a previous close, the close
is backed out from the percentage. When it shows market value but no price, the
price is market value over share count. Both are stated in the code.

## The analytical layer

Researched per stock with web search. The tool schema covers valuation
multiples, ten quarters of reported figures and derived multiples, quality
metrics, momentum, technicals, the latest earnings call, news sentiment, and the
write-up.

**Research is triggered automatically.** Applying a screenshot import queues
every position whose size changed, plus anything new, and the queue drains one
ticker at a time in the background. A position that moved is a position worth a
fresh read: the reason it moved is usually news, and the write-up on file
predates it. You can also run one by hand from any stock page.

Sequential on purpose — each pass runs web search and adaptive thinking, so
firing seventeen at once would burn the rate limit and give no useful progress
signal.

### News sentiment

Separate from options positioning, which is what the market is *doing* with
money; sentiment is what it is *saying*. Each pass returns a −1 to +1 score, a
paragraph on what is driving the tone, analyst target and rating revisions, and
up to six recent articles with source, date and a one-line "why a holder should
care" that is not allowed to just restate the headline.

The model is told to prefer coverage from the last 30 days and to say so
explicitly when the most recent thing it can find is older — silence reads as
"nothing happened", which is a different claim.

**Narrative fields are curated, not synthesised from numbers.** `managementSaid`
is only populated with what was actually said or reported. Where the figures are
available but the words are not, the text says so instead of inventing a quote.
The seed narratives follow the same rule.

## What is computed in-app

- **RSI (14 and 20), moving averages (20/50/100/200), +DI/−DI** — Wilder's
  smoothing, from a daily price series (`src/domain/technicals.ts`).
- **Trend score, 0–5** — one point per moving average the price sits above, one
  for RSI over 50, one for +DI over −DI. Missing inputs are excluded and the
  score is scaled to what could actually be measured, so a stock with no 200-day
  average is not silently penalised. The detail screen shows how many of the six
  checks were measurable.
- **Valuation band** — where the current multiple sits inside that stock's own
  history, as a percentile: bottom third reads cheap, top third expensive.

### One methodology note worth knowing

Forward P/E sits below trailing P/E almost by construction. Scoring a forward
multiple against a *trailing* history therefore reads "cheap" for nearly
everything — in an early build it flagged 10 of 17 names cheap, which is not
information.

So when the headline multiple is forward P/E and only a trailing history exists,
the **headline stays forward** but the **band is computed from trailing P/E
against the trailing history**, and the sentence says so:

> Trading at 19.7x forward p/e. On trailing p/e — the like-for-like comparison —
> 22.2x sits at the low end of its 2-year range of 23.4x–30.2x (median 26.9x).
> That is 24% below the mega-cap platform median.

EV/EBITDA and P/S are compared directly, because their histories are in the same
units.

## Multiple histories are derived, not published

Nobody publishes a P/E history series. These are reconstructed — quarter-end
close over trailing-twelve-month EPS, and quarter-end enterprise value over
trailing-twelve-month EBITDA. That is why they carry their own source stamp
separate from the reported fundamentals: they are a calculation, not a filing.

## Portfolio-level insights

The **AI insights** screen is split deliberately. Every figure — concentration,
the Herfindahl index, weighted beta, valuation percentile, trend and sentiment
breadth, earnings clustering, sector drift — is computed in
`src/domain/insights.ts` from the positions on file. That half always works and
needs no API key.

Claude's read sits on top of those numbers and is told not to recompute them.
Its job is the part arithmetic cannot do: noticing that three positions in three
sectors are one bet on the same underlying driver, or that the cheap half of the
book is cheap for the same reason. If the model were also generating the
figures, there would be no way to check its narrative against anything.

Every weighted average carries a coverage figure — how many positions and what
share of market value it could actually be computed for. Below 60% of the book,
the screen says the average is thin rather than reasoning confidently from it.

One correctness note: the Herfindahl index is computed across the equity sleeve
renormalised to 100%, not across net liquidation value. Using NLV weights let
cash dilute the index and reported *more* effective positions than the book
actually held — 18 from 14 holdings, which is impossible. Caught by a test.

## Explaining the metrics

Every metric in the app carries a "?" that opens a plain-English explanation in
three parts: what it is, how to read the number in front of you, and — where it
applies — the specific way that metric misleads.

They sit wherever a term appears, not only on table rows: section headings
("Multiple history", "The case"), chart captions ("EV / EBITDA", "Net income"),
the verdict pill, the narrative fields, the trend checks, the plan's tranches,
and the sector targets. The stock detail page carries 72.

The third part is not decoration. A tooltip that explains P/E without mentioning
that a collapsed-earnings company shows its highest multiple exactly when it is
cheapest is worse than no tooltip. The glossary lives in
`src/domain/glossary.ts` and holds 95 entries.

A mistyped `term="…"` renders nothing at all rather than failing, so a test walks
every screen, extracts each reference and asserts it resolves. Terms chosen from
data go through a helper with a `GlossaryKey` return type, which makes a wrong
key a compile error instead of a silent no-op.

## The cash-flow bridge

`src/domain/cashflow.ts` walks adjusted EBITDA down to free cash flow. The lines
themselves come from a research pass (`cashFlow` on the stock, stamped `Claude`);
the walk, the subtotals and the ratios are `Computed`.

```
  Adjusted EBITDA
− stock-based compensation      → Cash EBITDA
− cash interest, cash taxes, working-capital move
                                → Operating cash flow
− capital expenditure, other items
                                → Free cash flow
```

Two rules in there decide what the number means:

**Stock comp is deducted, not added back.** Adding it back is the common
convention and it treats a real cost as free because it is settled in shares. The
holder pays it through dilution. This is the single biggest reason the number
here is lower than the FCF a company reports in its own deck, and it is why META
converts 7% of adjusted EBITDA to cash rather than a flattering multiple of that.

**A missing line breaks the chain rather than counting as zero.** If cash taxes
are unknown, the walk stops at cash EBITDA and the card names the lines it does
not have. Treating an unknown deduction as nil would overstate the cash and the
overstatement would be invisible — exactly the failure mode this whole document
exists to avoid.

Ratios shown alongside: conversion (FCF ÷ adjusted EBITDA), capex intensity
(capex ÷ adjusted EBITDA) and FCF yield (FCF ÷ market cap, using shares implied
from price and market value).

Securities with no cash-flow statement of their own — funds like `SMH` — hide the
card rather than render an empty one.

## The Monte Carlo projection

`src/domain/montecarlo.ts`. Everything on that card is `Computed`; it consumes
positions, betas, 52-week ranges and analyst targets already on file and adds no
new external data.

Each holding's log return in year *t*:

```
(μᵢ − σᵢ²/2) + βᵢ · σ_market · z_market,t + σ_idio,i · zᵢ,t
```

- `z_market,t` is drawn **once per year per path and shared by every holding**.
  This is the whole point. Drawing independently per name would diversify the
  book in the simulation in a way it is not diversified in reality, and would
  understate the downside badly.
- The benchmark is compounded from those same `z_market` draws, so "beats the
  S&P in 42% of paths" is a path-by-path comparison, not two distributions
  compared at the median.
- `− σᵢ²/2` is the drift adjustment that keeps the *arithmetic* expected return
  equal to μ after log-normal compounding. Without it the simulation would
  quietly return less than the μ it was given.
- **μ** is either CAPM (`risk-free + β × 4.5% equity risk premium`, with the
  risk-free rate taken from the US 10-year on the same screen) or the analyst
  target implied return, capped at ±40% so one stale target cannot dominate.
- **σ** is the Parkinson range estimator, `ln(high/low) / (2·√ln 2)`, from the
  52-week high and low — floored at `β × market vol` so a quiet year cannot make
  a high-beta name look safe. Idiosyncratic vol is `√(σ² − (β·σ_market)²)` with a
  12% floor.
- Cash compounds at the risk-free rate with no volatility.
- 5,000 paths, seeded (`mulberry32`) so the same book gives the same answer twice
  — a projection that changes every time you open it is not something you can
  reason about.

The histogram clips to the 1st–99th percentile and folds the outliers into the
end bars, with the counts stated in the caption. Log-normal compounding produces
a tail long enough that an unclipped axis puts 95% of paths into two bars.

Stated on the page, not buried here: returns are drawn normal while real markets
have fatter tails, so the worst case shown is optimistic; and one market factor
means two names in the same theme are treated as less correlated than they are.

## Known gaps, stated rather than hidden

- **Short interest** has no automatic source. It stays null unless Claude finds
  it during a research pass.
- **Put/call open interest** is not returned by the free options endpoint; only
  the volume-based ratio refreshes automatically.
- **Momentum windows** (1M/3M/6M/YTD) need a price history the screenshot flow
  does not provide. They populate on a research pass; until then the only
  windows shown are the ones the 52-week range supports.
- **Adjusted EBITDA is as the company defines it.** The bridge does not
  re-derive it from the income statement, so whatever the company chose to
  exclude stays excluded. Deducting stock comp claws back the largest of those
  exclusions, but not all of them.
- **The simulation's correlation structure is one factor.** Two names in the
  same theme move together only as much as their betas imply, which is less than
  they really do.

## The optional Alpha Vantage path

Not required. If you set a key, the app fetches a daily price series (one call
per ticker) and computes every technical locally, rather than making nine calls
per ticker for indicators. The scheduler is budget-aware because a free key
allows **25 requests a day** — fewer than one per tracked ticker. It spends the
budget in priority order (held names first) and rotates slow-moving blocks
across days, so a small budget still covers the whole book over about four days
instead of starving the tail.

Rate limits and entitlement errors stop the run cleanly and leave every previous
value in place with its original timestamp. That is what lets the app show
last-known-good data with an honest "as of" rather than a blank screen.

## A note on the API key

Calling Anthropic directly from the device means the key is on the device. For a
single-owner personal app that is the honest trade: no server to run, no third
party holding the key, and the key is in the iOS keychain.

If this ever ships to more than one person, put a thin proxy in front of it —
your own endpoint holding the key server-side, with the app authenticating to
that instead. The client is a single file (`src/data/provider/claude.ts`) and
takes a base URL, so that change is small.
