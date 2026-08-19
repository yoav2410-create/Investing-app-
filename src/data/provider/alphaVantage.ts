/**
 * Alpha Vantage client.
 *
 * Deliberately thin: every call goes through `request`, which is the single
 * place that knows how Alpha Vantage signals problems. The API answers with
 * HTTP 200 for rate limits and bad symbols alike, putting the complaint in a
 * `Note`, `Information` or `Error Message` field — so status codes alone are
 * not enough to tell success from failure.
 */

export const AV_BASE = 'https://www.alphavantage.co/query';

export type AvFailureKind = 'rateLimit' | 'premiumRequired' | 'notFound' | 'network' | 'malformed';

export class AvError extends Error {
  constructor(
    readonly kind: AvFailureKind,
    message: string,
    readonly fn?: string,
    readonly symbol?: string,
  ) {
    super(message);
    this.name = 'AvError';
  }

  /** Rate limits and entitlement problems are worth stopping the run for. */
  get isFatalForRun(): boolean {
    return this.kind === 'rateLimit' || this.kind === 'premiumRequired';
  }
}

export interface AvClientOptions {
  apiKey: string;
  /** Injected so tests and the ingest script can supply their own. */
  fetchImpl?: typeof fetch;
  /** Called before every request; the scheduler uses it to charge the budget. */
  onRequest?: (fn: string, symbol?: string) => void;
  timeoutMs?: number;
}

function classify(payload: Record<string, unknown>): AvError | null {
  const note = (payload['Note'] ?? payload['Information']) as string | undefined;
  if (typeof note === 'string' && note.length) {
    const lower = note.toLowerCase();
    if (lower.includes('premium')) return new AvError('premiumRequired', note);
    if (lower.includes('rate limit') || lower.includes('requests per day') || lower.includes('thank you for using'))
      return new AvError('rateLimit', note);
    return new AvError('rateLimit', note);
  }
  const err = payload['Error Message'] as string | undefined;
  if (typeof err === 'string' && err.length) return new AvError('notFound', err);
  return null;
}

export class AlphaVantageClient {
  private readonly key: string;
  private readonly doFetch: typeof fetch;
  private readonly onRequest?: (fn: string, symbol?: string) => void;
  private readonly timeoutMs: number;

  constructor(opts: AvClientOptions) {
    this.key = opts.apiKey;
    this.doFetch = opts.fetchImpl ?? fetch;
    this.onRequest = opts.onRequest;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  async request<T = Record<string, unknown>>(
    fn: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    const url = new URL(AV_BASE);
    url.searchParams.set('function', fn);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    url.searchParams.set('apikey', this.key);

    const symbol = params['symbol'] as string | undefined;
    this.onRequest?.(fn, symbol);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.doFetch(url.toString(), { signal: controller.signal });
    } catch (e) {
      throw new AvError('network', e instanceof Error ? e.message : 'network error', fn, symbol);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new AvError('network', `HTTP ${res.status}`, fn, symbol);
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new AvError('malformed', 'response was not JSON', fn, symbol);
    }
    if (typeof payload !== 'object' || payload === null) {
      throw new AvError('malformed', 'response was not an object', fn, symbol);
    }

    const problem = classify(payload as Record<string, unknown>);
    if (problem) {
      throw new AvError(problem.kind, problem.message, fn, symbol);
    }
    return payload as T;
  }

  /** 100 daily candles — enough for every moving average up to SMA100. */
  dailyCompact(symbol: string) {
    return this.request<AvTimeSeriesDaily>('TIME_SERIES_DAILY', {
      symbol,
      outputsize: 'compact',
      datatype: 'json',
    });
  }

  /** 20+ years of candles. Premium-only; needed for a true SMA200. */
  dailyFull(symbol: string) {
    return this.request<AvTimeSeriesDaily>('TIME_SERIES_DAILY', {
      symbol,
      outputsize: 'full',
      datatype: 'json',
    });
  }

  overview(symbol: string) {
    return this.request<AvOverview>('OVERVIEW', { symbol });
  }

  putCallRatio(symbol: string) {
    return this.request<AvPutCall>('REALTIME_PUT_CALL_RATIO', { symbol });
  }

  earnings(symbol: string) {
    return this.request<AvEarnings>('EARNINGS', { symbol });
  }

  incomeStatement(symbol: string) {
    return this.request<AvIncomeStatement>('INCOME_STATEMENT', { symbol });
  }

  balanceSheet(symbol: string) {
    return this.request<AvBalanceSheet>('BALANCE_SHEET', { symbol });
  }

  globalQuote(symbol: string) {
    return this.request<AvGlobalQuote>('GLOBAL_QUOTE', { symbol, datatype: 'json' });
  }

  treasuryYield(maturity: '10year' | '30year') {
    return this.request<AvTreasury>('TREASURY_YIELD', { interval: 'daily', maturity });
  }
}

// ---------------------------------------------------------------------------
// Response shapes (only the fields we consume)
// ---------------------------------------------------------------------------

export interface AvTimeSeriesDaily {
  'Meta Data'?: { '2. Symbol'?: string; '3. Last Refreshed'?: string };
  'Time Series (Daily)'?: Record<
    string,
    { '1. open': string; '2. high': string; '3. low': string; '4. close': string; '5. volume': string }
  >;
}

export interface AvOverview {
  Symbol?: string;
  Name?: string;
  Sector?: string;
  AssetType?: string;
  PERatio?: string;
  ForwardPE?: string;
  PriceToSalesRatioTTM?: string;
  EVToEBITDA?: string;
  PEGRatio?: string;
  ProfitMargin?: string;
  OperatingMarginTTM?: string;
  Beta?: string;
  DividendYield?: string;
  AnalystTargetPrice?: string;
  AnalystRatingStrongBuy?: string;
  AnalystRatingBuy?: string;
  AnalystRatingHold?: string;
  AnalystRatingSell?: string;
  AnalystRatingStrongSell?: string;
  '52WeekHigh'?: string;
  '52WeekLow'?: string;
  '50DayMovingAverage'?: string;
  '200DayMovingAverage'?: string;
  SharesOutstanding?: string;
  LatestQuarter?: string;
}

export interface AvPutCall {
  symbol?: string;
  put_call_ratio_full_chain?: string;
  put_call_ratio_by_expiration?: { date: string; value: string }[];
}

export interface AvEarnings {
  symbol?: string;
  quarterlyEarnings?: {
    fiscalDateEnding: string;
    reportedDate?: string;
    reportedEPS?: string;
    estimatedEPS?: string;
    surprisePercentage?: string;
  }[];
}

export interface AvIncomeStatement {
  symbol?: string;
  quarterlyReports?: {
    fiscalDateEnding: string;
    totalRevenue?: string;
    operatingIncome?: string;
    ebitda?: string;
    netIncome?: string;
  }[];
}

export interface AvBalanceSheet {
  symbol?: string;
  quarterlyReports?: {
    fiscalDateEnding: string;
    shortLongTermDebtTotal?: string;
    cashAndCashEquivalentsAtCarryingValue?: string;
    shortTermInvestments?: string;
    totalShareholderEquity?: string;
    commonStockSharesOutstanding?: string;
  }[];
}

export interface AvGlobalQuote {
  'Global Quote'?: {
    '05. price'?: string;
    '08. previous close'?: string;
    '06. volume'?: string;
    '07. latest trading day'?: string;
  };
}

export interface AvTreasury {
  data?: { date: string; value: string }[];
}
