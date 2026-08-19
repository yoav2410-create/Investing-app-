import { SEED_ACCOUNT, SEED_HOLDINGS, SEED_STOCKS, SEED_PLAN, FX_TO_USD } from '@/data/seed';
import { positionViews, sectorBuckets, cashTotal, concentration } from '@/domain/portfolio';
import { project, throughTranche } from '@/domain/plan';
import { valuationRead } from '@/domain/valuation';
import { trendRead } from '@/domain/technicals';

const cash = cashTotal(SEED_ACCOUNT, FX_TO_USD);

describe('seed portfolio is internally consistent', () => {
  it('lands near a $100K book', () => {
    expect(SEED_ACCOUNT.netLiquidationValue).toBeGreaterThan(95_000);
    expect(SEED_ACCOUNT.netLiquidationValue).toBeLessThan(120_000);
  });

  it('starts under the 30% cash floor, which is why the plan exists', () => {
    const pct = (cash / SEED_ACCOUNT.netLiquidationValue) * 100;
    expect(pct).toBeLessThan(30);
  });

  it('keeps every position under the 15% cap today', () => {
    const positions = positionViews(SEED_HOLDINGS, SEED_STOCKS, SEED_ACCOUNT.netLiquidationValue);
    expect(concentration(positions).topWeightPct).toBeLessThan(15);
  });

  it('reaches the cash floor once all three tranches are done', () => {
    const p = project(SEED_PLAN, SEED_HOLDINGS, SEED_STOCKS, cash, throughTranche(SEED_PLAN, 'C'));
    expect(p.cashPct).toBeGreaterThanOrEqual(29.5);
    expect(p.breaches.filter((b) => b.kind === 'cashFloor')).toHaveLength(0);
  });

  it('exits PLTR, VST and TSSI completely by tranche C', () => {
    const p = project(SEED_PLAN, SEED_HOLDINGS, SEED_STOCKS, cash, throughTranche(SEED_PLAN, 'C'));
    const tickers = p.positions.map((x) => x.ticker);
    expect(tickers).not.toContain('PLTR');
    expect(tickers).not.toContain('VST');
    expect(tickers).not.toContain('TSSI');
    expect(tickers).toEqual(expect.arrayContaining(['ISRG', 'AMZN', 'SMH']));
  });
});

describe('analytics survive the edge cases', () => {
  it('reads a trend from partial data (PLTR has no -DI)', () => {
    const s = SEED_STOCKS.PLTR!;
    const r = trendRead(s.quote.value!.price, s.technicals.value);
    expect(r.available).toBe(5);
    expect(r.score).toBeGreaterThan(0);
  });

  it('does not invent a valuation band for an ETF with no history', () => {
    const r = valuationRead(SEED_STOCKS.SMH!);
    expect(r.band).toBeNull();
    expect(r.sentence).toContain('No ');
  });

  it('places META below its own trailing range', () => {
    const r = valuationRead(SEED_STOCKS.META!);
    expect(r.band).toBe('cheap');
    expect(r.sentence).toMatch(/low end/);
  });

  it('tolerates nulls inside TSSI quarterly history', () => {
    const s = SEED_STOCKS.TSSI!;
    expect(s.fundamentals.value!.revenue.some((p) => p.value == null)).toBe(true);
    const r = valuationRead(s);
    expect(r.sampleSize).toBe(9);
    expect(r.band).not.toBeNull();
  });

  it('buckets every sector and totals to the book', () => {
    const positions = positionViews(SEED_HOLDINGS, SEED_STOCKS, SEED_ACCOUNT.netLiquidationValue);
    const buckets = sectorBuckets(positions, cash, SEED_ACCOUNT.netLiquidationValue, SEED_PLAN.constraints.targetMix);
    const total = buckets.reduce((s, b) => s + b.weightPct, 0);
    expect(total).toBeCloseTo(100, 1);
  });
});

describe('the valuation band compares like with like', () => {
  it('scores a forward-P/E name on its trailing P/E, not its forward one', () => {
    const r = valuationRead(SEED_STOCKS.MSFT!);
    expect(r.label).toBe('Forward P/E');
    // Headline stays forward; the band is computed from trailing.
    expect(r.current).toBe(SEED_STOCKS.MSFT!.valuation.value!.forwardPe);
    expect(r.comparedValue).toBe(SEED_STOCKS.MSFT!.valuation.value!.trailingPe);
    expect(r.sentence).toMatch(/like-for-like/);
  });

  it('does not read most of the book as cheap', () => {
    const bands = Object.values(SEED_STOCKS).map((s) => valuationRead(s).band);
    const cheap = bands.filter((b) => b === 'cheap').length;
    const rated = bands.filter((b) => b != null).length;
    expect(cheap).toBeLessThan(rated / 2);
  });

  it('uses the multiple directly when the history is in the same units', () => {
    const r = valuationRead(SEED_STOCKS.CEG!);
    expect(r.label).toBe('EV/EBITDA');
    expect(r.comparedValue).toBe(r.current);
    expect(r.comparedLabel).toBeNull();
  });
});
