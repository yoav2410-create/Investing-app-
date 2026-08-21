import { capitalSplit, positionViews, yearGrowth } from '@/domain/portfolio';
import { SEED_HOLDINGS, SEED_STOCKS } from '@/data/seed';

const snap = (date: string, netLiquidationValue: number) => ({ date, netLiquidationValue });

describe('yearGrowth', () => {
  it('returns nothing for fewer than two snapshots — one point is not growth', () => {
    expect(yearGrowth([])).toEqual([]);
    expect(yearGrowth([snap('2026-08-20', 100_000)])).toEqual([]);
  });

  it('measures a single running year from its own earliest snapshot', () => {
    const rows = yearGrowth([snap('2026-02-01', 100_000), snap('2026-08-20', 110_000)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe('2026 YTD');
    expect(rows[0]!.changePct).toBeCloseTo(10);
  });

  it('measures completed years end-to-end and the running year from the last year end', () => {
    const rows = yearGrowth([
      snap('2024-03-01', 80_000),
      snap('2024-12-30', 88_000),
      snap('2025-12-31', 110_000),
      snap('2026-08-20', 99_000),
    ]);
    // 2024: within itself (nothing before it). 2025: vs 2024 end. 2026 YTD: vs 2025 end.
    expect(rows.map((r) => r.label)).toEqual(['2024', '2025', '2026 YTD']);
    expect(rows[0]!.changePct).toBeCloseTo(10);
    expect(rows[1]!.changePct).toBeCloseTo(25);
    expect(rows[2]!.changePct).toBeCloseTo(-10);
  });

  it('does not care what order the snapshots arrive in', () => {
    const shuffled = yearGrowth([snap('2026-08-20', 110_000), snap('2026-02-01', 100_000)]);
    expect(shuffled[0]!.changePct).toBeCloseTo(10);
  });
});

describe('capitalSplit', () => {
  const nlv = 104_691;
  const positions = positionViews(SEED_HOLDINGS, SEED_STOCKS, nlv);

  it('splits the seed book into equity and cash with nothing invented', () => {
    const split = capitalSplit(positions, 17_700, nlv);
    // The seed book holds no T-bill ETF, and that must read as zero held —
    // not as a guessed allocation.
    expect(split.cashLikePct).toBe(0);
    expect(split.cashLikeTickers).toEqual([]);
    expect(split.cashPct).toBeCloseTo((17_700 / nlv) * 100, 5);
    expect(split.equityPct).toBeGreaterThan(50);
    // Equity + cash covers most of the book; the remainder is unpriced names.
    expect(split.equityPct + split.cashPct).toBeLessThanOrEqual(100.01);
  });

  it('moves SGOV out of equity and into cash-like', () => {
    const withSgov = [
      ...positions,
      {
        ...positions[0]!,
        ticker: 'SGOV',
        marketValue: 10_000,
      },
    ];
    const split = capitalSplit(withSgov, 17_700, nlv);
    expect(split.cashLikePct).toBeCloseTo((10_000 / nlv) * 100, 5);
    expect(split.cashLikeTickers).toEqual(['SGOV']);
  });

  it('answers zeros rather than NaN on an empty book', () => {
    expect(capitalSplit([], 0, 0)).toEqual({
      equityPct: 0,
      cashPct: 0,
      cashLikePct: 0,
      cashLikeTickers: [],
    });
  });
});
