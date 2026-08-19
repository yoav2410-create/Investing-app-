import type { Holding, Stock } from './types';
import { positionViews } from './portfolio';

/**
 * Monte Carlo projection of the whole book against the S&P 500.
 *
 * The modelling choice that matters is correlation. Simulating fourteen
 * positions independently would let them diversify away risk that in reality
 * does not diversify — an AI-heavy book does not have fourteen independent
 * outcomes, it has roughly one plus noise. So every holding is driven by a
 * single shared market factor plus its own idiosyncratic term:
 *
 *     log r_i = (μ_i − σ_i²/2) + β_i · σ_m · z_m + σ_idio,i · z_i
 *
 * `z_m` is drawn once per year per path and shared by every holding, which is
 * what makes them fall together. `z_i` is drawn per holding. Correlation
 * between any two holdings therefore emerges from their betas rather than being
 * asserted, and the S&P benchmark is simulated from the same `z_m` so the
 * comparison is like-for-like within each path.
 *
 * Everything is deterministic given a seed, so the same inputs always produce
 * the same chart.
 */

// --------------------------------------------------------------------------
// Deterministic randomness
// --------------------------------------------------------------------------

/** mulberry32 — small, fast, and good enough for a projection like this. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller, returning one standard normal per call. */
function normalFrom(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare != null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = rand() * 2 - 1;
      v = rand() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const factor = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * factor;
    return u * factor;
  };
}

// --------------------------------------------------------------------------
// Per-holding inputs
// --------------------------------------------------------------------------

export type ReturnBasis = 'capm' | 'analyst';

export interface SimAssumptions {
  /** Annual risk-free rate, percent. Taken from the 10-year yield. */
  riskFreePct: number;
  /** Equity risk premium over the risk-free rate, percent. */
  equityRiskPremiumPct: number;
  /** Annual volatility of the market factor, percent. */
  marketVolPct: number;
  /** Where each holding's expected return comes from. */
  basis: ReturnBasis;
  years: number;
  paths: number;
  seed: number;
}

export const DEFAULT_ASSUMPTIONS: SimAssumptions = {
  riskFreePct: 4.18,
  equityRiskPremiumPct: 4.5,
  marketVolPct: 16,
  basis: 'capm',
  years: 5,
  paths: 5000,
  seed: 20260818,
};

export interface HoldingInput {
  ticker: string;
  weight: number;
  beta: number;
  /** Expected annual arithmetic return, as a decimal. */
  mu: number;
  /** Total annual volatility, as a decimal. */
  sigma: number;
  /** The part of sigma not explained by the market factor. */
  sigmaIdio: number;
  /** Where the volatility estimate came from, for the transparency table. */
  volSource: 'range' | 'beta' | 'default';
  /** Where the expected return came from. */
  returnSource: 'capm' | 'analyst' | 'default';
}

const DEFAULT_BETA = 1.0;
const DEFAULT_VOL = 0.3;
/** Analyst targets are twelve-month; anything beyond this is not a forecast. */
const ANALYST_CAP = 0.4;
/** No stock has zero company-specific risk, whatever the range implies. */
const MIN_IDIO_VOL = 0.12;

/**
 * Annualised volatility from the 52-week high and low, using Parkinson's
 * range estimator. It is a real estimator with a known bias — a single annual
 * range under-states volatility for a name that trended steadily — which is why
 * the result is floored against the beta-implied systematic volatility below.
 */
export function parkinsonVol(high: number | null, low: number | null): number | null {
  if (high == null || low == null || low <= 0 || high <= low) return null;
  return Math.log(high / low) / (2 * Math.sqrt(Math.log(2)));
}

export function buildInputs(
  holdings: Holding[],
  stocks: Record<string, Stock>,
  nlv: number,
  a: SimAssumptions,
): HoldingInput[] {
  const positions = positionViews(holdings, stocks, nlv);
  const marketVol = a.marketVolPct / 100;
  const rf = a.riskFreePct / 100;
  const erp = a.equityRiskPremiumPct / 100;

  return positions
    .filter((p) => (p.weightPct ?? 0) > 0)
    .map((p) => {
      const s = stocks[p.ticker];
      const v = s?.valuation.value ?? null;
      const beta = v?.beta ?? DEFAULT_BETA;

      const ranged = parkinsonVol(v?.week52High ?? null, v?.week52Low ?? null);
      const systematic = Math.abs(beta) * marketVol;
      // Total volatility is at least the systematic component: a stock cannot
      // be less volatile than the market moves it.
      let sigma: number;
      let volSource: HoldingInput['volSource'];
      if (ranged != null) {
        sigma = Math.max(ranged, systematic);
        volSource = ranged >= systematic ? 'range' : 'beta';
      } else if (v?.beta != null) {
        sigma = Math.sqrt(systematic ** 2 + MIN_IDIO_VOL ** 2);
        volSource = 'beta';
      } else {
        sigma = DEFAULT_VOL;
        volSource = 'default';
      }
      const sigmaIdio = Math.max(MIN_IDIO_VOL, Math.sqrt(Math.max(0, sigma ** 2 - systematic ** 2)));
      // Recompute total so the two components stay consistent with each other.
      const sigmaTotal = Math.sqrt(systematic ** 2 + sigmaIdio ** 2);

      let mu: number;
      let returnSource: HoldingInput['returnSource'];
      const target = v?.analystTargetPrice ?? null;
      const price = s?.quote.value?.price ?? null;
      if (a.basis === 'analyst' && target != null && price != null && price > 0) {
        const implied = target / price - 1;
        mu = Math.max(-ANALYST_CAP, Math.min(ANALYST_CAP, implied));
        returnSource = 'analyst';
      } else if (v?.beta != null) {
        mu = rf + beta * erp;
        returnSource = 'capm';
      } else {
        mu = rf + erp;
        returnSource = 'default';
      }

      return {
        ticker: p.ticker,
        weight: (p.weightPct ?? 0) / 100,
        beta,
        mu,
        sigma: sigmaTotal,
        sigmaIdio,
        volSource,
        returnSource,
      };
    });
}

// --------------------------------------------------------------------------
// Simulation
// --------------------------------------------------------------------------

export interface Percentiles {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface SimResult {
  years: number;
  paths: number;
  /** Starting value, so the chart can show money rather than multiples. */
  startingValue: number;
  /** Percentile bands of portfolio value at the end of each year, index 0 = today. */
  portfolioBands: Percentiles[];
  /** Same for a pure S&P 500 holding of the same starting value. */
  benchmarkBands: Percentiles[];
  /** Terminal portfolio values across every path, sorted ascending. */
  terminal: number[];
  /** Annualised return at each percentile, in percent. */
  annualised: Percentiles;
  /** Share of paths where the portfolio ends above the benchmark, 0–100. */
  beatBenchmarkPct: number;
  /** Share of paths ending below the starting value, 0–100. */
  lossPct: number;
  /** Median terminal value of the benchmark. */
  benchmarkMedian: number;
  /** Mean terminal value. */
  expectedValue: number;
  /** Worst 5% outcome — value at risk in level terms. */
  valueAtRisk5: number;
  /** Weighted beta of the simulated book, cash included. */
  effectiveBeta: number;
  inputs: HoldingInput[];
  /** Share of the book held in cash, earning the risk-free rate. */
  cashWeight: number;
}

function percentilesOf(sorted: number[]): Percentiles {
  const at = (q: number) => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
    return sorted[idx]!;
  };
  return { p5: at(0.05), p25: at(0.25), p50: at(0.5), p75: at(0.75), p95: at(0.95) };
}

export function simulate(
  inputs: HoldingInput[],
  cashWeight: number,
  startingValue: number,
  a: SimAssumptions,
): SimResult {
  const rand = mulberry32(a.seed);
  const normal = normalFrom(rand);
  const marketVol = a.marketVolPct / 100;
  const rf = a.riskFreePct / 100;
  const marketMu = rf + a.equityRiskPremiumPct / 100;
  const years = Math.max(1, Math.round(a.years));
  const paths = Math.max(100, Math.round(a.paths));

  // Values at each year end, per path, for both the book and the benchmark.
  const portfolioByYear: number[][] = Array.from({ length: years + 1 }, () => []);
  const benchmarkByYear: number[][] = Array.from({ length: years + 1 }, () => []);

  const effectiveBeta = inputs.reduce((s, i) => s + i.weight * i.beta, 0);

  for (let path = 0; path < paths; path++) {
    // Track each holding's value separately: weights drift as they compound,
    // which is what an un-rebalanced book actually does.
    const values = inputs.map((i) => i.weight * startingValue);
    let cash = cashWeight * startingValue;
    let benchmark = startingValue;

    portfolioByYear[0]!.push(startingValue);
    benchmarkByYear[0]!.push(startingValue);

    for (let year = 1; year <= years; year++) {
      const zMarket = normal();
      // Log-return of the market factor, drift-adjusted so the arithmetic mean
      // comes out at marketMu rather than the median.
      const marketLog = marketMu - marketVol ** 2 / 2 + marketVol * zMarket;
      benchmark *= Math.exp(marketLog);

      for (let k = 0; k < inputs.length; k++) {
        const i = inputs[k]!;
        const systematic = i.beta * marketVol * zMarket;
        const idio = i.sigmaIdio * normal();
        const log = i.mu - i.sigma ** 2 / 2 + systematic + idio;
        values[k] = values[k]! * Math.exp(log);
      }
      cash *= 1 + rf;

      portfolioByYear[year]!.push(values.reduce((s, v) => s + v, 0) + cash);
      benchmarkByYear[year]!.push(benchmark);
    }
  }

  const portfolioBands = portfolioByYear.map((v) => percentilesOf([...v].sort((x, y) => x - y)));
  const benchmarkBands = benchmarkByYear.map((v) => percentilesOf([...v].sort((x, y) => x - y)));

  const finalPortfolio = portfolioByYear[years]!;
  const finalBenchmark = benchmarkByYear[years]!;
  const terminal = [...finalPortfolio].sort((x, y) => x - y);

  let beats = 0;
  let losses = 0;
  for (let n = 0; n < finalPortfolio.length; n++) {
    if (finalPortfolio[n]! > finalBenchmark[n]!) beats++;
    if (finalPortfolio[n]! < startingValue) losses++;
  }

  const terminalPct = percentilesOf(terminal);
  const toAnnual = (v: number) => (Math.pow(v / startingValue, 1 / years) - 1) * 100;

  return {
    years,
    paths,
    startingValue,
    portfolioBands,
    benchmarkBands,
    terminal,
    annualised: {
      p5: toAnnual(terminalPct.p5),
      p25: toAnnual(terminalPct.p25),
      p50: toAnnual(terminalPct.p50),
      p75: toAnnual(terminalPct.p75),
      p95: toAnnual(terminalPct.p95),
    },
    beatBenchmarkPct: (beats / finalPortfolio.length) * 100,
    lossPct: (losses / finalPortfolio.length) * 100,
    benchmarkMedian: percentilesOf([...finalBenchmark].sort((x, y) => x - y)).p50,
    expectedValue: terminal.reduce((s, v) => s + v, 0) / terminal.length,
    valueAtRisk5: terminalPct.p5,
    effectiveBeta,
    inputs,
    cashWeight,
  };
}

export function runSimulation(
  holdings: Holding[],
  stocks: Record<string, Stock>,
  cash: number,
  nlv: number,
  assumptions: SimAssumptions = DEFAULT_ASSUMPTIONS,
): SimResult {
  const inputs = buildInputs(holdings, stocks, nlv, assumptions);
  const cashWeight = nlv === 0 ? 0 : cash / nlv;
  return simulate(inputs, cashWeight, nlv, assumptions);
}

export interface HistogramResult {
  buckets: { x: number; count: number }[];
  /** Range the buckets span. */
  lo: number;
  hi: number;
  /** Paths that fell outside the plotted range, folded into the end buckets. */
  clippedBelow: number;
  clippedAbove: number;
}

/**
 * Bucket terminal values for the distribution chart.
 *
 * Compounded returns are log-normal, so the raw range runs from roughly the
 * starting value out to several multiples of it. Plotting that whole span puts
 * 95% of the paths in the first two bars and wastes the rest of the axis on a
 * tail nobody can read. Buckets therefore span the 1st to 99th percentile and
 * the outliers are folded into the end bars, with the counts reported so the
 * chart can say what it left out.
 */
export function histogram(
  sortedValues: number[],
  buckets = 24,
  clip = 0.01,
): HistogramResult {
  if (sortedValues.length === 0) {
    return { buckets: [], lo: 0, hi: 0, clippedBelow: 0, clippedAbove: 0 };
  }
  const at = (q: number) =>
    sortedValues[Math.min(sortedValues.length - 1, Math.max(0, Math.round(q * (sortedValues.length - 1))))]!;
  const lo = at(clip);
  const hi = at(1 - clip);
  if (hi <= lo) {
    return { buckets: [{ x: lo, count: sortedValues.length }], lo, hi, clippedBelow: 0, clippedAbove: 0 };
  }

  const width = (hi - lo) / buckets;
  const out = Array.from({ length: buckets }, (_, i) => ({ x: lo + width * (i + 0.5), count: 0 }));
  let clippedBelow = 0;
  let clippedAbove = 0;
  for (const v of sortedValues) {
    if (v < lo) clippedBelow++;
    else if (v > hi) clippedAbove++;
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((v - lo) / width)));
    out[idx]!.count += 1;
  }
  return { buckets: out, lo, hi, clippedBelow, clippedAbove };
}
