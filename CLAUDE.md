# Portfolio Brief — working notes

A native iPhone app for a single owner's US equities book. Expo + React
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

**Targets come from analysis, not from the bundle.** The sector mix in
`PlanConstraints.targetMix` was a placeholder — a number nobody in this app can
defend, sitting where figures with a source and a date sit. The portfolio read
now returns an `AllocationStance` (`src/domain/types.ts`): a full sector mix
where each target says why it is that number, a proposed cash floor and position
cap, and concrete moves that each cite the figure behind them.
`resolveTargets()` in `src/domain/allocation.ts` picks the stance when one is on
file and the bundled mix otherwise, and the Sectors screen says which is in
force. The bundled mix is the fallback, never the answer.

Two boundaries worth keeping. The sector targets are *live* — drift is measured
against them. The cash floor and position cap are *proposals*; the plan keeps
enforcing its own until the owner says otherwise, and the screen shows both
numbers so one is never mistaken for the other. And `stanceProblems()` checks
the arithmetic before any of it is drawn, because a mix totalling 80% would make
every sector look underweight and the drift list would be confidently wrong.

**The plan is dynamic, not standing.** There is no plan document and no Plan
tab. The owner asks for a portfolio read; the stance's moves are pinned on the
insights screen as a checklist (`stanceDone` in the store — persisted, backed
up, reset when a fresh read replaces the moves); the previous read and which of
it was executed feeds the next one. The bundled `RebalancePlan` survives only
for its constraints (cash floor, position cap, the fallback target mix).

**Options positioning is gone; insider filings replace it.** A whole-chain
put/call ratio blurs hedging with conviction and needed a chain nothing free
supplies reliably. The research pass reads insider filings instead —
`Sentiment.insiderActivity` / `insiderDetail` — rendered on the stock page,
counted across the book in the insights breadth, and behind the net-selling
alert. Do not reintroduce an `options` block; old persisted stores may still
carry one as a dead key, which is harmless.

**Every metric explains itself.** ~94 glossary entries in `src/domain/glossary.ts`,
each `{title, what, read, caveat}`. The `caveat` is the point — a tooltip
explaining P/E without saying that a collapsed-earnings company shows its highest
multiple exactly when it is cheapest is worse than none. New metric ⇒ new entry
⇒ a `term=` on whatever renders it. 72 on the stock detail page.

## Layout

```
app/                     expo-router screens
  (tabs)/                Portfolio · Stocks · Sectors · More
  (tabs)/index.tsx       hero, allocation donut, the Monte Carlo block
  stock/[ticker].tsx     the deep per-stock page (the biggest screen)
  market.tsx             indices, ETFs, yields — the backdrop, nothing else
  insights.tsx           Claude's read, the pinned move checklist, computed below
  plan.tsx               a redirect to /insights; the Plan tab is gone
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
- **Container-absolute *output* paths**, fixed later than the Chromium one and
  worse for it: `page.screenshot()` creates its parent directory, so on Windows
  the PNGs went to `C:\home\user\…`, `docs/screenshots` stayed empty, and the
  run still printed "no page errors". Paths are resolved from `import.meta.url`
  now — via `fileURLToPath`, not `.pathname`, which keeps the leading slash and
  yields `C:\C:\…`.
- **`serve.mjs` comparing `import.meta.url` to a hand-built `file://` + argv[1]**,
  which never matches on Windows, so the server exited 0 without listening and
  every check failed to connect for reasons nothing explained.
- **The tab bar clipping its own labels.** A 48pt bar, 10pt of padding, a 28pt
  icon that cannot shrink and a 14pt label that can — so the label got a 10pt
  box with `overflow: hidden` and every glyph lost its bottom quarter, at every
  width, in both themes. `getBoundingClientRect` reported the box as fitting,
  because it did; the glyphs painted outside it. Found by opening a PNG.
- **`node:fs` inside `@anthropic-ai/sdk` failing the whole native bundle.** Expo
  Go could not start the app at all, and nothing caught it because the whole
  verification suite drives the web build. `metro.config.js` stubs Node built-ins
  for native only. A green suite says nothing about whether the app starts on a
  phone.
- **A screen check that inspected zero screens on Windows.** The glossary test
  filtered paths with `includes('/app/')`; Windows paths use `\`, so locally it
  matched nothing and passed while CI failed. The vacuous pass again, split
  across operating systems. Paths are normalised to `/` at collection now.
- **A cron that never fired, and would have shipped a white screen if it had.**
  GitHub registers `schedule:` only from the default branch, so the
  fifteen-minute quote refresh silently never ran while it lived on the feature
  branch. And `github.event.repository.name` is empty on schedule events, so
  the Pages base path would have resolved to nothing. The workflow lives on
  main too now, scheduled runs check out the working branch explicitly, and the
  base path derives from `GITHUB_REPOSITORY`. Verify automation by watching it
  fire, not by reading its YAML.
- **Two owners for one reservation, so neither could be tested.** `Screen`
  padded 64pt at the bottom — breathing room *and*, by accident, enough to
  clear the floating tab bar. Deleting the tab layout's own reservation
  therefore changed nothing on screen, and the check written to guard it
  passed on a build that had no reservation at all. One owner each: the tab
  layout reserves the bar, `Screen` reserves the margin. The check now fails
  on every tab screen at both widths when the reservation goes.
- **The tab bar clipped its labels again — on the phone only.** A floating
  62pt bar with React Navigation's safe-area padding *inside* it leaves 28pt
  of content box on an installed iPhone app (~34pt inset) and 62pt in a
  desktop browser: every screenshot taken here was perfect while the owner's
  phone showed four icons and no words. The bar sets `paddingBottom: 0` and
  clears the home indicator by floating above it instead, and
  `verify:pwa` now measures the arithmetic — content box versus
  icon-plus-label — rather than photographing it. Proven able to fail by
  putting the padding back.
- **A test fixture that was the owner's actual portfolio.** Verifying the
  Gemini reader meant rebuilding the owner's real broker screen — their
  tickers, their share counts, their net liquidation value — and the
  screenshot of it landed in `docs/screenshots/`, which is a public
  repository. `privacy-check` did not catch it: that scans `dist/` for text,
  and this was owner data inside a PNG outside the build. Deleted before it
  was committed. Test fixtures get invented numbers; if a real book is needed
  to prove something, the artefact stays in the scratchpad.
- **A cross-check that only ever ran on the author's laptop.** The publish
  compared its Finnhub prices against Yahoo and passed 12 of 12 — locally.
  On GitHub's runners every request came back 429 (Yahoo refuses datacenter
  IPs as well as browsers), so every real publish logged "skipped" and wrote
  no attestation, while the app showed blank space that read as "nothing
  wrong". Corroboration now comes from CBOE's delayed-quote CDN — the same
  host whose VIX history is already proven to answer from CI — and when the
  check cannot run it writes *why* into quotes.json and the app says so.
  Verify an external dependency from the machine that will actually call it.
- **A failing test froze the price feed.** The fifteen-minute cron rebuilt
  the branch tip, so one work-in-progress commit whose test failed stopped
  every scheduled publish until someone noticed the email. The refresh exists
  to re-mark the site that is live, not to ship undeployed code: the build
  now stamps `dist/build-info.json` with the commit it was built from, and
  scheduled runs read it back and rebuild exactly that commit. Automation
  that must never stop cannot share a gate with work in progress.
- **A set() on tab-hide that raced storage.** `stopLiveStream` ran on every
  visibilitychange — including the unload half of a navigation — and its
  `set({streamStatus:'off'})` made persist serialise the dying page's state
  over storage, erasing what the interaction check had just planted there.
  Any handler wired to "the app went to background" must be a strict no-op
  when it has nothing to do; a gratuitous set() is a gratuitous storage write.
- **A renamed persisted key with no migration.** `alertOnOptionsFlip` became
  `alertOnInsiderSelling` and every upgraded install rehydrated `undefined` —
  the alert silently off, while fresh installs had it on. The store persists
  with a version and `normalisePersisted()` now; backup restore runs through
  the same function. Renaming anything persisted means writing the migration
  in the same commit.

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
npm run verify:allocation    # targets come from the read, not the bundle
npm run verify:backup        # export, wipe, restore returns the book
```

`verify:allocation` plants a stance rather than paying for a real read, and the
assertion is the *change*: it reads the bundled target first, plants a different
one, and requires the screen to show the new number. "A target renders" would
pass with the placeholder still in force, which is the thing being fixed.

`verify:backup` clears storage mid-run and asserts the book really was lost
before restoring it. Without that, "it restored" is true regardless of what the
file held.

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
time. That layer is not CORS-bound — the search happens on Anthropic's side — so
it can reach whatever source is best for the question, and it is where anything
resembling "the latest investor call" comes from.

**Prices are a different problem, and the constraint is CORS, not preference.**
The app is a static site with no server, so a price source has to be readable by
a browser. Measured, not assumed:

| Source | Answers a script | `Access-Control-Allow-Origin` | Usable |
| --- | --- | --- | --- |
| Yahoo Finance `v8/finance/chart` | yes | none | no |
| Finviz | yes | none | no (and against their terms) |
| Stooq CSV | 404 | none | no |
| Alpha Vantage | yes | `*` | yes |
| Google Sheets published CSV | yes | reflects the origin | yes |

Yahoo and Finviz return perfectly good data to `curl` and are then refused by
the browser, which is the worst kind of failure to design around: it looks like
a bug in the app. Yahoo also 429s Node's `fetch` while answering `curl` 200
with identical headers, and refuses GitHub's runners outright — which is why
the cross-check is not Yahoo's. `scripts/crosscheck.mjs` samples each publish
against **CBOE's delayed-quote CDN** (`cdn.cboe.com/api/global/delayed_quotes`),
the exchange's own numbers, no key, on the host already proven to answer from
CI. The result goes into `quotes.json` as `crosscheck` and Settings states it;
when the source will not answer, the payload carries the reason instead of
going quiet. Proven able to fail three ways: a halved price is flagged at 50%,
a dead source produces an explanation, an honest feed passes. CBOE lags by
fifteen minutes, hence a 3% tolerance rather than a tight one. So prices come from Alpha Vantage, or from a Google Sheet the
owner publishes — `GOOGLEFINANCE()` exists only inside Sheets, and publishing
one as CSV is the only way to get Google's quotes onto the phone without a
server. `src/data/provider/googleSheet.ts`.

That provider re-marks names already held and nothing else. A sheet row for a
ticker not in the book is not evidence the owner bought it, so it is reported as
skipped rather than added — positions come from the broker screenshot and only
from there. An unpublished sheet answers 200 with a sign-in page, so the parser
checks for markup before trusting the CSV; without that it would parse HTML into
confident nonsense.

**The bundled dataset is seed data, not the owner's book.** META is real (Alpha
Vantage, 2026-08-18) and PLTR's technicals are real; everything else is
realistic but invented, marked `Seed`, and two holdings (`LLY`, `LMT`) were
added to fill out a fourteen-name book. `docs/DATA.md` has the full picture.
Do not present seed figures as the owner's actual position.

## The bundle is public — keep it that way on purpose

The seed data is compiled into the built JavaScript, not just the source, and a
Pages site is publicly reachable on every plan (password-protected Pages is
Enterprise-only). So repository visibility does not control what the app
exposes. The bundle does.

The seed data was therefore replaced with neutral demo values: round share
counts, round cost bases, `$15,000` and `€2,500` cash, `$5,000` realised P&L,
and a plan whose notes explain the mechanic each leg demonstrates rather than
arguing an investment case. Nothing in it describes a real position or a real
strategy, and `scripts/privacy-check.mjs` asserts that.

**Keep it that way.** If you make the demo data more realistic, make it more
*illustrative*, not more personal: pick figures that exercise a case the screens
need (a position at the cap, a losing position, an ETF with no P/E), never
figures copied from someone's account. The same goes for the plan notes — a
made-up thesis written in confident prose is exactly what this app exists not to
produce.

Verified clean across the full history: no API keys, tokens or credentials have
ever been committed. Anything imported from a screenshot lives only in the
phone's storage and is never part of a build.

**Which is why the storage had to be made durable.** The positions were read
out of a photograph and approved row by row; there is no feed to replay them
from. On the deployed site `navigator.storage.persisted()` returned false,
meaning the browser could evict the whole book to reclaim space, silently.
`src/data/persistence.ts` asks for persistent storage once the store has
hydrated — browsers weigh the request against how used the app looks — and
reports the answer on Settings rather than implying a safety the browser never
gave. `src/data/backup.ts` writes the book to a file the owner keeps. The API
keys are deliberately excluded from it: they live outside the store precisely so
they are not part of anything the app writes out.

One thing sanitising cannot reach: **the owner's email is in the commit
history**, so a public repository exposes it. Fixing that means publishing from
a repository with fresh history, not editing files.

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
