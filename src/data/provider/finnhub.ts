import type { Quote } from '@/domain/types';

/**
 * Live quotes, pulled straight into the app.
 *
 * Chosen by measurement rather than reputation. The binding constraint is that
 * this is a static site with no server, so the browser has to be allowed to
 * read the response. Checked against the requesting origin:
 *
 *   Finnhub        ACAO *                    usable
 *   Twelve Data    ACAO *                    usable
 *   FMP            ACAO *                    usable
 *   Polygon        reflects the origin       usable
 *   Marketstack    ACAO *                    usable, but a tiny free tier
 *   Tiingo         no header                 unusable from a browser
 *   Yahoo, Finviz  no header                 unusable from a browser
 *
 * Finnhub wins the remaining question — its free tier serves real-time US
 * quotes rather than end-of-day — and one call returns everything a quote needs.
 *
 * This re-marks names already held. Positions still come from the broker
 * screenshot; a price feed does not know what anyone owns.
 */

export const FINNHUB_BASE = 'https://finnhub.io/api/v1';

export type FinnhubFailure = 'auth' | 'rateLimit' | 'network' | 'malformed' | 'noData';

export class FinnhubError extends Error {
  constructor(message: string, readonly kind: FinnhubFailure) {
    super(message);
    this.name = 'FinnhubError';
  }
}

/** The /quote payload. Short names are Finnhub's, not ours. */
export interface FinnhubQuote {
  /** Current price. */
  c: number;
  /** Change. */
  d: number | null;
  /** Percent change. */
  dp: number | null;
  h: number;
  l: number;
  o: number;
  /** Previous close. */
  pc: number;
  /** Unix seconds of the last trade. */
  t: number;
}

/**
 * Finnhub answers 200 with every field zeroed for a symbol it does not know,
 * so "did the request succeed" is not the same question as "is there a price".
 * A zero here would render as a real mark of $0.00 and quietly destroy the
 * book's value, which is the exact failure this codebase exists to avoid.
 */
export function toQuote(raw: FinnhubQuote, fallbackDay: string): Quote {
  if (!raw || typeof raw.c !== 'number' || !Number.isFinite(raw.c) || raw.c <= 0) {
    throw new FinnhubError('No price came back for that symbol.', 'noData');
  }
  const previousClose = Number.isFinite(raw.pc) && raw.pc > 0 ? raw.pc : raw.c;
  const change = Number.isFinite(raw.d as number) ? (raw.d as number) : raw.c - previousClose;
  const changePct = Number.isFinite(raw.dp as number)
    ? (raw.dp as number)
    : previousClose === 0
      ? 0
      : (change / previousClose) * 100;
  // `t` is the last trade, which is the day the price belongs to. Falling back
  // to today would date a stale weekend mark as if it were fresh.
  const tradingDay =
    typeof raw.t === 'number' && raw.t > 0
      ? new Date(raw.t * 1000).toISOString().slice(0, 10)
      : fallbackDay;
  return { price: raw.c, previousClose, change, changePct, volume: null, tradingDay };
}

async function readOne(
  symbol: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<FinnhubQuote> {
  const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`;
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (e) {
    throw new FinnhubError(
      `Could not reach Finnhub. ${e instanceof Error ? e.message : ''}`.trim(),
      'network',
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new FinnhubError('Finnhub rejected the API key.', 'auth');
  }
  if (res.status === 429) {
    throw new FinnhubError('Finnhub rate limit reached. Wait a minute and try again.', 'rateLimit');
  }
  if (!res.ok) {
    throw new FinnhubError(`Finnhub answered ${res.status}.`, 'network');
  }
  try {
    return (await res.json()) as FinnhubQuote;
  } catch {
    throw new FinnhubError('Finnhub returned something that was not JSON.', 'malformed');
  }
}

export interface QuoteBatch {
  quotes: Record<string, Quote>;
  /** Symbol-level failures, named. Never silently dropped. */
  failures: { symbol: string; reason: string }[];
  /** Set when the whole run was cut short, so the caller can say why. */
  stoppedEarly: FinnhubFailure | null;
}

/**
 * Fetch a batch, one symbol at a time.
 *
 * Sequential with a small gap rather than a burst: the free tier is a
 * per-minute allowance, and firing seventeen requests at once is the reliable
 * way to spend it on a 429 instead of on prices. A key or rate-limit failure
 * stops the run — every remaining symbol would fail the same way, and seventeen
 * copies of one error is not a more useful report than one.
 */
export async function fetchQuotes(
  symbols: string[],
  token: string,
  opts: { fetchImpl?: typeof fetch; gapMs?: number; today?: string } = {},
): Promise<QuoteBatch> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const gapMs = opts.gapMs ?? 120;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  const quotes: Record<string, Quote> = {};
  const failures: { symbol: string; reason: string }[] = [];
  let stoppedEarly: FinnhubFailure | null = null;

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i]!;
    try {
      quotes[symbol] = toQuote(await readOne(symbol, token, fetchImpl), today);
    } catch (e) {
      const kind = e instanceof FinnhubError ? e.kind : 'network';
      const reason = e instanceof Error ? e.message : 'Unknown failure.';
      if (kind === 'auth' || kind === 'rateLimit') {
        stoppedEarly = kind;
        failures.push({ symbol, reason });
        break;
      }
      failures.push({ symbol, reason });
    }
    if (gapMs > 0 && i < symbols.length - 1) {
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }

  return { quotes, failures, stoppedEarly };
}
