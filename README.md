# Portfolio Brief

An iPhone app for a single owner's US equities book. It replaces a daily HTML
report with something you open on your phone: account
snapshot, sector concentration, returns attribution, a deep analytical page per
stock, market overview, and an interactive rebalancing action board.

Built with Expo (React Native) + TypeScript. Runs on a real iPhone today through
Expo Go — no Mac and no App Store account required.

## Run it

```bash
npm install
npx expo start
```

Scan the QR code with the iPhone Camera app. Expo Go opens the app.

**No computer?** [`docs/PUBLISH-FROM-PHONE.md`](docs/PUBLISH-FROM-PHONE.md) is
the step-by-step version written for someone who has never used GitHub, and it
covers the one decision that route requires — Pages needs either a public
repository or a paid plan. [`docs/IPHONE-NO-COMPUTER.md`](docs/IPHONE-NO-COMPUTER.md)
is the shorter version for someone who already knows GitHub.

**With a computer**, [`docs/IPHONE.md`](docs/IPHONE.md) covers Expo Go through to
a signed TestFlight build, which is what adds background refresh, notifications
and the Face ID lock.

`npm run web` opens the same app in a browser, which is useful for a quick look
but is not the target: the layouts are designed for a phone.

## Two things to set up

1. **Anthropic API key** — Settings → Claude. This is what reads your broker
   screenshots and researches each stock. Without it the app still runs on the
   bundled seed data, it just cannot update anything.
2. **Alpha Vantage key** *(optional)* — Settings → Alpha Vantage. Adds precise
   daily technicals. Everything works without it.

Keys live in the iOS keychain (`expo-secure-store`), never in the bundle and
never in AsyncStorage.

## How data gets in

There is no market-data subscription. You screenshot your broker's positions
screen, and Claude reads it:

**Portfolio → Update from a screenshot** → pick the image → Claude transcribes
the rows → you review a diff of exactly what it thinks changed → apply.

Nothing is written to the book until you approve it, and any row Claude was
unsure about is flagged before you do.

**Applying an import starts the research automatically.** Every position that
moved goes into a queue, and Claude works through it one at a time: the latest
earnings call and what was said on it, analyst targets and revisions, and news
from the last month. You can also run one by hand from any stock page.

Every metric carries a **"?"** explaining what it is, how to read it, and where
it misleads — on table rows, section headings and chart captions alike. 70 on the
stock detail page, 95 entries in the glossary.

**More → AI insights** reads across the whole book: concentration, what the
positions have in common regardless of sector, and where the risk actually sits.
The figures there are computed locally and work without any API key.

## Two things worth knowing about

**Every stock page walks adjusted EBITDA down to free cash flow.** Adjusted
EBITDA → less stock-based compensation → cash EBITDA → less cash interest, cash
taxes and the working-capital move → operating cash flow → less capex → free cash
flow, drawn as a waterfall with the conversion rate, capex intensity and FCF
yield underneath. Stock comp is *deducted*, not added back — it is a real cost
paid in shares. If a line is missing the chain stops there rather than treating
the unknown as zero, because pretending an unknown deduction is nil would
overstate the cash.

**Market → Where this book could end up** runs a 5,000-path Monte Carlo over the
actual holdings and compares it to the S&P 500 over 1, 3, 5 or 10 years. Every
name is driven by one shared market factor scaled by its beta plus its own
independent noise, so the positions fall together instead of behaving like 14
independent bets, and the benchmark is simulated from the same market draws so
the "beats the index" figure is a genuine path-by-path comparison. Expected
returns come from CAPM or from analyst targets — you can switch — and the
per-holding weight, beta, return and volatility that went in are all on screen.

## Verify it yourself

```bash
npm run typecheck        # strict TypeScript, no errors
npm test                 # 64 tests over the analytics, cash flow, simulation, merge and glossary
npm run build:web        # produces dist/
npx serve dist -l 8080 -s
npm run verify:screenshots   # every route, both themes, two iPhone widths
npm run verify:interaction   # projection, leg toggling, navigation, no-key path
npm run verify:features      # metric explainers, insights, sentiment card
npm run verify:simulation    # Monte Carlo horizons and basis, the FCF bridge
npm run build:pages          # the GitHub Pages build, base path and PWA shell
npm run verify:pwa           # installable, routable, remembers the key
npm run verify:privacy       # no credentials or personal data in the build
```

`verify:privacy` runs in CI before anything is published, and fails the build
rather than shipping. The bundle is the real boundary — the seed data is
compiled into it, and a Pages site is publicly reachable on every plan, so
repository visibility controls none of what the app shows.

The browser-driven checks need Playwright's Chromium once
(`npx playwright install chromium`); they find it themselves after that, or take
`CHROME_PATH`. `npm run serve:web` is a dependency-free static server with the
same deep-link fallback the deployed site has — a plain static server answers
`/stock/META` with an empty 404 and every check dies on it.

`verify:simulation` presses the controls rather than just photographing them: it
switches horizon and return basis and asserts the median outcome actually moves,
expands the per-holding input table, and checks that a fund with no cash-flow
statement hides the bridge instead of rendering an empty one.

## Layout

```
CLAUDE.md             context for anyone (or anything) picking this up cold
app/                  expo-router routes (screens)
  (tabs)/             Portfolio · Stocks · Sectors · Plan · More
  stock/[ticker]      the deep per-stock page
  sync                screenshot import
  insights            portfolio-level read
src/
  domain/             pure analytics — no React, fully unit tested
    technicals.ts     RSI, moving averages, +DI/−DI, the 0–5 trend score
    valuation.ts      cheap / fair / expensive against a stock's own history
    portfolio.ts      positions, sector buckets, attribution, concentration
    plan.ts           tranche projection against the cash floor and position cap
    insights.ts       portfolio-level metrics: concentration, breadth, event risk
    cashflow.ts       the adjusted-EBITDA to free-cash-flow walk
    montecarlo.ts     single-factor path simulation of the book against the S&P
    glossary.ts       plain-English explanation behind every "?" 
  data/
    provider/claude.ts   screenshot reading + per-stock research
    claudeSync.ts        merge rules (a null never overwrites a known value)
    seed/                the bundled starting dataset
    store.ts             persisted app state
  components/         UI primitives and hand-drawn SVG charts
  theme/              light and dark palettes
docs/
  PUBLISH-FROM-PHONE.md  phone-only route, written for a first-time GitHub user
  IPHONE-NO-COMPUTER.md  the same route, short version
  IPHONE.md           getting it onto an iPhone, from clone to TestFlight
  HANDOFF.md          what was built, what it costs, what is missing
  DATA.md             where every number comes from
```

See `docs/HANDOFF.md` for the full picture, including the seed-data caveat.
