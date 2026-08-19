import type {
  Holding,
  PlanLeg,
  RebalancePlan,
  SectorId,
  Stock,
  TrancheId,
} from './types';
import { positionViews, sectorBuckets, type PositionView } from './portfolio';

export const TRANCHES: TrancheId[] = ['A', 'B', 'C'];

export interface TrancheProgress {
  tranche: TrancheId;
  total: number;
  done: number;
  /** Net cash the remaining legs would raise (positive) or spend (negative). */
  remainingCash: number;
}

export function trancheProgress(plan: RebalancePlan): TrancheProgress[] {
  return TRANCHES.map((t) => {
    const legs = plan.legs.filter((l) => l.tranche === t);
    const open = legs.filter((l) => !l.done && l.action !== 'hold' && l.action !== 'defer');
    return {
      tranche: t,
      total: legs.filter((l) => l.action !== 'hold' && l.action !== 'defer').length,
      done: legs.filter((l) => l.done).length,
      remainingCash: open.reduce((s, l) => s + (l.estimatedCash ?? 0), 0),
    };
  });
}

/**
 * Apply a set of legs to a holdings list, producing the holdings that would
 * exist afterwards. Exits remove the position outright; buys and sells move
 * share counts. Cost basis is carried forward for sells and blended for buys so
 * the projected unrealised P&L stays meaningful.
 */
export function applyLegs(
  holdings: Holding[],
  legs: PlanLeg[],
  stocks: Record<string, Stock>,
): Holding[] {
  const map = new Map(holdings.map((h) => [h.ticker, { ...h }]));

  for (const leg of legs) {
    if (leg.action === 'hold' || leg.action === 'defer') continue;
    const price = stocks[leg.ticker]?.quote.value?.price ?? null;
    const existing = map.get(leg.ticker);

    if (leg.action === 'exit') {
      map.delete(leg.ticker);
      continue;
    }
    if (leg.action === 'sell') {
      if (!existing) continue;
      const remaining = leg.shares == null ? 0 : existing.shares - leg.shares;
      if (remaining <= 0) map.delete(leg.ticker);
      else map.set(leg.ticker, { ...existing, shares: remaining });
      continue;
    }
    if (leg.action === 'buy') {
      const add = leg.shares ?? 0;
      if (add <= 0) continue;
      const sector = stocks[leg.ticker]?.sector ?? existing?.sector ?? 'tech';
      if (!existing) {
        map.set(leg.ticker, {
          ticker: leg.ticker,
          shares: add,
          costBasis: price ?? 0,
          sector,
        });
      } else {
        const totalShares = existing.shares + add;
        const blended =
          price == null
            ? existing.costBasis
            : (existing.costBasis * existing.shares + price * add) / totalShares;
        map.set(leg.ticker, { ...existing, shares: totalShares, costBasis: blended });
      }
    }
  }
  return [...map.values()];
}

export interface PlanProjection {
  /** Cash after the selected legs settle. */
  cash: number;
  cashPct: number;
  /** Headroom above (positive) or shortfall below (negative) the cash floor. */
  cashFloorHeadroomPct: number;
  netLiquidationValue: number;
  positions: PositionView[];
  sectors: ReturnType<typeof sectorBuckets>;
  breaches: PlanBreach[];
}

export interface PlanBreach {
  kind: 'cashFloor' | 'positionCap' | 'sectorDrift';
  severity: 'warn' | 'error';
  message: string;
}

/**
 * Project the portfolio forward over a set of legs and check it against the
 * plan's own constraints. Used twice on the action board: once for "as things
 * stand" (legs already marked done) and once for "if I finish tranche X".
 */
export function project(
  plan: RebalancePlan,
  holdings: Holding[],
  stocks: Record<string, Stock>,
  startingCash: number,
  legs: PlanLeg[],
): PlanProjection {
  const applied = applyLegs(holdings, legs, stocks);
  const cash =
    startingCash +
    legs
      .filter((l) => l.action !== 'hold' && l.action !== 'defer')
      .reduce((s, l) => s + (l.estimatedCash ?? 0), 0);

  const positionsAtCurrent = positionViews(applied, stocks, 1);
  const invested = positionsAtCurrent.reduce((s, p) => s + (p.marketValue ?? 0), 0);
  const nlv = invested + cash;

  const positions = positionViews(applied, stocks, nlv);
  const sectors = sectorBuckets(positions, cash, nlv, plan.constraints.targetMix);

  const cashPct = nlv === 0 ? 0 : (cash / nlv) * 100;
  const floorPct = plan.constraints.cashFloorPct * 100;
  const capPct = plan.constraints.maxPositionPct * 100;

  const breaches: PlanBreach[] = [];
  // Tolerance keeps a plan that lands exactly on the floor from reading as a
  // breach on floating-point noise alone.
  const EPS = 0.05;
  if (cashPct < floorPct - EPS) {
    breaches.push({
      kind: 'cashFloor',
      severity: 'error',
      message: `Cash would sit at ${cashPct.toFixed(1)}%, under the ${floorPct.toFixed(0)}% floor.`,
    });
  }
  for (const p of positions) {
    if (p.weightPct != null && p.weightPct > capPct + EPS) {
      breaches.push({
        kind: 'positionCap',
        severity: 'error',
        message: `${p.ticker} would be ${p.weightPct.toFixed(1)}% of the book, over the ${capPct.toFixed(0)}% cap.`,
      });
    }
  }
  for (const s of sectors) {
    if (s.driftPct != null && Math.abs(s.driftPct) > 7 && s.sector !== 'cash') {
      breaches.push({
        kind: 'sectorDrift',
        severity: 'warn',
        message: `${s.short} would be ${s.driftPct > 0 ? '+' : ''}${s.driftPct.toFixed(1)}pp vs target.`,
      });
    }
  }

  return {
    cash,
    cashPct,
    cashFloorHeadroomPct: cashPct - floorPct,
    netLiquidationValue: nlv,
    positions,
    sectors,
    breaches,
  };
}

/** Legs the owner has already executed. */
export function doneLegs(plan: RebalancePlan): PlanLeg[] {
  return plan.legs.filter((l) => l.done);
}

/** Everything done, plus the whole of the named tranche. */
export function throughTranche(plan: RebalancePlan, tranche: TrancheId): PlanLeg[] {
  const order = TRANCHES.indexOf(tranche);
  const seen = new Set<string>();
  const out: PlanLeg[] = [];
  for (const leg of plan.legs) {
    const legOrder = TRANCHES.indexOf(leg.tranche);
    if (leg.done || legOrder <= order) {
      if (!seen.has(leg.id)) {
        seen.add(leg.id);
        out.push(leg);
      }
    }
  }
  return out;
}

export function legsByTranche(plan: RebalancePlan, tranche: TrancheId): PlanLeg[] {
  return plan.legs.filter((l) => l.tranche === tranche);
}

export function tickersInPlan(plan: RebalancePlan): string[] {
  return [...new Set(plan.legs.map((l) => l.ticker))];
}

export function legsForTicker(plan: RebalancePlan, ticker: string): PlanLeg[] {
  return plan.legs.filter((l) => l.ticker === ticker);
}

export function actionLabel(action: PlanLeg['action']): string {
  switch (action) {
    case 'buy':
      return 'Buy';
    case 'sell':
      return 'Sell';
    case 'exit':
      return 'Exit';
    case 'hold':
      return 'Hold';
    case 'defer':
      return 'Deferred';
  }
}

export function actionTone(action: PlanLeg['action']): 'up' | 'down' | 'flat' {
  if (action === 'buy') return 'up';
  if (action === 'sell' || action === 'exit') return 'down';
  return 'flat';
}

export function sectorTargetEntries(
  plan: RebalancePlan,
): { sector: SectorId; pct: number }[] {
  return Object.entries(plan.constraints.targetMix).map(([sector, pct]) => ({
    sector: sector as SectorId,
    pct: pct * 100,
  }));
}
