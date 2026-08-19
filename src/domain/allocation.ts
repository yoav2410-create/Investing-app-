import type {
  AllocationStance,
  DataSourceId,
  IsoDate,
  RebalancePlan,
  SectorId,
} from './types';
import { SECTORS } from './types';
import type { SimResult } from './montecarlo';

/**
 * Which sector targets the app should actually measure against, and where they
 * came from.
 *
 * The bundled plan ships a `targetMix`. That was always a placeholder — a
 * number nobody in this app can defend, sitting in the same position as figures
 * that carry a source and a date. So targets now come from the portfolio read
 * when there is one, and the screen says which it is using. The fallback is not
 * removed, because an app with no analysis on file still has to draw the chart.
 *
 * The same rule as everywhere else: nothing here invents a number. A sector the
 * analysis did not speak to has no target, and renders as no target rather than
 * as zero.
 */

export interface ResolvedTargets {
  /** Percent of NLV per sector. Sectors the source did not name are absent. */
  mix: Partial<Record<SectorId, number>>;
  source: DataSourceId;
  asOf: IsoDate | null;
  /** For the caption under the chart. */
  label: string;
  /** Why each target is what it is, when the source could say. */
  why: Partial<Record<SectorId, string>>;
}

export function resolveTargets(
  plan: RebalancePlan,
  read: { at: string; stance: AllocationStance | null } | null,
): ResolvedTargets {
  const stance = read?.stance;
  if (stance && stance.targetMix.length > 0) {
    const mix: Partial<Record<SectorId, number>> = {};
    const why: Partial<Record<SectorId, string>> = {};
    for (const t of stance.targetMix) {
      mix[t.sector] = t.targetPct;
      if (t.why) why[t.sector] = t.why;
    }
    return {
      mix,
      // 'manual' is this codebase's id for "Claude wrote this"; the Data
      // sources screen renders it as Claude. Reusing it keeps one vocabulary.
      source: 'manual',
      asOf: read?.at ?? null,
      label: 'Targets from the portfolio read',
      why,
    };
  }
  const mix: Partial<Record<SectorId, number>> = {};
  for (const [k, v] of Object.entries(plan.constraints.targetMix)) {
    mix[k as SectorId] = v * 100;
  }
  return {
    mix,
    source: 'seed',
    asOf: null,
    label: 'Targets from the bundled plan — run a portfolio read to replace them',
    why: {},
  };
}

/**
 * Problems with a stance the model returned, in words.
 *
 * Not a schema check — the tool schema already guarantees the shape. This
 * catches the arithmetic a well-formed answer can still get wrong, because a
 * mix that totals 80% would silently make every sector look underweight and the
 * drift list would be nonsense rather than empty.
 */
export function stanceProblems(stance: AllocationStance): string[] {
  const problems: string[] = [];
  const known = new Set(SECTORS.map((s) => s.id));

  const seen = new Set<SectorId>();
  for (const t of stance.targetMix) {
    if (!known.has(t.sector)) problems.push(`Unknown sector "${t.sector}".`);
    if (seen.has(t.sector)) problems.push(`${t.sector} is given a target twice.`);
    seen.add(t.sector);
    if (!Number.isFinite(t.targetPct) || t.targetPct < 0 || t.targetPct > 100) {
      problems.push(`${t.sector} target of ${t.targetPct}% is not a share of the book.`);
    }
  }

  if (stance.targetMix.length > 0) {
    const total = stance.targetMix.reduce((a, t) => a + (Number.isFinite(t.targetPct) ? t.targetPct : 0), 0);
    // Two points of slack for rounding. Beyond that the mix is not a mix.
    if (Math.abs(total - 100) > 2) {
      problems.push(`Targets total ${total.toFixed(1)}%, not 100%.`);
    }
  }

  if (stance.cashFloorPct != null && (stance.cashFloorPct < 0 || stance.cashFloorPct > 100)) {
    problems.push(`Cash floor of ${stance.cashFloorPct}% is not a share of the book.`);
  }
  if (stance.maxPositionPct != null && (stance.maxPositionPct <= 0 || stance.maxPositionPct > 100)) {
    problems.push(`Position cap of ${stance.maxPositionPct}% is not a share of the book.`);
  }

  for (const m of stance.moves) {
    if (m.kind !== 'hold' && !m.basis.trim()) {
      problems.push(`A ${m.kind} move on ${m.ticker ?? m.sector ?? 'the book'} cites no figure.`);
    }
  }

  return problems;
}

/**
 * The projection, small enough to hand a model.
 *
 * The point of including it is that the spread is the argument: a book whose
 * worst 5% is a third of its starting value has a cash problem the sector
 * weights alone do not show.
 */
export function summariseSimulation(sim: SimResult): string {
  const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
  const pct = (v: number, d = 1) => `${v.toFixed(d)}%`;
  // Index 0 of the bands is today, so the terminal distribution is the last one.
  const end = sim.portfolioBands[sim.portfolioBands.length - 1];
  const median = end?.p50 ?? sim.expectedValue;
  const best = end?.p95 ?? sim.expectedValue;
  return [
    `Monte Carlo over ${sim.years} years, ${sim.paths.toLocaleString('en-US')} paths, from ${money(sim.startingValue)}:`,
    `  median ${money(median)} (${pct(sim.annualised.p50)} a year)`,
    `  worst 5% ${money(sim.valueAtRisk5)} (${pct(sim.annualised.p5)} a year); best 5% ${money(best)} (${pct(sim.annualised.p95)} a year)`,
    `  beats the S&P in ${pct(sim.beatBenchmarkPct, 0)} of paths; S&P median ${money(sim.benchmarkMedian)}`,
    `  ends below today's value in ${pct(sim.lossPct, 0)} of paths`,
    `  effective beta ${sim.effectiveBeta.toFixed(2)}, cash sleeve ${pct(sim.cashWeight * 100)}`,
    'Every holding is driven by one shared market factor scaled by its beta, so these paths already account for the book falling together rather than diversifying in the simulation in a way it does not in reality.',
  ].join('\n');
}
