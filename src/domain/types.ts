/**
 * Domain model for the Portfolio Brief app.
 *
 * Every field that can go stale independently carries its own `asOf` stamp via
 * `Stamped<T>`, so a screen can show live prices next to week-old fundamentals
 * and say so honestly instead of implying one freshness for the whole record.
 */

/** ISO-8601 date (YYYY-MM-DD) or full timestamp. */
export type IsoDate = string;

/** A value plus provenance. `null` value means "never fetched / not available". */
export interface Stamped<T> {
  value: T | null;
  asOf: IsoDate | null;
  source: DataSourceId;
}

export type DataSourceId =
  | 'alphavantage'
  | 'computed'
  | 'seed'
  | 'manual'
  | 'unavailable';

export type SectorId =
  | 'tech'
  | 'industrials'
  | 'consumer'
  | 'power'
  | 'financials'
  | 'healthcare'
  | 'cash';

export const SECTORS: { id: SectorId; label: string; short: string }[] = [
  { id: 'tech', label: 'Tech / AI & Software', short: 'Tech/AI' },
  { id: 'industrials', label: 'Industrials / Defense & Aero', short: 'Defense' },
  { id: 'consumer', label: 'Consumer', short: 'Consumer' },
  { id: 'power', label: 'Power / Nuclear', short: 'Power' },
  { id: 'financials', label: 'Financials', short: 'Financials' },
  { id: 'healthcare', label: 'Healthcare', short: 'Health' },
  { id: 'cash', label: 'Cash', short: 'Cash' },
];

export type Verdict = 'buy' | 'add' | 'hold' | 'trim' | 'sell' | 'challenge' | 'watch';

export type TrendLabel =
  | 'Strong uptrend'
  | 'Uptrend'
  | 'Mild uptrend'
  | 'Mixed'
  | 'Mild downtrend'
  | 'Downtrend'
  | 'Strong downtrend';

export type OptionsRead = 'bullish' | 'neutral' | 'bearish';

export type ValuationBand = 'cheap' | 'fair' | 'expensive';

/** Which multiple is the honest one to lead with for this business. */
export type PrimaryMultiple = 'evEbitda' | 'forwardPe' | 'trailingPe' | 'ps';

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export interface CashByCurrency {
  currency: string;
  amount: number;
}

export interface AccountSnapshot {
  netLiquidationValue: number;
  dayPnl: number;
  dayPnlPct: number;
  unrealizedPnl: number;
  realizedPnl: number;
  marketValue: number;
  excessLiquidity: number;
  maintenanceMargin: number;
  buyingPower: number;
  cash: CashByCurrency[];
  asOf: IsoDate;
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

export interface Holding {
  ticker: string;
  shares: number;
  /** Average cost per share. Drives unrealised P&L when prices refresh. */
  costBasis: number;
  sector: SectorId;
}

// ---------------------------------------------------------------------------
// Per-stock data
// ---------------------------------------------------------------------------

export interface Quote {
  price: number;
  previousClose: number;
  change: number;
  changePct: number;
  volume: number | null;
  /** Trading day the price belongs to (not the fetch time). */
  tradingDay: IsoDate;
}

export interface ValuationSnapshot {
  trailingPe: number | null;
  forwardPe: number | null;
  priceToSales: number | null;
  evToEbitda: number | null;
  peg: number | null;
  profitMargin: number | null;
  operatingMargin: number | null;
  shortInterestPct: number | null;
  beta: number | null;
  week52ChangePct: number | null;
  dividendYield: number | null;
  analystTargetPrice: number | null;
  analystRating: string | null;
  week52High: number | null;
  week52Low: number | null;
  debtToEquity: number | null;
}

export interface QuarterPoint {
  /** Fiscal quarter end, e.g. "2026-06-30". */
  period: IsoDate;
  /** Display label, e.g. "Q2 26". */
  label: string;
  value: number | null;
}

/** 8 quarters of reported results, straight off the income statement. */
export interface FundamentalsSeries {
  revenue: QuarterPoint[];
  operatingIncome: QuarterPoint[];
  netIncome: QuarterPoint[];
  eps: QuarterPoint[];
}

/**
 * 10 quarters of valuation multiples. These are *derived* (quarter-end price
 * over trailing earnings / EBITDA) rather than published, so they carry their
 * own stamp separate from the reported fundamentals above.
 */
export interface MultipleHistory {
  peHistory: QuarterPoint[];
  evEbitdaHistory: QuarterPoint[];
  psHistory: QuarterPoint[];
}

/**
 * The walk from adjusted EBITDA down to free cash flow.
 *
 * All figures are trailing twelve months, in USD, and signed as they appear in
 * the bridge: `adjustedEbitda` is positive, every deduction below it is stored
 * as a positive number and subtracted. `freeCashFlow` is stored rather than
 * always derived, because a company's own reported FCF is worth showing next to
 * the walk that tries to reach it.
 */
export interface CashFlowBridge {
  adjustedEbitda: number | null;
  /** Non-cash, but a real cost to owners — added back in adj EBITDA, so removed here. */
  stockBasedCompensation: number | null;
  cashInterest: number | null;
  cashTaxes: number | null;
  /** Positive means working capital consumed cash. */
  workingCapitalChange: number | null;
  capitalExpenditure: number | null;
  /** Anything the standard lines above do not capture; signed. */
  otherItems: number | null;
  /** Reported operating cash flow, when available, as a cross-check. */
  operatingCashFlow: number | null;
  /** Reported free cash flow, when available. */
  freeCashFlow: number | null;
}

/**
 * Quality and balance-sheet health. These answer "is this a good business?"
 * separately from "is it cheaply priced?" — the two questions the valuation
 * card alone cannot separate.
 */
export interface QualityMetrics {
  returnOnEquity: number | null;
  returnOnInvestedCapital: number | null;
  grossMargin: number | null;
  freeCashFlowMargin: number | null;
  /** Net debt / EBITDA. Negative means net cash. */
  netDebtToEbitda: number | null;
  /** Revenue compound annual growth over the last three years, percent. */
  revenueCagr3y: number | null;
  revenueGrowthYoY: number | null;
  epsGrowthYoY: number | null;
  /** Percent of shares held by insiders and by institutions. */
  insiderOwnershipPct: number | null;
  institutionalOwnershipPct: number | null;
  /** Net change in share count over a year, percent. Negative = buybacks. */
  shareCountChangePct: number | null;
}

/** Price performance over standard windows, in percent. */
export interface Momentum {
  oneMonth: number | null;
  threeMonth: number | null;
  sixMonth: number | null;
  oneYear: number | null;
  yearToDate: number | null;
  /** Percent below the 52-week high — the drawdown the owner is sitting in. */
  fromHighPct: number | null;
  /** Percent above the 52-week low. */
  fromLowPct: number | null;
}

export interface Technicals {
  rsi14: number | null;
  rsi20: number | null;
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  plusDi: number | null;
  minusDi: number | null;
}

/** A single piece of coverage Claude found while researching. */
export interface NewsItem {
  headline: string;
  source: string | null;
  date: IsoDate | null;
  url: string | null;
  /** -1 (clearly negative) to +1 (clearly positive). */
  sentiment: number | null;
  /** Why it matters to a holder, in one line. */
  soWhat: string | null;
}

/**
 * How the market is currently talking about this name. Distinct from options
 * positioning, which is what the market is *doing* with money.
 */
export interface Sentiment {
  /** -1 to +1, weighted across recent coverage. */
  score: number | null;
  label: 'very negative' | 'negative' | 'mixed' | 'positive' | 'very positive' | null;
  /** One paragraph on what is driving the tone right now. */
  summary: string | null;
  /** Analyst target and rating movement since the last quarter. */
  analystRevisions: string | null;
  headlines: NewsItem[];
}

export interface OptionsPositioning {
  /** Whole-chain put/call ratio by volume. */
  putCallVolume: number | null;
  /** Whole-chain put/call ratio by open interest. */
  putCallOpenInterest: number | null;
}

export interface EarningsCall {
  date: IsoDate | null;
  /** e.g. "Q2 FY2026". */
  quarter: string | null;
  reportedEps: number | null;
  estimatedEps: number | null;
  surprisePct: number | null;
  revenue: number | null;
  /** What management actually said — quotes and specific figures. */
  managementSaid: string | null;
  /** Forward guidance given on the call. */
  guidance: string | null;
  /** What to listen for next quarter. */
  watchNext: string | null;
  /** Two or three sentences summarising the call as a whole. */
  callSummary: string | null;
  /** Verbatim lines worth keeping, each attributed to a speaker. */
  quotes: { speaker: string; text: string }[];
  /** How the shares reacted on the day, in percent. */
  reactionPct: number | null;
}

/**
 * Judgement fields. These are curated rather than computed — see
 * docs/DATA.md for why, and `narrativeAsOf` for how stale they are.
 */
export interface Narrative {
  catalyst: string | null;
  risk: string | null;
  verdict: Verdict;
  verdictReasoning: string | null;
  /** One-line thesis shown on the list row. */
  thesis: string | null;
  /** The strongest case each way, stated without hedging. */
  bullCase: string | null;
  bearCase: string | null;
  /** The specific observation that would flip the verdict. */
  whatWouldChangeMyMind: string | null;
}

export interface Stock {
  ticker: string;
  name: string;
  sector: SectorId;
  /** ETFs skip P/E, EPS, earnings calls and verdicts. */
  isEtf: boolean;
  /** True when the position is watchlist-only (no shares held). */
  watchlistOnly: boolean;
  /** Which multiple leads the valuation card for this business. */
  primaryMultiple: PrimaryMultiple;
  /** Peer group label used in the valuation-vs-sector line. */
  peerGroup: string | null;
  /** Median of `primaryMultiple` across the peer group, when known. */
  peerMedianMultiple: number | null;

  quote: Stamped<Quote>;
  valuation: Stamped<ValuationSnapshot>;
  fundamentals: Stamped<FundamentalsSeries>;
  multipleHistory: Stamped<MultipleHistory>;
  technicals: Stamped<Technicals>;
  quality: Stamped<QualityMetrics>;
  cashFlow: Stamped<CashFlowBridge>;
  momentum: Stamped<Momentum>;
  options: Stamped<OptionsPositioning>;
  sentiment: Stamped<Sentiment>;
  earnings: Stamped<EarningsCall>;
  narrative: Narrative;
  narrativeAsOf: IsoDate | null;
  /** Next scheduled report date, when known. */
  nextEarningsDate: IsoDate | null;
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

export interface MarketInstrument {
  symbol: string;
  name: string;
  kind: 'index' | 'etf' | 'yield';
  last: number | null;
  changePct: number | null;
}

export interface MarketSnapshot {
  instruments: MarketInstrument[];
  asOf: IsoDate | null;
}

// ---------------------------------------------------------------------------
// Rebalancing plan
// ---------------------------------------------------------------------------

export type TrancheId = 'A' | 'B' | 'C';

export type LegAction = 'buy' | 'sell' | 'exit' | 'hold' | 'defer';

export interface PlanLeg {
  id: string;
  tranche: TrancheId;
  ticker: string;
  action: LegAction;
  /** Share count. `null` for "whole position" exits or for hold/defer legs. */
  shares: number | null;
  /** Estimated cash impact in USD; negative = cash out (a buy). */
  estimatedCash: number | null;
  note: string;
  done: boolean;
  doneAt: IsoDate | null;
}

export interface PlanConstraints {
  /** Minimum cash as a share of NLV, e.g. 0.30. */
  cashFloorPct: number;
  /** Maximum single position as a share of NLV, e.g. 0.15. */
  maxPositionPct: number;
  /** Target sector mix as shares of NLV. */
  targetMix: Record<SectorId, number>;
}

export interface RebalancePlan {
  name: string;
  constraints: PlanConstraints;
  legs: PlanLeg[];
  /** Free-text rationale shown at the top of the action board. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Snapshots (history)
// ---------------------------------------------------------------------------

export interface PortfolioSnapshot {
  date: IsoDate;
  netLiquidationValue: number;
  dayPnl: number;
  /** Per-ticker trend score at the time, for the trend-history view. */
  trendScores: Record<string, number>;
  verdicts: Record<string, Verdict>;
}

// ---------------------------------------------------------------------------
// Refresh bookkeeping
// ---------------------------------------------------------------------------

export type RefreshStatus = 'idle' | 'running' | 'ok' | 'partial' | 'failed';

export interface RefreshLogEntry {
  at: IsoDate;
  status: RefreshStatus;
  callsUsed: number;
  /** Human-readable per-symbol outcomes, newest first. */
  messages: string[];
}

export interface RefreshState {
  status: RefreshStatus;
  lastRunAt: IsoDate | null;
  lastSuccessAt: IsoDate | null;
  /** Calls spent against today's budget; resets on a new UTC day. */
  callsUsedToday: number;
  budgetDay: IsoDate | null;
  log: RefreshLogEntry[];
  /** Symbols whose fundamentals are queued but not yet refreshed. */
  pending: string[];
}

export interface Settings {
  /** Requests allowed per day. Free Alpha Vantage keys get 25. */
  dailyCallBudget: number;
  /** Refresh automatically when the app opens and a day has passed. */
  autoRefreshOnLaunch: boolean;
  /** Register the OS background task (needs a dev/production build). */
  backgroundRefreshEnabled: boolean;
  notificationsEnabled: boolean;
  biometricLockEnabled: boolean;
  /** Absolute RSI/MA thresholds that fire an alert when crossed. */
  alertOnTrendChange: boolean;
  alertOnOptionsFlip: boolean;
  alertOnEarningsWithinDays: number;
}
