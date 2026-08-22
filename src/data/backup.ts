import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type {
  Holding,
  MarketSnapshot,
  PortfolioSnapshot,
  RebalancePlan,
  RefreshState,
  Settings,
  Stock,
} from '@/domain/types';
import { nowIso } from '@/domain/format';
import { normalisePersisted, useApp, type PendingImport } from './store';

/**
 * A file the owner can keep, holding the whole book.
 *
 * The positions in this app did not come from a broker feed that could simply
 * be replayed — they were read out of a screenshot the owner took by hand, and
 * approved row by row. Persistent storage (see `persistence.ts`) stops the
 * browser evicting that work to free space, but it does not survive clearing
 * website data, a lost phone, or moving to a different device. Nothing did,
 * before this file existed.
 *
 * Deliberately *not* included: the Anthropic and Alpha Vantage keys. They live
 * outside the store (`keys.ts`) precisely so they are not part of anything the
 * app writes out, and a backup that quietly carried a credential into the
 * owner's downloads folder would be a worse failure than having no backup.
 */

export const BACKUP_FORMAT = 'portfolio-brief-backup';
export const BACKUP_VERSION = 1;

/** Exactly the slice the store persists. Kept in step with `partialize`. */
export interface PersistedSlice {
  holdings: Holding[];
  stocks: Record<string, Stock>;
  plan: RebalancePlan;
  market: MarketSnapshot;
  cash: { currency: string; amount: number }[];
  settings: Settings;
  refresh: RefreshState;
  snapshots: PortfolioSnapshot[];
  staleNarratives: string[];
  pendingImport: PendingImport | null;
  portfolioRead: unknown;
  /** Optional: backups written before the dynamic plan existed lack it. */
  stanceDone?: string[];
}

export interface BackupContents {
  holdings: number;
  stocks: number;
  snapshots: number;
  planLegs: number;
  netLiquidationValue: number | null;
}

export interface BackupPayload {
  format: string;
  version: number;
  exportedAt: string;
  /** Summary counts, so a person can see what a file holds before trusting it. */
  contents: BackupContents;
  state: PersistedSlice;
}

function currentSlice(): PersistedSlice {
  const s = useApp.getState();
  return {
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
  };
}

export function describe(slice: PersistedSlice, nlv: number | null): BackupContents {
  return {
    holdings: slice.holdings?.length ?? 0,
    stocks: Object.keys(slice.stocks ?? {}).length,
    snapshots: slice.snapshots?.length ?? 0,
    planLegs: slice.plan?.legs?.length ?? 0,
    netLiquidationValue: nlv,
  };
}

export function buildBackup(): BackupPayload {
  const slice = currentSlice();
  let nlv: number | null = null;
  try {
    nlv = useApp.getState().account().netLiquidationValue;
  } catch {
    // A backup is still worth writing even if the derived figure will not
    // compute; the raw positions are the part that matters.
    nlv = null;
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: nowIso(),
    contents: describe(slice, nlv),
    state: slice,
  };
}

export function backupFilename(at = new Date()): string {
  const stamp = at.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `portfolio-brief-${stamp}.json`;
}

/**
 * Hand the file to the owner. Returns what happened in words, because a save
 * that quietly did nothing is the failure mode worth naming.
 */
export async function saveBackup(): Promise<{ ok: boolean; message: string }> {
  const payload = buildBackup();
  const text = JSON.stringify(payload, null, 2);
  const name = backupFilename();

  if (Platform.OS === 'web') {
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking immediately can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return {
        ok: true,
        message: `Saved ${name} — ${payload.contents.holdings} holdings, ${payload.contents.stocks} stocks.`,
      };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Could not save the backup.' };
    }
  }

  try {
    const file = new FileSystem.File(FileSystem.Paths.cache, name);
    file.write(text);
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, message: 'Sharing is not available on this device, so the file cannot be handed off.' };
    }
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Portfolio Brief backup' });
    return {
      ok: true,
      message: `Shared ${name} — ${payload.contents.holdings} holdings, ${payload.contents.stocks} stocks.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not write the backup.' };
  }
}

/**
 * Read a backup file without applying it.
 *
 * Every failure says which check failed rather than "invalid file". Restoring
 * is destructive — it replaces the book on this device — so the owner is shown
 * what the file contains and confirms before anything is written.
 */
export function parseBackup(text: string): BackupPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not JSON. Pick the .json file this app exported.');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('That file does not contain a backup object.');
  }
  const p = raw as Partial<BackupPayload>;
  if (p.format !== BACKUP_FORMAT) {
    throw new Error(
      `That file is not a Portfolio Brief backup (it says "${String(p.format ?? 'nothing')}").`,
    );
  }
  if (typeof p.version !== 'number' || p.version > BACKUP_VERSION) {
    throw new Error(
      `That backup is version ${String(p.version)}, which this build does not know how to read.`,
    );
  }
  const state = p.state as PersistedSlice | undefined;
  if (!state || !Array.isArray(state.holdings) || typeof state.stocks !== 'object' || state.stocks === null) {
    throw new Error('That backup is missing its holdings or stocks, so it would restore an empty book.');
  }
  return { ...(p as BackupPayload), state };
}

/** Replaces the book on this device. Caller confirms first. */
export function restoreBackup(payload: BackupPayload): void {
  // A backup written by an older build is an old persisted state by another
  // door, so it goes through the same repairs an upgrade does — renamed
  // settings mapped, a stuck refresh status cleared, missing slices defaulted.
  const s = normalisePersisted(payload.state as unknown as Record<string, unknown>) as unknown as PersistedSlice;
  useApp.setState({
    holdings: s.holdings,
    stocks: s.stocks,
    plan: s.plan,
    market: s.market,
    cash: s.cash,
    settings: s.settings,
    refresh: s.refresh,
    snapshots: s.snapshots,
    staleNarratives: s.staleNarratives ?? [],
    pendingImport: s.pendingImport ?? null,
    portfolioRead: (s.portfolioRead ?? null) as never,
    stanceDone: s.stanceDone ?? [],
  });
}

/** Web-only: open the file picker and read one file as text. */
export function pickBackupFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    // A cancelled picker fires nothing in most browsers, so the promise simply
    // never settles. That is fine: the screen stays as it was.
    input.click();
  });
}
