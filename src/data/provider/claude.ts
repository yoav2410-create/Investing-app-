import type { AllocationStance, Holding, SectorId, Verdict } from '@/domain/types';
import { SECTORS } from '@/domain/types';

/**
 * The shapes a portfolio read and a positions import travel in, and the diff
 * that turns read positions into a reviewable change.
 *
 * This file used to hold the Anthropic client too — three tool-shaped calls
 * that read a screenshot, researched a stock and analysed the book. All three
 * are gone, along with the SDK: a Claude.ai subscription is not API access,
 * the owner has no credits, and a feature that can only answer "add a key"
 * is a dead control wearing a live one's clothes. The work happens in the
 * conversation now and comes back as a paste, validated in
 * `src/data/readExchange.ts`.
 *
 * What stays is what both routes need regardless of who did the reading: the
 * types, and `diffHoldings`, which is the safety rail — no import is written
 * until the owner has seen it row by row.
 */
export interface ParsedPosition {
  ticker: string;
  companyName: string | null;
  shares: number | null;
  price: number | null;
  marketValue: number | null;
  averageCost: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  dayChangePct: number | null;
  /** 0–1. Anything the model could only partially read comes back low. */
  confidence: number;
  /** What was unreadable, in the model's words. */
  note: string | null;
}

export interface ParsedAccount {
  netLiquidationValue: number | null;
  cashUsd: number | null;
  dayPnl: number | null;
  unrealizedPnl: number | null;
  asOfLabel: string | null;
}

export interface PositionsReadResult {
  positions: ParsedPosition[];
  account: ParsedAccount;
  /** Model's summary of anything it could not read confidently. */
  warnings: string[];
}

export interface HoldingDiff {
  ticker: string;
  kind: 'added' | 'removed' | 'changed' | 'unchanged';
  before: { shares: number; costBasis: number } | null;
  after: { shares: number; costBasis: number } | null;
  price: number | null;
  confidence: number;
  note: string | null;
}

export function diffHoldings(
  current: Holding[],
  parsed: ParsedPosition[],
  sectorFor: (ticker: string) => SectorId,
): HoldingDiff[] {
  const byTicker = new Map(current.map((h) => [h.ticker, h]));
  const seen = new Set<string>();
  const out: HoldingDiff[] = [];

  for (const p of parsed) {
    seen.add(p.ticker);
    const existing = byTicker.get(p.ticker) ?? null;
    const shares = p.shares;
    if (shares == null) {
      out.push({
        ticker: p.ticker,
        kind: 'unchanged',
        before: existing ? { shares: existing.shares, costBasis: existing.costBasis } : null,
        after: existing ? { shares: existing.shares, costBasis: existing.costBasis } : null,
        price: p.price,
        confidence: p.confidence,
        note: 'Share count was not readable — left untouched.',
      });
      continue;
    }
    // Derive cost basis when the broker shows P&L but not average cost.
    const cost =
      p.averageCost ??
      (p.price != null && p.unrealizedPnl != null && shares !== 0
        ? p.price - p.unrealizedPnl / shares
        : (existing?.costBasis ?? p.price ?? 0));

    const after = { shares, costBasis: cost };
    if (!existing) {
      out.push({ ticker: p.ticker, kind: 'added', before: null, after, price: p.price, confidence: p.confidence, note: p.note });
    } else if (Math.abs(existing.shares - shares) > 1e-6) {
      out.push({
        ticker: p.ticker,
        kind: 'changed',
        before: { shares: existing.shares, costBasis: existing.costBasis },
        after,
        price: p.price,
        confidence: p.confidence,
        note: p.note,
      });
    } else {
      out.push({
        ticker: p.ticker,
        kind: 'unchanged',
        before: { shares: existing.shares, costBasis: existing.costBasis },
        after,
        price: p.price,
        confidence: p.confidence,
        note: p.note,
      });
    }
  }

  for (const h of current) {
    if (seen.has(h.ticker)) continue;
    out.push({
      ticker: h.ticker,
      kind: 'removed',
      before: { shares: h.shares, costBasis: h.costBasis },
      after: null,
      price: null,
      confidence: 1,
      note: 'Not present in this import.',
    });
  }

  void sectorFor;
  return out.sort((a, b) => {
    const order = { changed: 0, added: 1, removed: 2, unchanged: 3 } as const;
    return order[a.kind] - order[b.kind] || a.ticker.localeCompare(b.ticker);
  });
}

// ---------------------------------------------------------------------------
// 2. Per-stock research refresh
// ---------------------------------------------------------------------------

export interface ResearchResult {
  ticker: string;
  companyName: string;
  about: string | null;
  primaryMultiple: 'evEbitda' | 'forwardPe' | 'trailingPe' | 'ps';
  primaryMultipleRationale: string;
  peerGroup: string | null;
  peerMedianMultiple: number | null;
  valuation: {
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
  };
  /** Newest quarter first. Revenue / income in millions of USD. */
  quarters: {
    period: string;
    revenue: number | null;
    operatingIncome: number | null;
    netIncome: number | null;
    eps: number | null;
    trailingPe: number | null;
    evToEbitda: number | null;
    priceToSales: number | null;
  }[];
  earnings: {
    date: string | null;
    quarter: string | null;
    reportedEps: number | null;
    estimatedEps: number | null;
    surprisePct: number | null;
    revenue: number | null;
    callSummary: string | null;
    managementSaid: string | null;
    guidance: string | null;
    watchNext: string | null;
    reactionPct: number | null;
    quotes: { speaker: string; text: string; topic: string | null }[];
  };
  sentiment: {
    score: number | null;
    label: 'very negative' | 'negative' | 'mixed' | 'positive' | 'very positive' | null;
    summary: string | null;
    analystRevisions: string | null;
    insiderActivity: 'buying' | 'selling' | 'quiet' | null;
    insiderDetail: string | null;
    headlines: {
      headline: string;
      source: string | null;
      date: string | null;
      url: string | null;
      sentiment: number | null;
      soWhat: string | null;
    }[];
  };
  quality: {
    returnOnEquity: number | null;
    returnOnInvestedCapital: number | null;
    grossMargin: number | null;
    freeCashFlowMargin: number | null;
    netDebtToEbitda: number | null;
    revenueCagr3y: number | null;
    revenueGrowthYoY: number | null;
    epsGrowthYoY: number | null;
    insiderOwnershipPct: number | null;
    institutionalOwnershipPct: number | null;
    shareCountChangePct: number | null;
  };
  cashFlow: {
    adjustedEbitda: number | null;
    stockBasedCompensation: number | null;
    cashInterest: number | null;
    cashTaxes: number | null;
    workingCapitalChange: number | null;
    capitalExpenditure: number | null;
    otherItems: number | null;
    operatingCashFlow: number | null;
    freeCashFlow: number | null;
  };
  momentum: {
    oneMonth: number | null;
    threeMonth: number | null;
    sixMonth: number | null;
    oneYear: number | null;
    yearToDate: number | null;
    fromHighPct: number | null;
    fromLowPct: number | null;
  };
  technicals: {
    rsi14: number | null;
    rsi20: number | null;
    sma20: number | null;
    sma50: number | null;
    sma100: number | null;
    sma200: number | null;
    plusDi: number | null;
    minusDi: number | null;
  };
  narrative: {
    thesis: string;
    catalyst: string;
    risk: string;
    bullCase: string;
    bearCase: string;
    whatWouldChangeMyMind: string;
    verdict: Verdict;
    verdictReasoning: string;
  };
  nextEarningsDate: string | null;
  sources: string[];
}

const numberOrNull = { type: ['number', 'null'] as const };

export interface PortfolioReadResult {
  headline: string;
  /** What the book is actually betting on, in the owner's terms. */
  whatThisBookIs: string;
  observations: {
    title: string;
    detail: string;
    severity: 'good' | 'watch' | 'risk';
    /** Tickers this observation is about. */
    tickers: string[];
  }[];
  /** Groups that would move together regardless of their sector labels. */
  themeClusters: {
    theme: string;
    tickers: string[];
    weightPct: number | null;
    why: string;
  }[];
  /** The single biggest risk, named rather than hedged. */
  biggestRisk: string;
  /** The most useful thing to do next, and why. */
  nextAction: string;
  /** What is not knowable from the data on file. */
  blindSpots: string[];
  /**
   * The recommended shape of the book, and the moves that would get there.
   *
   * Optional in the type, not in the schema: reads written before this existed
   * are still on file in the owner's storage, and a stored read with no stance
   * has to keep rendering rather than crash the Insights screen.
   */
  allocation?: AllocationStance;
}

