import type {
  AccountSnapshot,
  Holding,
  MarketSnapshot,
  PlanLeg,
  RebalancePlan,
  Settings,
} from '@/domain/types';
import { SEED_STOCKS } from './stocks';

/**
 * Seed portfolio. Clearly not the owner's real book — replace it in Settings →
 * Positions, or point `scripts/ingest.ts` at a broker export. Every number here
 * is internally consistent: the account tiles are derived from the holdings and
 * the seeded quotes rather than hard-coded, so editing a position updates them.
 */

export const SEED_HOLDINGS: Holding[] = [
  { ticker: 'META', shares: 11, costBasis: 590.2, sector: 'tech' },
  { ticker: 'MSFT', shares: 10, costBasis: 548.3, sector: 'tech' },
  { ticker: 'NOW', shares: 6, costBasis: 872.4, sector: 'tech' },
  { ticker: 'PLTR', shares: 100, costBasis: 68.4, sector: 'tech' },
  { ticker: 'TSSI', shares: 95, costBasis: 46.2, sector: 'tech' },
  { ticker: 'VST', shares: 30, costBasis: 176.5, sector: 'power' },
  { ticker: 'CEG', shares: 15, costBasis: 312.8, sector: 'power' },
  { ticker: 'FTAI', shares: 34, costBasis: 118.6, sector: 'industrials' },
  { ticker: 'BWXT', shares: 30, costBasis: 152.4, sector: 'industrials' },
  { ticker: 'LMT', shares: 10, costBasis: 542.1, sector: 'industrials' },
  { ticker: 'MCD', shares: 18, costBasis: 298.6, sector: 'consumer' },
  { ticker: 'MELI', shares: 2, costBasis: 2104.0, sector: 'consumer' },
  { ticker: 'SPGI', shares: 9, costBasis: 528.4, sector: 'financials' },
  { ticker: 'LLY', shares: 5, costBasis: 892.0, sector: 'healthcare' },
];

/** Non-USD balances are converted with these rates on the account screen. */
export const FX_TO_USD: Record<string, number> = { USD: 1, ILS: 0.275 };

export const SEED_CASH = [
  { currency: 'USD', amount: 18_420.0 },
  { currency: 'ILS', amount: 5_200.0 },
];

/**
 * Derive the account tiles from holdings + quotes so the numbers can never
 * drift apart from the positions they describe.
 */
export function deriveAccount(
  holdings: Holding[],
  stocks: typeof SEED_STOCKS,
  cash = SEED_CASH,
  realizedPnl = 4_318.6,
): AccountSnapshot {
  let marketValue = 0;
  let costValue = 0;
  let dayPnl = 0;
  for (const h of holdings) {
    const q = stocks[h.ticker]?.quote.value;
    if (!q) continue;
    marketValue += q.price * h.shares;
    costValue += h.costBasis * h.shares;
    dayPnl += q.change * h.shares;
  }
  const cashUsd = cash.reduce((s, c) => s + c.amount * (FX_TO_USD[c.currency] ?? 1), 0);
  const nlv = marketValue + cashUsd;
  const previousNlv = nlv - dayPnl;

  // A cash account with no borrowings: maintenance margin is a broker-style
  // 25% of long market value and buying power is 2x excess liquidity.
  const maintenanceMargin = marketValue * 0.25;
  const excessLiquidity = nlv - maintenanceMargin;

  return {
    netLiquidationValue: nlv,
    dayPnl,
    dayPnlPct: previousNlv === 0 ? 0 : (dayPnl / previousNlv) * 100,
    unrealizedPnl: marketValue - costValue,
    realizedPnl,
    marketValue,
    excessLiquidity,
    maintenanceMargin,
    buyingPower: excessLiquidity * 2,
    cash,
    asOf: '2026-08-18T20:15:00Z',
  };
}

export const SEED_ACCOUNT = deriveAccount(SEED_HOLDINGS, SEED_STOCKS);

// ---------------------------------------------------------------------------
// Rebalancing plan
// ---------------------------------------------------------------------------

function leg(
  id: string,
  tranche: PlanLeg['tranche'],
  ticker: string,
  action: PlanLeg['action'],
  shares: number | null,
  note: string,
): PlanLeg {
  const price = SEED_STOCKS[ticker]?.quote.value?.price ?? null;
  let estimatedCash: number | null = null;
  if (price != null && shares != null) {
    const signed = action === 'buy' ? -1 : 1;
    estimatedCash = signed * price * shares;
  }
  return { id, tranche, ticker, action, shares, estimatedCash, note, done: false, doneAt: null };
}

export const SEED_PLAN: RebalancePlan = {
  name: 'Three-tranche rebalance',
  summary:
    'Raise cash to the 30% floor, retire the two lowest-conviction positions, keep the power thesis but express it through contracted nuclear instead of merchant generation, and open three new positions in thirds rather than betting on a single entry price. Executed as of the close prices shown; re-price before trading.',
  constraints: {
    cashFloorPct: 0.3,
    maxPositionPct: 0.15,
    targetMix: {
      tech: 0.26,
      industrials: 0.16,
      consumer: 0.1,
      power: 0.08,
      financials: 0.05,
      healthcare: 0.05,
      cash: 0.3,
    },
  },
  legs: [
    // -- Tranche A: raise the cash, retire the weak names ------------------
    leg('a-pltr', 'A', 'PLTR', 'sell', 55, 'First of two legs. Staged across A and B so the realised gain lands in two settlement windows rather than one.'),
    leg('a-vst', 'A', 'VST', 'exit', 30, 'Full exit. Proceeds fund the Constellation add — same thesis, contracted rather than merchant.'),
    leg('a-tssi', 'A', 'TSSI', 'exit', 95, 'Full exit. Lowest conviction in the book and the chart has already broken.'),
    leg('a-now', 'A', 'NOW', 'buy', 2, 'First of three adds. Growth and margin expanding together.'),
    leg('a-ceg', 'A', 'CEG', 'buy', 3, 'First of two adds, funded by the Vistra exit.'),
    leg('a-isrg', 'A', 'ISRG', 'buy', 2, 'Open. Fills the thinnest sector bucket in the book.'),
    leg('a-amzn', 'A', 'AMZN', 'buy', 3, 'Open. Cheapest platform multiple available.'),
    leg('a-smh', 'A', 'SMH', 'buy', 2, 'Open. Sector exposure without a single-name bet.'),
    leg('a-meta', 'A', 'META', 'hold', null, 'Untouched. Cheapest in two years; no reason to sell into the drawdown.'),
    leg('a-ftai', 'A', 'FTAI', 'hold', null, 'Untouched and full-size. Eight quarters of margin expansion at a PEG under 1.'),
    leg('a-mcd', 'A', 'MCD', 'hold', null, 'No plan-driven change. Held for the yield and the 0.62 beta.'),
    leg('a-bwxt', 'A', 'BWXT', 'hold', null, 'No plan-driven change. Executing well but priced for it.'),
    leg('a-lmt', 'A', 'LMT', 'hold', null, 'No plan-driven change. Low-beta ballast.'),
    leg('a-spgi', 'A', 'SPGI', 'hold', null, 'No plan-driven change. Only financials exposure in the book.'),
    leg('a-lly', 'A', 'LLY', 'hold', null, 'No plan-driven change. Trim candidate in C if the 50-day breaks.'),

    // -- Tranche B: finish the exit, keep averaging in ---------------------
    leg('b-pltr', 'B', 'PLTR', 'sell', 45, 'Second and final leg of the exit. Completes the position wind-down.'),
    leg('b-now', 'B', 'NOW', 'buy', 1, 'Second add. Completes the ServiceNow build.'),
    leg('b-ceg', 'B', 'CEG', 'buy', 3, 'Second and final add.'),
    leg('b-isrg', 'B', 'ISRG', 'buy', 2, 'Second of three entries.'),
    leg('b-amzn', 'B', 'AMZN', 'buy', 3, 'Second of three entries.'),
    leg('b-smh', 'B', 'SMH', 'buy', 2, 'Second of three entries.'),

    // -- Tranche C: complete the new positions ----------------------------
    leg('c-isrg', 'C', 'ISRG', 'buy', 1, 'Final entry. Completes the Intuitive Surgical position.'),
    leg('c-amzn', 'C', 'AMZN', 'buy', 2, 'Final entry. Completes the Amazon position.'),
    leg('c-smh', 'C', 'SMH', 'buy', 1, 'Final entry. Sized to land the book just above the cash floor rather than exactly on it.'),
    leg('c-msft', 'C', 'MSFT', 'defer', null, 'Top-up deferred. The cash floor has first claim; conviction unchanged.'),
    leg('c-meli', 'C', 'MELI', 'defer', null, 'Top-up deferred for the same reason. First in line if C runs ahead of plan.'),
  ],
};

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

export const SEED_MARKET: MarketSnapshot = {
  asOf: '2026-08-18T20:15:00Z',
  instruments: [
    { symbol: 'SPX', name: 'S&P 500', kind: 'index', last: 6842.3, changePct: -0.62 },
    { symbol: 'DJI', name: 'Dow Jones', kind: 'index', last: 47_180.4, changePct: -0.34 },
    { symbol: 'IXIC', name: 'Nasdaq Composite', kind: 'index', last: 23_410.8, changePct: -0.88 },
    { symbol: 'SPY', name: 'SPDR S&P 500', kind: 'etf', last: 682.1, changePct: -0.61 },
    { symbol: 'QQQ', name: 'Invesco QQQ', kind: 'etf', last: 598.4, changePct: -0.86 },
    { symbol: 'SMH', name: 'VanEck Semiconductor', kind: 'etf', last: 328.4, changePct: 1.96 },
    { symbol: 'US10Y', name: 'US 10-year yield', kind: 'yield', last: 4.18, changePct: 0.72 },
    { symbol: 'US30Y', name: 'US 30-year yield', kind: 'yield', last: 4.74, changePct: 0.42 },
  ],
};

export const DEFAULT_SETTINGS: Settings = {
  // A free Alpha Vantage key allows 25 requests a day. The scheduler treats
  // this as a hard budget and prioritises accordingly.
  dailyCallBudget: 25,
  autoRefreshOnLaunch: true,
  backgroundRefreshEnabled: false,
  notificationsEnabled: false,
  biometricLockEnabled: false,
  alertOnTrendChange: true,
  alertOnOptionsFlip: true,
  alertOnEarningsWithinDays: 7,
};
