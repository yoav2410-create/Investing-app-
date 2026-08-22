import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * API keys never go in the bundle and never in AsyncStorage alongside the
 * portfolio. Where they do live depends on the platform, and the difference is
 * worth being explicit about:
 *
 *   native — the iOS keychain (`expo-secure-store`). Encrypted at rest, tied to
 *   the device, unreadable by other apps.
 *
 *   web — `localStorage`, scoped to the origin the app is served from. Weaker
 *   than the keychain: any script running on that origin could read it. For a
 *   personal app installed to the home screen from a site serving only its own
 *   code, that is the honest trade, and it is the difference between a usable
 *   app and one that asks for the key on every launch. It is stated on the
 *   Settings screen rather than left for the owner to discover.
 *
 * Either way the key stays on the device and is sent only to Anthropic.
 */

export type KeyName = 'alphavantage' | 'anthropic' | 'finnhub' | 'gemini';

const STORE_KEYS: Record<KeyName, string> = {
  alphavantage: 'alphavantage.apiKey',
  anthropic: 'anthropic.apiKey',
  finnhub: 'finnhub.apiKey',
  gemini: 'gemini.apiKey',
};

/** Last-resort store for a browser with localStorage disabled (private mode). */
const memoryKeys: Partial<Record<KeyName, string>> = {};

function webStorage(): Storage | null {
  try {
    // Safari throws on access when storage is blocked, not on use.
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = '__probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export async function getKey(name: KeyName): Promise<string | null> {
  if (Platform.OS === 'web') {
    const store = webStorage();
    if (!store) return memoryKeys[name] ?? null;
    return store.getItem(STORE_KEYS[name]);
  }
  try {
    return await SecureStore.getItemAsync(STORE_KEYS[name]);
  } catch {
    return null;
  }
}

export async function setKey(name: KeyName, value: string): Promise<void> {
  const trimmed = value.trim();
  if (Platform.OS === 'web') {
    const store = webStorage();
    if (!store) {
      if (trimmed) memoryKeys[name] = trimmed;
      else delete memoryKeys[name];
      return;
    }
    if (trimmed) store.setItem(STORE_KEYS[name], trimmed);
    else store.removeItem(STORE_KEYS[name]);
    return;
  }
  if (!trimmed) {
    await SecureStore.deleteItemAsync(STORE_KEYS[name]);
    return;
  }
  await SecureStore.setItemAsync(STORE_KEYS[name], trimmed);
}

/**
 * Where a key on this platform actually lives, for the Settings screen. An app
 * holding an API key should say where it put it.
 */
export function keyStorageDescription(): string {
  if (Platform.OS !== 'web') return 'Stored in the iOS keychain, encrypted and tied to this device.';
  return webStorage()
    ? 'Stored in this browser only. Weaker than the iOS keychain — clearing website data removes it.'
    : 'Held for this session only — private browsing is blocking storage, so the key is forgotten on close.';
}

export const getApiKey = () => getKey('alphavantage');
export const setApiKey = (v: string) => setKey('alphavantage', v);
export const getClaudeKey = () => getKey('anthropic');
export const setClaudeKey = (v: string) => setKey('anthropic', v);

/** Never render the key itself — only enough to confirm which one is stored. */
export function maskKey(key: string | null): string {
  if (!key) return 'not set';
  if (key.length <= 4) return '••••';
  return `••••${key.slice(-4)}`;
}
