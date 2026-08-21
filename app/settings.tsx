import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Switch, TextInput, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Divider, Row, Screen, Section, Text } from '@/components/ui';
import { useApp } from '@/data/store';
import { getKey, keyStorageDescription, maskKey, setKey, type KeyName } from '@/data/keys';
import { runAlertCheck } from '@/data/alerts';
import {
  durabilityDescription,
  requestDurableStorage,
  UNKNOWN_DURABILITY,
  type StorageDurability,
} from '@/data/persistence';
import {
  parseBackup,
  pickBackupFile,
  restoreBackup,
  saveBackup,
  type BackupPayload,
} from '@/data/backup';
import { currency, relativeAsOf, shares as fmtShares } from '@/domain/format';

export default function SettingsScreen() {
  const { palette, spacing, radius } = useTheme();
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const holdings = useApp((s) => s.holdings);
  const stocks = useApp((s) => s.stocks);
  const resetToSeed = useApp((s) => s.resetToSeed);

  const [status, setStatus] = useState<string | null>(null);

  return (
    <Screen>
      <Section title="Claude" subtitle="Reads your screenshots and researches each stock">
        <KeyField
          name="anthropic"
          label="Anthropic API key"
          placeholder="sk-ant-…"
          help={`${keyStorageDescription()} It never leaves this device except in requests to Anthropic.`}
        />
      </Section>

      <PricesSection onStatus={setStatus} />

      <YourDataSection onStatus={setStatus} />

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
            label="Insiders turn net sellers"
            hint="A held name whose recent filings read as selling"
            value={settings.alertOnInsiderSelling}
            onChange={(v) => update({ alertOnInsiderSelling: v })}
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
            hint={
              Platform.OS === 'web'
                ? 'Not available in a browser — there is no biometric prompt to unlock with'
                : 'Require authentication whenever the app comes back to the foreground'
            }
            value={Platform.OS === 'web' ? false : settings.biometricLockEnabled}
            disabled={Platform.OS === 'web'}
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

/**
 * The price pipeline, stated plainly: a scheduled feed does the common case
 * with no key at all, and a device key closes the gap to every name held.
 *
 * The Google Sheet route that used to sit here is gone. It solved the same
 * problem with a manual publishing step the scheduled feed made unnecessary,
 * and a settings screen that offers two ways to do one thing is how the owner
 * ends up doing neither.
 */
function PricesSection(_props: { onStatus: (s: string) => void }) {
  const { spacing } = useTheme();
  const refreshingQuotes = useApp((s) => s.refreshingQuotes);
  const quotesFetchedAt = useApp((s) => s.quotesFetchedAt);

  return (
    <Section title="Prices" subtitle="Automatic — nothing here to operate">
      <Card style={{ gap: spacing.sm }}>
        <Text variant="caption" muted>
          Marks refresh on their own: on open, every fifteen minutes while open, when the app
          returns to the foreground, and after every screenshot import. A scheduled feed keeps
          them current even while the app is closed.
          {quotesFetchedAt ? ` Feed last fetched ${relativeAsOf(quotesFetchedAt)}.` : ''}
          {refreshingQuotes ? ' Refreshing now…' : ''}
        </Text>
        <Divider />
        <KeyField
          name="finnhub"
          label="Finnhub key"
          placeholder="paste your free key"
          help="finnhub.io — free, no card. Optional but worth it: the feed covers the liquid US market, and this key covers everything else you ever hold, live, with nothing else to set up."
        />
      </Card>
    </Section>
  );
}

/**
 * Where the book lives, and how to get a copy of it out.
 *
 * The positions were read from a screenshot the owner took by hand and
 * approved row by row; there is no feed to replay them from. So this screen
 * states plainly whether the browser has promised to keep them, and offers a
 * file when it has not — rather than leaving the owner to discover the answer
 * the hard way.
 */
function YourDataSection({ onStatus }: { onStatus: (s: string) => void }) {
  const { spacing } = useTheme();
  const [durability, setDurability] = useState<StorageDurability>(UNKNOWN_DURABILITY);
  const [staged, setStaged] = useState<BackupPayload | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void requestDurableStorage().then(setDurability);
  }, []);

  const onSave = async () => {
    setBusy(true);
    const res = await saveBackup();
    setBusy(false);
    onStatus(res.message);
    // Saving is the moment the answer can change: a browser that refused
    // before may grant persistence once the app is clearly in use.
    void requestDurableStorage().then(setDurability);
  };

  const onChoose = async () => {
    const text = await pickBackupFile();
    if (text === null) return;
    try {
      setStaged(parseBackup(text));
      onStatus('Backup read. Check what it holds before restoring.');
    } catch (e) {
      setStaged(null);
      onStatus(e instanceof Error ? e.message : 'That file could not be read.');
    }
  };

  return (
    <Section title="Your data" subtitle="Where the book is kept, and how to keep a copy">
      <Card style={{ gap: spacing.sm }}>
        <Text variant="caption" muted>
          {durabilityDescription(durability)}
        </Text>
        <Button label={busy ? 'Saving…' : 'Save a backup'} onPress={onSave} disabled={busy} />
        <Text variant="caption" faint>
          A single .json file holding every position, stock, snapshot and the plan. Your API keys
          are deliberately not in it.
        </Text>

        {Platform.OS === 'web' ? (
          <>
            <Divider />
            <Button label="Restore from a backup" variant="quiet" onPress={onChoose} />
            {staged ? (
              <>
                <Row label="Holdings" value={String(staged.contents.holdings)} />
                <Row label="Stocks" value={String(staged.contents.stocks)} />
                <Row label="Snapshots" value={String(staged.contents.snapshots)} />
                <Row
                  label="Exported"
                  value={staged.exportedAt.slice(0, 16).replace('T', ' ')}
                />
                <Text variant="caption" muted>
                  Restoring replaces the book on this device. There is no undo, so save a backup of
                  what is here first if you are not sure.
                </Text>
                <Button
                  label="Replace the book with this backup"
                  tone="down"
                  onPress={() => {
                    restoreBackup(staged);
                    onStatus(
                      `Restored ${staged.contents.holdings} holdings and ${staged.contents.stocks} stocks.`,
                    );
                    setStaged(null);
                  }}
                />
              </>
            ) : null}
          </>
        ) : (
          <Text variant="caption" faint>
            Restoring from a file is available in the browser version. Here, share the backup to
            somewhere you can reach it from Safari.
          </Text>
        )}
      </Card>
    </Section>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
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
      <View style={{ flex: 1, minWidth: 0, opacity: disabled ? 0.5 : 1 }}>
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
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled }}
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
