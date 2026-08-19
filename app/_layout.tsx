import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState as RNAppState, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { InfoProvider } from '@/components/InfoButton';
import { Button, Screen, Text } from '@/components/ui';
import { useApp, ensureFirstSnapshot } from '@/data/store';

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

  useEffect(() => {
    if (hydrated) ensureFirstSnapshot();
  }, [hydrated]);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' }}>
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
          headerTitleStyle: { color: palette.text },
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
