# Portfolio Brief

An iPhone app for a single owner's ~$100K US equities book. It replaces the daily
HTML "Portfolio Brief" report with something you open on your phone: account
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

The analytical layer — multiples, reported figures, quality metrics, the
write-up — is researched per stock on demand: open a stock, tap **Re-research
with Claude**. That call uses web search, so the figures are current rather than
recalled.

## Verify it yourself

```bash
npm run typecheck        # strict TypeScript, no errors
npm test                 # 26 tests over the analytics and merge logic
npm run build:web        # produces dist/
npx serve dist -l 8080 -s
npm run verify:screenshots   # every route, both themes, two iPhone widths
npm run verify:interaction   # projection, leg toggling, navigation, no-key path
```

## Layout

```
app/                  expo-router routes (screens)
  (tabs)/             Portfolio · Stocks · Sectors · Plan · More
  stock/[ticker]      the deep per-stock page
  sync                screenshot import
src/
  domain/             pure analytics — no React, fully unit tested
    technicals.ts     RSI, moving averages, +DI/−DI, the 0–5 trend score
    valuation.ts      cheap / fair / expensive against a stock's own history
    portfolio.ts      positions, sector buckets, attribution, concentration
    plan.ts           tranche projection against the cash floor and position cap
  data/
    provider/claude.ts   screenshot reading + per-stock research
    claudeSync.ts        merge rules (a null never overwrites a known value)
    seed/                the bundled starting dataset
    store.ts             persisted app state
  components/         UI primitives and hand-drawn SVG charts
  theme/              light and dark palettes
docs/
  HANDOFF.md          what was built, what it costs, what is missing
  DATA.md             where every number comes from
```

See `docs/HANDOFF.md` for the full picture, including the seed-data caveat.
