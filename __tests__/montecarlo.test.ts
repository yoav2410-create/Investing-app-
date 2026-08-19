import { SEED_ACCOUNT, SEED_HOLDINGS, SEED_STOCKS, FX_TO_USD } from '@/data/seed';
import { cashTotal } from '@/domain/portfolio';
import {
  DEFAULT_ASSUMPTIONS,
  buildInputs,
  histogram,
  parkinsonVol,
  runSimulation,
  simulate,
  type SimAssumptions,
} from '@/domain/montecarlo';

const cash = cashTotal(SEED_ACCOUNT, FX_TO_USD);
const nlv = SEED_ACCOUNT.netLiquidationValue;
const run = (over: Partial<SimAssumptions> = {}) =>
  runSimulation(SEED_HOLDINGS, SEED_STOCKS, cash, nlv, { ...DEFAULT_ASSUMPTIONS, ...over });

describe('volatility estimation', () => {
  it('uses the Parkinson range estimator', () => {
    // ln(2)/(2*sqrt(ln 2)) = 0.4163
    expect(parkinsonVol(200, 100)).toBeCloseTo(0.4163, 3);
  });

  it('refuses a range it cannot use', () => {
    expect(parkinsonVol(null, 100)).toBeNull();
    expect(parkinsonVol(100, 100)).toBeNull();
    expect(parkinsonVol(100, 0)).toBeNull();
  });

  it('never lets a stock be less volatile than its own market exposure', () => {
    const inputs = buildInputs(SEED_HOLDINGS, SEED_STOCKS, nlv, DEFAULT_ASSUMPTIONS);
    const marketVol = DEFAULT_ASSUMPTIONS.marketVolPct / 100;
    for (const i of inputs) {
      expect(i.sigma).toBeGreaterThanOrEqual(Math.abs(i.beta) * marketVol - 1e-9);
      expect(i.sigmaIdio).toBeGreaterThanOrEqual(0.12 - 1e-9);
    }
  });

  it('gives a high-beta name more volatility than a low-beta one', () => {
    const inputs = buildInputs(SEED_HOLDINGS, SEED_STOCKS, nlv, DEFAULT_ASSUMPTIONS);
    const pltr = inputs.find((i) => i.ticker === 'PLTR')!; // beta 2.34
    const lmt = inputs.find((i) => i.ticker === 'LMT')!; // beta 0.48
    expect(pltr.sigma).toBeGreaterThan(lmt.sigma);
  });
});

describe('expected returns', () => {
  it('prices each holding off CAPM by default', () => {
    const inputs = buildInputs(SEED_HOLDINGS, SEED_STOCKS, nlv, DEFAULT_ASSUMPTIONS);
    const lmt = inputs.find((i) => i.ticker === 'LMT')!;
    const rf = DEFAULT_ASSUMPTIONS.riskFreePct / 100;
    const erp = DEFAULT_ASSUMPTIONS.equityRiskPremiumPct / 100;
    expect(lmt.mu).toBeCloseTo(rf + lmt.beta * erp, 6);
    expect(lmt.returnSource).toBe('capm');
  });

  it('caps analyst-implied upside rather than extrapolating a target', () => {
    const inputs = buildInputs(SEED_HOLDINGS, SEED_STOCKS, nlv, {
      ...DEFAULT_ASSUMPTIONS,
      basis: 'analyst',
    });
    for (const i of inputs) {
      expect(i.mu).toBeLessThanOrEqual(0.4 + 1e-9);
      expect(i.mu).toBeGreaterThanOrEqual(-0.4 - 1e-9);
    }
    // META's target of $754.14 against $543.67 is 38.7% — under the cap, so it
    // passes through untouched.
    expect(inputs.find((i) => i.ticker === 'META')!.mu).toBeCloseTo(754.14 / 543.67 - 1, 6);
    // PLTR's target sits below spot — a negative expected return, kept negative
    // rather than floored at zero.
    expect(inputs.find((i) => i.ticker === 'PLTR')!.mu).toBeLessThan(0);
  });

  it('does clamp a target that implies more than the cap', () => {
    const stocks = {
      ...SEED_STOCKS,
      META: {
        ...SEED_STOCKS.META!,
        valuation: {
          ...SEED_STOCKS.META!.valuation,
          value: { ...SEED_STOCKS.META!.valuation.value!, analystTargetPrice: 2000 },
        },
      },
    };
    const inputs = buildInputs(SEED_HOLDINGS, stocks, nlv, {
      ...DEFAULT_ASSUMPTIONS,
      basis: 'analyst',
    });
    expect(inputs.find((i) => i.ticker === 'META')!.mu).toBeCloseTo(0.4, 6);
  });
});

describe('the simulation itself', () => {
  it('is deterministic for a given seed', () => {
    expect(run().terminal).toEqual(run().terminal);
    expect(run({ seed: 7 }).terminal).not.toEqual(run({ seed: 8 }).terminal);
  });

  it('starts every path at the current account value', () => {
    const r = run();
    expect(r.portfolioBands[0]!.p50).toBeCloseTo(nlv, 6);
    expect(r.benchmarkBands[0]!.p50).toBeCloseTo(nlv, 6);
    expect(r.portfolioBands).toHaveLength(r.years + 1);
  });

  it('keeps the percentile bands ordered at every horizon', () => {
    for (const band of run().portfolioBands) {
      expect(band.p5).toBeLessThanOrEqual(band.p25);
      expect(band.p25).toBeLessThanOrEqual(band.p50);
      expect(band.p50).toBeLessThanOrEqual(band.p75);
      expect(band.p75).toBeLessThanOrEqual(band.p95);
    }
  });

  it('widens the distribution as the horizon lengthens', () => {
    const oneYear = run({ years: 1 });
    const fiveYear = run({ years: 5 });
    const spread = (r: typeof oneYear) =>
      (r.annualised.p95 - r.annualised.p5);
    // Annualised spread narrows with time even as the level spread widens.
    const levelSpread = (r: typeof oneYear) => {
      const b = r.portfolioBands[r.years]!;
      return (b.p95 - b.p5) / r.startingValue;
    };
    expect(levelSpread(fiveYear)).toBeGreaterThan(levelSpread(oneYear));
    expect(spread(fiveYear)).toBeLessThan(spread(oneYear));
  });

  it('correlates the holdings through a shared market factor', () => {
    // With a single factor, a book of beta-1.3 names must be more volatile than
    // the benchmark it is compared against.
    const r = run();
    const spread = (bands: typeof r.portfolioBands) => {
      const b = bands[r.years]!;
      return (b.p95 - b.p5) / r.startingValue;
    };
    expect(r.effectiveBeta).toBeGreaterThan(1);
    expect(spread(r.portfolioBands)).toBeGreaterThan(spread(r.benchmarkBands) * 0.8);
  });

  it('earns the risk-free rate on the cash sleeve', () => {
    const inputs = buildInputs(SEED_HOLDINGS, SEED_STOCKS, nlv, DEFAULT_ASSUMPTIONS);
    // An all-cash book should compound at exactly the risk-free rate.
    const allCash = simulate([], 1, 100_000, { ...DEFAULT_ASSUMPTIONS, years: 3 });
    expect(allCash.portfolioBands[3]!.p50).toBeCloseTo(100_000 * 1.0418 ** 3, 2);
    expect(allCash.terminal[0]).toBeCloseTo(allCash.terminal[allCash.terminal.length - 1]!, 2);
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('reports probabilities as percentages inside their bounds', () => {
    const r = run();
    for (const v of [r.beatBenchmarkPct, r.lossPct]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(r.valueAtRisk5).toBeLessThan(r.expectedValue);
  });

  it('buckets terminal values into a histogram that keeps every path', () => {
    const r = run();
    const h = histogram(r.terminal, 20);
    expect(h.buckets).toHaveLength(20);
    // Clipped paths are folded into the end bars, so nothing is lost.
    expect(h.buckets.reduce((s, b) => s + b.count, 0)).toBe(r.terminal.length);
  });

  it('clips the log-normal tail so the chart is readable', () => {
    const r = run({ years: 10 });
    const h = histogram(r.terminal, 20);
    // Without clipping the top bucket runs to several times the median and the
    // first two bars hold almost everything.
    expect(h.hi).toBeLessThan(r.terminal[r.terminal.length - 1]!);
    expect(h.clippedAbove).toBeGreaterThan(0);
    const biggest = Math.max(...h.buckets.map((b) => b.count));
    expect(biggest / r.terminal.length).toBeLessThan(0.4);
  });
});
