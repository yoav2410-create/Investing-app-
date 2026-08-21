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
 * A stable identity for one proposed move, so a done-mark survives re-renders
 * and backups but not a re-generation. Built from what the move *is* rather
 * than its position in the list: reordering the same recommendations must not
 * shuffle which of them read as executed.
 */
export function stanceMoveKey(m: {
  kind: string;
  ticker: string | null;
  sector: string | null;
  action: string;
}): string {
  return [m.kind, m.ticker ?? '', m.sector ?? '', m.action].join('|');
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


// ---------------------------------------------------------------------------
// Executing a move, and comparing one stance to the next
// ---------------------------------------------------------------------------

export interface HoldingChange {
  ticker: string;
  /** Share delta: negative sells, positive buys. */
  sharesDelta: number;
  /** null removes the holding entirely. */
  newShares: number | null;
  /** Estimated cash released (positive) or spent (negative), at the mark used. */
  cashDelta: number;
  /** The mark the arithmetic used, so the confirm line can cite it. */
  price: number;
}

/**
 * What ticking "done and applied" on a move would do to the book.
 *
 * Returns null - with the reason - whenever the change cannot be computed
 * honestly: no mark to price it at, no holding to trim, a size the model
 * declined to give. Estimating any of those would put an invented share count
 * into the same store the broker screenshot feeds, which is the one corruption
 * this app is built to refuse. The screenshot import remains the source of
 * truth; this is a convenience for the gap between executing at the broker and
 * photographing the result.
 */
export function moveToHoldingChange(
  move: { kind: string; ticker: string | null; sizePctOfNlv: number | null },
  holdings: { ticker: string; shares: number }[],
  priceOf: (ticker: string) => number | null,
  nlv: number,
): { change: HoldingChange | null; reason: string | null } {
  if (!move.ticker) return { change: null, reason: 'This move is about a sleeve, not one name.' };
  if (move.kind === 'hold') return { change: null, reason: 'A hold changes nothing.' };
  const price = priceOf(move.ticker);
  if (price == null || price <= 0) {
    return { change: null, reason: `No mark on file for ${move.ticker} to price the change.` };
  }
  const held = holdings.find((h) => h.ticker === move.ticker)?.shares ?? 0;

  if (move.kind === 'exit') {
    if (held <= 0) return { change: null, reason: `Nothing held in ${move.ticker} to exit.` };
    return {
      change: { ticker: move.ticker, sharesDelta: -held, newShares: null, cashDelta: held * price, price },
      reason: null,
    };
  }

  if (move.sizePctOfNlv == null || move.sizePctOfNlv <= 0 || nlv <= 0) {
    return { change: null, reason: 'The read did not size this move, so there is no honest share count to apply.' };
  }
  const rawShares = (move.sizePctOfNlv / 100) * nlv / price;
  // Whole shares, floored: applying 3.2% as 3.18 shares pretends to a
  // precision the broker will not honour anyway.
  const shares = Math.floor(rawShares);
  if (shares < 1) return { change: null, reason: 'The sized amount rounds below one share at the current mark.' };

  if (move.kind === 'trim') {
    if (held <= 0) return { change: null, reason: `Nothing held in ${move.ticker} to trim.` };
    const sell = Math.min(shares, held);
    const remaining = held - sell;
    return {
      change: {
        ticker: move.ticker,
        sharesDelta: -sell,
        newShares: remaining > 0 ? remaining : null,
        cashDelta: sell * price,
        price,
      },
      reason: null,
    };
  }

  if (move.kind === 'add' || move.kind === 'enter') {
    return {
      change: { ticker: move.ticker, sharesDelta: shares, newShares: held + shares, cashDelta: -(shares * price), price },
      reason: null,
    };
  }

  return { change: null, reason: 'Raising cash is the effect of the other moves, not a trade of its own.' };
}

/**
 * What a fresh read changed against the one it replaced, in sentences.
 *
 * The owner sees a new plan appear; without this they would have to remember
 * the old numbers to know whether anything actually moved. Only real changes
 * are reported - a target that stayed put is silence, not a line saying so.
 */
export function diffStances(
  prev: AllocationStance | null | undefined,
  next: AllocationStance,
): string[] {
  if (!prev) return [];
  const out: string[] = [];
  const label = (id: string) => SECTORS.find((s) => s.id === id)?.short ?? id;

  const prevMix = new Map(prev.targetMix.map((t) => [t.sector, t.targetPct]));
  for (const t of next.targetMix) {
    const was = prevMix.get(t.sector);
    if (was == null) out.push(`${label(t.sector)} target set at ${t.targetPct.toFixed(0)}% (had none).`);
    else if (Math.abs(was - t.targetPct) >= 1) {
      out.push(`${label(t.sector)} target ${was.toFixed(0)}% -> ${t.targetPct.toFixed(0)}%.`);
    }
    prevMix.delete(t.sector);
  }
  for (const [sector, was] of prevMix) {
    out.push(`${label(sector)} target dropped (was ${was.toFixed(0)}%).`);
  }

  if (prev.cashFloorPct !== next.cashFloorPct) {
    const fmt = (v: number | null) => (v == null ? 'unset' : `${v.toFixed(0)}%`);
    out.push(`Cash floor ${fmt(prev.cashFloorPct)} -> ${fmt(next.cashFloorPct)}.`);
  }
  if (prev.maxPositionPct !== next.maxPositionPct) {
    const fmt = (v: number | null) => (v == null ? 'unset' : `${v.toFixed(0)}%`);
    out.push(`Position cap ${fmt(prev.maxPositionPct)} -> ${fmt(next.maxPositionPct)}.`);
  }

  const keyOf = stanceMoveKey;
  const prevKeys = new Set(prev.moves.map(keyOf));
  const nextKeys = new Set(next.moves.map(keyOf));
  const dropped = prev.moves.filter((m) => !nextKeys.has(keyOf(m)) && m.kind !== 'hold');
  const added = next.moves.filter((m) => !prevKeys.has(keyOf(m)) && m.kind !== 'hold');
  for (const m of added) out.push(`New move: ${m.kind} ${m.ticker ?? m.sector ?? 'book'}.`);
  for (const m of dropped) out.push(`No longer proposed: ${m.kind} ${m.ticker ?? m.sector ?? 'book'}.`);

  return out;
}
