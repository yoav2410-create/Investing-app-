import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  Holding,
  MarketSnapshot,
  PlanLeg,
  PortfolioSnapshot,
  RebalancePlan,
  RefreshState,
  Settings,
  Stock,
  Verdict,
} from '@/domain/types';
import { nowIso, todayIso } from '@/domain/format';
import { trendRead } from '@/domain/technicals';
import {
  DEFAULT_SETTINGS,
  FX_TO_USD,
  SEED_ACCOUNT,
  SEED_CASH,
  SEED_HOLDINGS,
  SEED_MARKET,
  SEED_PLAN,
  SEED_STOCKS,
  deriveAccount,
} from './seed';
import { INITIAL_REFRESH_STATE, runRefresh } from './refresh';
import { getApiKey, getClaudeKey, getKey } from './keys';
import {
  analysePortfolio,
  createClaude,
  diffHoldings,
  readPositionsFromImage,
  researchStock,
  type HoldingDiff,
  type ParsedPosition,
  type PortfolioReadResult,
  type PositionsReadResult,
} from './provider/claude';
import { buildInsights, summariseForModel } from '@/domain/insights';
import { stanceMoveKey, stanceProblems, summariseSimulation } from '@/domain/allocation';
import { fetchQuotes } from './provider/finnhub';
import { fetchPublishedQuotes, toQuote as toPublishedQuote } from './provider/publishedQuotes';
import { DEFAULT_ASSUMPTIONS, runSimulation } from '@/domain/montecarlo';
import { applyPositions, mergeResearch } from './claudeSync';
import { runAlertCheck } from './alerts';

/** A screenshot import in progress, kept in the store so the review screen
 *  survives a navigation away and back. */
export interface PendingImport {
  imageUri: string;
  read: PositionsReadResult;
  diffs: HoldingDiff[];
  /** Tickers the owner has unticked. */
  skipped: string[];
  at: string;
}

export interface AppState {
  hydrated: boolean;
  holdings: Holding[];
  stocks: Record<string, Stock>;
  plan: RebalancePlan;
  market: MarketSnapshot;
  cash: { currency: string; amount: number }[];
  settings: Settings;
  refresh: RefreshState;
  snapshots: PortfolioSnapshot[];
  /** Tickers whose curated narrative is older than their latest report. */
  staleNarratives: string[];
  unlocked: boolean;
  pendingImport: PendingImport | null;
  /** Ticker currently in flight, so the UI can show a spinner. */
  researching: string[];
  /** Tickers waiting their turn. Research runs one at a time. */
  researchQueue: string[];
  /** Newest first: what the last few research passes did. */
  researchLog: { ticker: string; at: string; ok: boolean; message: string }[];
  /** The last portfolio-level read, with the timestamp it was written. */
  portfolioRead: { at: string; result: PortfolioReadResult } | null;
  analysingPortfolio: boolean;
  /**
   * Which of the read's proposed moves the owner has executed, keyed by
   * `stanceMoveKey`. This is the plan now: Claude proposes on request, the app
   * pins the proposals, and the owner ticks them off. A fresh read replaces
   * the checklist — done-marks describe moves that no longer exist.
   */
  stanceDone: string[];
  toggleStanceDone: (key: string) => void;

  account: () => ReturnType<typeof deriveAccount>;
  cashUsd: () => number;

  toggleLeg: (id: string) => void;
  resetTranche: (tranche: PlanLeg['tranche']) => void;
  updatePlan: (plan: RebalancePlan) => void;
  updateHoldings: (holdings: Holding[]) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setUnlocked: (v: boolean) => void;
  refreshNow: (opts?: { fetchImpl?: typeof fetch }) => Promise<{ ok: boolean; message: string }>;
  readScreenshot: (input: {
    uri: string;
    base64: string;
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
    hint?: string;
  }) => Promise<{ ok: boolean; message: string }>;
  toggleImportSkip: (ticker: string) => void;
  applyPendingImport: () => { applied: number; needResearch: string[] };
  discardPendingImport: () => void;
  researchTicker: (ticker: string) => Promise<{ ok: boolean; message: string }>;
  /** Queue names for research; they run sequentially in the background. */
  enqueueResearch: (tickers: string[]) => void;
  clearResearchQueue: () => void;
  analysePortfolioNow: () => Promise<{ ok: boolean; message: string }>;
  /** Live marks for whatever is held right now. Follows the book, not a list. */
  refreshLiveQuotes: (opts?: { fetchImpl?: typeof fetch }) => Promise<{ ok: boolean; message: string }>;
  refreshingQuotes: boolean;
  /** When the published feed the marks came from was fetched, for the UI. */
  quotesFetchedAt: string | null;
  takeSnapshot: () => void;
  resetToSeed: () => void;
}

function snapshotFrom(stocks: Record<string, Stock>, nlv: number, dayPnl: number): PortfolioSnapshot {
  const trendScores: Record<string, number> = {};
  const verdicts: Record<string, Verdict> = {};
  for (const [ticker, s] of Object.entries(stocks)) {
    trendScores[ticker] = trendRead(s.quote.value?.price ?? null, s.technicals.value).score;
    verdicts[ticker] = s.narrative.verdict;
  }
  return { date: todayIso(), netLiquidationValue: nlv, dayPnl, trendScores, verdicts };
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      holdings: SEED_HOLDINGS,
      stocks: SEED_STOCKS,
      plan: SEED_PLAN,
      market: SEED_MARKET,
      cash: SEED_CASH,
      settings: DEFAULT_SETTINGS,
      refresh: INITIAL_REFRESH_STATE,
      snapshots: [],
      staleNarratives: [],
      unlocked: false,
      pendingImport: null,
      researching: [],
      researchQueue: [],
      researchLog: [],
      portfolioRead: null,
      analysingPortfolio: false,
      stanceDone: [],
      toggleStanceDone: (key) =>
        set((s) => ({
          stanceDone: s.stanceDone.includes(key)
            ? s.stanceDone.filter((k) => k !== key)
            : [...s.stanceDone, key],
        })),
      refreshingQuotes: false,
      quotesFetchedAt: null,

      account: () => deriveAccount(get().holdings, get().stocks, get().cash, SEED_ACCOUNT.realizedPnl),
      cashUsd: () =>
        get().cash.reduce((s, c) => s + c.amount * (FX_TO_USD[c.currency] ?? 1), 0),

      toggleLeg: (id) =>
        set((s) => ({
          plan: {
            ...s.plan,
            legs: s.plan.legs.map((l) =>
              l.id === id ? { ...l, done: !l.done, doneAt: l.done ? null : nowIso() } : l,
            ),
          },
        })),

      resetTranche: (tranche) =>
        set((s) => ({
          plan: {
            ...s.plan,
            legs: s.plan.legs.map((l) =>
              l.tranche === tranche ? { ...l, done: false, doneAt: null } : l,
            ),
          },
        })),

      updatePlan: (plan) => set({ plan }),
      updateHoldings: (holdings) => set({ holdings }),
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setUnlocked: (unlocked) => set({ unlocked }),

      refreshNow: async (opts) => {
        const state = get();
        if (state.refresh.status === 'running') {
          return { ok: false, message: 'A refresh is already running.' };
        }
        set({ refresh: { ...state.refresh, status: 'running' } });
        const apiKey = (await getApiKey()) ?? '';
        try {
          const result = await runRefresh({
            stocks: state.stocks,
            heldTickers: state.holdings.map((h) => h.ticker),
            settings: state.settings,
            state: state.refresh,
            apiKey,
            fetchImpl: opts?.fetchImpl,
          });
          const stale = new Set(state.staleNarratives);
          for (const t of result.newEarnings) stale.add(t);
          set({
            stocks: result.stocks,
            refresh: result.state,
            staleNarratives: [...stale],
            market: result.market ?? state.market,
          });
          get().takeSnapshot();
          return {
            ok: result.state.status !== 'failed',
            message: result.messages[0] ?? 'Refresh complete.',
          };
        } catch (e) {
          set({
            refresh: {
              ...get().refresh,
              status: 'failed',
              lastRunAt: nowIso(),
            },
          });
          return { ok: false, message: e instanceof Error ? e.message : 'Refresh failed.' };
        }
      },

      readScreenshot: async ({ uri, base64, mediaType, hint }) => {
        const key = await getClaudeKey();
        if (!key) {
          return { ok: false, message: 'Add your Anthropic API key in Settings → Data first.' };
        }
        try {
          const client = createClaude({ apiKey: key, allowBrowser: Platform.OS === 'web' });
          const read = await readPositionsFromImage(client, { base64, mediaType }, hint);
          if (read.positions.length === 0) {
            return {
              ok: false,
              message:
                read.warnings[0] ?? 'No positions were legible in that image. Try a fuller screenshot.',
            };
          }
          const state = get();
          const diffs = diffHoldings(state.holdings, read.positions, (t) =>
            state.stocks[t]?.sector ?? 'tech',
          );
          set({
            pendingImport: { imageUri: uri, read, diffs, skipped: [], at: nowIso() },
          });
          const changed = diffs.filter((d) => d.kind !== 'unchanged').length;
          return {
            ok: true,
            message:
              changed === 0
                ? `Read ${read.positions.length} positions — nothing has changed.`
                : `Read ${read.positions.length} positions, ${changed} differ from the book.`,
          };
        } catch (e) {
          return { ok: false, message: describeError(e) };
        }
      },

      toggleImportSkip: (ticker) =>
        set((s) => {
          if (!s.pendingImport) return {};
          const skipped = new Set(s.pendingImport.skipped);
          if (skipped.has(ticker)) skipped.delete(ticker);
          else skipped.add(ticker);
          return { pendingImport: { ...s.pendingImport, skipped: [...skipped] } };
        }),

      applyPendingImport: () => {
        const state = get();
        const pending = state.pendingImport;
        if (!pending) return { applied: 0, needResearch: [] };
        const skipped = new Set(pending.skipped);
        const result = applyPositions({
          diffs: pending.diffs,
          parsed: pending.read.positions,
          holdings: state.holdings,
          stocks: state.stocks,
          sectorFor: (t) => state.stocks[t]?.sector ?? 'tech',
          skipped,
        });
        const cashUsd = pending.read.account.cashUsd;
        set({
          holdings: result.holdings,
          stocks: result.stocks,
          pendingImport: null,
          cash:
            cashUsd == null
              ? state.cash
              : [
                  { currency: 'USD', amount: cashUsd },
                  ...state.cash.filter((c) => c.currency !== 'USD'),
                ],
        });
        get().takeSnapshot();
        // New marks can push a stock over a moving average or the book under
        // the cash floor, so the alert check belongs here rather than on a timer.
        void runAlertCheck(get());
        const touched = pending.diffs
          .filter((d) => !skipped.has(d.ticker) && (d.kind === 'added' || d.kind === 'changed'))
          .map((d) => d.ticker);
        // A position that moved is a position worth a fresh read: the reason it
        // moved is usually news, and the write-up on file predates it.
        const toResearch = [...new Set([...result.needResearch, ...touched])];
        if (toResearch.length) get().enqueueResearch(toResearch);
        // Price the new book immediately rather than waiting for the next
        // quarter-hour tick. A name that just arrived in the import has only
        // the screenshot's mark, which was already minutes old when it was
        // photographed; fifteen minutes more of it is the exact staleness the
        // import was trying to fix. Fire-and-forget — the screenshot marks are
        // already applied, so a failed refresh just leaves them in place.
        void get().refreshLiveQuotes();
        return { applied: touched.length, needResearch: toResearch };
      },

      discardPendingImport: () => set({ pendingImport: null }),

      enqueueResearch: (tickers) => {
        const state = get();
        const known = new Set(Object.keys(state.stocks));
        const queued = new Set([...state.researchQueue, ...state.researching]);
        const next = tickers.filter((t) => known.has(t) && !queued.has(t));
        if (next.length === 0) return;
        set({ researchQueue: [...state.researchQueue, ...next] });
        void pumpResearchQueue();
      },

      clearResearchQueue: () => set({ researchQueue: [] }),

      refreshLiveQuotes: async (opts) => {
        if (get().refreshingQuotes) return { ok: false, message: 'Already refreshing.' };
        set({ refreshingQuotes: true });
        try {
          // The published feed first. It needs no key, no setup and no decision
          // from the owner, and the scheduled workflow keeps it current whether
          // or not the app has been opened — which is the only way "up to date"
          // can mean anything for a static site nobody is looking at.
          const published = await fetchPublishedQuotes(opts?.fetchImpl ?? fetch);
          const state = get();
          // Everything the book actually renders, held or watched. This is what
          // makes coverage self-healing: a name that arrives in tonight's
          // screenshot import is priced on the next pass because it is in
          // `stocks`, not because a list somewhere was updated to mention it.
          // There is no list, so there is nothing to fall out of date.
          const symbols = [
            ...new Set([...state.holdings.map((h) => h.ticker), ...Object.keys(state.stocks)]),
          ];
          if (symbols.length === 0) return { ok: false, message: 'Nothing in the book to price yet.' };

          let fromFeed = 0;
          const missing: string[] = [];
          if (published) {
            const stocks = { ...state.stocks };
            for (const ticker of symbols) {
              const entry = published.quotes[ticker];
              const stock = stocks[ticker];
              if (!stock) continue;
              const quote = entry ? toPublishedQuote(entry, todayIso()) : null;
              if (!quote) { missing.push(ticker); continue; }
              // Never replace a newer mark with an older one. The feed can be
              // half an hour behind a price the device fetched itself a moment
              // ago, and applying it anyway would walk the book backwards -
              // keeping a price that has already been superseded is exactly the
              // stale data this is supposed to avoid.
              const existing = stock.quote?.asOf;
              if (existing && Date.parse(existing) >= Date.parse(published.fetchedAt)) continue;
              // Stamped with when the workflow fetched it, not with now. The
              // point of a schedule is that the app may be opened long after,
              // and the age of the mark has to survive that gap intact.
              stocks[ticker] = {
                ...stock,
                quote: { value: quote, asOf: published.fetchedAt, source: 'finnhub' },
              };
              fromFeed++;
            }
            if (fromFeed > 0) set({ stocks, quotesFetchedAt: published.fetchedAt });
          }

          // A device key is optional, and only earns its keep on names the
          // schedule does not carry.
          const key = await getKey('finnhub');
          const toTopUp = published ? missing : symbols;
          if (!key || toTopUp.length === 0) {
            if (fromFeed > 0) {
              const parts = [`Re-marked ${fromFeed} of ${symbols.length} holdings from the published feed.`];
              if (toTopUp.length) {
                parts.push(`Not covered: ${toTopUp.join(', ')} — they keep their previous marks.`);
              }
              return { ok: true, message: parts.join(' ') };
            }
            return {
              ok: false,
              message: published
                ? 'The published feed carries none of your holdings yet.'
                : 'No published marks are available yet.',
            };
          }

          const batch = await fetchQuotes(toTopUp, key, { fetchImpl: opts?.fetchImpl, today: todayIso() });
          const at = nowIso();
          const stocks = { ...get().stocks };
          let applied = 0;
          for (const [ticker, quote] of Object.entries(batch.quotes)) {
            const stock = stocks[ticker];
            if (!stock) continue;
            stocks[ticker] = { ...stock, quote: { value: quote, asOf: at, source: 'finnhub' } };
            applied++;
          }
          if (applied > 0) set({ stocks });

          if (batch.stoppedEarly === 'auth') {
            return { ok: false, message: 'Finnhub rejected that key. Check it in Settings.' };
          }
          const parts = [`Re-marked ${fromFeed + applied} of ${symbols.length} holdings.`];
          if (batch.stoppedEarly === 'rateLimit') {
            parts.push('Finnhub rate limit reached; the rest kept their previous marks.');
          } else if (batch.failures.length) {
            // Named rather than dropped: a name that silently stops updating
            // looks like a flat stock rather than a missing feed.
            parts.push(`No price for ${batch.failures.map((f) => f.symbol).join(', ')}.`);
          }
          return { ok: fromFeed + applied > 0, message: parts.join(' ') };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : 'Could not refresh quotes.' };
        } finally {
          set({ refreshingQuotes: false });
        }
      },

      analysePortfolioNow: async () => {
        const key = await getClaudeKey();
        if (!key) {
          return { ok: false, message: 'Add your Anthropic API key in Settings → Data first.' };
        }
        if (get().analysingPortfolio) {
          return { ok: false, message: 'Already running.' };
        }
        set({ analysingPortfolio: true });
        try {
          const state = get();
          const insights = buildInsights(
            state.holdings,
            state.stocks,
            state.plan,
            state.cashUsd(),
            state.account().netLiquidationValue,
          );
          const verdicts = Object.values(state.stocks)
            .filter((s) => state.holdings.some((h) => h.ticker === s.ticker))
            .map((s) => `${s.ticker}: ${s.narrative.verdict} — ${s.narrative.thesis ?? ''}`)
            .join('\n');
          // What the model proposed last time, and which of it the owner
          // actually executed. That is the plan's whole history now — there is
          // no standing plan document, only the previous read and its ticks —
          // and telling the model what was and was not acted on lets it reason
          // about follow-through instead of proposing the same trim twice.
          const prev = state.portfolioRead?.result.allocation;
          const planText = prev
            ? [
                `Your previous recommendations (${state.portfolioRead!.at.slice(0, 10)}):`,
                ...prev.moves.map((m) => {
                  const key = stanceMoveKey(m);
                  return `- ${m.kind} ${m.ticker ?? m.sector ?? 'book'}: ${m.action} [${
                    state.stanceDone.includes(key) ? 'executed' : 'not executed'
                  }]`;
                }),
              ].join('\n')
            : 'No previous recommendations on file.';

          // The projection is handed over rather than described. The stance is
          // supposed to set the cash floor from what this book actually does in
          // a drawdown, and it cannot do that from sector weights alone.
          const simulation = summariseSimulation(
            runSimulation(
              state.holdings,
              state.stocks,
              state.cashUsd(),
              state.account().netLiquidationValue,
              {
                ...DEFAULT_ASSUMPTIONS,
                // The same 10-year yield the Market screen discounts against,
                // so the stance and the chart cannot disagree about the rate.
                riskFreePct:
                  state.market.instruments.find((i) => i.symbol === 'US10Y')?.last ??
                  DEFAULT_ASSUMPTIONS.riskFreePct,
              },
            ),
          );

          const client = createClaude({ apiKey: key, allowBrowser: Platform.OS === 'web' });
          const result = await analysePortfolio(client, summariseForModel(insights), {
            verdicts,
            plan: planText,
            simulation,
          });

          // A stance whose arithmetic does not hold would quietly make every
          // sector look underweight, so it is checked before it is stored and
          // the problems are surfaced rather than swallowed.
          const problems = result.allocation ? stanceProblems(result.allocation) : [];
          // A fresh read replaces the checklist: the old done-marks describe
          // moves that no longer exist, and carrying them over would show new
          // recommendations as already executed.
          set({ portfolioRead: { at: nowIso(), result }, stanceDone: [] });
          return {
            ok: true,
            message: problems.length
              ? `Portfolio read updated, but the targets need a look: ${problems.join(' ')}`
              : 'Portfolio read updated.',
          };
        } catch (e) {
          return { ok: false, message: describeError(e) };
        } finally {
          set({ analysingPortfolio: false });
        }
      },

      researchTicker: async (ticker) => {
        const key = await getClaudeKey();
        if (!key) {
          return { ok: false, message: 'Add your Anthropic API key in Settings → Data first.' };
        }
        if (get().researching.includes(ticker)) {
          return { ok: false, message: `${ticker} is already being researched.` };
        }
        set((s) => ({ researching: [...s.researching, ticker] }));
        try {
          const state = get();
          const holding = state.holdings.find((h) => h.ticker === ticker);
          const planNote = state.plan.legs.find((l) => l.ticker === ticker)?.note;
          const client = createClaude({ apiKey: key, allowBrowser: Platform.OS === 'web' });
          const result = await researchStock(client, ticker, {
            name: state.stocks[ticker]?.name,
            shares: holding?.shares,
            costBasis: holding?.costBasis,
            planNote,
          });
          set((s) => ({
            stocks: { ...s.stocks, [ticker]: mergeResearch(s.stocks[ticker], result, ticker) },
            staleNarratives: s.staleNarratives.filter((t) => t !== ticker),
          }));
          const headlines = result.sentiment?.headlines?.length ?? 0;
          const message = `${ticker} updated${
            headlines ? ` ֲ· ${headlines} recent article${headlines === 1 ? '' : 's'}` : ''
          }.`;
          set((s) => ({
            researchLog: [{ ticker, at: nowIso(), ok: true, message }, ...s.researchLog].slice(0, 40),
          }));
          return { ok: true, message };
        } catch (e) {
          const message = describeError(e);
          set((s) => ({
            researchLog: [{ ticker, at: nowIso(), ok: false, message }, ...s.researchLog].slice(0, 40),
          }));
          return { ok: false, message };
        } finally {
          set((s) => ({ researching: s.researching.filter((t) => t !== ticker) }));
        }
      },

      takeSnapshot: () =>
        set((s) => {
          const acct = deriveAccount(s.holdings, s.stocks, s.cash, SEED_ACCOUNT.realizedPnl);
          const today = todayIso();
          const next = snapshotFrom(s.stocks, acct.netLiquidationValue, acct.dayPnl);
          const without = s.snapshots.filter((x) => x.date !== today);
          return { snapshots: [...without, next].slice(-400) };
        }),

      resetToSeed: () =>
        set({
          holdings: SEED_HOLDINGS,
          stocks: SEED_STOCKS,
          plan: SEED_PLAN,
          market: SEED_MARKET,
          cash: SEED_CASH,
          settings: DEFAULT_SETTINGS,
          refresh: INITIAL_REFRESH_STATE,
          snapshots: [],
          staleNarratives: [],
          pendingImport: null,
          portfolioRead: null,
          researchQueue: [],
          researchLog: [],
        }),
    }),
    {
      name: 'portfolio-brief-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // `unlocked` is deliberately not persisted: Face ID must be satisfied
      // again on every cold start.
      partialize: (s) => ({
        holdings: s.holdings,
        stocks: s.stocks,
        plan: s.plan,
        market: s.market,
        cash: s.cash,
        settings: s.settings,
        refresh: s.refresh,
        snapshots: s.snapshots,
        staleNarratives: s.staleNarratives,
        pendingImport: s.pendingImport,
        researchLog: s.researchLog,
        portfolioRead: s.portfolioRead,
        stanceDone: s.stanceDone,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setUnlocked(false);
        useApp.setState({ hydrated: true });
      },
    },
  ),
);

/**
 * Drain the research queue one ticker at a time.
 *
 * Sequential on purpose: each pass runs web search and adaptive thinking, so
 * firing seventeen at once would burn the rate limit and give the owner no
 * useful progress signal. One at a time is slower in wall-clock and much easier
 * to reason about when one of them fails.
 */
let pumping = false;

async function pumpResearchQueue(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const state = useApp.getState();
      const next = state.researchQueue[0];
      if (!next) break;
      useApp.setState({ researchQueue: state.researchQueue.slice(1) });
      await state.researchTicker(next);
    }
  } finally {
    pumping = false;
  }
}

/** Seed the first snapshot so the history chart is never empty on day one. */
export function ensureFirstSnapshot() {
  const s = useApp.getState();
  if (s.snapshots.length === 0) s.takeSnapshot();
}

/** Turn an SDK or network failure into something worth showing a person. */
function describeError(e: unknown): string {
  if (e && typeof e === 'object' && 'status' in e) {
    const status = (e as { status?: number }).status;
    if (status === 401) return 'That Anthropic API key was rejected. Check it in Settings → Data.';
    if (status === 429) return 'Rate limited by the API. Wait a moment and try again.';
    if (status === 400) return 'The request was rejected. If this is a very large screenshot, try cropping it.';
    if (status && status >= 500) return 'The API is having trouble. Try again shortly.';
  }
  if (e instanceof Error) {
    return e.message.includes('Network') || e.message.includes('fetch')
      ? 'No network. Your last-known figures are still on screen.'
      : e.message;
  }
  return 'Something went wrong.';
}
