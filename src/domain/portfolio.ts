import type {
  AccountSnapshot,
  Holding,
  SectorId,
  Stock,
} from './types';
import { SECTORS } from './types';

export interface PositionView {
  ticker: string;
  name: string;
  sector: SectorId;
  shares: number;
  price: number | null;
  marketValue: number | null;
  costValue: number;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  dayPnl: number | null;
  dayPnlPct: number | null;
  weightPct: number | null;
}

export function positionViews(
  holdings: Holding[],
  stocks: Record<string, Stock>,
  nlv: number,
): PositionView[] {
  return holdings.map((h) => {
    const stock = stocks[h.ticker];
    const q = stock?.quote.value ?? null;
    const price = q?.price ?? null;
    const marketValue = price == null ? null : price * h.shares;
    const costValue = h.costBasis * h.shares;
    const unrealizedPnl = marketValue == null ? null : marketValue - costValue;
    return {
      ticker: h.ticker,
      name: stock?.name ?? h.ticker,
      sector: h.sector,
      shares: h.shares,
      price,
      marketValue,
      costValue,
      unrealizedPnl,
      unrealizedPnlPct:
        unrealizedPnl == null || costValue === 0 ? null : (unrealizedPnl / costValue) * 100,
      dayPnl: q == null ? null : q.change * h.shares,
      dayPnlPct: q?.changePct ?? null,
      weightPct: marketValue == null || nlv === 0 ? null : (marketValue / nlv) * 100,
    };
  });
}

export interface SectorBucket {
  sector: SectorId;
  label: string;
  short: string;
  marketValue: number;
  weightPct: number;
  targetPct: number | null;
  driftPct: number | null;
  tickers: string[];
}

export function sectorBuckets(
  positions: PositionView[],
  cashTotal: number,
  nlv: number,
  targetMix: Partial<Record<SectorId, number>> = {},
): SectorBucket[] {
  const byId = new Map<SectorId, { mv: number; tickers: string[] }>();
  for (const s of SECTORS) byId.set(s.id, { mv: 0, tickers: [] });
  byId.get('cash')!.mv = cashTotal;

  for (const p of positions) {
    const bucket = byId.get(p.sector);
    if (!bucket) continue;
    bucket.mv += p.marketValue ?? 0;
    bucket.tickers.push(p.ticker);
  }

  return SECTORS.map((s) => {
    const b = byId.get(s.id)!;
    const weightPct = nlv === 0 ? 0 : (b.mv / nlv) * 100;
    const rawTarget = targetMix[s.id];
    const targetPct = rawTarget == null ? null : rawTarget * 100;
    return {
      sector: s.id,
      label: s.label,
      short: s.short,
      marketValue: b.mv,
      weightPct,
      targetPct,
      driftPct: targetPct == null ? null : weightPct - targetPct,
      tickers: b.tickers,
    };
  });
}

export interface Mover {
  ticker: string;
  name: string;
  changePct: number;
  dayPnl: number | null;
}

export function topMovers(positions: PositionView[], count = 3): {
  gainers: Mover[];
  losers: Mover[];
} {
  const withChange = positions
    .filter((p): p is PositionView & { dayPnlPct: number } => p.dayPnlPct != null)
    .map((p) => ({
      ticker: p.ticker,
      name: p.name,
      changePct: p.dayPnlPct,
      dayPnl: p.dayPnl,
    }));
  const sorted = [...withChange].sort((a, b) => b.changePct - a.changePct);
  return {
    gainers: sorted.slice(0, count),
    losers: sorted.slice(-count).reverse().filter((m) => m.changePct < 0),
  };
}

/** Total cash across currencies, converted at 1:1 for anything already USD. */
export function cashTotal(account: AccountSnapshot, fxToUsd: Record<string, number> = {}): number {
  return account.cash.reduce((sum, c) => {
    const rate = c.currency === 'USD' ? 1 : (fxToUsd[c.currency] ?? 1);
    return sum + c.amount * rate;
  }, 0);
}

export interface AttributionRow {
  ticker: string;
  name: string;
  sector: SectorId;
  /** Contribution to portfolio day P&L in $. */
  contribution: number;
  /** Share of the absolute day move, 0–100. */
  sharePct: number;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
}

export function attribution(positions: PositionView[]): AttributionRow[] {
  const totalAbs = positions.reduce((s, p) => s + Math.abs(p.dayPnl ?? 0), 0);
  return positions
    .map((p) => ({
      ticker: p.ticker,
      name: p.name,
      sector: p.sector,
      contribution: p.dayPnl ?? 0,
      sharePct: totalAbs === 0 ? 0 : (Math.abs(p.dayPnl ?? 0) / totalAbs) * 100,
      unrealizedPnl: p.unrealizedPnl,
      unrealizedPnlPct: p.unrealizedPnlPct,
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

/** Largest single position as a share of NLV — the cap the plan enforces. */
export function concentration(positions: PositionView[]): {
  topTicker: string | null;
  topWeightPct: number;
  top5WeightPct: number;
} {
  const sorted = [...positions]
    .filter((p) => p.weightPct != null)
    .sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0));
  return {
    topTicker: sorted[0]?.ticker ?? null,
    topWeightPct: sorted[0]?.weightPct ?? 0,
    top5WeightPct: sorted.slice(0, 5).reduce((s, p) => s + (p.weightPct ?? 0), 0),
  };
}
