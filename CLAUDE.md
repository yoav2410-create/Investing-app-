# Portfolio Brief — working notes

A native iPhone app for one owner's ~$100K US equities book. Expo + React
Native + TypeScript. Read this before changing anything; it is the context a
fresh session would otherwise have to rediscover.

## Branch and delivery

- Work happens on **`claude/iphone-investment-app-frn8sy`**. Do not push to
  `main` without being asked.
- **Do not open a pull request unless the owner explicitly asks for one.**
- Never put a model identifier in a commit message, PR body, code comment or
  anything else pushed to the repository.

## What this app is, and what it refuses to be

The original brief said: not a WebView wrapper, do not drop analytical depth to
make the build easier, and **do not invent numbers**. Those still hold, and the
third one shapes most of the architecture.

**Provenance is not decoration.** Every data block on every stock is a
`Stamped<T>` carrying its own `asOf` and `source` (`claude` | `alphavantage` |
`computed` | `seed` | `manual` | `unavailable`), surfaced on the Data sources
screen. Live prices sitting next to week-old fundamentals is fine as long as the
app says which is which. Adding a field without a source stamp breaks this.

**Missing means missing.** Nothing substitutes a plausible number for an absent
one. A `null` renders as an em dash, a broken cash-flow chain stops at the last
known subtotal, a trend score scales to the checks that could actually be
measured, and a weighted average carries the share of the book it covers and
says it is thin below 60%. Filling a gap with zero is the specific failure mode
this codebase is built to avoid.

**Every metric explains itself.** 95 glossary entries in `src/domain/glossary.ts`,
each `{title, what, read, caveat}`. The `caveat` is the point — a tooltip
explaining P/E without saying that a collapsed-earnings company shows its highest
multiple exactly when it is cheapest is worse than none. New metric ⇒ new entry
⇒ a `term=` on whatever renders it. 72 on the stock detail page.

## Layout

```
app/                     expo-router screens
  (tabs)/                Portfolio · Stocks · Sectors · Plan · More
  stock/[ticker].tsx     the deep per-stock page (the biggest screen)
  market.tsx             indices, yields, Monte Carlo, book-wide put/call
  insights.tsx           portfolio-level read — Claude's on top, computed below
  sync.tsx               screenshot import and the review diff
src/domain/              pure analytics, no React, unit tested on their own
  technicals.ts          Wilder RSI/±DI, moving averages, the 0–5 trend score
  valuation.ts           cheap / fair / expensive against a stock's own history
  cashflow.ts            adjusted EBITDA → free cash flow
  montecarlo.ts          single-factor path simulation against the S&P
  insights.ts            concentration, breadth, coverage
  glossary.ts            the text behind every "?"
src/data/
  provider/claude.ts     screenshot reading + per-stock research (web search)
  claudeSync.ts          merge rules — a null never overwrites a known value
  keys.ts                keychain on native, localStorage on web
  store.ts               zustand + AsyncStorage, persisted as portfolio-brief-v1
src/components/charts.tsx  every chart, hand-drawn SVG, each with a spoken summary
scripts/                 the verification passes (see below)
docs/                    HANDOFF, DATA, IPHONE, IPHONE-NO-COMPUTER
```

## Two decisions that look wrong until you know why

**Stock comp is deducted in the FCF bridge, not added back.** The usual
convention adds it back and treats a real cost as free because it is settled in
shares. This is why META converts 7% of adjusted EBITDA to cash here and a much
flatter-looking number in its own deck. Deliberate. `src/domain/cashflow.ts`.

**The Monte Carlo draws one market factor shared by every holding**, not
independent noise per name. Independent draws would diversify the book in the
simulation in a way it is not diversified in reality and would understate the
downside badly. The benchmark compounds from the same draws, so "beats the S&P
in N% of paths" is a path-by-path count. `src/domain/montecarlo.ts`.

## Bugs already found here — do not reintroduce them

- **Comparing a forward multiple to a trailing history** read 10 of 17 names
  "cheap", which is not information. The headline stays forward; the band is
  computed like-for-like and the sentence says which number was placed in the
  range. Now 2 of 17.
- **Concentration computed over NLV weights** let cash dilute the Herfindahl
  index and reported *more* effective positions than holdings — 18 from 14.
  Normalised across the equity sleeve. There is a test.
- **Verification regexes that matched nothing and passed vacuously**, twice,
  after a `?` was inserted between a label and its value. If an assertion cannot
  fail, it is not an assertion — check that a check fails before trusting it.
- **A hard-coded container Chromium path** in every script, which broke every
  verification pass on any other machine. Now `scripts/browser.mjs`.

## Verifying

The analytics have unit tests; the screens are checked by driving the real web
build in Chromium. Both matter — a passing calculation rendered into a collided
layout is still broken.

```bash
npm run typecheck            # strict, noUncheckedIndexedAccess
npm test                     # 64 tests
npm run build:web            # bundles to dist/
npm run serve:web            # dependency-free, with the deep-link fallback
npm run verify:screenshots   # every route, both themes, 375pt and 440pt
npm run verify:interaction   # tranche projection, navigation, the no-key path
npm run verify:features      # explainers, insights offline, sentiment card
npm run verify:simulation    # Monte Carlo horizons and basis, the FCF bridge
```

Playwright needs a browser once: `npx playwright install chromium`. The scripts
find it themselves, or take `CHROME_PATH`.

For the web/PWA deployment specifically:

```bash
npm run build:pages          # base path + PWA shell
npm run verify:pwa           # serves it the way Pages does, then checks it
```

The verification scripts press controls rather than photographing them — the
horizon chips must actually move the median, not just relabel it. Keep that
property when adding checks.

**Look at the screenshots.** Three real rendering bugs in this project were
found only by opening the PNGs: a histogram squashed into two bars by a
log-normal tail, a waterfall whose nine columns collided at 390pt, and a stat
truncating mid-word. Tests said everything passed.

## The data situation

There is no market-data subscription. Prices and positions come from a
screenshot of the owner's broker, read by Claude, **shown as a diff, and written
only on approval**. That review is not ceremony: it is the one place a confident
misreading would silently corrupt everything downstream. Rows under 70%
confidence are flagged, rows can be excluded, and a null from the model never
overwrites a value already on file.

Applying an import queues research on every position that moved. Claude searches
the web for the latest call, analyst revisions and recent news, one ticker at a
time.

**The bundled dataset is seed data, not the owner's book.** META is real (Alpha
Vantage, 2026-08-18) and PLTR's technicals are real; everything else is
realistic but invented, marked `Seed`, and two holdings (`LLY`, `LMT`) were
added to fill out a fourteen-name book. `docs/DATA.md` has the full picture.
Do not present seed figures as the owner's actual position.

## Before publishing anything: what the bundle contains

Read this before making the repository public or deploying Pages. It was found
late and it changes what "publish" means.

**The seed data is baked into the built JavaScript**, not just the source. Grep
the export and `Raise cash to the 30% floor`, `18420` and `4318.6` are all in
there. A Pages site is publicly reachable on every plan — password-protected
Pages is Enterprise-only — so paying to keep the repository private does *not*
keep the app's contents private. Repository visibility is the wrong lever.

What is genuinely personal in there:

- **The rebalancing plan is the owner's real strategy**, not invented: the 30%
  cash floor, the 15% position cap, the full exits from VST and TSSI with their
  stated reasoning, the two-leg PLTR wind-down, the target sector mix.
- **Share counts, cost bases, cash balances and realised P&L** read as real
  whether or not they are (`SEED_HOLDINGS`, `SEED_CASH`, `realizedPnl`).
- **The owner's email** is in the commit history, so a public repository exposes
  it permanently.

What is *not* exposed, verified across the full history: no API keys, tokens or
credentials have ever been committed. Anything imported from a screenshot lives
only in the phone's storage and is never part of a build.

The per-company analytical data — multiples, revenue, EBITDA — is public
information about public companies and carries no privacy weight.

**So the fix is not repository visibility, it is the bundle.** Replacing
`SEED_HOLDINGS`, `SEED_CASH`, `realizedPnl` and `SEED_PLAN` with neutral demo
values makes publishing safe under any option, and costs the owner nothing —
importing a screenshot replaces all of it on first use anyway. Note that several
verification assertions are pinned to the current seed figures (cash headroom
11.7pp, effective positions 12.1, weighted beta 1.35, the "nuclear" search
hitting one name); they are checking the numbers the seed produces, so they need
updating to whatever the new data yields, not deleting.

## Getting it onto the phone

Two routes, both written up:

- `docs/IPHONE-NO-COMPUTER.md` — GitHub Actions builds it, Pages serves it,
  Safari installs it to the home screen. Free, phone-only. No background
  refresh, no notifications, no Face ID.
- `docs/IPHONE.md` — Expo Go, then EAS Update, then a signed TestFlight build.
  The last stage needs an Apple Developer account at $99/year and is what adds
  the four missing things.

The owner has no computer of their own, so the free route is the live one.

## House style

Match what is there. Comments explain *why* a decision was made, not what the
line does, and they are worth writing where a reader would otherwise assume a
mistake. Prose in the UI states the caveat rather than hiding it. Charts carry a
spoken summary for VoiceOver. When something cannot be computed, say so in words
a person can act on.
