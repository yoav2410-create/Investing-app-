import type {
  FundamentalsSeries,
  Holding,
  Momentum,
  MultipleHistory,
  QualityMetrics,
  Technicals,
  QuarterPoint,
  Quote,
  SectorId,
  Stamped,
  Stock,
  ValuationSnapshot,
} from '@/domain/types';
import { nowIso, quarterLabel } from '@/domain/format';
import type { HoldingDiff, ParsedPosition, ResearchResult } from './provider/claude';

/**
 * Merging Claude's output into the app's state.
 *
 * Kept as pure functions away from the store so the merge rules are testable
 * and so the two hard rules are enforced in one place:
 *
 *   1. A null from Claude never overwrites a value the app already has. The
 *      model returning null means "I could not read/find this", not "this is
 *      now unknown".
 *   2. Nothing merges until the owner approves the diff.
 */

const MILLION = 1_000_000;

function stampClaude<T>(value: T): Stamped<T> {
  return { value, asOf: nowIso(), source: 'manual' };
}

/** Prefer the incoming value, fall back to what is already stored. */
function keep<T>(incoming: T | null | undefined, existing: T | null): T | null {
  return incoming == null ? existing : incoming;
}

export function quoteFromParsed(p: ParsedPosition, existing: Quote | null): Quote | null {
  const price = p.price ?? (p.shares && p.marketValue ? p.marketValue / p.shares : null);
  if (price == null) return existing;
  // A broker screen shows the day move as a percentage far more often than it
  // shows the previous close, so derive the close from the percentage.
  const changePct = p.dayChangePct ?? existing?.changePct ?? 0;
  const previousClose = changePct === -100 ? price : price / (1 + changePct / 100);
  return {
    price,
    previousClose,
    change: price - previousClose,
    changePct,
    volume: existing?.volume ?? null,
    tradingDay: new Date().toISOString().slice(0, 10),
  };
}

export interface ApplyPositionsInput {
  diffs: HoldingDiff[];
  parsed: ParsedPosition[];
  holdings: Holding[];
  stocks: Record<string, Stock>;
  sectorFor: (ticker: string) => SectorId;
  /** Diff ids (tickers) the owner unticked; these are skipped entirely. */
  skipped?: Set<string>;
}

export interface ApplyPositionsResult {
  holdings: Holding[];
  stocks: Record<string, Stock>;
  /** Tickers that are new to the app and have no analysis yet. */
  needResearch: string[];
}

export function applyPositions({
  diffs,
  parsed,
  holdings,
  stocks,
  sectorFor,
  skipped = new Set(),
}: ApplyPositionsInput): ApplyPositionsResult {
  const byTicker = new Map(holdings.map((h) => [h.ticker, { ...h }]));
  const parsedByTicker = new Map(parsed.map((p) => [p.ticker, p]));
  const nextStocks = { ...stocks };
  const needResearch: string[] = [];

  for (const d of diffs) {
    if (skipped.has(d.ticker)) continue;

    if (d.kind === 'removed') {
      byTicker.delete(d.ticker);
      continue;
    }
    if (d.after) {
      byTicker.set(d.ticker, {
        ticker: d.ticker,
        shares: d.after.shares,
        costBasis: d.after.costBasis,
        sector: byTicker.get(d.ticker)?.sector ?? sectorFor(d.ticker),
      });
    }

    // Refresh the mark for any ticker the screenshot priced, held or not.
    const p = parsedByTicker.get(d.ticker);
    const existing = nextStocks[d.ticker];
    if (p && existing) {
      const quote = quoteFromParsed(p, existing.quote.value);
      if (quote) nextStocks[d.ticker] = { ...existing, quote: stampClaude(quote) };
    } else if (p && !existing) {
      nextStocks[d.ticker] = blankStock(d.ticker, p, sectorFor(d.ticker));
      needResearch.push(d.ticker);
    }
  }

  return { holdings: [...byTicker.values()], stocks: nextStocks, needResearch };
}

/**
 * A ticker the owner holds but the app has never analysed. Everything analytical
 * is null and the detail screen shows a "research this" prompt rather than
 * pretending to know anything about it.
 */
export function blankStock(ticker: string, p: ParsedPosition, sector: SectorId): Stock {
  const quote = quoteFromParsed(p, null);
  return {
    ticker,
    name: p.companyName ?? ticker,
    sector,
    isEtf: false,
    watchlistOnly: false,
    primaryMultiple: 'forwardPe',
    peerGroup: null,
    peerMedianMultiple: null,
    quote: quote ? stampClaude(quote) : { value: null, asOf: null, source: 'unavailable' },
    valuation: { value: null, asOf: null, source: 'unavailable' },
    technicals: { value: null, asOf: null, source: 'unavailable' },
    quality: { value: null, asOf: null, source: 'unavailable' },
    momentum: { value: null, asOf: null, source: 'unavailable' },
    options: { value: null, asOf: null, source: 'unavailable' },
    sentiment: { value: null, asOf: null, source: 'unavailable' },
    earnings: { value: null, asOf: null, source: 'unavailable' },
    fundamentals: { value: null, asOf: null, source: 'unavailable' },
    multipleHistory: { value: null, asOf: null, source: 'unavailable' },
    narrative: {
      catalyst: null,
      risk: null,
      verdict: 'watch',
      verdictReasoning: null,
      thesis: 'Imported from a screenshot — not researched yet.',
      bullCase: null,
      bearCase: null,
      whatWouldChangeMyMind: null,
    },
    narrativeAsOf: null,
    nextEarningsDate: null,
  };
}

// ---------------------------------------------------------------------------
// Research merge
// ---------------------------------------------------------------------------

function points(
  quarters: ResearchResult['quarters'],
  pick: (q: ResearchResult['quarters'][number]) => number | null,
  scale = 1,
): QuarterPoint[] {
  return quarters.map((q) => {
    const v = pick(q);
    return {
      period: q.period,
      label: quarterLabel(q.period),
      value: v == null ? null : v * scale,
    };
  });
}

/** True when at least one quarter carries a real number. */
function hasAny(series: QuarterPoint[]): boolean {
  return series.some((p) => p.value != null);
}

export function mergeResearch(existing: Stock | undefined, r: ResearchResult, ticker: string): Stock {
  const base = existing ?? blankStock(
    ticker,
    {
      ticker,
      companyName: r.companyName,
      shares: null, price: null, marketValue: null, averageCost: null,
      unrealizedPnl: null, unrealizedPnlPct: null, dayChangePct: null,
      confidence: 1, note: null,
    },
    'tech',
  );

  const ev = r.valuation ?? ({} as ResearchResult['valuation']);
  const prev = base.valuation.value;
  const valuation: ValuationSnapshot = {
    trailingPe: keep(ev.trailingPe, prev?.trailingPe ?? null),
    forwardPe: keep(ev.forwardPe, prev?.forwardPe ?? null),
    priceToSales: keep(ev.priceToSales, prev?.priceToSales ?? null),
    evToEbitda: keep(ev.evToEbitda, prev?.evToEbitda ?? null),
    peg: keep(ev.peg, prev?.peg ?? null),
    profitMargin: keep(ev.profitMargin, prev?.profitMargin ?? null),
    operatingMargin: keep(ev.operatingMargin, prev?.operatingMargin ?? null),
    shortInterestPct: keep(ev.shortInterestPct, prev?.shortInterestPct ?? null),
    beta: keep(ev.beta, prev?.beta ?? null),
    week52ChangePct: keep(ev.week52ChangePct, prev?.week52ChangePct ?? null),
    dividendYield: keep(ev.dividendYield, prev?.dividendYield ?? null),
    analystTargetPrice: keep(ev.analystTargetPrice, prev?.analystTargetPrice ?? null),
    analystRating: keep(ev.analystRating, prev?.analystRating ?? null),
    week52High: keep(ev.week52High, prev?.week52High ?? null),
    week52Low: keep(ev.week52Low, prev?.week52Low ?? null),
    debtToEquity: keep(ev.debtToEquity, prev?.debtToEquity ?? null),
  };

  const quarters = r.quarters ?? [];
  const fundamentals: FundamentalsSeries = {
    revenue: points(quarters.slice(0, 8), (q) => q.revenue, MILLION),
    operatingIncome: points(quarters.slice(0, 8), (q) => q.operatingIncome, MILLION),
    netIncome: points(quarters.slice(0, 8), (q) => q.netIncome, MILLION),
    eps: points(quarters.slice(0, 8), (q) => q.eps),
  };
  const multipleHistory: MultipleHistory = {
    peHistory: points(quarters, (q) => q.trailingPe),
    evEbitdaHistory: points(quarters, (q) => q.evToEbitda),
    psHistory: points(quarters, (q) => q.priceToSales),
  };

  const keepFundamentals = hasAny(fundamentals.revenue) || hasAny(fundamentals.eps);
  const keepHistory =
    hasAny(multipleHistory.peHistory) ||
    hasAny(multipleHistory.evEbitdaHistory) ||
    hasAny(multipleHistory.psHistory);

  const e = r.earnings;
  const prevEarnings = base.earnings.value;

  return {
    ...base,
    name: r.companyName || base.name,
    primaryMultiple: r.primaryMultiple ?? base.primaryMultiple,
    peerGroup: keep(r.peerGroup, base.peerGroup),
    peerMedianMultiple: keep(r.peerMedianMultiple, base.peerMedianMultiple),
    valuation: stampClaude(valuation),
    quality: r.quality ? stampClaude(mergeQuality(base.quality.value, r.quality)) : base.quality,
    momentum: r.momentum ? stampClaude(mergeMomentum(base.momentum.value, r.momentum)) : base.momentum,
    technicals: r.technicals
      ? stampClaude(mergeTechnicals(base.technicals.value, r.technicals))
      : base.technicals,
    fundamentals: keepFundamentals ? stampClaude(fundamentals) : base.fundamentals,
    multipleHistory: keepHistory ? stampClaude(multipleHistory) : base.multipleHistory,
    earnings: e
      ? stampClaude({
          date: keep(e.date, prevEarnings?.date ?? null),
          quarter: keep(e.quarter, prevEarnings?.quarter ?? null),
          reportedEps: keep(e.reportedEps, prevEarnings?.reportedEps ?? null),
          estimatedEps: keep(e.estimatedEps, prevEarnings?.estimatedEps ?? null),
          surprisePct: keep(e.surprisePct, prevEarnings?.surprisePct ?? null),
          revenue: keep(e.revenue, prevEarnings?.revenue ?? null),
          callSummary: keep(e.callSummary, prevEarnings?.callSummary ?? null),
          managementSaid: keep(e.managementSaid, prevEarnings?.managementSaid ?? null),
          guidance: keep(e.guidance, prevEarnings?.guidance ?? null),
          watchNext: keep(e.watchNext, prevEarnings?.watchNext ?? null),
          reactionPct: keep(e.reactionPct, prevEarnings?.reactionPct ?? null),
          // An empty quotes array means "found none this pass", which should not
          // erase quotes captured on an earlier one.
          quotes: e.quotes?.length ? e.quotes : (prevEarnings?.quotes ?? []),
        })
      : base.earnings,
    sentiment: r.sentiment
      ? stampClaude({
          score: keep(r.sentiment.score, base.sentiment.value?.score ?? null),
          label: keep(r.sentiment.label, base.sentiment.value?.label ?? null),
          summary: keep(r.sentiment.summary, base.sentiment.value?.summary ?? null),
          analystRevisions: keep(
            r.sentiment.analystRevisions,
            base.sentiment.value?.analystRevisions ?? null,
          ),
          headlines: r.sentiment.headlines?.length
            ? r.sentiment.headlines
            : (base.sentiment.value?.headlines ?? []),
        })
      : base.sentiment,
    narrative: r.narrative
      ? {
          thesis: keep(r.narrative.thesis, base.narrative.thesis),
          catalyst: keep(r.narrative.catalyst, base.narrative.catalyst),
          risk: keep(r.narrative.risk, base.narrative.risk),
          verdict: r.narrative.verdict ?? base.narrative.verdict,
          verdictReasoning: keep(r.narrative.verdictReasoning, base.narrative.verdictReasoning),
          bullCase: keep(r.narrative.bullCase, base.narrative.bullCase),
          bearCase: keep(r.narrative.bearCase, base.narrative.bearCase),
          whatWouldChangeMyMind: keep(
            r.narrative.whatWouldChangeMyMind,
            base.narrative.whatWouldChangeMyMind,
          ),
        }
      : base.narrative,
    narrativeAsOf: nowIso(),
    nextEarningsDate: keep(r.nextEarningsDate, base.nextEarningsDate),
  };
}

function mergeQuality(prev: QualityMetrics | null, next: Partial<QualityMetrics>): QualityMetrics {
  return {
    returnOnEquity: keep(next.returnOnEquity, prev?.returnOnEquity ?? null),
    returnOnInvestedCapital: keep(next.returnOnInvestedCapital, prev?.returnOnInvestedCapital ?? null),
    grossMargin: keep(next.grossMargin, prev?.grossMargin ?? null),
    freeCashFlowMargin: keep(next.freeCashFlowMargin, prev?.freeCashFlowMargin ?? null),
    netDebtToEbitda: keep(next.netDebtToEbitda, prev?.netDebtToEbitda ?? null),
    revenueCagr3y: keep(next.revenueCagr3y, prev?.revenueCagr3y ?? null),
    revenueGrowthYoY: keep(next.revenueGrowthYoY, prev?.revenueGrowthYoY ?? null),
    epsGrowthYoY: keep(next.epsGrowthYoY, prev?.epsGrowthYoY ?? null),
    insiderOwnershipPct: keep(next.insiderOwnershipPct, prev?.insiderOwnershipPct ?? null),
    institutionalOwnershipPct: keep(next.institutionalOwnershipPct, prev?.institutionalOwnershipPct ?? null),
    shareCountChangePct: keep(next.shareCountChangePct, prev?.shareCountChangePct ?? null),
  };
}

function mergeMomentum(prev: Momentum | null, next: Partial<Momentum>): Momentum {
  return {
    oneMonth: keep(next.oneMonth, prev?.oneMonth ?? null),
    threeMonth: keep(next.threeMonth, prev?.threeMonth ?? null),
    sixMonth: keep(next.sixMonth, prev?.sixMonth ?? null),
    oneYear: keep(next.oneYear, prev?.oneYear ?? null),
    yearToDate: keep(next.yearToDate, prev?.yearToDate ?? null),
    fromHighPct: keep(next.fromHighPct, prev?.fromHighPct ?? null),
    fromLowPct: keep(next.fromLowPct, prev?.fromLowPct ?? null),
  };
}

function mergeTechnicals(prev: Technicals | null, next: Partial<Technicals>): Technicals {
  return {
    rsi14: keep(next.rsi14, prev?.rsi14 ?? null),
    rsi20: keep(next.rsi20, prev?.rsi20 ?? null),
    sma20: keep(next.sma20, prev?.sma20 ?? null),
    sma50: keep(next.sma50, prev?.sma50 ?? null),
    sma100: keep(next.sma100, prev?.sma100 ?? null),
    sma200: keep(next.sma200, prev?.sma200 ?? null),
    plusDi: keep(next.plusDi, prev?.plusDi ?? null),
    minusDi: keep(next.minusDi, prev?.minusDi ?? null),
  };
}
