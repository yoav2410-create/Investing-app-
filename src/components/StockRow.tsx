import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { Pill, Text } from './ui';
import { currency, percent, tone } from '@/domain/format';
import { trendLabelTone, trendRead } from '@/domain/technicals';
import { bandTone, valuationRead } from '@/domain/valuation';
import type { Stock, Verdict } from '@/domain/types';
import type { Tone } from '@/theme/tokens';

export const VERDICT_TONE: Record<Verdict, Tone> = {
  buy: 'up',
  add: 'up',
  hold: 'flat',
  trim: 'warn',
  sell: 'down',
  challenge: 'warn',
  watch: 'accent',
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  buy: 'Buy',
  add: 'Add',
  hold: 'Hold',
  trim: 'Trim',
  sell: 'Sell',
  challenge: 'Challenge',
  watch: 'Watch',
};

export function StockRow({
  stock,
  shares,
  weightPct,
  showValuation = true,
}: {
  stock: Stock;
  shares?: number;
  weightPct?: number | null;
  showValuation?: boolean;
}) {
  const { palette, spacing, radius } = useTheme();
  const quote = stock.quote.value;
  const trend = trendRead(quote?.price ?? null, stock.technicals.value);
  const val = showValuation ? valuationRead(stock) : null;

  const spoken = [
    `${stock.ticker}, ${stock.name}`,
    quote ? `${currency(quote.price)}, ${percent(quote.changePct)} today` : 'no price',
    shares != null ? `${shares} shares` : 'watchlist only',
    `verdict ${VERDICT_LABEL[stock.narrative.verdict]}`,
    trend.label,
    val?.band ? `${val.band} against its own range` : '',
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Link href={{ pathname: '/stock/[ticker]', params: { ticker: stock.ticker } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint="Opens the full analysis"
        style={({ pressed }) => ({
          backgroundColor: pressed ? palette.cardMuted : palette.card,
          borderColor: palette.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.lg,
          padding: spacing.md,
          gap: spacing.sm,
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text variant="heading">{stock.ticker}</Text>
              {stock.isEtf ? <Pill label="ETF" tone="flat" compact /> : null}
              {shares == null ? <Pill label="Watchlist" tone="accent" compact /> : null}
            </View>
            <Text variant="caption" muted numberOfLines={1}>
              {stock.name}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="mono">{quote ? currency(quote.price) : '—'}</Text>
            <Text variant="caption" tone={tone(quote?.changePct)}>
              {quote ? percent(quote.changePct) : 'no price'}
            </Text>
          </View>
        </View>

        {stock.narrative.thesis ? (
          <Text variant="caption" muted numberOfLines={2}>
            {stock.narrative.thesis}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          <Pill
            label={VERDICT_LABEL[stock.narrative.verdict]}
            tone={VERDICT_TONE[stock.narrative.verdict]}
            compact
          />
          <Pill
            label={`${trend.label} ${trend.score.toFixed(1)}/5`}
            tone={trendLabelTone(trend.label)}
            compact
          />
          {val?.band && val.current != null ? (
            <Pill
              label={`${val.label} ${val.current.toFixed(1)}x · ${val.band}`}
              tone={bandTone(val.band)}
              compact
            />
          ) : null}
          {weightPct != null ? (
            <Pill label={`${weightPct.toFixed(1)}% of book`} tone="flat" compact />
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}
