import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * API keys live in the keychain, never in AsyncStorage and never in the bundle.
 * `expo-secure-store` has no web implementation, so on web keys are held in
 * memory for the session only — the right trade for a browser preview, and it
 * is stated plainly on the Data sources screen.
 *
 * Calling Anthropic directly from the device means the key is on the device.
 * For a single-owner personal app that is the honest trade: no server to run,
 * no third party holding the key. It is written up in docs/DATA.md along with
 * the proxy setup to use if this ever ships to more than one person.
 */

export type KeyName = 'alphavantage' | 'anthropic';

const STORE_KEYS: Record<KeyName, string> = {
  alphavantage: 'alphavantage.apiKey',
  anthropic: 'anthropic.apiKey',
};

const memoryKeys: Partial<Record<KeyName, string>> = {};

export async function getKey(name: KeyName): Promise<string | null> {
  if (Platform.OS === 'web') return memoryKeys[name] ?? null;
  try {
    return await SecureStore.getItemAsync(STORE_KEYS[name]);
  } catch {
    return null;
  }
}

export async function setKey(name: KeyName, value: string): Promise<void> {
  const trimmed = value.trim();
  if (Platform.OS === 'web') {
    if (trimmed) memoryKeys[name] = trimmed;
    else delete memoryKeys[name];
    return;
  }
  if (!trimmed) {
    await SecureStore.deleteItemAsync(STORE_KEYS[name]);
    return;
  }
  await SecureStore.setItemAsync(STORE_KEYS[name], trimmed);
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
