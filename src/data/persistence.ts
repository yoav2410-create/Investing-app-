import { Platform } from 'react-native';

/**
 * Ask the browser not to throw the owner's book away.
 *
 * On web the store lives in localStorage, which browsers treat as best-effort
 * by default: under storage pressure, or after a long enough gap, it can be
 * cleared without warning or any prompt. For most sites that is the right
 * default. Here it is the one thing that must not happen — the positions came
 * from a broker screenshot the owner photographed by hand, and losing them
 * means taking it again. An app that silently forgets the book has no value.
 *
 * `navigator.storage.persist()` moves the origin from "best-effort" to
 * "persistent", which browsers grant far more readily to an app installed to
 * the home screen than to a tab. It is a request, not a guarantee, and Safari
 * answers it silently — so the outcome is reported rather than assumed, and
 * Settings states which way it went instead of implying safety the browser
 * never promised.
 *
 * This is not a substitute for the backup file. Persistent storage survives
 * eviction; it does not survive "Clear website data", a lost phone, or a
 * different device. That is what `backup.ts` is for.
 */

export interface StorageDurability {
  /** Whether the platform can answer the question at all. */
  supported: boolean;
  /** Whether the store is protected from automatic eviction. */
  persistent: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
}

export const UNKNOWN_DURABILITY: StorageDurability = {
  supported: false,
  persistent: false,
  usageBytes: null,
  quotaBytes: null,
};

export async function requestDurableStorage(): Promise<StorageDurability> {
  // On native the store is a file in the app's own container. Nothing evicts it
  // but deleting the app, so there is no request to make.
  if (Platform.OS !== 'web') {
    return { supported: true, persistent: true, usageBytes: null, quotaBytes: null };
  }

  const storage = globalThis.navigator?.storage;
  if (!storage?.persist) return UNKNOWN_DURABILITY;

  try {
    // Asking again when it has already been granted is wasteful and, in some
    // browsers, re-prompts.
    const already = storage.persisted ? await storage.persisted() : false;
    const persistent = already || (await storage.persist());
    const estimate = storage.estimate ? await storage.estimate() : null;
    return {
      supported: true,
      persistent,
      usageBytes: estimate?.usage ?? null,
      quotaBytes: estimate?.quota ?? null,
    };
  } catch {
    // A browser that refuses to answer is treated as not persistent, because
    // that is the assumption that keeps the owner's backup habit intact.
    return { supported: true, persistent: false, usageBytes: null, quotaBytes: null };
  }
}

/** For the Settings screen. Says what is true, including when it is not good. */
export function durabilityDescription(d: StorageDurability): string {
  if (Platform.OS !== 'web') {
    return 'Held in this app\'s own storage on the device. Only deleting the app removes it.';
  }
  if (!d.supported) {
    return 'This browser will not say whether it protects stored data. Export a backup and keep it.';
  }
  if (d.persistent) {
    return 'This browser has marked the book as persistent, so it will not be cleared to free space. Clearing website data still removes it.';
  }
  return 'This browser has not granted persistent storage, so the book could be cleared to free space. Export a backup and keep it somewhere else.';
}
