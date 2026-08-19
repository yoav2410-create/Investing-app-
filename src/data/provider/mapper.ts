import type {
  EarningsCall,
  FundamentalsSeries,
  MultipleHistory,
  OptionsPositioning,
  QuarterPoint,
  Quote,
  ValuationSnapshot,
} from '@/domain/types';
import { quarterLabel } from '@/domain/format';
import type { Candle } from '@/domain/technicals';
import type {
  AvBalanceSheet,
  AvEarnings,
  AvGlobalQuote,
  AvIncomeStatement,
  AvOverview,
  AvPutCall,
  AvTimeSeriesDaily,
} from './alphaVantage';

/** Alpha Vantage writes "None", "-" and "" for missing numbers. */
export function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = v.trim();
  if (!t || t === 'None' || t === '-' || t === 'null') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Newest-first candles, ready for the technicals engine. */
export function toCandles(payload: AvTimeSeriesDaily): Candle[] {
  const series = payload['Time Series (Daily)'];
  if (!series) return [];
  return Object.entries(series)
    .map(([date, row]) => ({
      date,
      high: Number(row['2. high']),
      low: Number(row['3. low']),
      close: Number(row['4. close']),
    }))
    .filter((c) => Number.isFinite(c.close))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function quoteFromCandles(payload: AvTimeSeriesDaily): Quote | null {
  const series = payload['Time Series (Daily)'];
  if (!series) return null;
  const dates = Object.keys(series).sort().reverse();
  const today = dates[0];
  const prev = dates[1];
  if (!today) return null;
  const row = series[today]!;
  const price = num(row['4. close']);
  if (price == null) return null;
  const previousClose = prev ? (num(series[prev]!['4. close']) ?? price) : price;
  const change = price - previousClose;
  return {
    price,
    previousClose,
    change,
    changePct: previousClose === 0 ? 0 : (change / previousClose) * 100,
    volume: num(row['5. volume']),
    tradingDay: today,
  };
}

export function quoteFromGlobalQuote(payload: AvGlobalQuote): Quote | null {
  const g = payload['Global Quote'];
  if (!g) return null;
  const price = num(g['05. price']);
  const previousClose = num(g['08. previous close']);
  if (price == null || previousClose == null) return null;
  const change = price - previousClose;
  return {
    price,
    previousClose,
    change,
    changePct: previousClose === 0 ? 0 : (change / previousClose) * 100,
    volume: num(g['06. volume']),
    tradingDay: g['07. latest trading day'] ?? new Date().toISOString().slice(0, 10),
  };
}

function analystRating(o: AvOverview): string | null {
  const buckets: [string, number | null][] = [
    ['strong buy', num(o.AnalystRatingStrongBuy)],
    ['buy', num(o.AnalystRatingBuy)],
    ['hold', num(o.AnalystRatingHold)],
    ['sell', num(o.AnalystRatingSell)],
    ['strong sell', num(o.AnalystRatingStrongSell)],
  ];
  const total = buckets.reduce((s, [, n]) => s + (n ?? 0), 0);
  if (total === 0) return null;
  const bullish = (num(o.AnalystRatingStrongBuy) ?? 0) + (num(o.AnalystRatingBuy) ?? 0);
  const label = bullish / total >= 0.6 ? 'Buy' : bullish / total >= 0.35 ? 'Hold' : 'Sell';
  return `${label} (${bullish} of ${total} buy or better)`;
}

/**
 * OVERVIEW carries most of the valuation block. Short interest, 52-week change
 * and debt/equity are not in it — the first has no Alpha Vantage source at all,
 * the other two are filled in from the price series and balance sheet.
 */
export function valuationFromOverview(
  o: AvOverview,
  extras: { week52ChangePct?: number | null; debtToEquity?: number | null; shortInterestPct?: number | null } = {},
): ValuationSnapshot {
  const dividendYield = num(o.DividendYield);
  const profitMargin = num(o.ProfitMargin);
  const operatingMargin = num(o.OperatingMarginTTM);
  return {
    trailingPe: num(o.PERatio),
    forwardPe: num(o.ForwardPE),
    priceToSales: num(o.PriceToSalesRatioTTM),
    evToEbitda: num(o.EVToEBITDA),
    peg: num(o.PEGRatio),
    // Alpha Vantage reports these as fractions; the app shows percentages.
    profitMargin: profitMargin == null ? null : profitMargin * 100,
    operatingMargin: operatingMargin == null ? null : operatingMargin * 100,
    shortInterestPct: extras.shortInterestPct ?? null,
    beta: num(o.Beta),
    week52ChangePct: extras.week52ChangePct ?? null,
    dividendYield: dividendYield == null ? null : dividendYield * 100,
    analystTargetPrice: num(o.AnalystTargetPrice),
    analystRating: analystRating(o),
    week52High: num(o['52WeekHigh']),
    week52Low: num(o['52WeekLow']),
    debtToEquity: extras.debtToEquity ?? null,
  };
}

/** Percentage change against the close closest to a year ago. */
export function week52Change(candles: Candle[]): number | null {
  if (candles.length < 2) return null;
  const latest = candles[0]!;
  const target = new Date(latest.date).getTime() - 365 * 86_400_000;
  let best: Candle | null = null;
  let bestGap = Infinity;
  for (const c of candles) {
    const gap = Math.abs(new Date(c.date).getTime() - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = c;
    }
  }
  // Anything more than 45 days off the anniversary is not a 52-week change.
  if (!best || bestGap > 45 * 86_400_000 || best.close === 0) return null;
  return ((latest.close - best.close) / best.close) * 100;
}

export function debtToEquity(bs: AvBalanceSheet): number | null {
  const q = bs.quarterlyReports?.[0];
  if (!q) return null;
  const debt = num(q.shortLongTermDebtTotal);
  const equity = num(q.totalShareholderEquity);
  if (debt == null || equity == null || equity === 0) return null;
  return debt / equity;
}

function point(period: string, value: number | null): QuarterPoint {
  return { period, label: quarterLabel(period), value };
}

export function fundamentalsFrom(
  income: AvIncomeStatement,
  earnings: AvEarnings,
  quarters = 8,
): FundamentalsSeries {
  const rows = (income.quarterlyReports ?? []).slice(0, quarters);
  const epsRows = (earnings.quarterlyEarnings ?? []).slice(0, quarters);
  return {
    revenue: rows.map((r) => point(r.fiscalDateEnding, num(r.totalRevenue))),
    operatingIncome: rows.map((r) => point(r.fiscalDateEnding, num(r.operatingIncome))),
    netIncome: rows.map((r) => point(r.fiscalDateEnding, num(r.netIncome))),
    eps: epsRows.map((r) => point(r.fiscalDateEnding, num(r.reportedEPS))),
  };
}

/**
 * Derive 10 quarters of P/E and EV/EBITDA.
 *
 * Alpha Vantage publishes neither as a history, so both are reconstructed:
 * quarter-end close over trailing-twelve-month EPS, and quarter-end enterprise
 * value over trailing-twelve-month EBITDA. Anything that cannot be built from
 * complete inputs comes back null rather than interpolated.
 */
export function multipleHistoryFrom(
  candles: Candle[],
  income: AvIncomeStatement,
  balance: AvBalanceSheet,
  earnings: AvEarnings,
  quarters = 10,
): MultipleHistory {
  const incomeRows = income.quarterlyReports ?? [];
  const balanceByDate = new Map(
    (balance.quarterlyReports ?? []).map((r) => [r.fiscalDateEnding, r]),
  );
  const epsByDate = new Map(
    (earnings.quarterlyEarnings ?? []).map((r) => [r.fiscalDateEnding, num(r.reportedEPS)]),
  );

  const closeOn = (date: string): number | null => {
    const target = new Date(date).getTime();
    let best: Candle | null = null;
    let bestGap = Infinity;
    for (const c of candles) {
      const gap = Math.abs(new Date(c.date).getTime() - target);
      if (gap < bestGap) {
        bestGap = gap;
        best = c;
      }
    }
    return best && bestGap <= 10 * 86_400_000 ? best.close : null;
  };

  const trailing = (index: number, get: (i: number) => number | null): number | null => {
    let sum = 0;
    for (let i = index; i < index + 4; i++) {
      const v = get(i);
      if (v == null) return null;
      sum += v;
    }
    return sum;
  };

  const peHistory: QuarterPoint[] = [];
  const evEbitdaHistory: QuarterPoint[] = [];
  const psHistory: QuarterPoint[] = [];

  for (let i = 0; i < Math.min(quarters, incomeRows.length); i++) {
    const row = incomeRows[i]!;
    const period = row.fiscalDateEnding;
    const price = closeOn(period);

    const ttmEps = trailing(i, (j) => {
      const d = incomeRows[j]?.fiscalDateEnding;
      return d ? (epsByDate.get(d) ?? null) : null;
    });
    peHistory.push(
      point(period, price != null && ttmEps != null && ttmEps > 0 ? price / ttmEps : null),
    );

    const ttmEbitda = trailing(i, (j) => num(incomeRows[j]?.ebitda));
    const ttmRevenue = trailing(i, (j) => num(incomeRows[j]?.totalRevenue));
    const bs = balanceByDate.get(period);
    const sharesOut = num(bs?.commonStockSharesOutstanding);
    const debt = num(bs?.shortLongTermDebtTotal);
    const cash =
      (num(bs?.cashAndCashEquivalentsAtCarryingValue) ?? 0) + (num(bs?.shortTermInvestments) ?? 0);

    const marketCap = price != null && sharesOut != null ? price * sharesOut : null;
    const ev = marketCap != null && debt != null ? marketCap + debt - cash : null;
    evEbitdaHistory.push(
      point(period, ev != null && ttmEbitda != null && ttmEbitda > 0 ? ev / ttmEbitda : null),
    );
    psHistory.push(
      point(
        period,
        marketCap != null && ttmRevenue != null && ttmRevenue > 0 ? marketCap / ttmRevenue : null,
      ),
    );
  }

  return { peHistory, evEbitdaHistory, psHistory };
}

export function optionsFrom(pc: AvPutCall): OptionsPositioning {
  return {
    putCallVolume: num(pc.put_call_ratio_full_chain),
    putCallOpenInterest: null,
  };
}

/**
 * Latest reported quarter. `managementSaid` and `guidance` stay null here —
 * they are the curated narrative layer and are never synthesised from numbers
 * the API returned. See docs/DATA.md.
 */
export function earningsFrom(
  earnings: AvEarnings,
  income: AvIncomeStatement,
): EarningsCall | null {
  const q = earnings.quarterlyEarnings?.[0];
  if (!q) return null;
  const revenueRow = (income.quarterlyReports ?? []).find(
    (r) => r.fiscalDateEnding === q.fiscalDateEnding,
  );
  return {
    date: q.reportedDate ?? q.fiscalDateEnding,
    quarter: quarterLabel(q.fiscalDateEnding),
    reportedEps: num(q.reportedEPS),
    estimatedEps: num(q.estimatedEPS),
    surprisePct: num(q.surprisePercentage),
    revenue: num(revenueRow?.totalRevenue),
    managementSaid: null,
    guidance: null,
    watchNext: null,
  };
}

/** The reported date of the most recent quarter, used for new-earnings detection. */
export function latestReportDate(earnings: AvEarnings): string | null {
  const q = earnings.quarterlyEarnings?.[0];
  return q?.reportedDate ?? q?.fiscalDateEnding ?? null;
}
