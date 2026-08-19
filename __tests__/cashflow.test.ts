import { SEED_STOCKS } from '@/data/seed';
import { buildBridge, conversionTone, fcfYield } from '@/domain/cashflow';

describe('the EBITDA to FCF walk', () => {
  it('lands on the figure the company reported', () => {
    const r = buildBridge(SEED_STOCKS.META!.cashFlow.value)!;
    // 109.655 − 22.0 − 3.2 − 12.5 − 1.8 − 62.0 = 8.155
    expect(r.derivedFcf).toBeCloseTo(8_155_000_000, -3);
    expect(r.reportedFcf).toBe(8_155_000_000);
    expect(r.unexplained).toBeCloseTo(0, -3);
  });

  it('shows how little of META\'s EBITDA survives the capex', () => {
    const r = buildBridge(SEED_STOCKS.META!.cashFlow.value)!;
    expect(r.conversionPct).toBeCloseTo(7.4, 0);
    expect(r.capexIntensityPct).toBeCloseTo(56.5, 0);
    expect(r.sentence).toMatch(/capital expenditure/);
    expect(conversionTone(r.conversionPct)).toBe('down');
  });

  it('deducts stock-based compensation rather than adding it back', () => {
    const r = buildBridge(SEED_STOCKS.META!.cashFlow.value)!;
    const sbc = r.steps.find((s) => s.key === 'stockBasedCompensation')!;
    expect(sbc.delta).toBeLessThan(0);
    expect(r.cashEbitdaPct).toBeLessThan(100);
  });

  it('walks through the expected subtotals in order', () => {
    const r = buildBridge(SEED_STOCKS.CEG!.cashFlow.value)!;
    const subtotals = r.steps.filter((s) => s.isSubtotal).map((s) => s.key);
    expect(subtotals).toEqual([
      'adjustedEbitda',
      'cashEbitda',
      'operatingCashFlow',
      'freeCashFlow',
    ]);
  });

  it('separates an asset-light business from a capital-intensive one', () => {
    const software = buildBridge(SEED_STOCKS.NOW!.cashFlow.value)!;
    const power = buildBridge(SEED_STOCKS.CEG!.cashFlow.value)!;
    expect(software.capexIntensityPct!).toBeLessThan(power.capexIntensityPct!);
    expect(software.conversionPct!).toBeGreaterThan(power.conversionPct!);
  });

  it('flags a thin walk when several lines are missing but the chain holds', () => {
    const r = buildBridge({
      adjustedEbitda: 1000,
      stockBasedCompensation: 0,
      cashInterest: 100,
      cashTaxes: 100,
      workingCapitalChange: 0,
      capitalExpenditure: 200,
      otherItems: null,
      operatingCashFlow: null,
      freeCashFlow: null,
    })!;
    expect(r.derivedFcf).toBe(600);
    expect(r.conversionPct).toBe(60);
    expect(r.completeness.known).toBe(5);
  });

  it('breaks the running total rather than treating a gap as zero', () => {
    const r = buildBridge({
      adjustedEbitda: 1000,
      stockBasedCompensation: null,
      cashInterest: 100,
      cashTaxes: 100,
      workingCapitalChange: 0,
      capitalExpenditure: 200,
      otherItems: null,
      operatingCashFlow: null,
      freeCashFlow: null,
    })!;
    expect(r.derivedFcf).toBeNull();
    expect(r.completeness.known).toBe(4);
    // With the chain broken there is no conversion to state, and the copy says
    // so rather than quoting a ratio built on a hole.
    expect(r.conversionPct).toBeNull();
    expect(r.sentence).toMatch(/Not enough of the cash-flow lines/);
    // The steps before the gap still carry their running totals.
    expect(r.steps.find((s) => s.key === 'adjustedEbitda')!.runningTotal).toBe(1000);
    expect(r.steps.find((s) => s.key === 'cashEbitda')!.runningTotal).toBeNull();
  });

  it('returns nothing at all when there is no EBITDA to start from', () => {
    expect(buildBridge(null)).toBeNull();
    expect(buildBridge(SEED_STOCKS.SMH!.cashFlow.value)).toBeNull();
  });

  it('computes an FCF yield against market cap', () => {
    expect(fcfYield(8_155_000_000, 543.67, 2_566_000_000)).toBeCloseTo(0.58, 1);
    expect(fcfYield(100, null, 10)).toBeNull();
  });
});
