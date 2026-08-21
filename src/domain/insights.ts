import type { Holding, RebalancePlan, SectorId, Stock } from './types';
import { positionViews, sectorBuckets, type PositionView } from './portfolio';
import { trendRead } from './technicals';
import { valuationRead } from './valuation';
import { daysUntil } from './format';

/**
 * Portfolio-level analytics.
 *
 * Everything here is computed, not written — the numbers are deterministic and
 * testable, and the Insights screen hands them to Claude to write the
 * cross-cutting read over. That split matters: if the model were also
 * generating the figures, there would be no way to check its narrative against
 * anything.
 *
 * Each metric carries its own `available` count, because a book where only four
 * of fourteen names have a beta on file should not report a weighted average as
 * though it covered everything.
 */

export interface Coverage {
  /** Holdings the metric could be computed for. */
  available: number;
  /** Holdings in total. */
  total: number;
  /** Share of market value the metric covers, 0–100. */
  weightCoveredPct: number;
}

function coverage(positions: PositionView[], has: (p: PositionView) => boolean): Coverage {
  const total = positions.length;
  const covered = positions.filter(has);
  const totalMv = positions.reduce((s, p) => s + (p.marketValue ?? 0), 0);
  const coveredMv = covered.reduce((s, p) => s + (p.marketValue ?? 0), 0);
  return {
    available: covered.length,
    total,
    weightCoveredPct: totalMv === 0 ? 0 : (coveredMv / totalMv) * 100,
  };
}

/** Market-value weighted mean, ignoring positions with no value for the metric. */
function weightedMean(
  positions: PositionView[],
  value: (p: PositionView) => number | null,
): number | null {
  let num = 0;
  let den = 0;
  for (const p of positions) {
    const v = value(p);
    const w = p.marketValue ?? 0;
    if (v == null || w <= 0) continue;
    num += v * w;
    den += w;
  }
  return den === 0 ? null : num / den;
}

export interface ConcentrationInsight {
  topWeightPct: number;
  topTicker: string | null;
  top3WeightPct: number;
  top5WeightPct: number;
  /** Herfindahl index over position weights, 0–1. */
  hhi: number;
  /** 1 / HHI — the number of equally sized positions with the same concentration. */
  effectivePositions: number;
  positions: number;
  overCap: { ticker: string; weightPct: number }[];
}

export function concentrationInsight(
  positions: PositionView[],
  capPct: number,
): ConcentrationInsight {
  // Weights against net liquidation value, used for the headline figures the
  // owner compares to the position cap.
  const weights = positions
    .map((p) => p.weightPct ?? 0)
    .filter((w) => w > 0)
    .sort((a, b) => b - a);

  // The Herfindahl index only means anything over shares of a whole, so it is
  // computed across the equity sleeve renormalised to 100%. Using NLV weights
  // here would let cash dilute the index and report more effective positions
  // than the book actually holds.
  const investedTotal = weights.reduce((s, w) => s + w, 0);
  const hhi =
    investedTotal === 0
      ? 0
      : weights.reduce((s, w) => s + (w / investedTotal) ** 2, 0);
  return {
    topWeightPct: weights[0] ?? 0,
    topTicker: positions.slice().sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0))[0]?.ticker ?? null,
    top3WeightPct: weights.slice(0, 3).reduce((s, w) => s + w, 0),
    top5WeightPct: weights.slice(0, 5).reduce((s, w) => s + w, 0),
    hhi,
    effectivePositions: hhi === 0 ? 0 : 1 / hhi,
    positions: weights.length,
    overCap: positions
      .filter((p) => (p.weightPct ?? 0) > capPct)
      .map((p) => ({ ticker: p.ticker, weightPct: p.weightPct ?? 0 })),
  };
}

export interface BreadthInsight<T extends string> {
  counts: Record<T, number>;
  /** Weighted share of the book in each bucket, 0–100. */
  weights: Record<T, number>;
  coverage: Coverage;
}

function breadth<T extends string>(
  positions: PositionView[],
  buckets: readonly T[],
  classify: (p: PositionView) => T | null,
): BreadthInsight<T> {
  const counts = Object.fromEntries(buckets.map((b) => [b, 0])) as Record<T, number>;
  const weights = Object.fromEntries(buckets.map((b) => [b, 0])) as Record<T, number>;
  for (const p of positions) {
    const b = classify(p);
    if (!b) continue;
    counts[b] += 1;
    weights[b] += p.weightPct ?? 0;
  }
  return { counts, weights, coverage: coverage(positions, (p) => classify(p) != null) };
}

export const TREND_BUCKETS = ['up', 'mixed', 'down'] as const;
export const VALUE_BUCKETS = ['cheap', 'fair', 'expensive'] as const;
export const INSIDER_BUCKETS = ['buying', 'quiet', 'selling'] as const;

export interface EarningsCluster {
  /** Names reporting within the window, soonest first. */
  upcoming: { ticker: string; date: string; days: number; weightPct: number }[];
  /** Share of the book reporting inside the window. */
  weightPct: number;
  /** The busiest single week, as a count. */
  busiestWeekCount: number;
}

export function earningsCluster(
  positions: PositionView[],
  stocks: Record<string, Stock>,
  windowDays = 30,
): EarningsCluster {
  const upcoming = positions
    .map((p) => {
      const date = stocks[p.ticker]?.nextEarningsDate ?? null;
      const days = daysUntil(date);
      return date && days != null && days >= 0 && days <= windowDays
        ? { ticker: p.ticker, date, days, weightPct: p.weightPct ?? 0 }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => a.days - b.days);

  // Busiest seven-day run, measured by sliding over the sorted dates.
  let busiest = 0;
  for (let i = 0; i < upcoming.length; i++) {
    const start = upcoming[i]!.days;
    const inWeek = upcoming.filter((u) => u.days >= start && u.days < start + 7).length;
    busiest = Math.max(busiest, inWeek);
  }

  return {
    upcoming,
    weightPct: upcoming.reduce((s, u) => s + u.weightPct, 0),
    busiestWeekCount: busiest,
  };
}

export interface PortfolioInsights {
  netLiquidationValue: number;
  cashPct: number;
  cashFloorPct: number;
  cashHeadroomPct: number;

  concentration: ConcentrationInsight;

  /** Weighted average beta, plus how much of the book it actually covers. */
  beta: { value: number | null; coverage: Coverage };
  /** Weighted mean of each stock's valuation percentile against its own history. */
  valuationPercentile: { value: number | null; coverage: Coverage };
  /** Weighted average trend score, 0–5. */
  trendScore: { value: number | null; coverage: Coverage };
  /** Weighted distance below each name's 52-week high. */
  drawdown: { value: number | null; coverage: Coverage };
  /** Weighted net debt / EBITDA across the book. */
  leverage: { value: number | null; coverage: Coverage };
  /** Weighted return on equity. */
  quality: { value: number | null; coverage: Coverage };
  /** Weighted news sentiment, −1 to +1. */
  sentiment: { value: number | null; coverage: Coverage };

  trendBreadth: BreadthInsight<(typeof TREND_BUCKETS)[number]>;
  valueBreadth: BreadthInsight<(typeof VALUE_BUCKETS)[number]>;
  insiderBreadth: BreadthInsight<(typeof INSIDER_BUCKETS)[number]>;

  sectors: ReturnType<typeof sectorBuckets>;
  /** Sectors more than three points from target, worst first. */
  drift: { sector: SectorId; label: string; driftPct: number }[];

  earnings: EarningsCluster;

  /** Positions ranked by how much of the book's outcome rests on them. */
  keyPositions: {
    ticker: string;
    name: string;
    weightPct: number;
    trendScore: number;
    valuationBand: string | null;
    verdict: string;
  }[];

  /** Data gaps that limit how much any of the above can be trusted. */
  gaps: string[];
}

export function buildInsights(
  holdings: Holding[],
  stocks: Record<string, Stock>,
  plan: RebalancePlan,
  cash: number,
  nlv: number,
): PortfolioInsights {
  const positions = positionViews(holdings, stocks, nlv);
  const capPct = plan.constraints.maxPositionPct * 100;
  const floorPct = plan.constraints.cashFloorPct * 100;
  const cashPct = nlv === 0 ? 0 : (cash / nlv) * 100;

  const at = (p: PositionView) => stocks[p.ticker];

  const trendOf = (p: PositionView) => {
    const s = at(p);
    if (!s) return null;
    const r = trendRead(s.quote.value?.price ?? null, s.technicals.value);
    return r.available === 0 ? null : r;
  };

  const sectors = sectorBuckets(positions, cash, nlv, plan.constraints.targetMix);

  const insights: PortfolioInsights = {
    netLiquidationValue: nlv,
    cashPct,
    cashFloorPct: floorPct,
    cashHeadroomPct: cashPct - floorPct,

    concentration: concentrationInsight(positions, capPct),

    beta: {
      value: weightedMean(positions, (p) => at(p)?.valuation.value?.beta ?? null),
      coverage: coverage(positions, (p) => at(p)?.valuation.value?.beta != null),
    },
    valuationPercentile: {
      value: weightedMean(positions, (p) => {
        const s = at(p);
        return s ? valuationRead(s).percentile : null;
      }),
      coverage: coverage(positions, (p) => {
        const s = at(p);
        return s ? valuationRead(s).percentile != null : false;
      }),
    },
    trendScore: {
      value: weightedMean(positions, (p) => trendOf(p)?.score ?? null),
      coverage: coverage(positions, (p) => trendOf(p) != null),
    },
    drawdown: {
      value: weightedMean(positions, (p) => at(p)?.momentum.value?.fromHighPct ?? null),
      coverage: coverage(positions, (p) => at(p)?.momentum.value?.fromHighPct != null),
    },
    leverage: {
      value: weightedMean(positions, (p) => at(p)?.quality.value?.netDebtToEbitda ?? null),
      coverage: coverage(positions, (p) => at(p)?.quality.value?.netDebtToEbitda != null),
    },
    quality: {
      value: weightedMean(positions, (p) => at(p)?.quality.value?.returnOnEquity ?? null),
      coverage: coverage(positions, (p) => at(p)?.quality.value?.returnOnEquity != null),
    },
    sentiment: {
      value: weightedMean(positions, (p) => at(p)?.sentiment.value?.score ?? null),
      coverage: coverage(positions, (p) => at(p)?.sentiment.value?.score != null),
    },

    trendBreadth: breadth(positions, TREND_BUCKETS, (p) => {
      const r = trendOf(p);
      if (!r) return null;
      return r.score >= 3.5 ? 'up' : r.score <= 1.5 ? 'down' : 'mixed';
    }),
    valueBreadth: breadth(positions, VALUE_BUCKETS, (p) => {
      const s = at(p);
      return s ? valuationRead(s).band : null;
    }),
    insiderBreadth: breadth(positions, INSIDER_BUCKETS, (p) =>
      at(p)?.sentiment.value?.insiderActivity ?? null,
    ),

    sectors,
    drift: sectors
      .filter((s) => s.driftPct != null && Math.abs(s.driftPct) > 3)
      .map((s) => ({ sector: s.sector, label: s.label, driftPct: s.driftPct! }))
      .sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct)),

    earnings: earningsCluster(positions, stocks),

    keyPositions: positions
      .slice()
      .sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0))
      .slice(0, 6)
      .map((p) => {
        const s = at(p);
        return {
          ticker: p.ticker,
          name: s?.name ?? p.ticker,
          weightPct: p.weightPct ?? 0,
          trendScore: trendOf(p)?.score ?? 0,
          valuationBand: s ? valuationRead(s).band : null,
          verdict: s?.narrative.verdict ?? 'hold',
        };
      }),

    gaps: [],
  };

  // Be explicit about what would make the read above unreliable.
  const gaps: string[] = [];
  const thin = (name: string, c: Coverage) => {
    if (c.total > 0 && c.weightCoveredPct < 60) {
      gaps.push(
        `${name} covers only ${c.weightCoveredPct.toFixed(0)}% of the book (${c.available} of ${c.total} positions) — treat the average as indicative.`,
      );
    }
  };
  thin('Beta', insights.beta.coverage);
  thin('Valuation band', insights.valuationPercentile.coverage);
  thin('Trend', insights.trendScore.coverage);
  thin('Leverage', insights.leverage.coverage);
  thin('Sentiment', insights.sentiment.coverage);
  insights.gaps = gaps;

  return insights;
}

/** Compact the analysis into something small enough to hand a model. */
export function summariseForModel(i: PortfolioInsights): string {
  const pct = (v: number | null, d = 1) => (v == null ? 'n/a' : `${v.toFixed(d)}%`);
  const num = (v: number | null, d = 2) => (v == null ? 'n/a' : v.toFixed(d));
  return [
    `Net liquidation value: $${Math.round(i.netLiquidationValue).toLocaleString('en-US')}`,
    `Cash: ${pct(i.cashPct)} against a ${pct(i.cashFloorPct, 0)} floor (headroom ${pct(i.cashHeadroomPct)})`,
    `Positions: ${i.concentration.positions}; effective positions ${num(i.concentration.effectivePositions, 1)}`,
    `Top position ${i.concentration.topTicker ?? 'n/a'} at ${pct(i.concentration.topWeightPct)}; top 3 ${pct(i.concentration.top3WeightPct)}; top 5 ${pct(i.concentration.top5WeightPct)}`,
    i.concentration.overCap.length
      ? `Over the position cap: ${i.concentration.overCap.map((o) => `${o.ticker} ${pct(o.weightPct)}`).join(', ')}`
      : 'No position over the cap',
    `Weighted beta ${num(i.beta.value)} (covers ${pct(i.beta.coverage.weightCoveredPct, 0)} of the book)`,
    `Weighted valuation percentile against own history ${i.valuationPercentile.value == null ? 'n/a' : (i.valuationPercentile.value * 100).toFixed(0) + 'th'}`,
    `Weighted trend score ${num(i.trendScore.value, 1)} of 5`,
    `Weighted drawdown from 52w high ${pct(i.drawdown.value)}`,
    `Weighted net debt/EBITDA ${num(i.leverage.value)}; weighted ROE ${pct(i.quality.value)}`,
    `Weighted news sentiment ${num(i.sentiment.value)} (covers ${pct(i.sentiment.coverage.weightCoveredPct, 0)})`,
    `Trend breadth — up ${i.trendBreadth.counts.up}, mixed ${i.trendBreadth.counts.mixed}, down ${i.trendBreadth.counts.down}`,
    `Valuation breadth — cheap ${i.valueBreadth.counts.cheap}, fair ${i.valueBreadth.counts.fair}, expensive ${i.valueBreadth.counts.expensive}`,
    `Insider filings — buying ${i.insiderBreadth.counts.buying}, quiet ${i.insiderBreadth.counts.quiet}, selling ${i.insiderBreadth.counts.selling}`,
    `Sector mix: ${i.sectors.filter((s) => s.weightPct > 0.05).map((s) => `${s.short} ${pct(s.weightPct)}${s.targetPct != null ? ` (target ${pct(s.targetPct, 0)})` : ''}`).join(', ')}`,
    i.drift.length
      ? `Drift over 3pp: ${i.drift.map((d) => `${d.label} ${d.driftPct > 0 ? '+' : ''}${d.driftPct.toFixed(1)}pp`).join(', ')}`
      : 'No sector more than 3pp from target',
    i.earnings.upcoming.length
      ? `Reporting within 30 days: ${i.earnings.upcoming.map((u) => `${u.ticker} in ${u.days}d (${pct(u.weightPct)})`).join(', ')} — ${pct(i.earnings.weightPct)} of the book, busiest week ${i.earnings.busiestWeekCount} names`
      : 'Nothing reporting within 30 days',
    `Largest positions: ${i.keyPositions.map((k) => `${k.ticker} ${pct(k.weightPct)} trend ${k.trendScore.toFixed(1)}/5 ${k.valuationBand ?? 'unrated'} verdict ${k.verdict}`).join('; ')}`,
    i.gaps.length ? `Data gaps: ${i.gaps.join(' ')}` : 'No material data gaps',
  ].join('\n');
}
