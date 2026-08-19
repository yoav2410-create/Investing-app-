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

Researched per stock on demand (**Re-research with Claude**). The tool schema
covers valuation multiples, ten quarters of reported figures and derived
multiples, quality metrics, momentum, technicals, the latest earnings call, and
the write-up. `web_search` is enabled so figures are current rather than
recalled.

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

## Known gaps, stated rather than hidden

- **Short interest** has no automatic source. It stays null unless Claude finds
  it during a research pass.
- **Put/call open interest** is not returned by the free options endpoint; only
  the volume-based ratio refreshes automatically.
- **Momentum windows** (1M/3M/6M/YTD) need a price history the screenshot flow
  does not provide. They populate on a research pass; until then the only
  windows shown are the ones the 52-week range supports.

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
