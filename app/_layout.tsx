import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState as RNAppState, Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { InfoProvider } from '@/components/InfoButton';
import { Button, Screen, Text } from '@/components/ui';
import { useApp, ensureFirstSnapshot } from '@/data/store';
import { requestDurableStorage } from '@/data/persistence';

/** Face ID gate. Re-arms whenever the app goes to the background. */
function BiometricGate({ children }: { children: React.ReactNode }) {
  const enabled = useApp((s) => s.settings.biometricLockEnabled);
  const unlocked = useApp((s) => s.unlocked);
  const setUnlocked = useApp((s) => s.setUnlocked);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const { palette, spacing } = useTheme();

  const attempt = React.useCallback(async () => {
    setChecking(true);
    setFailed(false);
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        // Nothing to authenticate against — no enrolled biometrics, or a
        // browser, where `hasHardwareAsync` reports false. Locking the owner
        // out of their own data with no way to satisfy the prompt would be
        // worse than not locking it.
        setUnlocked(true);
        return;
      }
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Portfolio Brief',
        fallbackLabel: 'Use passcode',
      });
      if (res.success) setUnlocked(true);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  }, [setUnlocked]);

  useEffect(() => {
    if (enabled && !unlocked) void attempt();
  }, [enabled, unlocked, attempt]);

  useEffect(() => {
    if (!enabled) return;
    const sub = RNAppState.addEventListener('change', (state) => {
      if (state === 'background') setUnlocked(false);
    });
    return () => sub.remove();
  }, [enabled, setUnlocked]);

  if (!enabled || unlocked) return <>{children}</>;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.bg,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.xl,
        gap: spacing.lg,
      }}
    >
      <Text variant="title">Portfolio Brief</Text>
      <Text variant="body" muted style={{ textAlign: 'center' }}>
        {failed ? 'Authentication was cancelled.' : 'Unlocking…'}
      </Text>
      {checking ? <ActivityIndicator color={palette.accent} /> : null}
      {failed ? <Button label="Try again" onPress={attempt} /> : null}
    </View>
  );
}

function Root() {
  const { palette, scheme } = useTheme();
  const hydrated = useApp((s) => s.hydrated);
  const refreshLiveQuotes = useApp((s) => s.refreshLiveQuotes);
  const startLiveStream = useApp((s) => s.startLiveStream);
  const stopLiveStream = useApp((s) => s.stopLiveStream);

  useEffect(() => {
    if (hydrated) ensureFirstSnapshot();
  }, [hydrated]);

  // Asked for once the book is actually on disk, not before: browsers weigh
  // the request against how much the site is used, and asking with an empty
  // store is the weakest version of it. Fire-and-forget — a browser that says
  // no changes nothing about how the app runs, only what Settings reports and
  // how much the backup file matters.
  useEffect(() => {
    if (hydrated) void requestDurableStorage();
  }, [hydrated]);

  // Re-mark the book on open and then every fifteen minutes while it stays
  // open, matching the schedule the workflow publishes on. "Up to date without
  // extra work" has to mean the app does this rather than the owner
  // remembering to, so it is silent: with no key set it returns a message
  // nobody asked for, and Settings is where that conversation belongs. The
  // marks already on file still render, each with the date it was fetched.
  //
  // Coming back from the background counts as an open. A phone that has had
  // the app parked for an hour is the case where the prices on screen are
  // furthest from the truth, and where a timer alone would not have fired.
  useEffect(() => {
    if (!hydrated) return;
    void refreshLiveQuotes();
    const timer = setInterval(() => void refreshLiveQuotes(), 15 * 60 * 1000);
    const sub = RNAppState.addEventListener('change', (s) => {
      if (s === 'active') void refreshLiveQuotes();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [hydrated, refreshLiveQuotes]);

  // The trade stream: sub-second marks while a US session is open and a
  // Finnhub key is on the device. Torn down in the background — a socket
  // held by a backgrounded PWA is a battery bill — and retried on the hour
  // boundary so a session opening while the app sits idle still connects.
  useEffect(() => {
    if (!hydrated) return;
    void startLiveStream();
    const retry = setInterval(() => void startLiveStream(), 5 * 60 * 1000);
    const sub = RNAppState.addEventListener('change', (s) => {
      if (s === 'active') void startLiveStream();
      else if (s === 'background') stopLiveStream();
    });
    return () => {
      clearInterval(retry);
      sub.remove();
      stopLiveStream();
    };
  }, [hydrated, startLiveStream, stopLiveStream]);

  if (!hydrated) {
    // The first thing a cold start shows. A bare spinner reads as "something
    // is stuck"; a wordmark over the spinner reads as "the product is opening".
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: palette.bg,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
        }}
      >
        <Text variant="title">Portfolio Brief</Text>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  return (
    <BiometricGate>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.bg },
          headerTintColor: palette.text,
          headerTitleStyle: {
            color: palette.text,
            fontFamily:
              Platform.OS === 'web'
                ? "'Plex Sans Var', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
                : undefined,
            fontSize: 19,
            fontWeight: '700',
          },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: palette.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="stock/[ticker]" options={{ title: '' }} />
        <Stack.Screen name="sync" options={{ title: 'Update from screenshot' }} />
        <Stack.Screen name="market" options={{ title: 'Market' }} />
        <Stack.Screen name="returns" options={{ title: 'Returns' }} />
        <Stack.Screen name="watchlist" options={{ title: 'Watchlist' }} />
        <Stack.Screen name="history" options={{ title: 'History' }} />
        <Stack.Screen name="insights" options={{ title: 'AI insights' }} />
        <Stack.Screen name="sources" options={{ title: 'Data sources' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      </Stack>
    </BiometricGate>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <InfoProvider>
          <Root />
        </InfoProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** Rendered when a route throws, instead of a blank screen. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <ThemeProvider>
      <Screen>
        <Text variant="title">This screen hit a problem</Text>
        <Text variant="body" muted>
          {error.message}
        </Text>
        <Button label="Try again" onPress={retry} />
      </Screen>
    </ThemeProvider>
  );
}
