import React from 'react';
import {
  AccessibilityInfo,
  Animated,
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
import { Platform } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { toneColors, type Tone } from '@/theme/tokens';
import { InfoButton } from './InfoButton';
import type { GlossaryKey } from '@/domain/glossary';

/** IBM Plex Sans, self-hosted by the PWA shell. Web only; see Text. */
const APP_FONT =
  Platform.OS === 'web'
    ? "'Plex Sans Var', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    : undefined;

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
          // The self-hosted face ships with the web build only; native keeps
          // the system font until the file is registered through expo-font.
          fontFamily: APP_FONT,
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

/**
 * A short entrance for freshly mounted screens: fade in with a small rise.
 *
 * The router swaps screens with a hard cut on web, which reads as a page
 * reload rather than an app. Because each screen's `Screen` wrapper mounts on
 * navigation, animating the mount is the navigation transition — no router
 * integration required. Honours the system reduce-motion setting: for those
 * users the animation resolves instantly rather than being merely faster.
 */
function useEntrance() {
  const progress = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) {
          progress.setValue(1);
          return;
        }
        Animated.timing(progress, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      });
    return () => {
      cancelled = true;
    };
  }, [progress]);
  return {
    opacity: progress,
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
    ],
  };
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
  const entrance = useEntrance();
  if (!scroll) {
    return (
      <Animated.View style={[{ flex: 1, backgroundColor: palette.bg }, entrance]}>
        {children}
      </Animated.View>
    );
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
      <Animated.View style={[{ gap: spacing.lg }, entrance]}>{children}</Animated.View>
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
          // The quiet variant's tinted fill sits close to the card surface in
          // dark theme — a whisper of its own tone at the edge keeps it
          // reading as a control rather than as another card.
          borderWidth: variant === 'quiet' ? 1 : 0,
          borderColor: variant === 'quiet' ? c.fg + '38' : 'transparent',
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
        // Centred even when it wraps — a flush-left wrapped label reads as a
        // paragraph in a pill, not a button.
        style={{ color: variant === 'solid' ? palette.bg : c.fg, fontWeight: '600', textAlign: 'center' }}
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
  labelTextStyle,
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
  /** Styles the text itself; `style` covers the row container. */
  labelTextStyle?: StyleProp<TextStyle>;
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
        style={[{ flexShrink: 1 }, labelTextStyle]}
        accessibilityRole={variant === 'heading' || variant === 'title' ? 'header' : undefined}
      >
        {children}
      </Text>
      {term ? <InfoButton term={term} size={size ?? Math.round(type[variant].size * 0.92)} /> : null}
    </View>
  );
}

/** Shown wherever a block has no data rather than leaving a hole. */
/**
 * Horizontal section tabs with a sliding underline — one continuous piece of
 * navigation, the way a finance product sections a quote page, rather than a
 * row of buttons that each feel like a different screen. Equal-width segments
 * so the indicator's geometry is arithmetic, not measurement.
 */
export function SegmentedTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: number;
  onChange: (index: number) => void;
}) {
  const { palette, spacing } = useTheme();
  const [width, setWidth] = React.useState(0);
  const slide = React.useRef(new Animated.Value(active)).current;
  const reduced = useReducedMotion();

  React.useEffect(() => {
    if (reduced) {
      slide.setValue(active);
      return;
    }
    Animated.spring(slide, {
      toValue: active,
      useNativeDriver: false,
      speed: 22,
      bounciness: 4,
    }).start();
  }, [active, reduced, slide]);

  const segW = tabs.length > 0 ? width / tabs.length : 0;

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ borderBottomWidth: 1, borderBottomColor: palette.border }}
      accessibilityRole="tablist"
    >
      <View style={{ flexDirection: 'row' }}>
        {tabs.map((label, i) => (
          <Pressable
            key={label}
            onPress={() => onChange(i)}
            accessibilityRole="tab"
            accessibilityState={{ selected: i === active }}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              paddingVertical: spacing.sm + 2,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text
              variant="label"
              style={{
                color: i === active ? palette.text : palette.textFaint,
                fontWeight: i === active ? '700' : '500',
              }}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {width > 0 ? (
        <Animated.View
          style={{
            height: 3,
            width: Math.max(segW - 28, 24),
            marginBottom: -1,
            borderRadius: 2,
            backgroundColor: palette.accent,
            transform: [
              {
                translateX: slide.interpolate({
                  inputRange: [0, Math.max(tabs.length - 1, 1)],
                  outputRange: [14, segW * Math.max(tabs.length - 1, 1) + 14],
                }),
              },
            ],
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * Pulsing placeholder rows for content that is genuinely on its way (a
 * research pass in flight). Never a stand-in for "no data" — missing means
 * missing, and gets words, not shimmer.
 */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  const { palette, spacing, radius } = useTheme();
  const pulse = React.useRef(new Animated.Value(0.5)).current;
  const reduced = useReducedMotion();

  React.useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);

  return (
    <View style={{ gap: spacing.sm }} accessibilityLabel="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <Animated.View
          key={i}
          style={{
            height: 13,
            borderRadius: radius.sm,
            backgroundColor: palette.border,
            opacity: pulse,
            width: `${[92, 78, 85, 64][i % 4] ?? 80}%`,
          }}
        />
      ))}
    </View>
  );
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (live) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

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
