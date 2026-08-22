import React, { useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Divider, Pill, Screen, Section, Text } from '@/components/ui';
import { useApp } from '@/data/store';
import { currency, percent, shares as fmtShares } from '@/domain/format';
import type { HoldingDiff } from '@/data/provider/claude';
import { pickPositionsFile } from '@/data/import/positionsTable';

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
  const readPositionsTable = useApp((s) => s.readPositionsTable);
  const toggleSkip = useApp((s) => s.toggleImportSkip);
  const applyImport = useApp((s) => s.applyPendingImport);
  const discard = useApp((s) => s.discardPendingImport);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [hint, setHint] = useState('');
  const [pasted, setPasted] = useState('');

  const readTable = (text: string) => {
    setStatus(null);
    const res = readPositionsTable(text);
    setStatus(res);
    if (res.ok) setPasted('');
  };

  // Straight from the clipboard, so the Live Text route is screenshot →
  // copy → one button, with no textarea in the middle. Safari asks the owner
  // to confirm the paste, which is the browser doing its job, not a failure.
  const pasteFromClipboard = async () => {
    setStatus(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setStatus({ ok: false, message: 'The clipboard is empty. Copy the table first.' });
        return;
      }
      readTable(text);
    } catch {
      setStatus({
        ok: false,
        message: 'The browser would not hand over the clipboard. Paste into the box below instead.',
      });
    }
  };

  const chooseFile = async () => {
    setStatus(null);
    if (Platform.OS !== 'web') {
      setStatus({ ok: false, message: 'File picking is available in the browser; paste the table here instead.' });
      return;
    }
    const text = await pickPositionsFile();
    if (text == null) return;
    readTable(text);
  };

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
        // quality: 1 is not a nicety. The picker re-encodes anything below it
        // as JPEG, and a broker table is small text on a light ground — the
        // exact thing JPEG smears. Measured: the same screenshot read
        // perfectly as a PNG and came back with a missing average cost after a
        // 0.85 re-encode. The file is a few hundred KB either way.
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({
            base64: true,
            quality: 1,
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
          {/* A screenshot is what the owner actually has on a phone: exporting
              a CSV from a broker's app means a desktop, an email, a download.
              So the picture leads, and the two ways to turn one into positions
              sit side by side — a Gemini key reads it in the app, or iOS Live
              Text lifts the text out of the picture for free with no key at
              all. Everything ends in the same review diff. */}
          <Section title="From a screenshot" subtitle="The whole book at once — nothing typed">
            <Card style={{ gap: spacing.sm }}>
              <Text variant="body" muted>
                Screenshot your broker's positions screen, then pick it here. With a free Gemini
                key in Settings the app reads the rows itself; without one, open the screenshot in
                Photos, press and hold the text, Select All, Copy — then paste it below. Either
                way you approve every row before anything is written.
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button
                  label="Choose a screenshot"
                  onPress={() => pick('library')}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
                <Button
                  label="Paste"
                  variant="quiet"
                  onPress={pasteFromClipboard}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
              </View>
            </Card>
          </Section>

          <Section
            title="Or from a file your broker exports"
            subtitle="A CSV, or the table copied off their website"
          >
            <Card style={{ gap: spacing.sm }}>
              <Text variant="body" muted>
                Read on this device — no key involved. Paste the table or pick the file, and the
                app shows you what changed before writing anything.
              </Text>
              <TextInput
                value={pasted}
                onChangeText={(t) => {
                  setPasted(t);
                  setStatus(null);
                }}
                placeholder={'Paste your positions table here\nSymbol  Quantity  Avg cost\nAAPL    25        180.00'}
                placeholderTextColor={palette.textFaint}
                multiline
                accessibilityLabel="Paste your positions table"
                style={{
                  minHeight: 96,
                  color: palette.text,
                  backgroundColor: palette.cardMuted,
                  borderColor: palette.border,
                  borderWidth: 1,
                  borderRadius: radius.md,
                  padding: spacing.md,
                  fontSize: 15,
                }}
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button
                  label="Read the paste"
                  onPress={() => readTable(pasted)}
                  disabled={busy || pasted.trim().length === 0}
                  style={{ flex: 1 }}
                />
                <Button
                  label="Choose a file"
                  variant="quiet"
                  onPress={chooseFile}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
              </View>
              <Text variant="caption" faint>
                A CSV, TSV or plain text file with a symbol column and a quantity column. Column
                names, currency symbols and thousands separators are worked out for you.
              </Text>
            </Card>
          </Section>

          {/* The optional nudge for the model, and the camera. Both belong
              with the screenshot route above, which is why the duplicate
              picker that used to sit here is gone: two buttons doing the same
              thing on one screen is how a reader concludes they must do
              something different. */}
          <Section title="Anything the reader should know?" subtitle="Optional">
            <Card style={{ gap: spacing.sm }}>
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
                  backgroundColor: palette.cardMuted,
                  borderColor: palette.border,
                  borderWidth: 1,
                  borderRadius: radius.md,
                  padding: spacing.md,
                  fontSize: 15,
                }}
              />
              <Button
                label="Take a photo instead"
                onPress={() => pick('camera')}
                variant="quiet"
                disabled={busy}
              />
              <Text variant="caption" faint>
                A full-width screenshot showing the ticker, quantity and average cost columns gives
                the best read. Crop out anything you would rather not send.
              </Text>
            </Card>
          </Section>

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
            {/* A file import has no picture to show; the rows below are the
                evidence, and a grey placeholder box would be furniture. */}
            {pending.imageUri ? (
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
            ) : null}
          </Section>

          {pending.read.warnings.length ? (
            <Card style={{ borderColor: palette.warn, gap: spacing.xs }}>
              <Text variant="label" tone="warn">
                {pending.imageUri ? 'Claude flagged' : 'Worth knowing —'} {pending.read.warnings.length} thing
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

          {/* An import is read as the whole book: anything it does not mention
              is a position that was closed. That is right for a full export
              and wrong for half a paste, and the difference is invisible until
              it has already happened — so when an import would close more
              positions than it touches, it says so before the button, not in
              a row twelve scrolls down. */}
          {(() => {
            const closing = pending.diffs.filter(
              (d) => d.kind === 'removed' && !pending.skipped.includes(d.ticker),
            ).length;
            const touching = pending.diffs.filter((d) => d.kind === 'added' || d.kind === 'changed').length;
            if (closing === 0 || closing <= touching) return null;
            return (
              <Card style={{ borderColor: palette.down, gap: spacing.xs }}>
                <Text variant="label" tone="down">
                  This closes {closing} position{closing === 1 ? '' : 's'}
                </Text>
                <Text variant="caption" muted>
                  {pending.imageUri
                    ? 'They are not in the screenshot, so the app reads them as sold. If the screenshot showed only part of your book, untick those rows before applying.'
                    : 'They are not in the file, so the app reads them as sold. If you pasted only part of your book, untick those rows before applying — or discard and paste the whole table.'}
                </Text>
              </Card>
            );
          })()}

          <Section title="Changes" subtitle="Tap a row to exclude it">
            <View style={{ gap: spacing.sm }}>
              {pending.diffs.map((d) => (
                <DiffRow
                  key={d.ticker}
                  diff={d}
                  skipped={pending.skipped.includes(d.ticker)}
                  onToggle={() => toggleSkip(d.ticker)}
                  fromImage={pending.imageUri != null}
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
  fromImage,
}: {
  diff: HoldingDiff;
  skipped: boolean;
  onToggle: () => void;
  fromImage: boolean;
}) {
  const { palette, spacing, radius } = useTheme();
  const toneFor = { added: 'up', removed: 'down', changed: 'warn', unchanged: 'flat' } as const;
  // The word for where the rows came from: a file import saying "gone from
  // the screenshot" is the app describing something that never happened.
  const labelFor = {
    added: 'New position',
    removed: fromImage ? 'Gone from the screenshot' : 'Not in the file',
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
