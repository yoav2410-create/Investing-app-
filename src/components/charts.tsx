import React, { useMemo, useState } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';
import { toneColors, type Tone } from '@/theme/tokens';
import { Text } from './ui';
import type { QuarterPoint } from '@/domain/types';

/**
 * Charts are hand-drawn SVG rather than a charting library: it keeps the bundle
 * small, guarantees both palettes are honoured, and — the reason that matters
 * most here — lets every chart carry a spoken summary. A chart VoiceOver cannot
 * read is a chart half the owners cannot use, so each one exposes itself as a
 * single labelled image with the trend stated in words.
 */

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(0);
  return [w, (e) => setW(e.nativeEvent.layout.width)];
}

function niceBounds(values: number[], padPct = 0.12): [number, number] {
  if (values.length === 0) return [0, 1];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.1 || 1;
    return [lo - pad, hi + pad];
  }
  const pad = (hi - lo) * padPct;
  lo -= pad;
  hi += pad;
  return [lo, hi];
}

export interface SeriesChartProps {
  points: QuarterPoint[];
  /** Formats a value for the spoken summary and axis labels. */
  format: (v: number) => string;
  title: string;
  tone?: Tone;
  height?: number;
  style?: StyleProp<ViewStyle>;
  /** Draws a dashed line at this level, e.g. today's multiple. */
  marker?: { value: number; label: string } | null;
}

/** Line chart for a quarterly series. Nulls break the line rather than faking it. */
export function LineChart({
  points,
  format,
  title,
  tone = 'accent',
  height = 150,
  style,
  marker,
}: SeriesChartProps) {
  const { palette, spacing } = useTheme();
  const [width, onLayout] = useWidth();
  const c = toneColors(palette, tone);

  const ordered = useMemo(() => [...points].reverse(), [points]);
  const values = ordered.map((p) => p.value).filter((v): v is number => v != null);

  const summary = useMemo(() => {
    if (values.length < 2) return `${title}: not enough data to plot.`;
    const first = values[0]!;
    const last = values[values.length - 1]!;
    const dir = last > first ? 'rising' : last < first ? 'falling' : 'flat';
    return `${title}: ${dir} from ${format(first)} to ${format(last)} over ${values.length} quarters. Low ${format(Math.min(...values))}, high ${format(Math.max(...values))}.`;
  }, [values, title, format]);

  if (values.length < 2) {
    return (
      <View style={style}>
        <Text variant="caption" faint>
          Not enough quarterly history to plot {title.toLowerCase()}.
        </Text>
      </View>
    );
  }

  const padL = 4;
  const padR = 4;
  const padT = 8;
  const padB = 18;
  const w = Math.max(width, 1);
  const innerW = Math.max(w - padL - padR, 1);
  const innerH = Math.max(height - padT - padB, 1);
  const all = marker ? [...values, marker.value] : values;
  const [lo, hi] = niceBounds(all);
  const x = (i: number) => padL + (i / Math.max(ordered.length - 1, 1)) * innerW;
  const y = (v: number) => padT + innerH - ((v - lo) / (hi - lo)) * innerH;

  // Break the path wherever a quarter is missing.
  const segments: string[] = [];
  let current = '';
  ordered.forEach((p, i) => {
    if (p.value == null) {
      if (current) segments.push(current);
      current = '';
      return;
    }
    current += `${current ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
  });
  if (current) segments.push(current);

  const lastIndex = ordered.map((p) => p.value != null).lastIndexOf(true);

  return (
    <View
      style={style}
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={summary}
    >
      {width > 0 ? (
        <Svg width={w} height={height}>
          {[0, 0.5, 1].map((f) => (
            <Line
              key={f}
              x1={padL}
              x2={w - padR}
              y1={padT + innerH * f}
              y2={padT + innerH * f}
              stroke={palette.chartGrid}
              strokeWidth={1}
            />
          ))}
          {marker ? (
            <G>
              <Line
                x1={padL}
                x2={w - padR}
                y1={y(marker.value)}
                y2={y(marker.value)}
                stroke={palette.textFaint}
                strokeWidth={1}
                strokeDasharray="4 3"
              />
              <SvgText
                x={w - padR}
                y={Math.max(y(marker.value) - 4, 10)}
                fill={palette.textFaint}
                fontSize={10}
                textAnchor="end"
              >
                {marker.label}
              </SvgText>
            </G>
          ) : null}
          {segments.map((d, i) => (
            <Path key={i} d={d} stroke={c.fg} strokeWidth={2} fill="none" strokeLinejoin="round" />
          ))}
          {lastIndex >= 0 ? (
            <Circle cx={x(lastIndex)} cy={y(ordered[lastIndex]!.value!)} r={3.5} fill={c.fg} />
          ) : null}
          <SvgText x={padL} y={height - 4} fill={palette.textFaint} fontSize={10}>
            {ordered[0]?.label ?? ''}
          </SvgText>
          <SvgText x={w - padR} y={height - 4} fill={palette.textFaint} fontSize={10} textAnchor="end">
            {ordered[ordered.length - 1]?.label ?? ''}
          </SvgText>
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
        <Text variant="caption" faint>
          low {format(Math.min(...values))}
        </Text>
        <Text variant="caption" faint>
          high {format(Math.max(...values))}
        </Text>
      </View>
    </View>
  );
}

/** Bars for revenue / operating income. Missing quarters render as a gap. */
export function BarChart({
  points,
  format,
  title,
  tone = 'accent',
  height = 150,
  style,
}: SeriesChartProps) {
  const { palette, spacing } = useTheme();
  const [width, onLayout] = useWidth();
  const c = toneColors(palette, tone);
  const ordered = useMemo(() => [...points].reverse(), [points]);
  const values = ordered.map((p) => p.value).filter((v): v is number => v != null);

  const summary = useMemo(() => {
    if (!values.length) return `${title}: no data.`;
    const first = values[0]!;
    const last = values[values.length - 1]!;
    const pct = first === 0 ? null : ((last - first) / Math.abs(first)) * 100;
    return `${title}: ${format(first)} to ${format(last)} across ${values.length} quarters${
      pct == null ? '' : `, ${pct >= 0 ? 'up' : 'down'} ${Math.abs(pct).toFixed(0)} percent`
    }.`;
  }, [values, title, format]);

  if (!values.length) {
    return (
      <View style={style}>
        <Text variant="caption" faint>
          No {title.toLowerCase()} reported for this security.
        </Text>
      </View>
    );
  }

  const padT = 8;
  const padB = 18;
  const w = Math.max(width, 1);
  const innerH = Math.max(height - padT - padB, 1);
  const hi = Math.max(...values, 0);
  const lo = Math.min(...values, 0);
  const span = hi - lo || 1;
  const slot = w / Math.max(ordered.length, 1);
  const barW = Math.max(slot * 0.58, 3);
  const zeroY = padT + innerH - ((0 - lo) / span) * innerH;

  return (
    <View
      style={style}
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={summary}
    >
      {width > 0 ? (
        <Svg width={w} height={height}>
          <Line x1={0} x2={w} y1={zeroY} y2={zeroY} stroke={palette.chartGrid} strokeWidth={1} />
          {ordered.map((p, i) => {
            if (p.value == null) return null;
            const vy = padT + innerH - ((p.value - lo) / span) * innerH;
            const top = Math.min(vy, zeroY);
            const h = Math.max(Math.abs(zeroY - vy), 1);
            return (
              <Rect
                key={p.period}
                x={i * slot + (slot - barW) / 2}
                y={top}
                width={barW}
                height={h}
                rx={2}
                fill={p.value < 0 ? toneColors(palette, 'down').fg : c.fg}
                opacity={i === ordered.length - 1 ? 1 : 0.62}
              />
            );
          })}
          <SvgText x={2} y={height - 4} fill={palette.textFaint} fontSize={10}>
            {ordered[0]?.label ?? ''}
          </SvgText>
          <SvgText x={w - 2} y={height - 4} fill={palette.textFaint} fontSize={10} textAnchor="end">
            {ordered[ordered.length - 1]?.label ?? ''}
          </SvgText>
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
        <Text variant="caption" faint>
          {format(values[0]!)}
        </Text>
        <Text variant="caption" faint>
          latest {format(values[values.length - 1]!)}
        </Text>
      </View>
    </View>
  );
}

/**
 * Where price sits relative to each moving average. This is the chart the brief
 * asks for as a "moving-average-distance visualisation": a zero line for price
 * and one bar per average showing how far above or below it sits.
 */
export function MaDistanceChart({
  price,
  averages,
  style,
}: {
  price: number | null;
  averages: { label: string; value: number | null }[];
  style?: StyleProp<ViewStyle>;
}) {
  const { palette, spacing } = useTheme();
  const rows = averages.map((a) => ({
    label: a.label,
    pct: price == null || a.value == null || a.value === 0 ? null : ((price - a.value) / a.value) * 100,
    value: a.value,
  }));
  const present = rows.map((r) => r.pct).filter((v): v is number => v != null);
  const max = Math.max(6, ...present.map((v) => Math.abs(v)));

  const summary = rows
    .map((r) =>
      r.pct == null
        ? `${r.label}: no data`
        : `${r.label}: price ${r.pct >= 0 ? 'above' : 'below'} by ${Math.abs(r.pct).toFixed(1)} percent`,
    )
    .join('. ');

  return (
    <View
      style={[{ gap: spacing.sm }, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Distance from moving averages. ${summary}.`}
    >
      {rows.map((r) => {
        const half = 0.5;
        const frac = r.pct == null ? 0 : Math.max(-1, Math.min(1, r.pct / max)) * half;
        const positive = (r.pct ?? 0) >= 0;
        const c = toneColors(palette, r.pct == null ? 'flat' : positive ? 'up' : 'down');
        return (
          <View key={r.label} style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="caption" muted>
                {r.label}
              </Text>
              <Text variant="caption" style={{ color: c.fg, fontVariant: ['tabular-nums'] }}>
                {r.pct == null
                  ? '—'
                  : `${r.pct >= 0 ? '+' : '−'}${Math.abs(r.pct).toFixed(1)}%`}
              </Text>
            </View>
            <View
              style={{
                height: 8,
                borderRadius: 4,
                backgroundColor: palette.cardMuted,
                overflow: 'hidden',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  position: 'absolute',
                  left: '50%',
                  width: 1,
                  top: 0,
                  bottom: 0,
                  backgroundColor: palette.borderStrong,
                }}
              />
              {r.pct != null ? (
                <View
                  style={{
                    position: 'absolute',
                    left: positive ? '50%' : `${50 + frac * 100}%`,
                    width: `${Math.abs(frac) * 100}%`,
                    height: 8,
                    backgroundColor: c.fg,
                    borderRadius: 4,
                  }}
                />
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Horizontal stacked bar for sector concentration. */
export function ConcentrationBar({
  slices,
  style,
  height = 22,
}: {
  slices: { label: string; pct: number; color: string }[];
  style?: StyleProp<ViewStyle>;
  height?: number;
}) {
  const { radius } = useTheme();
  const total = slices.reduce((s, x) => s + x.pct, 0) || 1;
  const summary = slices
    .filter((s) => s.pct > 0.05)
    .map((s) => `${s.label} ${s.pct.toFixed(1)} percent`)
    .join(', ');
  return (
    <View
      style={[
        { flexDirection: 'row', height, borderRadius: radius.sm, overflow: 'hidden' },
        style,
      ]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Sector concentration: ${summary}.`}
    >
      {slices.map((s) => (
        <View
          key={s.label}
          style={{ flexGrow: s.pct / total, backgroundColor: s.color, minWidth: s.pct > 0 ? 2 : 0 }}
        />
      ))}
    </View>
  );
}

/** Current vs target, one row per sector. */
export function TargetBars({
  rows,
  style,
}: {
  rows: { label: string; current: number; target: number | null }[];
  style?: StyleProp<ViewStyle>;
}) {
  const { palette, spacing } = useTheme();
  const max = Math.max(20, ...rows.flatMap((r) => [r.current, r.target ?? 0])) * 1.1;
  return (
    <View style={[{ gap: spacing.md }, style]}>
      {rows.map((r) => {
        const drift = r.target == null ? null : r.current - r.target;
        const tone: Tone = drift == null ? 'flat' : Math.abs(drift) <= 3 ? 'flat' : drift > 0 ? 'warn' : 'accent';
        const c = toneColors(palette, tone);
        return (
          <View
            key={r.label}
            style={{ gap: 4 }}
            accessible
            accessibilityLabel={`${r.label}: ${r.current.toFixed(1)} percent${
              r.target == null ? ', no target' : ` against a ${r.target.toFixed(0)} percent target`
            }${drift == null ? '' : `, ${drift >= 0 ? 'over' : 'under'} by ${Math.abs(drift).toFixed(1)} points`}.`}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
              <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
                {r.label}
              </Text>
              <Text variant="caption" muted style={{ fontVariant: ['tabular-nums'] }}>
                {r.current.toFixed(1)}%
                {r.target == null ? '' : ` / ${r.target.toFixed(0)}%`}
              </Text>
            </View>
            <View
              style={{
                height: 10,
                backgroundColor: palette.cardMuted,
                borderRadius: 5,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.min(100, (r.current / max) * 100)}%`,
                  height: 10,
                  backgroundColor: c.fg,
                  borderRadius: 5,
                }}
              />
              {r.target != null ? (
                <View
                  style={{
                    position: 'absolute',
                    left: `${Math.min(100, (r.target / max) * 100)}%`,
                    top: -2,
                    bottom: -2,
                    width: 2,
                    backgroundColor: palette.text,
                    opacity: 0.65,
                  }}
                />
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Compact sparkline for portfolio history. */
export function Sparkline({
  values,
  height = 44,
  tone = 'accent',
  label,
  style,
}: {
  values: number[];
  height?: number;
  tone?: Tone;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette } = useTheme();
  const [width, onLayout] = useWidth();
  const c = toneColors(palette, tone);
  if (values.length < 2) {
    return (
      <View style={style} onLayout={onLayout}>
        <Text variant="caption" faint>
          One data point so far — the line appears after the next refresh.
        </Text>
      </View>
    );
  }
  const [lo, hi] = niceBounds(values, 0.08);
  const w = Math.max(width, 1);
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <View
      style={style}
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${label}. ${values.length} points, from ${values[0]!.toFixed(0)} to ${values[values.length - 1]!.toFixed(0)}.`}
    >
      {width > 0 ? (
        <Svg width={w} height={height}>
          <Path d={d} stroke={c.fg} strokeWidth={2} fill="none" />
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}

/** Where the current multiple sits inside its own historical range. */
export function RangeMeter({
  low,
  high,
  current,
  format,
  label,
  style,
}: {
  low: number;
  high: number;
  current: number;
  format: (v: number) => string;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette, spacing } = useTheme();
  const pct = high === low ? 0.5 : Math.max(0, Math.min(1, (current - low) / (high - low)));
  const tone: Tone = pct <= 0.33 ? 'up' : pct >= 0.67 ? 'down' : 'flat';
  const c = toneColors(palette, tone);
  return (
    <View
      style={[{ gap: spacing.xs }, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${label}: ${format(current)}, ${(pct * 100).toFixed(0)} percent of the way through a range of ${format(low)} to ${format(high)}.`}
    >
      <View
        style={{
          height: 10,
          borderRadius: 5,
          backgroundColor: palette.cardMuted,
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: `${pct * 100}%`,
            marginLeft: -6,
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: c.fg,
            borderWidth: 2,
            borderColor: palette.card,
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="caption" faint>
          {format(low)}
        </Text>
        <Text variant="caption" faint>
          {format(high)}
        </Text>
      </View>
    </View>
  );
}
