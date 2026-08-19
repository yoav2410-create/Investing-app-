import type { CashFlowBridge } from './types';

/**
 * The EBITDA-to-FCF walk.
 *
 * EBITDA is the number companies lead with and the one most valuation multiples
 * are built on, but it is not cash: it sits above interest, tax, the working
 * capital the business ties up, and the capital expenditure it needs to keep
 * running. The gap between EBITDA and free cash flow is where a business either
 * proves the earnings are real or shows they are not.
 *
 * Stock-based compensation is deducted deliberately. Adjusted EBITDA adds it
 * back as "non-cash", which is true of the company's bank balance and false of
 * the owner's stake — it is paid in the thing you own.
 */

export interface BridgeStep {
  key: string;
  label: string;
  /** Signed contribution to the running total. */
  delta: number | null;
  /** Running total after this step. */
  runningTotal: number | null;
  /** Subtotals are drawn differently and are not deductions. */
  isSubtotal: boolean;
  /** Short note explaining the line. */
  note?: string;
}

export interface BridgeResult {
  steps: BridgeStep[];
  /** Free cash flow the walk arrives at. */
  derivedFcf: number | null;
  /** What the company reported, when known. */
  reportedFcf: number | null;
  /** Difference between the two, when both exist. */
  unexplained: number | null;
  /** FCF as a percentage of adjusted EBITDA. */
  conversionPct: number | null;
  /** Cash EBITDA (after SBC) as a percentage of adjusted EBITDA. */
  cashEbitdaPct: number | null;
  /** Capex as a percentage of adjusted EBITDA — the reinvestment burden. */
  capexIntensityPct: number | null;
  /** How many of the six deduction lines were actually available. */
  completeness: { known: number; total: number };
  /** One-sentence plain reading of the conversion. */
  sentence: string;
}

const DEDUCTIONS = [
  'stockBasedCompensation',
  'cashInterest',
  'cashTaxes',
  'workingCapitalChange',
  'capitalExpenditure',
  'otherItems',
] as const;

function pct(part: number | null, whole: number | null): number | null {
  if (part == null || whole == null || whole === 0) return null;
  return (part / whole) * 100;
}

export function buildBridge(b: CashFlowBridge | null): BridgeResult | null {
  if (!b || b.adjustedEbitda == null) return null;

  const steps: BridgeStep[] = [];
  let running: number | null = b.adjustedEbitda;

  const push = (
    key: string,
    label: string,
    raw: number | null,
    sign: -1 | 1,
    note?: string,
  ) => {
    const delta = raw == null ? null : raw * sign;
    // A missing line breaks the running total rather than being treated as zero:
    // pretending an unknown deduction is nil would overstate the cash.
    running = running == null || delta == null ? null : running + delta;
    steps.push({ key, label, delta, runningTotal: running, isSubtotal: false, note });
  };

  steps.push({
    key: 'adjustedEbitda',
    label: 'Adjusted EBITDA',
    delta: b.adjustedEbitda,
    runningTotal: b.adjustedEbitda,
    isSubtotal: true,
    note: 'Trailing twelve months, as the company reports it',
  });

  push(
    'stockBasedCompensation',
    'Stock-based compensation',
    b.stockBasedCompensation,
    -1,
    'Added back as non-cash, but paid in the thing you own',
  );

  const cashEbitda = running;
  steps.push({
    key: 'cashEbitda',
    label: 'Cash EBITDA',
    delta: null,
    runningTotal: cashEbitda,
    isSubtotal: true,
  });

  push('cashInterest', 'Cash interest', b.cashInterest, -1, 'The cost of the debt in the EV');
  push('cashTaxes', 'Cash taxes', b.cashTaxes, -1);
  push(
    'workingCapitalChange',
    'Working capital',
    b.workingCapitalChange,
    -1,
    'Positive means growth tied up cash',
  );

  const operating = running;
  steps.push({
    key: 'operatingCashFlow',
    label: 'Operating cash flow',
    delta: null,
    runningTotal: operating,
    isSubtotal: true,
    note:
      b.operatingCashFlow != null && operating != null
        ? `Company reported ${formatShort(b.operatingCashFlow)}`
        : undefined,
  });

  push(
    'capitalExpenditure',
    'Capital expenditure',
    b.capitalExpenditure,
    -1,
    'What it costs to keep the assets working',
  );
  if (b.otherItems != null && b.otherItems !== 0) {
    push('otherItems', 'Other items', Math.abs(b.otherItems), b.otherItems >= 0 ? 1 : -1);
  }

  const derivedFcf = running;
  steps.push({
    key: 'freeCashFlow',
    label: 'Free cash flow',
    delta: null,
    runningTotal: derivedFcf,
    isSubtotal: true,
  });

  const known = DEDUCTIONS.filter((k) => b[k] != null).length;
  const fcfForRatios = b.freeCashFlow ?? derivedFcf;
  const conversionPct = pct(fcfForRatios, b.adjustedEbitda);

  return {
    steps,
    derivedFcf,
    reportedFcf: b.freeCashFlow,
    unexplained:
      b.freeCashFlow != null && derivedFcf != null ? b.freeCashFlow - derivedFcf : null,
    conversionPct,
    cashEbitdaPct: pct(cashEbitda, b.adjustedEbitda),
    capexIntensityPct: pct(b.capitalExpenditure, b.adjustedEbitda),
    completeness: { known, total: DEDUCTIONS.length },
    sentence: buildSentence(conversionPct, b, known),
  };
}

function buildSentence(
  conversionPct: number | null,
  b: CashFlowBridge,
  known: number,
): string {
  if (conversionPct == null) {
    return 'Not enough of the cash-flow lines are on file to walk EBITDA down to free cash flow.';
  }
  const where =
    conversionPct >= 70
      ? 'most of the reported EBITDA reaches shareholders as cash'
      : conversionPct >= 45
        ? 'a reasonable share of reported EBITDA reaches shareholders as cash'
        : conversionPct >= 20
          ? 'a meaningful share of reported EBITDA is consumed before it becomes cash'
          : conversionPct > 0
            ? 'almost all of the reported EBITDA is consumed before it becomes cash'
            : 'the business is not converting EBITDA into cash at all right now';

  const biggest = biggestDrag(b);
  const parts = [`${conversionPct.toFixed(0)}% of adjusted EBITDA converts to free cash flow — ${where}.`];
  if (biggest) parts.push(`The largest single deduction is ${biggest}.`);
  if (known < 4) parts.push(`Only ${known} of six deduction lines are on file, so treat the walk as indicative.`);
  return parts.join(' ');
}

function biggestDrag(b: CashFlowBridge): string | null {
  const labels: Record<(typeof DEDUCTIONS)[number], string> = {
    stockBasedCompensation: 'stock-based compensation',
    cashInterest: 'cash interest',
    cashTaxes: 'cash taxes',
    workingCapitalChange: 'working capital',
    capitalExpenditure: 'capital expenditure',
    otherItems: 'other items',
  };
  let best: { key: (typeof DEDUCTIONS)[number]; value: number } | null = null;
  for (const key of DEDUCTIONS) {
    const v = b[key];
    if (v == null || v <= 0) continue;
    if (!best || v > best.value) best = { key, value: v };
  }
  return best ? `${labels[best.key]} at ${formatShort(best.value)}` : null;
}

function formatShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function conversionTone(pct: number | null): 'up' | 'down' | 'flat' {
  if (pct == null) return 'flat';
  if (pct >= 60) return 'up';
  if (pct < 30) return 'down';
  return 'flat';
}

/** FCF yield: free cash flow over market capitalisation. */
export function fcfYield(
  fcf: number | null,
  price: number | null,
  sharesOutstanding: number | null,
): number | null {
  if (fcf == null || price == null || sharesOutstanding == null || sharesOutstanding <= 0) {
    return null;
  }
  const marketCap = price * sharesOutstanding;
  return marketCap === 0 ? null : (fcf / marketCap) * 100;
}
