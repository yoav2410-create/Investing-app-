import type { Quote } from '@/domain/types';

/**
 * Marks published alongside the app by the scheduled workflow.
 *
 * This is the path that needs nothing from the owner: no key, no sheet, no
 * button. `scripts/fetch-quotes.mjs` runs on a schedule with the Finnhub key
 * held in a GitHub secret, writes quotes.json into the deployment, and the app
 * reads it from its own origin — a same-origin request, so no cross-origin
 * permission is involved and no secret is shipped.
 *
 * The trade is freshness: these marks are as new as the last workflow run, not
 * as new as this second. That is why `fetchedAt` is carried through and shown
 * rather than smoothed over. A price presented without its age is the failure
 * this codebase is built to avoid, and it matters more here than anywhere else
 * because nothing on screen hints that a scheduler is involved.
 */

export interface PublishedQuote {
  symbol: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  tradingDay: string | null;
  asOf: string | null;
}

export interface PublishedVix {
  last: number;
  date: string;
  /** Weekly closes over the last year, oldest first, exact latest point kept. */
  series: { date: string; value: number }[];
}

export interface PublishedQuotes {
  version: number;
  source: string;
  fetchedAt: string;
  count: number;
  quotes: Record<string, PublishedQuote>;
  failures: { symbol: string; reason: string }[];
  /** Absent when the CBOE fetch failed that run; never a stale pretence. */
  vix?: PublishedVix | null;
}

/**
 * Where quotes.json sits relative to the running app.
 *
 * Pages serves this under /<repo>/, and the export bakes that prefix into every
 * asset path, so a bare '/quotes.json' would 404 on the deployed site while
 * working perfectly in local development — the exact shape of bug that reaches
 * the phone unnoticed. Deriving it from the document's own base keeps the two
 * the same.
 */
export function quotesUrl(): string {
  // The same variable the export bakes asset paths from, so this cannot
  // disagree with where the file actually landed. Deriving it from
  // location.pathname instead looks equivalent and is not: on a deep route
  // like /stock/META it would resolve against the wrong segment and 404 only
  // for someone who opened the app from a bookmark.
  const base = (process.env.EXPO_PUBLIC_BASE_URL ?? '').replace(/^\/+|\/+$/g, '');
  return base ? `/${base}/quotes.json` : '/quotes.json';
}

export async function fetchPublishedQuotes(
  fetchImpl: typeof fetch = fetch,
  url = quotesUrl(),
): Promise<PublishedQuotes | null> {
  try {
    // cache: 'no-store' because the file is republished on a schedule and a
    // cached copy would quietly pin the book to whenever the app was installed.
    const res = await fetchImpl(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as PublishedQuotes;
    if (!data || typeof data !== 'object' || !data.quotes) return null;
    return data;
  } catch {
    // Offline, or a deployment that predates the workflow. Neither is an error
    // worth surfacing: the marks already on file still render, with their dates.
    return null;
  }
}

/** Null when the published entry carries nothing usable. */
export function toQuote(p: PublishedQuote, fallbackDay: string): Quote | null {
  if (!p || typeof p.price !== 'number' || !Number.isFinite(p.price) || p.price <= 0) return null;
  const previousClose = p.previousClose && p.previousClose > 0 ? p.previousClose : p.price;
  const change = p.change ?? p.price - previousClose;
  const changePct = p.changePct ?? (previousClose === 0 ? 0 : (change / previousClose) * 100);
  return {
    price: p.price,
    previousClose,
    change,
    changePct,
    volume: null,
    tradingDay: p.tradingDay ?? fallbackDay,
  };
}
