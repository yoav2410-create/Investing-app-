# Handoff — start here

Paste the block in §0 into a fresh Claude Code session opened on
`C:\Users\Yoav\Investing-app-`. Everything else in this file is the context
that block refers to.

---

## 0. The opening message

> Read `docs/HANDOFF.md`, `docs/SPEC.md` and `CLAUDE.md` before touching
> anything, then do the job described in §3 of the handoff: bake my real book
> into the code, cut the import machinery, and leave one button that opens the
> conversation. My positions are in §2. Verify the way §5 says, and show me
> screenshots of the live site when you are done.

---

## 1. Where things are

| | |
| --- | --- |
| Working copy | `C:\Users\Yoav\Investing-app-` |
| Branch | `claude/iphone-investment-app-frn8sy` — never push to `main` except the deploy workflow file |
| Remote | `github.com/yoav2410-create/Investing-app-` (**public**) |
| Live site | https://yoav2410-create.github.io/Investing-app-/ |
| The rules | `CLAUDE.md` — read it; it is the accumulated bug history and the house style |
| The brief | `docs/SPEC.md` — everything the owner asked for, with reversals marked |

Stack: Expo SDK 57 + React Native 0.86 + expo-router + TypeScript strict,
built to static web and served by GitHub Pages. State in zustand, persisted to
`localStorage` under `portfolio-brief-v1`.

Prices: a GitHub Actions cron every 15 minutes (weekdays 13:00–21:00 UTC) runs
`scripts/fetch-quotes.mjs` over `data/universe.txt` with the Finnhub key from
repository secrets, writes `public/quotes.json`, cross-checks a sample against
CBOE's delayed feed, and deploys. The app reads that file from its own origin.
A Finnhub key on the device tops up anything the feed misses.

## 2. The owner's actual book

Eighteen positions. Read from their broker screenshot and reconciled: for
every row, shares × avg cost against market value and unrealised P&L agrees
with what the broker printed.

```
Symbol Quantity AvgCost
APP    19    375.47
BWXT   35    193.56
TSSI   500   9.67
VST    20    158.45
MCD    23    275.46
KRKNF  350   4.38
BSX    88    50.70
GOOGL  6     344.23
SGOV   280   100.58
IBIT   11    41.41
ETHA   28    17.74
FTAI   39    207.75
CEG    13    262.52
MELI   2     1673.59
SPGI   9     365.94
NOW    33    95.92
MSFT   10    329.82
META   15    213.93
```

Cash: **ILS 1,340** and **USD 365.74** (broker reported total cash 814.90 —
the ILS leg converts at roughly 3.0 in their statement; ask before assuming a
rate, and if unsure carry the two balances separately and say so).

Account figures at the time of reading: net liquidation value 99,539;
unrealised P&L 5,461; realised P&L 0; market value 98,709.40.

Sector mapping to this app's seven ids — `tech`: APP, TSSI, GOOGL, NOW, MSFT,
META · `industrials`: BWXT, KRKNF, FTAI · `power`: VST, CEG · `consumer`: MCD,
MELI · `healthcare`: BSX · `financials`: SPGI, IBIT, ETHA · `cash`: SGOV plus
the balances. (SGOV is already treated as cash-like by `capitalSplit`.)

Seven of these have never been researched by this app and have no analytical
layer at all: **APP, KRKNF, BSX, GOOGL, SGOV, IBIT, ETHA**. Eleven overlap
with the old demo set and carry seed-stamped figures: META, MSFT, NOW, TSSI,
VST, CEG, FTAI, BWXT, MCD, MELI, SPGI.

## 3. The job

The owner wants the simplest possible shape:

1. **The book lives in the code.** Replace the demo seed with the eighteen
   positions above. A fresh install, on any device, shows their portfolio.
   No import link, no paste box, no review diff to operate — the app opens
   already knowing what they hold.
2. **One button**, on the Portfolio screen: it opens the conversation
   (`settings.claudeSessionUrl`, set on the device, falling back to
   `https://claude.ai/code`). That is the entire interface for changing
   anything.
3. **The loop from here on:** the owner sends a screenshot of their broker to
   the conversation; the session edits the seed in this repo, pushes, and the
   deploy carries it to their phone. New names get added, changed sizes get
   updated, and names that left get deleted. **They want to see only what is
   in the portfolio** — this has come up three times, so treat any leftover
   ticker as a bug.
4. **Delete what the link flow needed** once the book is in the code: the
   `?positions=` handshake in `app/sync.tsx`, `applyAnythingPasted`,
   `readPositionsTable`, `src/data/import/positionsTable.ts`,
   `src/data/readExchange.ts` and `buildReadPrompt` / `applyPastedRead`, plus
   their tests and the `/sync` route if nothing routes to it. Do not leave
   unreachable code behind — that lesson is in `CLAUDE.md` twice.
5. **The analytical layer for the seven new names** has to be written the way
   the seed writes everything: real reported figures where they can be found,
   `null` where they cannot, a `Stamped` source on every block, and a
   `glossary` entry behind any new metric. Do not invent a number to fill a
   card.

### The privacy decision, recorded

`scripts/privacy-check.mjs` currently fails the build if anything
owner-specific reaches `dist/`, and this repository is public. The owner was
asked directly and answered: *"it is not sensitive information, I do not mind
people knowing what I hold, even if it is written in the code"*, then added
*"better that it be as little exposed as possible, but if you must, it is
possible."*

So: proceed, and narrow the check rather than deleting it. It must still fail
on anything credential-shaped — API keys, tokens, the session URL — and it
must still prove it can fail (the sentinel assertion). Update the comment at
the top of that file and the matching section in `CLAUDE.md` to say the policy
changed and why, so nobody later "fixes" it back.

What must **never** be committed regardless: API keys, the GitHub token, the
Claude Code session link, and the owner's email beyond what git history
already holds.

## 4. Standing rules, condensed

- **Never invent a number.** Unknown renders as an em dash. A weighted average
  states its coverage. Missing means missing.
- Every data block carries `asOf` and `source`; the Data sources screen shows
  them.
- **No API keys in the app.** A Claude.ai subscription is not API access. All
  Anthropic and Gemini code was removed deliberately; do not add it back.
- Prices refresh themselves. Never add a manual refresh button.
- **A check that cannot fail is not a check.** Break the thing it guards and
  watch it go red before trusting it. This has caught four vacuous assertions
  in this project.
- Any change to a persisted shape — including *adding* a settings key —
  needs a `version` bump and a `normalisePersisted` migration in the same
  commit.
- Comments explain *why*, never what the line does.
- No pull requests. No model identifier anywhere in the repository.

## 5. How to verify

```bash
npm run typecheck          # strict, noUncheckedIndexedAccess
npm test                   # 141 tests, 10 suites
npm run build:web          # then npm run serve:web on :8080
npm run verify:screenshots # every route, both themes, 375pt and 440pt
npm run verify:interaction # presses controls rather than photographing them
npm run verify:features
npm run verify:simulation
npm run verify:allocation
npm run verify:backup
node scripts/privacy-check.mjs
npm run build:pages && npm run verify:pwa
```

Then **open the PNGs in `docs/screenshots/`**. Three real rendering bugs in
this project were found only that way, and two more reached the owner's phone
because a screenshot taken on this machine cannot show an iPhone's safe-area
inset.

Deploying: push the branch. The workflow builds, fetches marks, stamps
`dist/build-info.json` with the commit, and publishes. Confirm the live site
is actually serving the new build by fetching `build-info.json` — do not
assume a green run means the CDN has caught up.

Pushing needs the token in the scratchpad; the credential manager hangs
silently, so push with
`git push "https://x-access-token:$TOKEN@github.com/yoav2410-create/Investing-app-.git" claude/iphone-investment-app-frn8sy`.

## 6. What the app looks like today

One button on Portfolio. Hero with net liquidation value and a live dot while
ticks stream. A demo-data warning while the seed is still in force — delete it
once the real book is the seed. Sector donut tapping through to Sectors. The
book: total, equities, cash, T-bill ETFs, dividends with coverage, return on
cost. Year-over-year growth from the app's own snapshots. Cash vs fear: the
VIX year with its regime bands, the contrarian logic behind the "?" only.
Monte Carlo on the front page, naming any holding it could not price.

Stock pages are quote pages: pinned ticker and price, a search magnifier, and
four tabs — Summary · News · Analysis · Financials — with a sliding underline.
Summary opens with what the business is: products, where in the world it
operates, channels, and who finally pays, in 55–75 words. Financials leads
with revenue against earnings as paired bars and an Annual/Quarterly toggle,
where annual means complete calendar years and a year missing a quarter is not
drawn.

Removed on purpose and not to be revived: the Plan tab, options positioning,
Realised P&L, daily attribution, Alpha Vantage, the manual refresh button, the
Anthropic key, Gemini.
