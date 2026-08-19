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
import { getApiKey, getClaudeKey } from './keys';
import {
  createClaude,
  diffHoldings,
  readPositionsFromImage,
  researchStock,
  type HoldingDiff,
  type ParsedPosition,
  type PositionsReadResult,
} from './provider/claude';
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
  /** Tickers currently being researched, so the UI can show a spinner. */
  researching: string[];

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
        const applied = pending.diffs.filter(
          (d) => !skipped.has(d.ticker) && d.kind !== 'unchanged',
        ).length;
        return { applied, needResearch: result.needResearch };
      },

      discardPendingImport: () => set({ pendingImport: null }),

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
          return { ok: true, message: `${ticker} updated.` };
        } catch (e) {
          return { ok: false, message: describeError(e) };
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
      }),
      onRehydrateStorage: () => (state) => {
        state?.setUnlocked(false);
        useApp.setState({ hydrated: true });
      },
    },
  ),
);

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
