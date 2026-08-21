import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';
import { toneColors, type Palette, type Tone } from '@/theme/tokens';
import { Text } from './ui';
import { compactNumber } from '@/domain/format';

// react-native-svg on web inherits the document default for SVG text, which is
// the browser serif — Times sitting next to system-ui UI text. Every SvgText
// takes this, or the charts look pasted in from a different app.
const CHART_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
import { SECTORS, type QuarterPoint, type SectorId } from '@/domain/types';

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
              <SvgText fontFamily={CHART_FONT}
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
          {/* Every period along the axis, not just the two ends — the reader
              should never have to interpolate which quarter a bend belongs to.
              Labels thin to every other one when the slots get too narrow to
              keep them apart, ends always kept. */}
          {ordered.map((p, i) => {
            const slot = innerW / Math.max(ordered.length - 1, 1);
            const keepLabel =
              slot >= 34 || i === 0 || i === ordered.length - 1 || i % 2 === (ordered.length - 1) % 2;
            if (!keepLabel) return null;
            // The end labels are anchored outward, which walks them into their
            // immediate neighbours — "Q1 24Q2 24" run together. The neighbour
            // yields; the end label is the one a reader needs.
            if ((i === 1 || i === ordered.length - 2) && slot < 48) return null;
            return (
              <SvgText
                fontFamily={CHART_FONT}
                key={`x-${p.period}`}
                x={x(i)}
                y={height - 4}
                fill={palette.textFaint}
                fontSize={9}
                textAnchor={i === 0 ? 'start' : i === ordered.length - 1 ? 'end' : 'middle'}
              >
                {p.label}
              </SvgText>
            );
          })}
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

  // Room above each bar for its own figure, and below the axis for every
  // period rather than only the two on the ends.
  const padT = 16;
  const padB = 24;
  const w = Math.max(width, 1);
  const innerH = Math.max(height - padT - padB, 1);
  const hi = Math.max(...values, 0);
  const lo = Math.min(...values, 0);
  const span = hi - lo || 1;
  const slot = w / Math.max(ordered.length, 1);
  const barW = Math.max(slot * 0.58, 3);
  const zeroY = padT + innerH - ((0 - lo) / span) * innerH;

  // A label per bar only while they can be read. Below roughly 34pt a slot the
  // figures start touching, and two overlapping numbers are worse than one
  // honest gap — so every other period is labelled instead, ends first.
  const showEveryValue = slot >= 34;
  const showEveryPeriod = slot >= 30;
  const keep = (i: number) =>
    i === 0 || i === ordered.length - 1 || i % 2 === ordered.length % 2;

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

          {/* The figure each bar stands for, on the bar. Reading a quarter off
              a shape and a caption was guesswork; the number is the point. */}
          {ordered.map((p, i) => {
            if (p.value == null) return null;
            if (!showEveryValue && !keep(i)) return null;
            const vy = padT + innerH - ((p.value - lo) / span) * innerH;
            const negative = p.value < 0;
            const cx = i * slot + slot / 2;
            return (
              <SvgText fontFamily={CHART_FONT}
                key={`v-${p.period}`}
                x={cx}
                y={negative ? Math.max(vy, zeroY) + 11 : Math.min(vy, zeroY) - 5}
                fill={palette.textMuted}
                fontSize={9}
                fontWeight={i === ordered.length - 1 ? '600' : '400'}
                textAnchor="middle"
              >
                {compactNumber(p.value)}
              </SvgText>
            );
          })}

          {/* Every quarter across the bottom, not just the two on the ends. */}
          {ordered.map((p, i) => {
            if (!showEveryPeriod && !keep(i)) return null;
            return (
              <SvgText fontFamily={CHART_FONT}
                key={`p-${p.period}`}
                x={i * slot + slot / 2}
                y={height - 6}
                fill={palette.textFaint}
                fontSize={9}
                textAnchor="middle"
              >
                {p.label}
              </SvgText>
            );
          })}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      {/* The unit lives here so it is stated once rather than on every bar. */}
      <Text variant="caption" faint style={{ marginTop: spacing.xs }}>
        {ordered.length} quarters · figures in {unitOf(values)} · latest{' '}
        {format(values[values.length - 1]!)}
      </Text>
    </View>
  );
}

/** What the on-bar figures are denominated in, given the range on show. */
function unitOf(values: number[]): string {
  const max = Math.max(...values.map((v) => Math.abs(v)));
  if (max >= 1e12) return 'trillions';
  if (max >= 1e9) return 'billions';
  if (max >= 1e6) return 'millions';
  if (max >= 1e3) return 'thousands';
  return 'units';
}

// --------------------------------------------------------------------------
// Sector colours and the allocation donut
// --------------------------------------------------------------------------

/**
 * A sector's colour, stable across every screen and every filter.
 *
 * The screens used to paint `series[i]` over whichever buckets happened to be
 * visible, which means colour followed *rank*: the day a sector emptied, every
 * sector after it changed colour. Colour has to follow the entity — Tech is
 * always the same blue whether it is first or fourth — or the reader relearns
 * the legend every time the book changes. Cash is deliberately neutral: it is
 * the absence of a bet, not another bet.
 */
export function sectorColor(palette: Palette, sector: SectorId): string {
  if (sector === 'cash') return palette.flat;
  const i = SECTORS.findIndex((s) => s.id === sector);
  return palette.series[i % palette.series.length]!;
}

export interface DonutSlice {
  sector: SectorId;
  label: string;
  pct: number;
}

/**
 * The allocation donut.
 *
 * Slices are separated by a 2pt surface gap and the large ones carry their own
 * label, so identity never rests on colour alone. The centre states the figure
 * the whole chart exists to show — where the biggest bet is — rather than being
 * decorative empty space.
 */
export function DonutChart({
  slices,
  size,
  style,
}: {
  slices: DonutSlice[];
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette, spacing } = useTheme();
  const [width, onLayout] = useWidth();
  // The ring takes half the row and the legend the rest. A fixed diameter left
  // the legend ~120pt on an iPhone SE, where "Consumer" truncated — and a
  // legend that cannot spell its labels is failing at its one job.
  const diameter = size ?? Math.max(132, Math.min(190, Math.round(width * 0.46)));
  const shown = slices.filter((s) => s.pct > 0.05).sort((a, b) => b.pct - a.pct);
  const total = shown.reduce((s, x) => s + x.pct, 0) || 1;

  const summary =
    shown.length === 0
      ? 'Allocation: nothing priced yet.'
      : `Allocation: ${shown.map((s) => `${s.label} ${s.pct.toFixed(1)} percent`).join(', ')}.`;

  const cx = diameter / 2;
  const cy = diameter / 2;
  const rOuter = diameter / 2 - 2;
  const rInner = rOuter * 0.62;
  const rLabel = (rOuter + rInner) / 2;
  // The 2pt gap between slices, expressed as the angle it subtends mid-ring.
  const gapRad = 2 / rLabel;

  const arcs: { d: string; color: string; labelX: number; labelY: number; s: DonutSlice }[] = [];
  let angle = -Math.PI / 2;
  for (const s of shown) {
    const sweep = (s.pct / total) * Math.PI * 2;
    const a0 = angle + gapRad / 2;
    const a1 = angle + sweep - gapRad / 2;
    angle += sweep;
    if (a1 <= a0) continue; // a sliver thinner than the gap has no drawable arc
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
    arcs.push({
      d: `M ${p(rOuter, a0)} A ${rOuter} ${rOuter} 0 ${large} 1 ${p(rOuter, a1)} L ${p(rInner, a1)} A ${rInner} ${rInner} 0 ${large} 0 ${p(rInner, a0)} Z`,
      color: sectorColor(palette, s.sector),
      labelX: cx + rLabel * Math.cos((a0 + a1) / 2),
      labelY: cy + rLabel * Math.sin((a0 + a1) / 2),
      s,
    });
  }

  const top = shown[0];

  return (
    <View
      onLayout={onLayout}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={summary}
    >
      <Svg width={diameter} height={diameter}>
        {arcs.map((a) => (
          <Path key={a.s.sector} d={a.d} fill={a.color} />
        ))}
        {/* A label on every slice wide enough to hold one; the legend carries
            the rest. Text wears ink, not the series colour. */}
        {arcs
          .filter((a) => a.s.pct / total >= 0.09)
          .map((a) => (
            <SvgText fontFamily={CHART_FONT}
              key={`l-${a.s.sector}`}
              x={a.labelX}
              y={a.labelY + 3}
              fill="#FFFFFF"
              fontSize={10}
              fontWeight="600"
              textAnchor="middle"
            >
              {`${Math.round(a.s.pct)}%`}
            </SvgText>
          ))}
        {top ? (
          <>
            <SvgText fontFamily={CHART_FONT} x={cx} y={cy - 4} fill={palette.textMuted} fontSize={10} textAnchor="middle">
              heaviest
            </SvgText>
            <SvgText fontFamily={CHART_FONT} x={cx} y={cy + 12} fill={palette.text} fontSize={13} fontWeight="700" textAnchor="middle">
              {top.label}
            </SvgText>
          </>
        ) : null}
      </Svg>

      <View style={{ flex: 1, gap: 6 }}>
        {shown.map((s) => (
          <View key={s.sector} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                backgroundColor: sectorColor(palette, s.sector),
              }}
            />
            <Text variant="caption" muted style={{ flex: 1 }} numberOfLines={1}>
              {s.label}
            </Text>
            <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
              {s.pct.toFixed(1)}%
            </Text>
          </View>
        ))}
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


/**
 * Waterfall for the EBITDA-to-FCF walk.
 *
 * Subtotals are drawn from the baseline; deductions float, so the eye follows
 * the cash draining out rather than reading a row of unrelated bars. A step the
 * data cannot supply is drawn as a gap with a dashed outline, because a missing
 * deduction rendered as zero would overstate the cash that survives.
 */
export function WaterfallChart({
  steps,
  format,
  height = 210,
  style,
  minColumnWidth = 62,
}: {
  steps: {
    key: string;
    label: string;
    delta: number | null;
    runningTotal: number | null;
    isSubtotal: boolean;
  }[];
  format: (v: number) => string;
  height?: number;
  style?: StyleProp<ViewStyle>;
  /** Nine columns will not fit a phone, so the chart scrolls rather than collides. */
  minColumnWidth?: number;
}) {
  const { palette, spacing } = useTheme();
  const [width, onLayout] = useWidth();

  const drawable = steps.filter((s) => s.runningTotal != null || s.delta != null);
  const levels = steps.flatMap((s) => (s.runningTotal == null ? [] : [s.runningTotal]));
  if (levels.length < 2) {
    return (
      <View style={style}>
        <Text variant="caption" faint>
          Not enough cash-flow lines on file to draw the walk.
        </Text>
      </View>
    );
  }

  const summary = steps
    .map((s) =>
      s.isSubtotal
        ? `${s.label} ${s.runningTotal == null ? 'unknown' : format(s.runningTotal)}`
        : `less ${s.label} ${s.delta == null ? 'unknown' : format(Math.abs(s.delta))}`,
    )
    .join('; ');

  const padT = 6;
  const padB = 40;
  // Draw at whichever is wider: the container, or the width the labels need.
  const w = Math.max(width, drawable.length * minColumnWidth, 1);
  const scrolls = w > width + 1;
  const innerH = Math.max(height - padT - padB, 1);
  const hi = Math.max(0, ...levels);
  const lo = Math.min(0, ...levels);
  const span = hi - lo || 1;
  const y = (v: number) => padT + innerH - ((v - lo) / span) * innerH;
  const slot = w / Math.max(drawable.length, 1);
  const barW = Math.max(slot * 0.62, 4);

  return (
    <View
      style={style}
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Cash flow walk. ${summary}.`}
    >
      {width > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={scrolls}
          scrollEnabled={scrolls}
          contentContainerStyle={{ width: w }}
        >
        <Svg width={w} height={height}>
          <Line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke={palette.chartGrid} strokeWidth={1} />
          {drawable.map((s, i) => {
            const x = i * slot + (slot - barW) / 2;
            const label = (
              <SvgText fontFamily={CHART_FONT}
                key={`t-${s.key}`}
                x={i * slot + slot / 2}
                y={height - 26}
                fill={palette.textFaint}
                fontSize={9}
                textAnchor="middle"
              >
                {shortLabel(s.label)}
              </SvgText>
            );

            if (s.isSubtotal) {
              if (s.runningTotal == null) return label;
              const top = Math.min(y(s.runningTotal), y(0));
              const h = Math.max(Math.abs(y(s.runningTotal) - y(0)), 2);
              return (
                <G key={s.key}>
                  <Rect
                    x={x}
                    y={top}
                    width={barW}
                    height={h}
                    rx={2}
                    fill={s.runningTotal >= 0 ? palette.accent : palette.down}
                  />
                  {label}
                  <SvgText fontFamily={CHART_FONT}
                    x={i * slot + slot / 2}
                    y={height - 12}
                    fill={palette.text}
                    fontSize={9}
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {format(s.runningTotal)}
                  </SvgText>
                </G>
              );
            }

            // A deduction floats between the running totals either side of it.
            const prev = drawable[i - 1]?.runningTotal ?? null;
            if (s.delta == null || prev == null || s.runningTotal == null) {
              return (
                <G key={s.key}>
                  <Rect
                    x={x}
                    y={y(hi) + innerH * 0.35}
                    width={barW}
                    height={innerH * 0.18}
                    rx={2}
                    fill="none"
                    stroke={palette.borderStrong}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  {label}
                  <SvgText fontFamily={CHART_FONT}
                    x={i * slot + slot / 2}
                    y={height - 12}
                    fill={palette.textFaint}
                    fontSize={9}
                    textAnchor="middle"
                  >
                    n/a
                  </SvgText>
                </G>
              );
            }

            const top = Math.min(y(prev), y(s.runningTotal));
            const h = Math.max(Math.abs(y(prev) - y(s.runningTotal)), 2);
            return (
              <G key={s.key}>
                <Rect
                  x={x}
                  y={top}
                  width={barW}
                  height={h}
                  rx={2}
                  fill={s.delta < 0 ? palette.down : palette.up}
                  opacity={0.85}
                />
                {label}
                <SvgText fontFamily={CHART_FONT}
                  x={i * slot + slot / 2}
                  y={height - 12}
                  fill={palette.textMuted}
                  fontSize={9}
                  textAnchor="middle"
                >
                  {format(Math.abs(s.delta))}
                </SvgText>
              </G>
            );
          })}
        </Svg>
        </ScrollView>
      ) : (
        <View style={{ height }} />
      )}
      <Text variant="caption" faint style={{ marginTop: spacing.xs }}>
        Blue bars are subtotals from zero; red bars are what each line takes out.
        {scrolls ? ' Scroll sideways for the full walk.' : ''}
      </Text>
    </View>
  );
}

function shortLabel(label: string): string {
  const map: Record<string, string> = {
    'Adjusted EBITDA': 'Adj EBITDA',
    'Stock-based compensation': 'SBC',
    'Cash EBITDA': 'Cash EBITDA',
    'Cash interest': 'Interest',
    'Cash taxes': 'Taxes',
    'Working capital': 'WC',
    'Operating cash flow': 'OCF',
    'Capital expenditure': 'Capex',
    'Free cash flow': 'FCF',
    'Other items': 'Other',
  };
  return map[label] ?? label;
}

/**
 * Fan chart for a Monte Carlo projection.
 *
 * Two nested bands (5–95 and 25–75) plus the median, with the benchmark median
 * drawn as a dashed line on the same axes. Showing the benchmark inside the fan
 * rather than beside it is the whole point: the question is not what the book
 * might do, it is whether it beats the alternative.
 */
export function FanChart({
  bands,
  benchmark,
  format,
  height = 200,
  style,
  label,
}: {
  bands: { p5: number; p25: number; p50: number; p75: number; p95: number }[];
  benchmark: { p50: number }[];
  format: (v: number) => string;
  height?: number;
  style?: StyleProp<ViewStyle>;
  label: string;
}) {
  const { palette, spacing } = useTheme();
  const [width, onLayout] = useWidth();
  if (bands.length < 2) {
    return (
      <View style={style}>
        <Text variant="caption" faint>
          Not enough horizon to plot.
        </Text>
      </View>
    );
  }

  const padT = 8;
  const padB = 20;
  const w = Math.max(width, 1);
  const innerH = Math.max(height - padT - padB, 1);
  const all = [
    ...bands.flatMap((b) => [b.p5, b.p95]),
    ...benchmark.map((b) => b.p50),
  ];
  const [lo, hi] = niceBounds(all, 0.05);
  const x = (i: number) => (i / (bands.length - 1)) * w;
  const y = (v: number) => padT + innerH - ((v - lo) / (hi - lo)) * innerH;

  const areaPath = (upper: (b: (typeof bands)[number]) => number, lower: (b: (typeof bands)[number]) => number) => {
    const up = bands.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(upper(b)).toFixed(1)}`).join('');
    const down = [...bands]
      .map((b, i) => ({ b, i }))
      .reverse()
      .map(({ b, i }) => `L${x(i).toFixed(1)},${y(lower(b)).toFixed(1)}`)
      .join('');
    return `${up}${down}Z`;
  };

  const line = (pick: (b: (typeof bands)[number]) => number) =>
    bands.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pick(b)).toFixed(1)}`).join('');

  const last = bands[bands.length - 1]!;
  const benchLast = benchmark[benchmark.length - 1]?.p50 ?? null;

  return (
    <View
      style={style}
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${label}. After ${bands.length - 1} years the middle outcome is ${format(last.p50)}, with a nine-in-ten range from ${format(last.p5)} to ${format(last.p95)}. The benchmark's middle outcome is ${benchLast == null ? 'unknown' : format(benchLast)}.`}
    >
      {width > 0 ? (
        <Svg width={w} height={height}>
          {[0, 0.5, 1].map((f) => (
            <Line
              key={f}
              x1={0}
              x2={w}
              y1={padT + innerH * f}
              y2={padT + innerH * f}
              stroke={palette.chartGrid}
              strokeWidth={1}
            />
          ))}
          <Path d={areaPath((b) => b.p95, (b) => b.p5)} fill={palette.accent} opacity={0.14} />
          <Path d={areaPath((b) => b.p75, (b) => b.p25)} fill={palette.accent} opacity={0.24} />
          <Path d={line((b) => b.p50)} stroke={palette.accent} strokeWidth={2.5} fill="none" />
          {benchmark.length === bands.length ? (
            <Path
              d={benchmark.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(b.p50).toFixed(1)}`).join('')}
              stroke={palette.textMuted}
              strokeWidth={2}
              strokeDasharray="5 4"
              fill="none"
            />
          ) : null}
          <Circle cx={x(bands.length - 1)} cy={y(last.p50)} r={3.5} fill={palette.accent} />
          {/* Every year along the axis, thinned to every other on the long
              horizons, so a bend in the path can be dated without guessing. */}
          {bands.map((_, i) => {
            const slot = w / Math.max(bands.length - 1, 1);
            const keepLabel = slot >= 34 || i === 0 || i === bands.length - 1 || i % 2 === (bands.length - 1) % 2;
            if (!keepLabel) return null;
            return (
              <SvgText
                fontFamily={CHART_FONT}
                key={`yr-${i}`}
                x={x(i)}
                y={height - 4}
                fill={palette.textFaint}
                fontSize={9}
                textAnchor={i === 0 ? 'start' : i === bands.length - 1 ? 'end' : 'middle'}
              >
                {i === 0 ? 'now' : `${i}y`}
              </SvgText>
            );
          })}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
        <Text variant="caption" faint>
          worst 5% {format(last.p5)}
        </Text>
        <Text variant="caption" faint>
          best 5% {format(last.p95)}
        </Text>
      </View>
    </View>
  );
}

/** Distribution of terminal outcomes, with the starting value marked. */
export function Histogram({
  buckets,
  marker,
  format,
  height = 120,
  style,
  label,
}: {
  buckets: { x: number; count: number }[];
  marker: number | null;
  format: (v: number) => string;
  height?: number;
  style?: StyleProp<ViewStyle>;
  label: string;
}) {
  const { palette } = useTheme();
  const [width, onLayout] = useWidth();
  if (buckets.length === 0) return null;

  const w = Math.max(width, 1);
  const padB = 16;
  const innerH = Math.max(height - padB, 1);
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  const lo = buckets[0]!.x;
  const hi = buckets[buckets.length - 1]!.x;
  const span = hi - lo || 1;
  const slot = w / buckets.length;

  return (
    <View
      style={style}
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${label}. Outcomes range from ${format(lo)} to ${format(hi)}.`}
    >
      {width > 0 ? (
        <Svg width={w} height={height}>
          {buckets.map((b, i) => {
            const h = (b.count / maxCount) * innerH;
            const below = marker != null && b.x < marker;
            return (
              <Rect
                key={i}
                x={i * slot + slot * 0.1}
                y={innerH - h}
                width={slot * 0.8}
                height={Math.max(h, 1)}
                rx={1}
                fill={below ? palette.down : palette.accent}
                opacity={below ? 0.75 : 0.8}
              />
            );
          })}
          {marker != null && marker >= lo && marker <= hi ? (
            <Line
              x1={((marker - lo) / span) * w}
              x2={((marker - lo) / span) * w}
              y1={0}
              y2={innerH}
              stroke={palette.text}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          ) : null}
          <SvgText fontFamily={CHART_FONT} x={2} y={height - 3} fill={palette.textFaint} fontSize={9}>
            {format(lo)}
          </SvgText>
          <SvgText fontFamily={CHART_FONT} x={w - 2} y={height - 3} fill={palette.textFaint} fontSize={9} textAnchor="end">
            {format(hi)}
          </SvgText>
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}
