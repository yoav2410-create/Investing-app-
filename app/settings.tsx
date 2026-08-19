import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, TextInput, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Divider, Row, Screen, Section, Text } from '@/components/ui';
import { useApp } from '@/data/store';
import { getKey, maskKey, setKey, type KeyName } from '@/data/keys';
import { runAlertCheck } from '@/data/alerts';
import { currency, shares as fmtShares } from '@/domain/format';

export default function SettingsScreen() {
  const { palette, spacing, radius } = useTheme();
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const holdings = useApp((s) => s.holdings);
  const stocks = useApp((s) => s.stocks);
  const refreshNow = useApp((s) => s.refreshNow);
  const resetToSeed = useApp((s) => s.resetToSeed);
  const refresh = useApp((s) => s.refresh);

  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Screen>
      <Section title="Claude" subtitle="Reads your screenshots and researches each stock">
        <KeyField
          name="anthropic"
          label="Anthropic API key"
          placeholder="sk-ant-…"
          help="Stored in the device keychain. It never leaves the device except in requests to Anthropic."
        />
      </Section>

      <Section title="Alpha Vantage" subtitle="Optional — adds precise daily technicals">
        <KeyField
          name="alphavantage"
          label="Alpha Vantage API key"
          placeholder="Optional"
          help="A free key allows 25 requests a day, which is fewer than one per tracked ticker. The scheduler spends that budget in priority order and rotates the rest across days."
        />
        <Card style={{ gap: spacing.sm }}>
          <Row
            label="Daily call budget"
            value={String(settings.dailyCallBudget)}
            hint={`${refresh.callsUsedToday} used today`}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {[25, 75, 500].map((n) => (
              <Button
                key={n}
                label={String(n)}
                onPress={() => update({ dailyCallBudget: n })}
                variant={settings.dailyCallBudget === n ? 'solid' : 'quiet'}
                style={{ flex: 1 }}
              />
            ))}
          </View>
          <Button
            label={busy ? 'Refreshing…' : 'Refresh technicals now'}
            onPress={async () => {
              setBusy(true);
              const res = await refreshNow();
              setBusy(false);
              setStatus(res.message);
            }}
            variant="quiet"
            disabled={busy}
          />
          {busy ? <ActivityIndicator color={palette.accent} /> : null}
        </Card>
      </Section>

      <Section title="Alerts">
        <Card>
          <Toggle
            label="Notifications"
            hint="Local notifications when something crosses a threshold"
            value={settings.notificationsEnabled}
            onChange={async (v) => {
              if (v) {
                const perm = await Notifications.requestPermissionsAsync();
                if (!perm.granted) {
                  setStatus('Notification permission was declined.');
                  return;
                }
              }
              update({ notificationsEnabled: v });
            }}
          />
          <Toggle
            label="Trend changes"
            hint="A stock crossing a moving average or flipping trend direction"
            value={settings.alertOnTrendChange}
            onChange={(v) => update({ alertOnTrendChange: v })}
          />
          <Toggle
            label="Options flow flips bearish"
            hint="Put/call crossing 1.00"
            value={settings.alertOnOptionsFlip}
            onChange={(v) => update({ alertOnOptionsFlip: v })}
          />
          <Row
            label="Earnings warning"
            value={`${settings.alertOnEarningsWithinDays} days ahead`}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            {[3, 7, 14].map((n) => (
              <Button
                key={n}
                label={`${n}d`}
                onPress={() => update({ alertOnEarningsWithinDays: n })}
                variant={settings.alertOnEarningsWithinDays === n ? 'solid' : 'quiet'}
                style={{ flex: 1 }}
              />
            ))}
          </View>
          <Divider />
          <Button
            label="Check alerts now"
            variant="quiet"
            onPress={async () => {
              const fired = await runAlertCheck(useApp.getState());
              setStatus(
                fired.length === 0
                  ? 'Nothing is crossing a threshold right now.'
                  : `${fired.length} alert${fired.length === 1 ? '' : 's'}: ${fired.map((f) => f.title).join('; ')}`,
              );
            }}
          />
        </Card>
      </Section>

      <Section title="Privacy">
        <Card>
          <Toggle
            label="Face ID lock"
            hint="Require authentication whenever the app comes back to the foreground"
            value={settings.biometricLockEnabled}
            onChange={(v) => update({ biometricLockEnabled: v })}
          />
        </Card>
      </Section>

      <Section title="Positions" subtitle="Read from your screenshots; editable here">
        <Card>
          {holdings.map((h) => (
            <Row
              key={h.ticker}
              label={h.ticker}
              hint={stocks[h.ticker]?.name}
              value={`${fmtShares(h.shares)} sh @ ${currency(h.costBasis)}`}
            />
          ))}
          <Text variant="caption" faint style={{ marginTop: spacing.sm }}>
            {holdings.length} positions. The fastest way to correct these is to import a fresh
            screenshot — Claude will show you the diff before anything changes.
          </Text>
        </Card>
      </Section>

      <Section title="Reset">
        <Card style={{ gap: spacing.sm }}>
          <Text variant="caption" muted>
            Restores the bundled seed portfolio and clears snapshots. Your API keys are kept.
          </Text>
          <Button
            label="Reset to seed data"
            tone="down"
            variant="quiet"
            onPress={() => {
              resetToSeed();
              setStatus('Reset to the bundled seed portfolio.');
            }}
          />
        </Card>
      </Section>

      {status ? (
        <Card>
          <Text variant="caption" muted>
            {status}
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { palette, spacing } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.sm,
        minHeight: 44,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body">{label}</Text>
        {hint ? (
          <Text variant="caption" faint>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: palette.accent, false: palette.borderStrong }}
      />
    </View>
  );
}

function KeyField({
  name,
  label,
  placeholder,
  help,
}: {
  name: KeyName;
  label: string;
  placeholder: string;
  help: string;
}) {
  const { palette, spacing, radius } = useTheme();
  const [stored, setStored] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getKey(name).then(setStored);
  }, [name]);

  return (
    <Card style={{ gap: spacing.sm }}>
      <Text variant="label">{label}</Text>
      <Text variant="caption" faint>
        Currently: {maskKey(stored)}
      </Text>
      <TextInput
        value={draft}
        onChangeText={(t) => {
          setDraft(t);
          setSaved(false);
        }}
        placeholder={placeholder}
        placeholderTextColor={palette.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        accessibilityLabel={label}
        style={{
          color: palette.text,
          backgroundColor: palette.cardMuted,
          borderColor: palette.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          minHeight: 44,
          fontSize: 15,
        }}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button
          label={saved ? 'Saved' : 'Save key'}
          onPress={async () => {
            await setKey(name, draft);
            setStored(await getKey(name));
            setDraft('');
            setSaved(true);
          }}
          style={{ flex: 1 }}
        />
        <Button
          label="Clear"
          variant="quiet"
          onPress={async () => {
            await setKey(name, '');
            setStored(null);
            setDraft('');
            setSaved(false);
          }}
          style={{ flex: 1 }}
        />
      </View>
      <Text variant="caption" faint>
        {help}
      </Text>
    </Card>
  );
}
