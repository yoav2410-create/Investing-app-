import type {
  MarketSnapshot,
  RefreshLogEntry,
  RefreshState,
  Settings,
  Stamped,
  Stock,
} from '@/domain/types';
import { nowIso, todayIso } from '@/domain/format';
import { computeTechnicals } from '@/domain/technicals';
import { AlphaVantageClient, AvError } from './provider/alphaVantage';
import {
  debtToEquity,
  earningsFrom,
  fundamentalsFrom,
  latestReportDate,
  multipleHistoryFrom,
  quoteFromCandles,
  toCandles,
  valuationFromOverview,
  week52Change,
} from './provider/mapper';

/**
 * Refresh orchestration.
 *
 * The hard constraint is the API budget: a free Alpha Vantage key allows 25
 * requests a day, which is fewer than one per tracked ticker. So the scheduler
 * spends the budget in priority order and rotates the expensive, slow-moving
 * work across days, rather than refusing to run at all.
 *
 * Priority, highest first:
 *   1. Price history for held names   — 1 call each, yields quote + every
 *                                       moving average, RSI and DI locally.
 *   2. Price history for watchlist names.
 *   3. Options positioning for names whose put/call is stale.
 *   4. Valuation snapshot (OVERVIEW), round-robin.
 *   5. Earnings check, round-robin — detects a new report since last refresh.
 *   6. Statements, only for names where step 5 found a new report.
 *
 * Nothing is ever overwritten with null: a failed call leaves the previous
 * value and its original `asOf` in place, which is what lets the UI show
 * last-known-good data with an honest timestamp instead of a blank screen.
 */

export interface RefreshInput {
  stocks: Record<string, Stock>;
  heldTickers: string[];
  settings: Settings;
  state: RefreshState;
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Overrides "now" in tests. */
  now?: () => Date;
}

export interface RefreshOutput {
  stocks: Record<string, Stock>;
  market: MarketSnapshot | null;
  state: RefreshState;
  /** Names that reported since the last refresh — their narrative is now stale. */
  newEarnings: string[];
  messages: string[];
}

const STALE_HOURS = {
  quote: 6,
  options: 20,
  valuation: 24 * 3,
  earnings: 24 * 2,
};

function hoursSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 3_600_000;
}

function stamp<T>(value: T, at: string): Stamped<T> {
  return { value, asOf: at, source: 'alphavantage' };
}

/** Reset the budget counter when the calendar day rolls over. */
export function rollBudget(state: RefreshState, today = todayIso()): RefreshState {
  if (state.budgetDay === today) return state;
  return { ...state, budgetDay: today, callsUsedToday: 0 };
}

export function budgetRemaining(state: RefreshState, settings: Settings): number {
  const rolled = rollBudget(state);
  return Math.max(0, settings.dailyCallBudget - rolled.callsUsedToday);
}

interface Job {
  kind: 'prices' | 'options' | 'valuation' | 'earnings' | 'statements';
  ticker: string;
  /** Lower runs first. */
  priority: number;
}

/**
 * Build the work list. Exported so the Data Sources screen can show the owner
 * exactly what the next refresh intends to spend its budget on.
 */
export function planJobs(
  stocks: Record<string, Stock>,
  heldTickers: string[],
  budget: number,
  pending: string[] = [],
): Job[] {
  const held = new Set(heldTickers);
  const tickers = Object.keys(stocks);
  const jobs: Job[] = [];

  for (const t of tickers) {
    const s = stocks[t]!;
    if (hoursSince(s.quote.asOf) >= STALE_HOURS.quote) {
      jobs.push({ kind: 'prices', ticker: t, priority: held.has(t) ? 0 : 1 });
    }
  }
  // Slow-moving blocks rotate: oldest stamp first, so a small budget still
  // covers the whole book over a few days instead of starving the tail.
  const byAge = (kind: 'valuation' | 'earnings') =>
    tickers
      .filter((t) => hoursSince(stocks[t]![kind].asOf) >= STALE_HOURS[kind])
      .sort((a, b) => hoursSince(stocks[b]![kind].asOf) - hoursSince(stocks[a]![kind].asOf));

  for (const t of byAge('valuation')) jobs.push({ kind: 'valuation', ticker: t, priority: 4 });
  for (const t of byAge('earnings')) {
    if (stocks[t]!.isEtf) continue;
    jobs.push({ kind: 'earnings', ticker: t, priority: 5 });
  }
  for (const t of pending) {
    if (stocks[t]) jobs.push({ kind: 'statements', ticker: t, priority: 6 });
  }

  jobs.sort((a, b) => a.priority - b.priority);
  // `statements` costs four calls, so it only earns a slot with room to spare.
  const out: Job[] = [];
  let spend = 0;
  for (const job of jobs) {
    const cost = job.kind === 'statements' ? 4 : 1;
    if (spend + cost > budget) continue;
    spend += cost;
    out.push(job);
  }
  return out;
}

export async function runRefresh(input: RefreshInput): Promise<RefreshOutput> {
  const { settings, apiKey, fetchImpl } = input;
  const at = nowIso();
  let state = rollBudget(input.state);
  const stocks: Record<string, Stock> = { ...input.stocks };
  const messages: string[] = [];
  const newEarnings: string[] = [];
  const pending = new Set(state.pending);

  if (!apiKey) {
    return finish('failed', 'No API key set — add one in Settings → Data.');
  }

  let calls = 0;
  const client = new AlphaVantageClient({
    apiKey,
    fetchImpl,
    onRequest: () => {
      calls += 1;
    },
  });

  const budget = Math.max(0, settings.dailyCallBudget - state.callsUsedToday);
  if (budget <= 0) {
    return finish('partial', `Daily budget of ${settings.dailyCallBudget} calls already spent.`);
  }

  const jobs = planJobs(stocks, input.heldTickers, budget, [...pending]);
  if (jobs.length === 0) {
    return finish('ok', 'Everything already fresh — no calls needed.');
  }

  let stoppedEarly: AvError | null = null;

  for (const job of jobs) {
    if (stoppedEarly) break;
    const stock = stocks[job.ticker];
    if (!stock) continue;
    try {
      switch (job.kind) {
        case 'prices': {
          const payload = await client.dailyCompact(job.ticker);
          const candles = toCandles(payload);
          const quote = quoteFromCandles(payload);
          if (!candles.length || !quote) {
            messages.push(`${job.ticker}: price series came back empty, kept previous.`);
            break;
          }
          const technicals = computeTechnicals(candles);
          // A compact series is 100 candles, so SMA200 is unavailable. Keep the
          // previous SMA200 rather than dropping the 200-day check entirely.
          if (technicals.sma200 == null) {
            technicals.sma200 = stock.technicals.value?.sma200 ?? null;
          }
          // The same series also yields the 52-week change, so it costs no
          // extra call to keep that field current.
          const w52 = week52Change(candles);
          const valuation = stock.valuation.value
            ? { ...stock.valuation.value, week52ChangePct: w52 ?? stock.valuation.value.week52ChangePct }
            : null;
          stocks[job.ticker] = {
            ...stock,
            quote: stamp(quote, at),
            technicals: stamp(technicals, at),
            valuation: valuation
              ? { ...stock.valuation, value: valuation }
              : stock.valuation,
          };
          break;
        }
        case 'valuation': {
          const payload = await client.overview(job.ticker);
          if (!payload.Symbol) {
            messages.push(`${job.ticker}: no overview available (ETFs have none), kept previous.`);
            // Stamp the attempt so the rotation does not retry it every run.
            stocks[job.ticker] = {
              ...stocks[job.ticker]!,
              valuation: { ...stocks[job.ticker]!.valuation, asOf: at },
            };
            break;
          }
          const current = stocks[job.ticker]!;
          const valuation = valuationFromOverview(payload, {
            week52ChangePct: current.valuation.value?.week52ChangePct ?? null,
            debtToEquity: current.valuation.value?.debtToEquity ?? null,
            shortInterestPct: current.valuation.value?.shortInterestPct ?? null,
          });
          stocks[job.ticker] = { ...current, valuation: stamp(valuation, at) };
          break;
        }
        case 'earnings': {
          const payload = await client.earnings(job.ticker);
          const reported = latestReportDate(payload);
          const previous = stock.earnings.value?.date ?? null;
          const current = stocks[job.ticker]!;
          const merged = {
            ...current.earnings,
            asOf: at,
            source: 'alphavantage' as const,
          };
          if (reported && reported !== previous) {
            newEarnings.push(job.ticker);
            pending.add(job.ticker);
            messages.push(
              `${job.ticker}: new report on ${reported} — figures queued, curated commentary is now stale.`,
            );
          }
          stocks[job.ticker] = { ...current, earnings: merged };
          break;
        }
        case 'statements': {
          const [income, balance, earnings] = await Promise.all([
            client.incomeStatement(job.ticker),
            client.balanceSheet(job.ticker),
            client.earnings(job.ticker),
          ]);
          const current = stocks[job.ticker]!;
          const fundamentals = fundamentalsFrom(income, earnings);
          // Rebuilding the derived P/E, EV/EBITDA and P/S histories is the
          // whole reason this job also pulls the price series.
          let history = current.multipleHistory;
          try {
            const candles = toCandles(await client.dailyCompact(job.ticker));
            if (candles.length) {
              history = stamp(multipleHistoryFrom(candles, income, balance, earnings), at);
            }
          } catch {
            messages.push(`${job.ticker}: kept the previous valuation history.`);
          }
          const call = earningsFrom(earnings, income);
          const de = debtToEquity(balance);
          stocks[job.ticker] = {
            ...current,
            fundamentals: stamp(fundamentals, at),
            multipleHistory: history,
            earnings: call
              ? stamp(
                  {
                    ...call,
                    // Curated commentary survives a figures refresh; it is
                    // replaced only when someone writes a new one.
                    managementSaid: current.earnings.value?.managementSaid ?? null,
                    guidance: current.earnings.value?.guidance ?? null,
                    watchNext: current.earnings.value?.watchNext ?? null,
                  },
                  at,
                )
              : current.earnings,
            valuation: current.valuation.value
              ? stamp({ ...current.valuation.value, debtToEquity: de ?? current.valuation.value.debtToEquity }, at)
              : current.valuation,
          };
          pending.delete(job.ticker);
          messages.push(`${job.ticker}: reported figures updated.`);
          break;
        }
      }
    } catch (e) {
      const err = e instanceof AvError ? e : new AvError('network', String(e));
      messages.push(`${job.ticker}: ${err.kind} — ${err.message.slice(0, 120)}`);
      if (err.isFatalForRun) {
        stoppedEarly = err;
      }
    }
  }

  const status = stoppedEarly
    ? 'partial'
    : messages.some((m) => m.includes('kept previous'))
      ? 'partial'
      : 'ok';
  if (stoppedEarly) {
    messages.unshift(
      stoppedEarly.kind === 'rateLimit'
        ? 'Stopped early: the API key hit its rate limit. Everything below is last-known-good.'
        : 'Stopped early: this endpoint needs a paid Alpha Vantage plan.',
    );
  }
  return finish(status, undefined);

  function finish(status: RefreshState['status'], message?: string): RefreshOutput {
    if (message) messages.unshift(message);
    const entry: RefreshLogEntry = { at, status, callsUsed: calls, messages: [...messages] };
    const nextState: RefreshState = {
      status,
      lastRunAt: at,
      lastSuccessAt: status === 'ok' || status === 'partial' ? at : state.lastSuccessAt,
      callsUsedToday: state.callsUsedToday + calls,
      budgetDay: state.budgetDay ?? todayIso(),
      log: [entry, ...state.log].slice(0, 30),
      pending: [...pending],
    };
    return { stocks, market: null, state: nextState, newEarnings, messages };
  }
}

export const INITIAL_REFRESH_STATE: RefreshState = {
  status: 'idle',
  lastRunAt: null,
  lastSuccessAt: null,
  callsUsedToday: 0,
  budgetDay: null,
  log: [],
  pending: [],
};
