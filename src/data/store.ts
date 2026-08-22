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
import { getApiKey, getKey } from './keys';
import {
  diffHoldings,
  type HoldingDiff,
  type ParsedPosition,
  type PortfolioReadResult,
  type PositionsReadResult,
} from './provider/claude';
import { buildInsights, summariseForModel } from '@/domain/insights';
import {
  diffStances,
  moveToHoldingChange,
  resolveTargets,
  stanceMoveKey,
  stanceProblems,
  summariseSimulation,
} from '@/domain/allocation';
import { currency as currencyFmt } from '@/domain/format';
import { fetchQuotes } from './provider/finnhub';
import { inUsSession, openStream, type StreamHandle } from './provider/finnhubStream';
import {
  fetchPublishedQuotes,
  toQuote as toPublishedQuote,
  type PublishedCrosscheck,
} from './provider/publishedQuotes';
import { DEFAULT_ASSUMPTIONS, runSimulation } from '@/domain/montecarlo';
import { applyPositions, mergeResearch } from './claudeSync';
import { parsePositionsTable } from './import/positionsTable';
import { buildReadRequest, parsePastedRead } from './readExchange';
import { runAlertCheck } from './alerts';

/** A screenshot import in progress, kept in the store so the review screen
 *  survives a navigation away and back. */
export interface PendingImport {
  /** Null when the positions came from a file or a paste rather than a photo. */
  imageUri: string | null;
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
  /** The last portfolio-level read, with the timestamp it was written. */
  portfolioRead: { at: string; result: PortfolioReadResult } | null;
  /**
   * Which of the read's proposed moves the owner has executed, keyed by
   * `stanceMoveKey`. This is the plan now: Claude proposes on request, the app
   * pins the proposals, and the owner ticks them off. A fresh read replaces
   * the checklist — done-marks describe moves that no longer exist.
   */
  stanceDone: string[];
  toggleStanceDone: (key: string) => void;
  /** What the latest read changed against the one it replaced, in sentences. */
  stanceDiff: string[];
  /**
   * Tick a move AND apply its arithmetic to the book: exit removes the
   * holding, a sized trim/add shifts whole shares at the current mark, and the
   * cash leg moves the USD balance. Refuses — in words — anything it cannot
   * compute honestly. The broker screenshot remains the source of truth; this
   * covers the gap between executing there and photographing the result.
   */
  applyStanceMove: (key: string) => { ok: boolean; message: string };

  account: () => ReturnType<typeof deriveAccount>;
  cashUsd: () => number;

  toggleLeg: (id: string) => void;
  resetTranche: (tranche: PlanLeg['tranche']) => void;
  updatePlan: (plan: RebalancePlan) => void;
  updateHoldings: (holdings: Holding[]) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setUnlocked: (v: boolean) => void;
  refreshNow: (opts?: { fetchImpl?: typeof fetch }) => Promise<{ ok: boolean; message: string }>;
  /** The whole book from a broker export or a pasted table. No key needed. */
  readPositionsTable: (text: string) => { ok: boolean; message: string };
  toggleImportSkip: (ticker: string) => void;
  applyPendingImport: () => { applied: number; needResearch: string[] };
  discardPendingImport: () => void;
  /**
   * The same read, without an API key: the app writes the request — the book,
   * the previous recommendations and the projection, plus the exact output
   * shape — and the owner runs it in the conversation they already pay for.
   */
  buildReadPrompt: () => string;
  /** Take the answer back. Untrusted text; validated before it is stored. */
  applyPastedRead: (text: string) => { ok: boolean; message: string };
  /**
   * One paste box for whatever the conversation sent back. A portfolio read
   * and a positions table look nothing alike, so the app can tell them apart
   * rather than making the owner remember which button to press — and a
   * single answer carrying both is applied as both.
   */
  applyAnythingPasted: (text: string) => { ok: boolean; message: string };
  /** Live marks for whatever is held right now. Follows the book, not a list. */
  refreshLiveQuotes: (opts?: { fetchImpl?: typeof fetch }) => Promise<{ ok: boolean; message: string }>;
  refreshingQuotes: boolean;
  /** When the published feed the marks came from was fetched, for the UI. */
  quotesFetchedAt: string | null;
  /** The VIX ladder data from the published feed, for the cash-vs-fear card. */
  vix: { last: number; date: string; series: { date: string; value: number }[] } | null;
  /**
   * The feed's own audit trail: each publish samples its prices against Yahoo
   * Finance and records the agreement. Not persisted — it describes the feed
   * on file right now, and a day-old attestation shown as current would be
   * exactly the pretence it exists to rule out.
   */
  feedCrosscheck: PublishedCrosscheck | null;
  /**
   * The live trade stream. 'open' means ticks are flowing and the hero can
   * honestly wear a LIVE dot; anything else falls back to the fifteen-minute
   * machinery without ceremony.
   */
  streamStatus: 'off' | 'open' | 'closed' | 'error';
  startLiveStream: () => Promise<void>;
  stopLiveStream: () => void;
  /** Keep the stream's subscription list in step with the book. */
  syncStreamSymbols: () => void;
  takeSnapshot: () => void;
  resetToSeed: () => void;
}

/**
 * Bring a persisted state — from an old install or a restored backup file —
 * up to what this build expects. One function for both paths, so an upgrade
 * and a restore cannot disagree about what "old" means.
 *
 * Three repairs, each earned by a real failure:
 * - Settings are re-based on the defaults, so a key added after the state was
 *   written gets its default instead of `undefined` (which reads as "off" for
 *   every toggle). The renamed insider alert also inherits the old options
 *   toggle's choice rather than resetting it.
 * - `refresh.status` is forced back to idle. iOS kills a home-screen app
 *   whenever it likes; one killed mid-refresh persisted 'running' forever and
 *   the refresh button answered "already running" until a reset-to-seed.
 * - `stanceDone` gets its default for states that predate the dynamic plan.
 */
export function normalisePersisted<T extends Record<string, unknown>>(persisted: T): T {
  const p = persisted as T & {
    settings?: Partial<Settings> & { alertOnOptionsFlip?: boolean };
    refresh?: RefreshState;
    stanceDone?: string[];
  };
  const old = p.settings ?? {};
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...old,
    alertOnInsiderSelling:
      old.alertOnInsiderSelling ?? old.alertOnOptionsFlip ?? DEFAULT_SETTINGS.alertOnInsiderSelling,
    // An empty stored value loses to the bundled default rather than beating
    // it: installs that predate the link have '' on disk, and spreading old
    // settings over the defaults would keep that emptiness forever.
    claudeSessionUrl: old.claudeSessionUrl || DEFAULT_SETTINGS.claudeSessionUrl,
  };
  // Stocks written before the business-description block exist without
  // `about`; the detail screen dereferences `about.value`, so the field must
  // be present, honestly marked unavailable, not undefined.
  //
  // And the placeholder is not enough on its own. The descriptions ship in
  // the bundle, but an install that already had its stocks on disk keeps
  // those — so every existing phone rendered no description at all while a
  // fresh install showed one, which is how the owner found this. Where the
  // bundle knows a description and the stored stock does not, the stored
  // stock catches up. A description that came from a research pass (source
  // 'manual') is never overwritten by the bundle's: it is newer and better.
  const stocks = (p as { stocks?: Record<string, Stock> }).stocks;
  const repairedStocks = stocks
    ? Object.fromEntries(
        Object.entries(stocks).map(([t, s]) => {
          const seeded = SEED_STOCKS[t]?.about;
          const about =
            s.about?.source === 'manual' && s.about.value
              ? s.about
              : (s.about?.value ?? null) !== null
                ? s.about
                : (seeded ?? { value: null, asOf: null, source: 'unavailable' as const });
          return [t, { ...s, about }];
        }),
      )
    : stocks;
  return {
    ...p,
    ...(repairedStocks ? { stocks: repairedStocks } : {}),
    settings,
    refresh: p.refresh
      ? { ...p.refresh, status: p.refresh.status === 'running' ? 'idle' : p.refresh.status }
      : p.refresh,
    stanceDone: p.stanceDone ?? [],
    stanceDiff: (p as { stanceDiff?: string[] }).stanceDiff ?? [],
    vix: (p as { vix?: unknown }).vix ?? null,
  };
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
      portfolioRead: null,
      stanceDone: [],
      toggleStanceDone: (key) =>
        set((s) => ({
          stanceDone: s.stanceDone.includes(key)
            ? s.stanceDone.filter((k) => k !== key)
            : [...s.stanceDone, key],
        })),
      stanceDiff: [],
      applyStanceMove: (key) => {
        const state = get();
        const stance = state.portfolioRead?.result.allocation;
        const move = stance?.moves.find((m) => stanceMoveKey(m) === key);
        if (!move) return { ok: false, message: 'That move is no longer part of the current read.' };

        const { change, reason } = moveToHoldingChange(
          move,
          state.holdings,
          (t) => state.stocks[t]?.quote.value?.price ?? null,
          state.account().netLiquidationValue,
        );
        if (!change) return { ok: false, message: reason ?? 'This move cannot be applied automatically.' };
        if (change.sharesDelta > 0 && !state.stocks[change.ticker]) {
          return {
            ok: false,
            message: `${change.ticker} is not in the book yet — import a screenshot that includes it first.`,
          };
        }

        const holdings =
          change.newShares == null
            ? state.holdings.filter((h) => h.ticker !== change.ticker)
            : state.holdings.some((h) => h.ticker === change.ticker)
              ? state.holdings.map((h) =>
                  h.ticker === change.ticker ? { ...h, shares: change.newShares! } : h,
                )
              : [
                  ...state.holdings,
                  {
                    ticker: change.ticker,
                    shares: change.newShares,
                    // The mark it was bought at is the honest cost basis for a
                    // buy executed now; the next screenshot corrects it if the
                    // fill differed.
                    costBasis: change.price,
                    sector: state.stocks[change.ticker]!.sector,
                  },
                ];
        const cash = state.cash.some((c) => c.currency === 'USD')
          ? state.cash.map((c) =>
              c.currency === 'USD' ? { ...c, amount: c.amount + change.cashDelta } : c,
            )
          : [...state.cash, { currency: 'USD', amount: change.cashDelta }];

        set({
          holdings,
          cash,
          stanceDone: state.stanceDone.includes(key) ? state.stanceDone : [...state.stanceDone, key],
        });
        get().takeSnapshot();
        const verb = change.sharesDelta < 0 ? 'Sold' : 'Bought';
        return {
          ok: true,
          message: `${verb} ${Math.abs(change.sharesDelta)} ${change.ticker} at the ${currencyFmt(change.price)} mark${
            change.newShares == null ? ' — position closed' : ''
          }. Cash ${change.cashDelta >= 0 ? 'up' : 'down'} ${currencyFmt(Math.abs(change.cashDelta))}. Your next screenshot import remains the source of truth.`,
        };
      },
      refreshingQuotes: false,
      quotesFetchedAt: null,
      vix: null,
      feedCrosscheck: null,
      streamStatus: 'off',
      startLiveStream: async () => {
        if (streamHandle) return;
        const key = await getKey('finnhub');
        if (!key || !inUsSession()) return;
        const symbols = get().holdings.map((h) => h.ticker);
        if (!symbols.length) return;
        streamHandle = openStream(
          key,
          symbols,
          (prices) => {
            const state = get();
            const stocks = { ...state.stocks };
            const at = nowIso();
            const day = todayIso();
            let touched = 0;
            for (const [ticker, price] of Object.entries(prices)) {
              const stock = stocks[ticker];
              if (!stock) continue;
              // The tick is a price, not a day-change: previous close stays
              // whatever the last full quote established, so the day move
              // keeps meaning something between full refreshes.
              const prev = stock.quote.value?.previousClose ?? price;
              stocks[ticker] = {
                ...stock,
                quote: {
                  value: {
                    price,
                    previousClose: prev,
                    change: price - prev,
                    changePct: prev === 0 ? 0 : ((price - prev) / prev) * 100,
                    volume: null,
                    tradingDay: day,
                  },
                  asOf: at,
                  source: 'finnhub',
                },
              };
              touched++;
            }
            if (touched) set({ stocks });
          },
          (s) => set({ streamStatus: s === 'open' ? 'open' : s === 'error' ? 'error' : 'closed' }),
        );
      },
      stopLiveStream: () => {
        // A strict no-op when nothing is open. This runs every time the tab
        // hides — including the unload half of a navigation — and a set() here
        // makes persist serialise the dying page's state over whatever is in
        // storage. With no stream that write buys nothing and once raced a
        // fresher write out of existence.
        if (!streamHandle && get().streamStatus === 'off') return;
        streamHandle?.close();
        streamHandle = null;
        set({ streamStatus: 'off' });
      },
      syncStreamSymbols: () => {
        streamHandle?.setSymbols(get().holdings.map((h) => h.ticker));
      },

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

      // The path that needs nothing: no key, no credits, no model. A broker
      // export or a pasted table arrives as text, is parsed on the device, and
      // lands in exactly the same review diff the screenshot produces — so the
      // owner still approves every row before a number is written, and the
      // whole book arrives at once rather than a position at a time.
      readPositionsTable: (text) => {
        const parsed = parsePositionsTable(text);
        if (parsed.positions.length === 0) {
          return {
            ok: false,
            message: parsed.warnings[0] ?? 'Nothing in that file looked like a positions table.',
          };
        }
        const state = get();
        const diffs = diffHoldings(state.holdings, parsed.positions, (t) =>
          state.stocks[t]?.sector ?? 'tech',
        );
        set({
          pendingImport: {
            imageUri: null,
            read: {
              positions: parsed.positions,
              warnings: parsed.warnings,
              // A positions export carries positions. Account totals — cash,
              // net liquidation value, the day's P&L — are a different report,
              // so they stay null rather than being reconstructed from the
              // rows, which would silently drop whatever the file omitted.
              account: {
                netLiquidationValue: null,
                cashUsd: null,
                dayPnl: null,
                unrealizedPnl: null,
                asOfLabel: null,
              },
            },
            diffs,
            skipped: [],
            at: nowIso(),
          },
        });
        const changed = diffs.filter((d) => d.kind !== 'unchanged').length;
        return {
          ok: true,
          message:
            changed === 0
              ? `Read ${parsed.positions.length} positions — nothing has changed.`
              : `Read ${parsed.positions.length} positions, ${changed} differ from the book.`,
        };
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
        // A position that moved is worth a fresh read, and that read now
        // happens in the conversation rather than through an API key — so the
        // names are handed back to the caller and the import screen names
        // them, instead of a queue quietly researching nothing.
        const toResearch = [...new Set([...result.needResearch, ...touched])];
        // Price the new book immediately rather than waiting for the next
        // quarter-hour tick. A name that just arrived in the import has only
        // the screenshot's mark, which was already minutes old when it was
        // photographed; fifteen minutes more of it is the exact staleness the
        // import was trying to fix. Fire-and-forget — the screenshot marks are
        // already applied, so a failed refresh just leaves them in place.
        void get().refreshLiveQuotes();
        // The stream follows the book too: a name that just arrived starts
        // ticking without waiting for a reconnect.
        get().syncStreamSymbols();
        return { applied: touched.length, needResearch: toResearch };
      },

      discardPendingImport: () => set({ pendingImport: null }),

      refreshLiveQuotes: async (opts) => {
        if (get().refreshingQuotes) {
          // Not dropped — queued. A screenshot import fires this the moment it
          // applies, and the 15-minute timer or a foreground refresh is often
          // already mid-sweep with a symbol list fixed before the import
          // landed. Losing the request meant the new names kept the
          // screenshot's mark for up to a quarter of an hour, which is the
          // exact staleness the immediate refresh exists to remove.
          queuedQuoteRefresh = true;
          return { ok: false, message: 'A refresh is running; another will follow it.' };
        }
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
          // The VIX rides the same feed. Taken whenever present — even when no
          // holding matched — because the cash ladder is about the market, not
          // about which names happen to be in the book.
          if (published?.vix) set({ vix: published.vix });
          if (published) set({ feedCrosscheck: published.crosscheck ?? null });

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
          if (queuedQuoteRefresh) {
            queuedQuoteRefresh = false;
            // The follow-up reads `holdings` and `stocks` fresh, so it prices
            // whatever the import that queued it actually added.
            void get().refreshLiveQuotes(opts);
          }
        }
      },

      // The book, the previous recommendations and the projection, assembled
      // exactly as the API path assembles them — one source of truth for what
      // the reader is told, so a pasted read is working from the same facts
      // as a keyed one rather than a summary that drifted.
      buildReadPrompt: () => {
        const state = get();
        const targets = resolveTargets(
          state.plan,
          state.portfolioRead
            ? { at: state.portfolioRead.at, stance: state.portfolioRead.result.allocation ?? null }
            : null,
        );
        const planInForce = {
          ...state.plan,
          constraints: {
            ...state.plan.constraints,
            targetMix: Object.fromEntries(
              Object.entries(targets.mix).map(([k, v]) => [k, v / 100]),
            ) as RebalancePlan['constraints']['targetMix'],
          },
        };
        const insights = buildInsights(
          state.holdings,
          state.stocks,
          planInForce,
          state.cashUsd(),
          state.account().netLiquidationValue,
        );
        const verdicts = Object.values(state.stocks)
          .filter((s) => state.holdings.some((h) => h.ticker === s.ticker))
          .map((s) => `${s.ticker}: ${s.narrative.verdict} — ${s.narrative.thesis ?? ''}`)
          .join('\n');
        const prev = state.portfolioRead?.result.allocation;
        const planText = prev
          ? [
              `Previous recommendations (${state.portfolioRead!.at.slice(0, 10)}):`,
              ...prev.moves.map((m) => {
                const key = stanceMoveKey(m);
                return `- ${m.kind} ${m.ticker ?? m.sector ?? 'book'}: ${m.action} [${
                  state.stanceDone.includes(key) ? 'executed' : 'not executed'
                }]`;
              }),
            ].join('\n')
          : 'No previous recommendations on file.';
        const simulation = summariseSimulation(
          runSimulation(
            state.holdings,
            state.stocks,
            state.cashUsd(),
            state.account().netLiquidationValue,
            {
              ...DEFAULT_ASSUMPTIONS,
              riskFreePct:
                state.market.instruments.find((i) => i.symbol === 'US10Y')?.last ??
                DEFAULT_ASSUMPTIONS.riskFreePct,
            },
          ),
        );
        const book = [
          summariseForModel(insights),
          '',
          'PER-NAME VERDICTS AND THESES:',
          verdicts,
          '',
          'PROJECTION:',
          simulation,
        ].join('\n');
        return buildReadRequest(book, planText);
      },

      applyPastedRead: (text) => {
        const outcome = parsePastedRead(text);
        if (!outcome.ok || !outcome.result) return { ok: false, message: outcome.message };
        const state = get();
        // Same guard the API path uses: a mix whose arithmetic does not hold
        // would make every sector read as drifting.
        const problems = outcome.result.allocation ? stanceProblems(outcome.result.allocation) : [];
        set({
          portfolioRead: { at: nowIso(), result: outcome.result },
          stanceDone: [],
          stanceDiff: outcome.result.allocation
            ? diffStances(state.portfolioRead?.result.allocation, outcome.result.allocation)
            : [],
        });
        return {
          ok: true,
          message: problems.length
            ? `${outcome.message} The targets need a look: ${problems.join(' ')}`
            : outcome.message,
        };
      },

      applyAnythingPasted: (text) => {
        const raw = String(text ?? '').trim();
        if (!raw) return { ok: false, message: 'Nothing was pasted.' };
        const messages: string[] = [];
        let any = false;

        // A read is JSON with a headline; a positions table is rows. An answer
        // can contain both, so both are tried and both are reported.
        const readOutcome = parsePastedRead(raw);
        if (readOutcome.ok) {
          const applied = get().applyPastedRead(raw);
          messages.push(applied.message);
          any = any || applied.ok;
        }

        // Strip any fenced JSON before looking for a table, or the JSON's own
        // lines get read as positions.
        const withoutJson = raw.replace(/```(?:json)?[\s\S]*?```/g, '').trim();
        const looksTabular = /[\r\n]/.test(withoutJson) && /\d/.test(withoutJson);
        if (looksTabular) {
          const table = get().readPositionsTable(withoutJson);
          if (table.ok) {
            messages.push(table.message + ' Review the rows below before applying.');
            any = true;
          } else if (!any) {
            messages.push(table.message);
          }
        }

        if (!any) {
          return {
            ok: false,
            message: messages[0] ?? 'That did not look like a portfolio read or a positions table.',
          };
        }
        return { ok: true, message: messages.join(' ') };
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
          // With the read gone its checklist and feed stamp go too — a tick
          // that survived into a fresh seed book would describe a move from a
          // book that no longer exists.
          stanceDone: [],
          quotesFetchedAt: null,
        }),
    }),
    {
      name: 'portfolio-brief-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // Bumped when a persisted shape changes meaning — including ADDING a
      // settings key, because migrate only runs for stores below this number
      // and an unbumped addition rehydrates `undefined`, which reads as "off"
      // for every toggle. That is how the renamed insider-selling alert
      // silently never fired for upgraded installs, and it would have happened
      // again to alertOnDrift at v2. normalisePersisted is idempotent, so
      // re-running it on every bump is free. v4: stocks gained `about`. v5:
      // `about` is backfilled from the bundle, so installs that already had
      // their stocks on disk get the descriptions rather than a blank card.
      // v6: settings gained claudeSessionUrl. v7: it gained a default, which
      // an already-stored empty string would otherwise mask.
      version: 7,
      migrate: (persisted: unknown) => normalisePersisted(persisted as Record<string, unknown>),
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
        portfolioRead: s.portfolioRead,
        stanceDone: s.stanceDone,
        stanceDiff: s.stanceDiff,
        vix: s.vix,
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
/** A refresh asked for while one was running; honoured when it finishes. */
let queuedQuoteRefresh = false;
/** The open trade stream, if any. Module-level: sockets do not belong in state. */
let streamHandle: StreamHandle | null = null;


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
