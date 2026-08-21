import React from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { toneColors, type Tone } from '@/theme/tokens';
import { InfoButton } from './InfoButton';
import type { GlossaryKey } from '@/domain/glossary';

type TypeKey = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption' | 'mono';

export function Text({
  variant = 'body',
  tone,
  muted,
  faint,
  style,
  children,
  ...rest
}: React.ComponentProps<typeof RNText> & {
  variant?: TypeKey;
  tone?: Tone;
  muted?: boolean;
  faint?: boolean;
}) {
  const { palette, type } = useTheme();
  const t = type[variant];
  const color = tone
    ? toneColors(palette, tone).fg
    : faint
      ? palette.textFaint
      : muted
        ? palette.textMuted
        : palette.text;
  return (
    <RNText
      // Dynamic Type is honoured everywhere; the cap stops the largest
      // accessibility sizes from breaking table layouts outright.
      maxFontSizeMultiplier={variant === 'display' || variant === 'title' ? 1.6 : 2}
      style={[
        {
          color,
          fontSize: t.size,
          fontWeight: t.weight,
          letterSpacing: t.spacing,
          fontVariant: variant === 'mono' ? ['tabular-nums'] : undefined,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </RNText>
  );
}

export function Card({
  children,
  style,
  muted,
  padded = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  muted?: boolean;
  padded?: boolean;
}) {
  const { palette, radius, spacing, scheme } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: muted ? palette.cardMuted : palette.card,
          borderColor: palette.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.lg,
          padding: padded ? spacing.lg : 0,
          // Depth instead of outline-only: a soft ambient shadow separates the
          // card from the page the way iOS surfaces do. Kept faint in dark
          // mode, where a shadow on a dark ground reads as mud and the border
          // is doing the separating.
          shadowColor: '#0B1526',
          shadowOffset: { width: 0, height: 2 },
          shadowRadius: 8,
          shadowOpacity: scheme === 'dark' ? 0.35 : 0.07,
          elevation: 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Section({
  title,
  subtitle,
  action,
  children,
  style,
  term,
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Adds a "?" beside the section heading. */
  term?: GlossaryKey;
}) {
  const { spacing } = useTheme();
  return (
    <View style={[{ gap: spacing.sm }, style]}>
      {(title || action) && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: spacing.sm,
            flexWrap: 'wrap',
          }}
        >
          <View style={{ flexShrink: 1 }}>
            {title ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text variant="heading" accessibilityRole="header" style={{ flexShrink: 1 }}>
                  {title}
                </Text>
                {term ? <InfoButton term={term} size={16} /> : null}
              </View>
            ) : null}
            {subtitle ? (
              <Text variant="caption" muted>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {action}
        </View>
      )}
      {children}
    </View>
  );
}

export function Pill({
  label,
  tone = 'flat',
  style,
  compact,
}: {
  label: string;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}) {
  const { palette, radius, spacing } = useTheme();
  const c = toneColors(palette, tone);
  return (
    <View
      style={[
        {
          backgroundColor: c.bg,
          borderRadius: radius.pill,
          paddingHorizontal: compact ? spacing.sm : spacing.md,
          paddingVertical: compact ? 2 : 4,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      <Text variant="caption" style={{ color: c.fg, fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  );
}

export function Stat({
  label,
  value,
  detail,
  tone,
  style,
  accessibilityLabel,
  term,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** Adds a "?" that explains the metric in plain English. */
  term?: GlossaryKey;
}) {
  const { spacing } = useTheme();
  return (
    <View style={[{ gap: 2, minWidth: 0 }, style]}>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
        accessible
        accessibilityLabel={accessibilityLabel ?? `${label}: ${value}${detail ? `, ${detail}` : ''}`}
      >
        <Text variant="caption" muted numberOfLines={2} style={{ flexShrink: 1 }}>
          {label}
        </Text>
        {term ? <InfoButton term={term} size={13} /> : null}
      </View>
      <Text
        variant="mono"
        tone={tone}
        style={{ fontSize: 17 }}
        numberOfLines={1}
        adjustsFontSizeToFit
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {value}
      </Text>
      {detail ? (
        <Text
          variant="caption"
          faint
          numberOfLines={2}
          style={{ marginTop: spacing.xs - 2 }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

/** Two-column key/value line used throughout the detail screens. */
export function Row({
  label,
  value,
  tone,
  hint,
  onPress,
  term,
}: {
  label: string;
  value: string;
  tone?: Tone;
  hint?: string;
  onPress?: () => void;
  /** Adds a "?" that explains the metric in plain English. */
  term?: GlossaryKey;
}) {
  const { spacing, palette } = useTheme();
  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: spacing.md,
        paddingVertical: spacing.sm - 2,
      }}
      accessible={!term}
      accessibilityLabel={term ? undefined : `${label}: ${value}${hint ? `. ${hint}` : ''}`}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
          accessible={!!term}
          accessibilityLabel={term ? `${label}: ${value}${hint ? `. ${hint}` : ''}` : undefined}
        >
          <Text variant="body" muted style={{ flexShrink: 1 }}>
            {label}
          </Text>
          {term ? <InfoButton term={term} size={14} /> : null}
        </View>
        {hint ? (
          <Text variant="caption" faint>
            {hint}
          </Text>
        ) : null}
      </View>
      <Text variant="mono" tone={tone} style={{ textAlign: 'right', flexShrink: 0 }}>
        {value}
      </Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, backgroundColor: palette.card })}
    >
      {body}
    </Pressable>
  );
}

export function Divider() {
  const { palette } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border }} />;
}

export function Screen({
  children,
  scroll = true,
  refreshControl,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  refreshControl?: React.ReactElement<React.ComponentProps<typeof RefreshControl>>;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const { palette, spacing } = useTheme();
  if (!scroll) {
    return <View style={{ flex: 1, backgroundColor: palette.bg }}>{children}</View>;
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.bg }}
      contentContainerStyle={[
        { padding: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.lg },
        contentStyle,
      ]}
      refreshControl={refreshControl}
      contentInsetAdjustmentBehavior="automatic"
    >
      {children}
    </ScrollView>
  );
}

export function Button({
  label,
  onPress,
  tone = 'accent',
  variant = 'solid',
  disabled,
  style,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  tone?: Tone;
  variant?: 'solid' | 'quiet';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const { palette, radius, spacing } = useTheme();
  const c = toneColors(palette, tone);
  // A solid button is now genuinely solid — filled with the tone colour, label
  // in the page background colour, which is what keeps the contrast right in
  // both themes (near-white text on the light palette's saturated accent, near-
  // black on the dark palette's pale one). The quiet variant takes over the old
  // tinted look, so the two read as primary and secondary instead of as two
  // ways of drawing the same button.
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        {
          backgroundColor: variant === 'solid' ? c.fg : c.bg,
          borderRadius: radius.md,
          paddingVertical: spacing.md - 2,
          paddingHorizontal: spacing.lg,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
          // 44pt is the iOS minimum touch target.
          minHeight: 44,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      <Text
        variant="label"
        style={{ color: variant === 'solid' ? palette.bg : c.fg, fontWeight: '600' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A label with an optional "?" beside it.
 *
 * The row primitives already take a `term`, but a lot of the complexity in this
 * app lives in headings and chart captions — "EV / EBITDA", "Multiple history",
 * "What would change the verdict" — where there is no row to hang it on. This
 * makes adding one a single prop rather than a nested View every time.
 */
export function Label({
  children,
  term,
  variant = 'label',
  tone,
  muted,
  faint,
  size,
  style,
}: {
  /** Text, including interpolated fragments. */
  children: React.ReactNode;
  term?: GlossaryKey;
  variant?: TypeKey;
  tone?: Tone;
  muted?: boolean;
  faint?: boolean;
  /** Overrides the icon size, which otherwise tracks the text variant. */
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { type } = useTheme();
  return (
    <View
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 }, style]}
      accessible={!term}
    >
      <Text
        variant={variant}
        tone={tone}
        muted={muted}
        faint={faint}
        style={{ flexShrink: 1 }}
        accessibilityRole={variant === 'heading' || variant === 'title' ? 'header' : undefined}
      >
        {children}
      </Text>
      {term ? <InfoButton term={term} size={size ?? Math.round(type[variant].size * 0.92)} /> : null}
    </View>
  );
}

/** Shown wherever a block has no data rather than leaving a hole. */
export function Empty({ title, detail }: { title: string; detail?: string }) {
  const { spacing } = useTheme();
  return (
    <View style={{ paddingVertical: spacing.lg, gap: spacing.xs }}>
      <Text variant="body" muted>
        {title}
      </Text>
      {detail ? (
        <Text variant="caption" faint>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

export function textStyle(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  return style;
}
