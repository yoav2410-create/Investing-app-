import { diffHoldings, type ParsedPosition, type ResearchResult } from '@/data/provider/claude';
import { applyPositions, blankStock, mergeResearch, quoteFromParsed } from '@/data/claudeSync';
import { SEED_HOLDINGS, SEED_STOCKS } from '@/data/seed';
import type { Holding } from '@/domain/types';

const sectorFor = () => 'tech' as const;

function parsed(over: Partial<ParsedPosition> & { ticker: string }): ParsedPosition {
  return {
    companyName: null,
    shares: null,
    price: null,
    marketValue: null,
    averageCost: null,
    unrealizedPnl: null,
    unrealizedPnlPct: null,
    dayChangePct: null,
    confidence: 1,
    note: null,
    ...over,
  };
}

describe('reading a screenshot into a diff', () => {
  const holdings: Holding[] = [
    { ticker: 'META', shares: 11, costBasis: 590.2, sector: 'tech' },
    { ticker: 'PLTR', shares: 100, costBasis: 68.4, sector: 'tech' },
  ];

  it('classifies added, removed, changed and unchanged', () => {
    const diffs = diffHoldings(
      holdings,
      [
        parsed({ ticker: 'META', shares: 11, price: 543.67, averageCost: 590.2 }),
        parsed({ ticker: 'PLTR', shares: 45, price: 152.3, averageCost: 68.4 }),
        parsed({ ticker: 'NVDA', shares: 20, price: 180 }),
      ],
      sectorFor,
    );
    const kinds = Object.fromEntries(diffs.map((d) => [d.ticker, d.kind]));
    expect(kinds).toEqual({ META: 'unchanged', PLTR: 'changed', NVDA: 'added' });
  });

  it('treats a ticker missing from the screenshot as removed', () => {
    const diffs = diffHoldings(holdings, [parsed({ ticker: 'META', shares: 11 })], sectorFor);
    expect(diffs.find((d) => d.ticker === 'PLTR')?.kind).toBe('removed');
  });

  it('never guesses a share count it could not read', () => {
    const diffs = diffHoldings(holdings, [parsed({ ticker: 'META', shares: null, price: 500 })], sectorFor);
    const meta = diffs.find((d) => d.ticker === 'META')!;
    expect(meta.kind).toBe('unchanged');
    expect(meta.after?.shares).toBe(11);
    expect(meta.note).toMatch(/not readable/i);
  });

  it('derives average cost from price and unrealised P&L when the broker hides it', () => {
    const diffs = diffHoldings(
      [],
      [parsed({ ticker: 'AAPL', shares: 10, price: 200, unrealizedPnl: 500 })],
      sectorFor,
    );
    // 10 shares up $500 means $50/share of gain, so cost was $150.
    expect(diffs[0]!.after!.costBasis).toBeCloseTo(150, 6);
  });
});

describe('applying an approved diff', () => {
  it('skips rows the owner unticked', () => {
    const positions = [
      parsed({ ticker: 'META', shares: 5, price: 543.67 }),
      parsed({ ticker: 'PLTR', shares: 45, price: 152.3 }),
    ];
    const diffs = diffHoldings(SEED_HOLDINGS, positions, sectorFor);
    const result = applyPositions({
      diffs,
      parsed: positions,
      holdings: SEED_HOLDINGS,
      stocks: SEED_STOCKS,
      sectorFor,
      skipped: new Set(['META']),
    });
    // The point is that the skipped row is untouched, not what the number is.
    const metaBefore = SEED_HOLDINGS.find((h) => h.ticker === 'META')!.shares;
    expect(result.holdings.find((h) => h.ticker === 'META')?.shares).toBe(metaBefore);
    expect(result.holdings.find((h) => h.ticker === 'PLTR')?.shares).toBe(45);
  });

  it('flags a brand-new ticker as needing research', () => {
    const positions = [parsed({ ticker: 'NVDA', shares: 20, price: 180 })];
    const diffs = diffHoldings(SEED_HOLDINGS, positions, sectorFor).filter((d) => d.kind === 'added');
    const result = applyPositions({
      diffs,
      parsed: positions,
      holdings: SEED_HOLDINGS,
      stocks: SEED_STOCKS,
      sectorFor,
    });
    expect(result.needResearch).toContain('NVDA');
    expect(result.stocks.NVDA!.narrative.thesis).toMatch(/not researched/i);
  });
});

describe('quote reconstruction', () => {
  it('backs out the previous close from the day percentage', () => {
    const q = quoteFromParsed(parsed({ ticker: 'X', price: 110, dayChangePct: 10 }), null)!;
    expect(q.previousClose).toBeCloseTo(100, 6);
    expect(q.change).toBeCloseTo(10, 6);
  });

  it('falls back to market value over shares when no price column is shown', () => {
    const q = quoteFromParsed(parsed({ ticker: 'X', shares: 4, marketValue: 400 }), null)!;
    expect(q.price).toBe(100);
  });

  it('keeps the previous quote when nothing usable was read', () => {
    const existing = SEED_STOCKS.META!.quote.value!;
    expect(quoteFromParsed(parsed({ ticker: 'META' }), existing)).toBe(existing);
  });
});

describe('merging research', () => {
  function research(over: Partial<ResearchResult> = {}): ResearchResult {
    return {
      ticker: 'META',
      companyName: 'Meta Platforms',
      primaryMultiple: 'forwardPe',
      primaryMultipleRationale: '',
      peerGroup: null,
      peerMedianMultiple: null,
      valuation: {
        trailingPe: null, forwardPe: null, priceToSales: null, evToEbitda: null,
        peg: null, profitMargin: null, operatingMargin: null, shortInterestPct: null,
        beta: null, week52ChangePct: null, dividendYield: null, analystTargetPrice: null,
        analystRating: null, week52High: null, week52Low: null, debtToEquity: null,
      },
      quarters: [],
      quality: {
        returnOnEquity: null, returnOnInvestedCapital: null, grossMargin: null,
        freeCashFlowMargin: null, netDebtToEbitda: null, revenueCagr3y: null,
        revenueGrowthYoY: null, epsGrowthYoY: null, insiderOwnershipPct: null,
        institutionalOwnershipPct: null, shareCountChangePct: null,
      },
      cashFlow: {
        adjustedEbitda: null, stockBasedCompensation: null, cashInterest: null,
        cashTaxes: null, workingCapitalChange: null, capitalExpenditure: null,
        otherItems: null, operatingCashFlow: null, freeCashFlow: null,
      },
      momentum: {
        oneMonth: null, threeMonth: null, sixMonth: null, oneYear: null,
        yearToDate: null, fromHighPct: null, fromLowPct: null,
      },
      technicals: {
        rsi14: null, rsi20: null, sma20: null, sma50: null,
        sma100: null, sma200: null, plusDi: null, minusDi: null,
      },
      earnings: {
        date: null, quarter: null, reportedEps: null, estimatedEps: null,
        surprisePct: null, revenue: null, callSummary: null, managementSaid: null,
        guidance: null, watchNext: null, reactionPct: null, quotes: [],
      },
      sentiment: { score: null, label: null, summary: null, analystRevisions: null, insiderActivity: null, insiderDetail: null, headlines: [] },
      narrative: {
        thesis: 'x', catalyst: 'y', risk: 'z', bullCase: 'b', bearCase: 'c',
        whatWouldChangeMyMind: 'd', verdict: 'hold', verdictReasoning: 'r',
      },
      nextEarningsDate: null,
      sources: [],
      ...over,
    };
  }

  it('never lets a null overwrite a value already on file', () => {
    const before = SEED_STOCKS.META!;
    const after = mergeResearch(before, research(), 'META');
    expect(after.valuation.value!.trailingPe).toBe(before.valuation.value!.trailingPe);
    expect(after.valuation.value!.beta).toBe(before.valuation.value!.beta);
    expect(after.earnings.value!.managementSaid).toBe(before.earnings.value!.managementSaid);
  });

  it('keeps the existing series when the model returns no quarters', () => {
    const before = SEED_STOCKS.META!;
    const after = mergeResearch(before, research(), 'META');
    expect(after.fundamentals.value!.revenue).toHaveLength(8);
    expect(after.multipleHistory.value!.peHistory).toHaveLength(10);
  });

  it('takes new figures when the model does supply them', () => {
    const after = mergeResearch(
      SEED_STOCKS.META!,
      research({
        valuation: { ...research().valuation, forwardPe: 15.5 },
        quarters: [
          { period: '2026-06-30', revenue: 60_801, operatingIncome: 18_775, netIncome: 15_848, eps: 6.18, trailingPe: 22.2, evToEbitda: 13.6, priceToSales: 6.3 },
        ],
      }),
      'META',
    );
    expect(after.valuation.value!.forwardPe).toBe(15.5);
    expect(after.fundamentals.value!.revenue[0]!.value).toBe(60_801_000_000);
    expect(after.fundamentals.value!.netIncome[0]!.value).toBe(15_848_000_000);
    expect(after.valuation.source).toBe('manual');
  });

  it('scales the cash-flow walk from millions into absolute dollars', () => {
    const after = mergeResearch(
      SEED_STOCKS.NOW!,
      research({
        cashFlow: { ...research().cashFlow, adjustedEbitda: 2_400, capitalExpenditure: 180 },
      }),
      'NOW',
    );
    expect(after.cashFlow.value!.adjustedEbitda).toBe(2_400_000_000);
    expect(after.cashFlow.value!.capitalExpenditure).toBe(180_000_000);
    // Lines the model left null keep whatever the seed had.
    expect(after.cashFlow.value!.cashTaxes).toBe(SEED_STOCKS.NOW!.cashFlow.value!.cashTaxes);
  });

  it('builds a safe record for a ticker it has never seen', () => {
    const s = blankStock('NVDA', parsed({ ticker: 'NVDA', shares: 10, price: 180 }), 'tech');
    expect(s.valuation.value).toBeNull();
    expect(s.fundamentals.value).toBeNull();
    expect(s.cashFlow.value).toBeNull();
    expect(s.quote.value!.price).toBe(180);
    expect(s.narrative.verdict).toBe('watch');
  });
});
