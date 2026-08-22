import React, { useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
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
  const applyAnything = useApp((s) => s.applyAnythingPasted);
  const buildReadPrompt = useApp((s) => s.buildReadPrompt);
  const sessionUrl = useApp((s) => s.settings.claudeSessionUrl);
  const toggleSkip = useApp((s) => s.toggleImportSkip);
  const applyImport = useApp((s) => s.applyPendingImport);
  const discard = useApp((s) => s.discardPendingImport);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [pasted, setPasted] = useState('');

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
      setStatus(applyAnything(text));
    } catch {
      setStatus({
        ok: false,
        message: 'The browser would not hand over the clipboard. Paste into the box below instead.',
      });
    }
  };

  // The book as text, so the read can account for what is already held.
  const copyBook = async () => {
    try {
      await navigator.clipboard.writeText(buildReadPrompt());
      setStatus({ ok: true, message: 'The book is on the clipboard — paste it into the conversation.' });
    } catch {
      setStatus({ ok: false, message: 'The browser refused the clipboard. Ask for the read in the conversation instead.' });
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
    setStatus(applyAnything(text));
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
          {/* The whole loop, in the order it happens. The owner has a
              screenshot on their phone; the conversation can read it and
              analyse the book in one answer; the answer comes back here.
              A single paste box takes whatever that answer contains —
              positions, the read, or both — because making someone choose the
              right button for text they did not write is a puzzle, not a
              feature. */}
          <Section title="Send it to Claude" subtitle="Positions and the read, in one answer">
            <Card style={{ gap: spacing.sm }}>
              <Text variant="body" muted>
                Screenshot your broker's positions screen, open the conversation, attach it and
                ask for your positions and a portfolio read. Paste the reply below. Nothing is
                written to the book until you have seen the rows.
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button
                  label="Open the conversation"
                  onPress={() => Linking.openURL(sessionUrl || 'https://claude.ai/code')}
                  style={{ flex: 1 }}
                />
                <Button
                  label="Copy the book"
                  variant="quiet"
                  onPress={copyBook}
                  style={{ flex: 1 }}
                />
              </View>
              <Text variant="caption" faint>
                {sessionUrl
                  ? 'Copy the book too when you want the read to account for what you already hold.'
                  : 'Add your conversation link in Settings and this opens it directly.'}
              </Text>
            </Card>
          </Section>

          <Section title="Paste the answer" subtitle="Positions, a portfolio read, or both">
            <Card style={{ gap: spacing.sm }}>
              <TextInput
                value={pasted}
                onChangeText={(t) => {
                  setPasted(t);
                  setStatus(null);
                }}
                placeholder={'Paste what Claude sent back — a positions table, a ```json read, or both'}
                placeholderTextColor={palette.textFaint}
                multiline
                accessibilityLabel="Paste the answer from Claude"
                style={{
                  minHeight: 110,
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
                  label="Apply"
                  onPress={() => {
                    const res = applyAnything(pasted);
                    setStatus(res);
                    if (res.ok) setPasted('');
                  }}
                  disabled={busy || pasted.trim().length === 0}
                  style={{ flex: 1 }}
                />
                <Button
                  label="Paste from clipboard"
                  variant="quiet"
                  onPress={pasteFromClipboard}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
              </View>
              <Text variant="caption" faint>
                A broker's CSV export works here too — or pick the file directly.
              </Text>
              <Button label="Choose a file" variant="quiet" onPress={chooseFile} disabled={busy} />
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
