import type {
  DataSourceId,
  EarningsCall,
  FundamentalsSeries,
  Momentum,
  QualityMetrics,
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
  options: OptionsPositioning;
  /** Millions of USD, newest first (8 quarters). */
  revenue: (number | null)[];
  operatingIncome: (number | null)[];
  netIncome: (number | null)[];
  eps: (number | null)[];
  peHistory: (number | null)[];
  evEbitdaHistory: (number | null)[];
  psHistory: (number | null)[];
  earnings: EarningsCall;
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
    quality: (() => {
      const derived = deriveQuality(spec);
      return derived ? stamped(derived, seedAsOf, 'computed') : stamped<QualityMetrics>(null, null, 'unavailable');
    })(),
    momentum: spec.momentum
      ? stamped(spec.momentum, seedAsOf, 'seed')
      : stamped(deriveMomentum(spec), seedAsOf, 'computed'),
    options: stamped(spec.options, asOfFor('options'), pick('options')),
    earnings: stamped(spec.earnings, asOfFor('earnings'), pick('earnings')),
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
  managementSaid: null,
  guidance: null,
  watchNext: null,
};
