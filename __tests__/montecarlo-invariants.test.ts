import {
  DEFAULT_ASSUMPTIONS,
  buildInputs,
  runSimulation,
  simulate,
  type HoldingInput,
} from '@/domain/montecarlo';

import { SEED_ACCOUNT, SEED_HOLDINGS, SEED_STOCKS } from '@/data/seed';

/**
 * Invariants the simulation must satisfy exactly, not statistically.
 *
 * The existing tests exercise realistic books, where every figure is a cloud
 * of randomness and "looks reasonable" is the strongest available assertion.
 * These pin the corners where the right answer is known to the last digit —
 * because a drift term applied twice, or a benchmark drawing different noise
 * than the book, would still produce reasonable-looking clouds.
 */

const A = { ...DEFAULT_ASSUMPTIONS, paths: 400 };

function input(over: Partial<HoldingInput> = {}): HoldingInput {
  return {
    ticker: 'X',
    weight: 1,
    beta: 1,
    mu: 0.08,
    sigma: 0.16,
    sigmaIdio: 0,
    volSource: 'beta',
    returnSource: 'capm',
    ...over,
  };
}

describe('determinism', () => {
  it('the same seed produces the same simulation to the last digit', () => {
    const a = runSimulation(SEED_HOLDINGS, SEED_STOCKS, 15_000, 104_691, A);
    const b = runSimulation(SEED_HOLDINGS, SEED_STOCKS, 15_000, 104_691, A);
    expect(a.terminal).toEqual(b.terminal);
    expect(a.beatBenchmarkPct).toBe(b.beatBenchmarkPct);
    expect(a.portfolioBands).toEqual(b.portfolioBands);
  });
});

describe('an all-cash book', () => {
  it('compounds at exactly the risk-free rate with zero spread', () => {
    const sim = simulate([], 1, 100_000, { ...A, riskFreePct: 4 });
    for (let year = 0; year <= sim.years; year++) {
      const expected = 100_000 * Math.pow(1.04, year);
      const band = sim.portfolioBands[year]!;
      // No randomness touches cash, so every percentile is the same number.
      expect(band.p5).toBeCloseTo(expected, 6);
      expect(band.p95).toBeCloseTo(expected, 6);
    }
    expect(sim.lossPct).toBe(0);
    expect(sim.effectiveBeta).toBe(0);
  });
});

describe('a book that is the index', () => {
  it('tracks the benchmark path for path, so beating it is impossible', () => {
    // Beta one, no idiosyncratic noise, and the market drift as mu: the
    // holding's log-return collapses to the benchmark's. If the two ever
    // diverge, the benchmark is drawing different noise than the book, and
    // "beats the S&P in N% of paths" stops being a like-for-like count.
    const marketMu = A.riskFreePct / 100 + A.equityRiskPremiumPct / 100;
    const sim = simulate(
      [input({ mu: marketMu, sigma: A.marketVolPct / 100, sigmaIdio: 0 })],
      0,
      100_000,
      A,
    );
    for (let year = 0; year <= sim.years; year++) {
      expect(sim.portfolioBands[year]!.p50).toBeCloseTo(sim.benchmarkBands[year]!.p50, 6);
    }
    // Strictly-greater on identical values is false: 0% of paths "beat".
    expect(sim.beatBenchmarkPct).toBe(0);
  });
});

describe('internal consistency', () => {
  const sim = runSimulation(SEED_HOLDINGS, SEED_STOCKS, 15_000, 104_691, A);

  it('percentile bands are ordered at every year', () => {
    for (const band of sim.portfolioBands) {
      expect(band.p5).toBeLessThanOrEqual(band.p25);
      expect(band.p25).toBeLessThanOrEqual(band.p50);
      expect(band.p50).toBeLessThanOrEqual(band.p75);
      expect(band.p75).toBeLessThanOrEqual(band.p95);
    }
  });

  it('the loss share matches a direct count of the terminal array', () => {
    const below = sim.terminal.filter((v) => v < sim.startingValue).length;
    expect(sim.lossPct).toBeCloseTo((below / sim.terminal.length) * 100, 10);
  });

  it('value-at-risk is the 5th percentile the bands report', () => {
    expect(sim.valueAtRisk5).toBe(sim.portfolioBands[sim.years]!.p5);
  });

  it('the annualised median inverts back to the terminal median', () => {
    const p50 = sim.portfolioBands[sim.years]!.p50;
    const rebuilt = sim.startingValue * Math.pow(1 + sim.annualised.p50 / 100, sim.years);
    expect(rebuilt).toBeCloseTo(p50, 6);
  });
});

describe('holdings the projection cannot price', () => {
  it('leaves an unpriced position out rather than valuing it at zero', () => {
    const holdings = [...SEED_HOLDINGS, { ticker: 'NOPRICE', shares: 10, costBasis: 50, sector: 'tech' as const }];
    const stocks = {
      ...SEED_STOCKS,
      NOPRICE: {
        ...SEED_STOCKS.META!,
        ticker: 'NOPRICE',
        quote: { value: null, asOf: null, source: 'unavailable' as const },
      },
    };
    const inputs = buildInputs(holdings, stocks, SEED_ACCOUNT.netLiquidationValue, DEFAULT_ASSUMPTIONS);
    expect(inputs.some((i) => i.ticker === 'NOPRICE')).toBe(false);
    // And the rest are all still there, so the omission is one name, not a
    // silent truncation of the book.
    expect(inputs.length).toBe(SEED_HOLDINGS.length);
  });

  it('includes a newly imported name as soon as it has a price', () => {
    const holdings = [...SEED_HOLDINGS, { ticker: 'FRESH', shares: 10, costBasis: 50, sector: 'tech' as const }];
    const stocks = {
      ...SEED_STOCKS,
      FRESH: {
        ...SEED_STOCKS.META!,
        ticker: 'FRESH',
        quote: {
          value: { price: 60, previousClose: 59, change: 1, changePct: 1.7, volume: null, tradingDay: '2026-08-22' },
          asOf: '2026-08-22T00:00:00.000Z',
          source: 'finnhub' as const,
        },
        // Never researched: no beta, no 52-week range.
        valuation: { value: null, asOf: null, source: 'unavailable' as const },
      },
    };
    const inputs = buildInputs(holdings, stocks, SEED_ACCOUNT.netLiquidationValue, DEFAULT_ASSUMPTIONS);
    const fresh = inputs.find((i) => i.ticker === 'FRESH');
    expect(fresh).toBeDefined();
    // With nothing researched it falls back to market risk, and says so.
    expect(fresh!.beta).toBe(1);
    expect(fresh!.volSource).toBe('default');
  });
});
