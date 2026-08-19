import type {
  DataSourceId,
  EarningsCall,
  FundamentalsSeries,
  CashFlowBridge,
  Momentum,
  QualityMetrics,
  Sentiment,
  MultipleHistory,
  Narrative,
  OptionsPositioning,
  PrimaryMultiple,
  QuarterPoint,
  Quote,
  SectorId,
  Stamped,
  Stock,
  Technicals,
  ValuationSnapshot,
} from '@/domain/types';
import { quarterLabel } from '@/domain/format';

/** Calendar quarter ends, newest first. Seed series are indexed off this. */
export const QUARTER_ENDS = [
  '2026-06-30',
  '2026-03-31',
  '2025-12-31',
  '2025-09-30',
  '2025-06-30',
  '2025-03-31',
  '2024-12-31',
  '2024-09-30',
  '2024-06-30',
  '2024-03-31',
];

export function series(values: (number | null)[]): QuarterPoint[] {
  return values.map((value, i) => {
    const period = QUARTER_ENDS[i] ?? QUARTER_ENDS[QUARTER_ENDS.length - 1]!;
    return { period, label: quarterLabel(period), value };
  });
}

export function stamped<T>(value: T | null, asOf: string | null, source: DataSourceId): Stamped<T> {
  return { value, asOf, source };
}

export interface StockSpec {
  ticker: string;
  name: string;
  sector: SectorId;
  isEtf?: boolean;
  watchlistOnly?: boolean;
  primaryMultiple: PrimaryMultiple;
  peerGroup: string | null;
  peerMedianMultiple: number | null;
  /** [price, previousClose, volume] */
  quote: [number, number, number | null];
  tradingDay: string;
  valuation: ValuationSnapshot;
  technicals: Technicals;
  quality?: QualityMetrics;
  momentum?: Momentum;
  /** Which cash-flow shape this business has. Drives the seeded bridge. */
  cashFlowProfile?: CashFlowProfile;
  /** Explicit lines override anything the profile would derive. */
  cashFlow?: Partial<CashFlowBridge>;
  options: OptionsPositioning;
  /** Millions of USD, newest first (8 quarters). */
  revenue: (number | null)[];
  operatingIncome: (number | null)[];
  netIncome: (number | null)[];
  eps: (number | null)[];
  peHistory: (number | null)[];
  evEbitdaHistory: (number | null)[];
  psHistory: (number | null)[];
  earnings: Partial<EarningsCall>;
  narrative: Narrative;
  nextEarningsDate: string | null;
  /** Per-block provenance. Anything absent falls back to `seed`. */
  sources?: Partial<Record<
    'quote' | 'valuation' | 'technicals' | 'options' | 'earnings' | 'fundamentals' | 'multipleHistory',
    DataSourceId
  >>;
  /** When the live blocks were fetched. */
  liveAsOf?: string;
  narrativeAsOf?: string;
}

const MILLION = 1_000_000;

export function buildStock(spec: StockSpec, seedAsOf: string): Stock {
  const src = spec.sources ?? {};
  const pick = (k: keyof NonNullable<StockSpec['sources']>): DataSourceId => src[k] ?? 'seed';
  const asOfFor = (k: keyof NonNullable<StockSpec['sources']>): string =>
    src[k] === 'alphavantage' ? (spec.liveAsOf ?? seedAsOf) : seedAsOf;

  const [price, previousClose, volume] = spec.quote;
  const change = price - previousClose;
  const quote: Quote = {
    price,
    previousClose,
    change,
    changePct: previousClose === 0 ? 0 : (change / previousClose) * 100,
    volume,
    tradingDay: spec.tradingDay,
  };

  const fundamentals: FundamentalsSeries = {
    revenue: series(spec.revenue.map((v) => (v == null ? null : v * MILLION))),
    operatingIncome: series(spec.operatingIncome.map((v) => (v == null ? null : v * MILLION))),
    netIncome: series(spec.netIncome.map((v) => (v == null ? null : v * MILLION))),
    eps: series(spec.eps),
  };

  const multipleHistory: MultipleHistory = {
    peHistory: series(spec.peHistory),
    evEbitdaHistory: series(spec.evEbitdaHistory),
    psHistory: series(spec.psHistory),
  };

  return {
    ticker: spec.ticker,
    name: spec.name,
    sector: spec.sector,
    isEtf: spec.isEtf ?? false,
    watchlistOnly: spec.watchlistOnly ?? false,
    primaryMultiple: spec.primaryMultiple,
    peerGroup: spec.peerGroup,
    peerMedianMultiple: spec.peerMedianMultiple,
    quote: stamped(quote, asOfFor('quote'), pick('quote')),
    valuation: stamped(spec.valuation, asOfFor('valuation'), pick('valuation')),
    technicals: stamped(spec.technicals, asOfFor('technicals'), pick('technicals')),
    cashFlow: (() => {
      const bridge = deriveCashFlow(spec);
      return bridge
        ? stamped(bridge, seedAsOf, spec.cashFlow ? 'seed' : 'computed')
        : stamped<CashFlowBridge>(null, null, 'unavailable');
    })(),
    quality: (() => {
      const derived = deriveQuality(spec);
      return derived ? stamped(derived, seedAsOf, 'computed') : stamped<QualityMetrics>(null, null, 'unavailable');
    })(),
    momentum: spec.momentum
      ? stamped(spec.momentum, seedAsOf, 'seed')
      : stamped(deriveMomentum(spec), seedAsOf, 'computed'),
    options: stamped(spec.options, asOfFor('options'), pick('options')),
    earnings: stamped({ ...EMPTY_EARNINGS, ...spec.earnings }, asOfFor('earnings'), pick('earnings')),
    // Sentiment is coverage-based and has no offline equivalent, so it stays
    // empty until a research pass fills it rather than being seeded.
    sentiment: stamped<Sentiment>(null, null, 'unavailable'),
    fundamentals: stamped(
      spec.revenue.length ? fundamentals : null,
      spec.revenue.length ? asOfFor('fundamentals') : null,
      spec.revenue.length ? pick('fundamentals') : 'unavailable',
    ),
    multipleHistory: stamped(
      spec.peHistory.length ? multipleHistory : null,
      spec.peHistory.length ? asOfFor('multipleHistory') : null,
      spec.peHistory.length ? pick('multipleHistory') : 'unavailable',
    ),
    narrative: spec.narrative,
    narrativeAsOf: spec.narrativeAsOf ?? seedAsOf,
    nextEarningsDate: spec.nextEarningsDate,
  };
}

/**
 * Cash-flow shapes.
 *
 * Every figure is expressed as a share of adjusted EBITDA, which is what makes
 * the profiles comparable: a power utility and a software company differ far
 * more in where EBITDA leaks than in how much of it they report. `da` is
 * depreciation and amortisation as a share of operating income, used to get
 * from reported operating income back up to EBITDA.
 *
 * These are seed shapes, replaced the first time Claude researches the name.
 */
export type CashFlowProfile =
  | 'software'
  | 'aiHyperscaler'
  | 'power'
  | 'industrial'
  | 'consumer'
  | 'pharma'
  | 'smallCap';

const PROFILES: Record<
  CashFlowProfile,
  { da: number; sbc: number; interest: number; taxes: number; wc: number; capex: number }
> = {
  // Asset-light, pays its people in stock, almost no capex.
  software: { da: 0.14, sbc: 0.22, interest: 0.02, taxes: 0.14, wc: 0.02, capex: 0.1 },
  // Same economics, except capex has become the whole story.
  aiHyperscaler: { da: 0.26, sbc: 0.2, interest: 0.03, taxes: 0.11, wc: 0.02, capex: 0.57 },
  // Capital is the business: heavy plant, heavy debt.
  power: { da: 0.42, sbc: 0.01, interest: 0.18, taxes: 0.1, wc: 0.03, capex: 0.55 },
  industrial: { da: 0.2, sbc: 0.03, interest: 0.1, taxes: 0.15, wc: 0.05, capex: 0.22 },
  consumer: { da: 0.16, sbc: 0.02, interest: 0.12, taxes: 0.17, wc: 0.01, capex: 0.2 },
  pharma: { da: 0.18, sbc: 0.06, interest: 0.05, taxes: 0.13, wc: 0.06, capex: 0.18 },
  // Small caps fund growth out of working capital more than out of plant.
  smallCap: { da: 0.1, sbc: 0.08, interest: 0.06, taxes: 0.12, wc: 0.18, capex: 0.12 },
};

function deriveCashFlow(spec: StockSpec): CashFlowBridge | null {
  const explicit = spec.cashFlow;
  const profileName = spec.cashFlowProfile;
  if (!explicit && !profileName) return null;

  const ttmOperating = spec.operatingIncome
    .slice(0, 4)
    .reduce<number | null>((sum, v) => (sum == null || v == null ? null : sum + v), 0);

  const profile = profileName ? PROFILES[profileName] : null;
  const derivedEbitda =
    ttmOperating != null && profile != null ? ttmOperating * MILLION * (1 + profile.da) : null;
  const adjustedEbitda = explicit?.adjustedEbitda ?? derivedEbitda;
  if (adjustedEbitda == null) return null;

  const share = (k: keyof NonNullable<typeof profile>) =>
    profile ? Math.round(adjustedEbitda * profile[k]) : null;

  const bridge: CashFlowBridge = {
    adjustedEbitda,
    stockBasedCompensation: explicit?.stockBasedCompensation ?? share('sbc'),
    cashInterest: explicit?.cashInterest ?? share('interest'),
    cashTaxes: explicit?.cashTaxes ?? share('taxes'),
    workingCapitalChange: explicit?.workingCapitalChange ?? share('wc'),
    capitalExpenditure: explicit?.capitalExpenditure ?? share('capex'),
    otherItems: explicit?.otherItems ?? null,
    operatingCashFlow: explicit?.operatingCashFlow ?? null,
    freeCashFlow: explicit?.freeCashFlow ?? null,
  };

  // Fill the two reported cross-checks from the walk itself when the spec did
  // not supply them, so the card always has something to compare against.
  const afterOperating =
    bridge.stockBasedCompensation != null &&
    bridge.cashInterest != null &&
    bridge.cashTaxes != null &&
    bridge.workingCapitalChange != null
      ? adjustedEbitda -
        bridge.stockBasedCompensation -
        bridge.cashInterest -
        bridge.cashTaxes -
        bridge.workingCapitalChange
      : null;
  bridge.operatingCashFlow = bridge.operatingCashFlow ?? afterOperating;
  bridge.freeCashFlow =
    bridge.freeCashFlow ??
    (afterOperating != null && bridge.capitalExpenditure != null
      ? afterOperating - bridge.capitalExpenditure
      : null);

  return bridge;
}

/**
 * Growth is derived from the reported series rather than seeded, so it can
 * never disagree with the charts above it. Balance-sheet ratios that the series
 * cannot produce are taken from the spec, and anything neither source has stays
 * null — the detail screen prints an em dash rather than a guess.
 */
function deriveQuality(spec: StockSpec): QualityMetrics | null {
  const yoy = (series: (number | null)[]): number | null => {
    const now = series[0];
    const then = series[4];
    if (now == null || then == null || then === 0) return null;
    return (now / then - 1) * 100;
  };

  const revenueGrowthYoY = yoy(spec.revenue);
  const epsGrowthYoY = yoy(spec.eps);
  const base = spec.quality;
  if (!base && revenueGrowthYoY == null && epsGrowthYoY == null) return null;

  return {
    returnOnEquity: base?.returnOnEquity ?? null,
    returnOnInvestedCapital: base?.returnOnInvestedCapital ?? null,
    grossMargin: base?.grossMargin ?? null,
    freeCashFlowMargin: base?.freeCashFlowMargin ?? null,
    netDebtToEbitda: base?.netDebtToEbitda ?? null,
    revenueCagr3y: base?.revenueCagr3y ?? null,
    revenueGrowthYoY: base?.revenueGrowthYoY ?? revenueGrowthYoY,
    epsGrowthYoY: base?.epsGrowthYoY ?? epsGrowthYoY,
    insiderOwnershipPct: base?.insiderOwnershipPct ?? null,
    institutionalOwnershipPct: base?.institutionalOwnershipPct ?? null,
    shareCountChangePct: base?.shareCountChangePct ?? null,
  };
}

/**
 * With no price history in the seed, the only momentum windows that can be
 * stated honestly are the ones the 52-week range and the published 52-week
 * change already imply. The rest stay null until a research refresh fills them.
 */
function deriveMomentum(spec: StockSpec): Momentum {
  const [price] = spec.quote;
  const hi = spec.valuation.week52High;
  const lo = spec.valuation.week52Low;
  return {
    oneMonth: null,
    threeMonth: null,
    sixMonth: null,
    oneYear: spec.valuation.week52ChangePct,
    yearToDate: null,
    fromHighPct: hi != null && hi > 0 ? ((price - hi) / hi) * 100 : null,
    fromLowPct: lo != null && lo > 0 ? ((price - lo) / lo) * 100 : null,
  };
}

/** Convenience for the many "no data at all" valuation blocks (ETFs). */
export const EMPTY_VALUATION: ValuationSnapshot = {
  trailingPe: null,
  forwardPe: null,
  priceToSales: null,
  evToEbitda: null,
  peg: null,
  profitMargin: null,
  operatingMargin: null,
  shortInterestPct: null,
  beta: null,
  week52ChangePct: null,
  dividendYield: null,
  analystTargetPrice: null,
  analystRating: null,
  week52High: null,
  week52Low: null,
  debtToEquity: null,
};

export const EMPTY_EARNINGS: EarningsCall = {
  date: null,
  quarter: null,
  reportedEps: null,
  estimatedEps: null,
  surprisePct: null,
  revenue: null,
  callSummary: null,
  managementSaid: null,
  guidance: null,
  watchNext: null,
  reactionPct: null,
  quotes: [],
};
