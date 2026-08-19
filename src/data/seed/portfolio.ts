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
 * Demo portfolio.
 *
 * These are not anyone's positions. The share counts, cost bases, cash and
 * realised P&L below are round invented numbers chosen to exercise the app:
 * a name at the position cap, a name well under it, a loss-making position, a
 * high-priced low-share-count name, and enough cash to sit below the floor so
 * the plan screen has something to solve.
 *
 * They are replaced wholesale the first time a broker screenshot is imported,
 * which is the point — nothing here is meant to survive first use, and nothing
 * here should be read as a real book.
 *
 * The tickers are widely held large caps used so the analytical screens have
 * real public companies to render. Every number stays internally consistent:
 * the account tiles are derived from the holdings and the seeded quotes rather
 * than hard-coded, so editing a position updates them.
 */

export const SEED_HOLDINGS: Holding[] = [
  { ticker: 'META', shares: 10, costBasis: 600.0, sector: 'tech' },
  { ticker: 'MSFT', shares: 10, costBasis: 550.0, sector: 'tech' },
  { ticker: 'NOW', shares: 5, costBasis: 900.0, sector: 'tech' },
  { ticker: 'PLTR', shares: 100, costBasis: 70.0, sector: 'tech' },
  { ticker: 'TSSI', shares: 100, costBasis: 50.0, sector: 'tech' },
  { ticker: 'VST', shares: 25, costBasis: 180.0, sector: 'power' },
  { ticker: 'CEG', shares: 15, costBasis: 320.0, sector: 'power' },
  { ticker: 'FTAI', shares: 30, costBasis: 120.0, sector: 'industrials' },
  { ticker: 'BWXT', shares: 30, costBasis: 150.0, sector: 'industrials' },
  { ticker: 'LMT', shares: 10, costBasis: 540.0, sector: 'industrials' },
  { ticker: 'MCD', shares: 20, costBasis: 300.0, sector: 'consumer' },
  { ticker: 'MELI', shares: 2, costBasis: 2100.0, sector: 'consumer' },
  { ticker: 'SPGI', shares: 10, costBasis: 530.0, sector: 'financials' },
  { ticker: 'LLY', shares: 5, costBasis: 900.0, sector: 'healthcare' },
];

/** Non-USD balances are converted with these rates on the account screen. */
/** A second currency so the multi-currency account tiles have something to convert. */
export const FX_TO_USD: Record<string, number> = { USD: 1, EUR: 1.08 };

export const SEED_CASH = [
  { currency: 'USD', amount: 15_000.0 },
  { currency: 'EUR', amount: 2_500.0 },
];

/**
 * Derive the account tiles from holdings + quotes so the numbers can never
 * drift apart from the positions they describe.
 */
export function deriveAccount(
  holdings: Holding[],
  stocks: typeof SEED_STOCKS,
  cash = SEED_CASH,
  realizedPnl = 5_000.0,
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

/**
 * Demo rebalance plan.
 *
 * Not anyone's strategy. It exists so the Plan screen has a realistic shape to
 * render and project against: three tranches, a cash floor the book currently
 * breaches, a position cap the largest holding sits just under, every action
 * type represented
 * (sell, exit, buy, hold, defer), and legs staged across tranches so marking
 * one done visibly moves the projection.
 *
 * Replace it with your own from the Plan screen. The notes below deliberately
 * explain the mechanic being demonstrated rather than argue an investment case,
 * because a made-up thesis presented in confident prose is exactly the kind of
 * thing this app is built not to do.
 */
export const SEED_PLAN: RebalancePlan = {
  name: 'Three-tranche rebalance',
  summary:
    'A worked example, not advice: raise cash back above the floor, close the two smallest positions, and open three new ones in thirds rather than at a single entry price. Every figure here is demo data — re-price and re-reason before trading anything.',
  constraints: {
    cashFloorPct: 0.25,
    maxPositionPct: 0.16,
    targetMix: {
      tech: 0.24,
      industrials: 0.16,
      consumer: 0.1,
      power: 0.1,
      financials: 0.08,
      healthcare: 0.07,
      cash: 0.25,
    },
  },
  legs: [
    // -- Tranche A: raise cash, close the smallest positions ---------------
    leg('a-pltr', 'A', 'PLTR', 'sell', 50, 'Demo: a partial sell split across two tranches, so the plan screen shows a position winding down in stages rather than at once.'),
    leg('a-vst', 'A', 'VST', 'exit', 25, 'Demo: a full exit. Shows how the projection frees cash and empties a sector bucket.'),
    leg('a-tssi', 'A', 'TSSI', 'exit', 100, 'Demo: a second full exit, to show two closures landing in the same tranche.'),
    leg('a-now', 'A', 'NOW', 'buy', 2, 'Demo: the first of three adds, to show a position being built rather than opened at one price.'),
    leg('a-ceg', 'A', 'CEG', 'buy', 3, 'Demo: an add funded by an exit in the same tranche.'),
    leg('a-isrg', 'A', 'ISRG', 'buy', 2, 'Demo: opening a watchlist name — a position with no share count behind it until now.'),
    leg('a-amzn', 'A', 'AMZN', 'buy', 3, 'Demo: a second watchlist name being opened.'),
    leg('a-smh', 'A', 'SMH', 'buy', 2, 'Demo: an ETF leg, which has no P/E or earnings and so renders the empty states.'),
    leg('a-meta', 'A', 'META', 'hold', null, 'Demo: a hold with no share change, to show untouched names still listed.'),
    leg('a-ftai', 'A', 'FTAI', 'hold', null, 'Demo: another hold.'),
    leg('a-mcd', 'A', 'MCD', 'hold', null, 'Demo: another hold.'),
    leg('a-bwxt', 'A', 'BWXT', 'hold', null, 'Demo: another hold.'),
    leg('a-lmt', 'A', 'LMT', 'hold', null, 'Demo: another hold.'),
    leg('a-spgi', 'A', 'SPGI', 'hold', null, 'Demo: another hold.'),
    leg('a-lly', 'A', 'LLY', 'hold', null, 'Demo: another hold.'),

    // -- Tranche B: finish the wind-down, keep averaging in ----------------
    leg('b-pltr', 'B', 'PLTR', 'sell', 50, 'Demo: the second half of the staged sell, completing the wind-down.'),
    leg('b-now', 'B', 'NOW', 'buy', 1, 'Demo: the second add, completing this position.'),
    leg('b-ceg', 'B', 'CEG', 'buy', 3, 'Demo: the second and final add here.'),
    leg('b-isrg', 'B', 'ISRG', 'buy', 2, 'Demo: the second of three entries.'),
    leg('b-amzn', 'B', 'AMZN', 'buy', 3, 'Demo: the second of three entries.'),
    leg('b-smh', 'B', 'SMH', 'buy', 2, 'Demo: the second of three entries.'),

    // -- Tranche C: complete the new positions -----------------------------
    leg('c-isrg', 'C', 'ISRG', 'buy', 1, 'Demo: the final entry, completing the position.'),
    leg('c-amzn', 'C', 'AMZN', 'buy', 2, 'Demo: the final entry, completing the position.'),
    leg('c-smh', 'C', 'SMH', 'buy', 1, 'Demo: sized so the book lands just above the cash floor rather than exactly on it.'),
    leg('c-msft', 'C', 'MSFT', 'defer', null, 'Demo: a deferred leg, to show the "defer" action and a constraint taking priority.'),
    leg('c-meli', 'C', 'MELI', 'defer', null, 'Demo: a second deferred leg.'),
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
