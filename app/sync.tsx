import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Divider, Pill, Screen, Section, Text } from '@/components/ui';
import { useApp } from '@/data/store';
import { currency, percent, shares as fmtShares } from '@/domain/format';
import type { HoldingDiff } from '@/data/provider/claude';

/**
 * Update the book from a broker screenshot.
 *
 * The flow is deliberately three explicit steps — pick, read, approve — because
 * an OCR pass over a screenshot is the one place in this app where a confident
 * wrong answer would quietly corrupt the position data everything else is built
 * on. Nothing is written until the owner has seen the diff.
 */
export default function SyncScreen() {
  const router = useRouter();
  const { palette, spacing, radius } = useTheme();
  const pending = useApp((s) => s.pendingImport);
  const readScreenshot = useApp((s) => s.readScreenshot);
  const toggleSkip = useApp((s) => s.toggleImportSkip);
  const applyImport = useApp((s) => s.applyPendingImport);
  const discard = useApp((s) => s.discardPendingImport);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [hint, setHint] = useState('');

  const pick = async (from: 'library' | 'camera') => {
    setStatus(null);
    const permission =
      from === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setStatus({
        ok: false,
        message:
          from === 'camera'
            ? 'Camera access was declined. You can still choose an existing screenshot.'
            : 'Photo access was declined. Enable it in iOS Settings to pick a screenshot.',
      });
      return;
    }

    const result =
      from === 'camera'
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.85 })
        : await ImagePicker.launchImageLibraryAsync({
            base64: true,
            quality: 0.85,
            mediaTypes: ['images'],
          });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    if (!asset.base64) {
      setStatus({ ok: false, message: 'That image could not be read from disk.' });
      return;
    }

    setBusy(true);
    setStatus({ ok: true, message: 'Reading the screenshot…' });
    const res = await readScreenshot({
      uri: asset.uri,
      base64: asset.base64,
      mediaType: asset.mimeType === 'image/png' ? 'image/png' : 'image/jpeg',
      hint: hint.trim() || undefined,
    });
    setBusy(false);
    setStatus(res);
  };

  const apply = () => {
    const { applied, needResearch } = applyImport();
    setStatus({
      ok: true,
      message:
        applied === 0
          ? 'Nothing changed — the book already matched.'
          : `${applied} position${applied === 1 ? '' : 's'} updated.` +
            (needResearch.length
              ? ` Researching ${needResearch.join(', ')} in the background.`
              : ''),
    });
    router.back();
  };

  return (
    <Screen>
      {!pending ? (
        <>
          <Card style={{ gap: spacing.sm }}>
            <Text variant="heading">How this works</Text>
            <Text variant="body" muted>
              Take a screenshot of your broker's positions screen and pick it here. Claude reads the
              rows, shows you exactly what it thinks changed, and only writes to the book once you
              approve. Nothing is fetched from a market-data feed — the marks come from your own
              statement.
            </Text>
            <Text variant="body" muted>
              Once you apply, every position that moved goes into a research queue: Claude searches
              for the latest on each one — what was said on the most recent earnings call, current
              analyst targets and revisions, and news from the last month — and rewrites that stock's
              page.
            </Text>
            <Text variant="caption" faint>
              A full-width screenshot with the ticker, quantity, last price and P&L columns visible
              gives the best read. Crop out anything you would rather not send.
            </Text>
          </Card>

          <Section title="Anything Claude should know?" subtitle="Optional">
            <TextInput
              value={hint}
              onChangeText={setHint}
              placeholder="e.g. this is the margin account, ignore the pending orders row"
              placeholderTextColor={palette.textFaint}
              multiline
              accessibilityLabel="Optional context for reading the screenshot"
              style={{
                minHeight: 64,
                color: palette.text,
                backgroundColor: palette.card,
                borderColor: palette.border,
                borderWidth: 1,
                borderRadius: radius.md,
                padding: spacing.md,
                fontSize: 15,
              }}
            />
          </Section>

          <View style={{ gap: spacing.sm }}>
            <Button label="Choose a screenshot" onPress={() => pick('library')} disabled={busy} />
            <Button
              label="Take a photo"
              onPress={() => pick('camera')}
              variant="quiet"
              disabled={busy}
            />
          </View>

          {busy ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
              <ActivityIndicator color={palette.accent} />
              <Text variant="body" muted>
                Claude is reading the image…
              </Text>
            </View>
          ) : null}

          {status ? (
            <Card style={{ borderColor: status.ok ? palette.border : palette.down }}>
              <Text variant="body" tone={status.ok ? undefined : 'down'}>
                {status.message}
              </Text>
            </Card>
          ) : null}
        </>
      ) : (
        <>
          <Section
            title="Review before applying"
            subtitle={`${pending.diffs.filter((d) => d.kind !== 'unchanged').length} of ${pending.diffs.length} rows differ`}
          >
            <Image
              source={{ uri: pending.imageUri }}
              style={{
                width: '100%',
                height: 160,
                borderRadius: radius.md,
                resizeMode: 'contain',
                backgroundColor: palette.cardMuted,
              }}
              accessibilityLabel="The screenshot you selected"
            />
          </Section>

          {pending.read.warnings.length ? (
            <Card style={{ borderColor: palette.warn, gap: spacing.xs }}>
              <Text variant="label" tone="warn">
                Claude flagged {pending.read.warnings.length} thing
                {pending.read.warnings.length === 1 ? '' : 's'}
              </Text>
              {pending.read.warnings.map((w, i) => (
                <Text key={i} variant="caption" muted>
                  • {w}
                </Text>
              ))}
            </Card>
          ) : null}

          {pending.read.account.netLiquidationValue != null ||
          pending.read.account.cashUsd != null ? (
            <Card style={{ gap: spacing.xs }}>
              <Text variant="label">Account figures read</Text>
              {pending.read.account.netLiquidationValue != null ? (
                <Text variant="caption" muted>
                  Net liquidation value {currency(pending.read.account.netLiquidationValue)}
                </Text>
              ) : null}
              {pending.read.account.cashUsd != null ? (
                <Text variant="caption" muted>
                  Cash {currency(pending.read.account.cashUsd)} — this will replace the USD cash
                  balance
                </Text>
              ) : null}
              {pending.read.account.asOfLabel ? (
                <Text variant="caption" faint>
                  Timestamp on screen: {pending.read.account.asOfLabel}
                </Text>
              ) : null}
            </Card>
          ) : null}

          <Section title="Changes" subtitle="Tap a row to exclude it">
            <View style={{ gap: spacing.sm }}>
              {pending.diffs.map((d) => (
                <DiffRow
                  key={d.ticker}
                  diff={d}
                  skipped={pending.skipped.includes(d.ticker)}
                  onToggle={() => toggleSkip(d.ticker)}
                />
              ))}
            </View>
          </Section>

          <View style={{ gap: spacing.sm }}>
            <Button label="Apply to my book" onPress={apply} />
            <Button label="Discard this read" onPress={discard} variant="quiet" tone="down" />
          </View>
        </>
      )}
    </Screen>
  );
}

function DiffRow({
  diff,
  skipped,
  onToggle,
}: {
  diff: HoldingDiff;
  skipped: boolean;
  onToggle: () => void;
}) {
  const { palette, spacing, radius } = useTheme();
  const toneFor = { added: 'up', removed: 'down', changed: 'warn', unchanged: 'flat' } as const;
  const labelFor = {
    added: 'New position',
    removed: 'Gone from the screenshot',
    changed: 'Size changed',
    unchanged: 'Unchanged',
  } as const;

  const before = diff.before;
  const after = diff.after;
  const lowConfidence = diff.confidence < 0.7;

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !skipped }}
      accessibilityLabel={`${diff.ticker}, ${labelFor[diff.kind]}. ${
        skipped ? 'Excluded' : 'Included'
      }.`}
      style={{
        backgroundColor: palette.card,
        borderColor: skipped ? palette.border : lowConfidence ? palette.warn : palette.border,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: radius.md,
        padding: spacing.md,
        gap: spacing.xs,
        opacity: skipped ? 0.5 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Ionicons
          name={skipped ? 'square-outline' : 'checkbox'}
          size={20}
          color={skipped ? palette.textFaint : palette.accent}
        />
        <Text variant="heading" style={{ flex: 1 }}>
          {diff.ticker}
        </Text>
        <Pill label={labelFor[diff.kind]} tone={toneFor[diff.kind]} compact />
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' }}>
        <Text variant="caption" muted>
          {before ? `${fmtShares(before.shares)} sh` : 'not held'}
          {' → '}
          {after ? `${fmtShares(after.shares)} sh` : 'closed'}
        </Text>
        {diff.price != null ? (
          <Text variant="caption" muted>
            at {currency(diff.price)}
          </Text>
        ) : null}
        {after && before && after.costBasis !== before.costBasis ? (
          <Text variant="caption" muted>
            avg cost {currency(before.costBasis)} → {currency(after.costBasis)}
          </Text>
        ) : null}
      </View>

      {lowConfidence ? (
        <Text variant="caption" tone="warn">
          Claude was only {percent(diff.confidence * 100, { sign: false, decimals: 0 })} confident
          reading this row — check it against the screenshot.
        </Text>
      ) : null}
      {diff.note ? (
        <Text variant="caption" faint>
          {diff.note}
        </Text>
      ) : null}
    </Pressable>
  );
}
