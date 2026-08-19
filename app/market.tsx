import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Card, Pill, Row, Screen, Section, Text } from '@/components/ui';
import { useApp } from '@/data/store';
import { percent, ratio, relativeAsOf, tone } from '@/domain/format';
import { optionsRead, readTone } from '@/domain/options';

export default function MarketScreen() {
  const { spacing } = useTheme();
  const market = useApp((s) => s.market);
  const stocks = useApp((s) => s.stocks);

  const indices = market.instruments.filter((i) => i.kind === 'index');
  const etfs = market.instruments.filter((i) => i.kind === 'etf');
  const yields = market.instruments.filter((i) => i.kind === 'yield');

  /** Most bearish first — the table is there to surface what is being sold. */
  const sentiment = useMemo(
    () =>
      Object.values(stocks)
        .filter((s) => s.options.value?.putCallVolume != null)
        .map((s) => ({
          ticker: s.ticker,
          name: s.name,
          volume: s.options.value!.putCallVolume!,
          oi: s.options.value!.putCallOpenInterest,
          read: optionsRead(s.options.value!.putCallVolume!)!,
        }))
        .sort((a, b) => b.volume - a.volume),
    [stocks],
  );

  const bearish = sentiment.filter((s) => s.read === 'bearish').length;
  const bullish = sentiment.filter((s) => s.read === 'bullish').length;

  return (
    <Screen>
      <Text variant="caption" faint>
        As of {relativeAsOf(market.asOf)}
      </Text>

      <Section title="Indices">
        <Card>
          {indices.map((i) => (
            <Row
              key={i.symbol}
              label={i.name}
              value={`${i.last?.toLocaleString('en-US', { maximumFractionDigits: 2 }) ?? '—'}  ${percent(i.changePct)}`}
              tone={tone(i.changePct)}
            />
          ))}
        </Card>
      </Section>

      <Section title="ETFs">
        <Card>
          {etfs.map((i) => (
            <Row
              key={i.symbol}
              label={`${i.symbol} · ${i.name}`}
              value={`${i.last?.toFixed(2) ?? '—'}  ${percent(i.changePct)}`}
              tone={tone(i.changePct)}
            />
          ))}
        </Card>
      </Section>

      <Section title="Treasury yields">
        <Card>
          {yields.map((i) => (
            <Row
              key={i.symbol}
              label={i.name}
              value={`${i.last?.toFixed(2) ?? '—'}%  ${percent(i.changePct)}`}
              tone={tone(i.changePct)}
            />
          ))}
        </Card>
      </Section>

      <Section
        term="putCall"
        title="Options sentiment across the book"
        subtitle={`${bearish} bearish, ${bullish} bullish · most bearish first`}
      >
        <Card style={{ gap: spacing.sm }}>
          {sentiment.length === 0 ? (
            <Text variant="body" muted>
              No options data on file yet.
            </Text>
          ) : null}
          {sentiment.map((s) => (
            <View
              key={s.ticker}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
              accessible
              accessibilityLabel={`${s.ticker}: put call volume ${s.volume.toFixed(2)}, reads ${s.read}`}
            >
              <Text variant="heading" style={{ width: 62 }}>
                {s.ticker}
              </Text>
              <Text variant="mono" style={{ width: 56 }}>
                {ratio(s.volume)}
              </Text>
              <Text variant="caption" muted style={{ width: 56 }}>
                {s.oi == null ? '—' : ratio(s.oi)}
              </Text>
              <View style={{ flex: 1 }} />
              <Pill label={s.read} tone={readTone(s.read)} compact />
            </View>
          ))}
          <Text variant="caption" faint>
            Columns are put/call by volume, then by open interest. At or below 0.70 reads bullish, at
            or above 1.00 reads bearish — the data source's own convention.
          </Text>
        </Card>
      </Section>
    </Screen>
  );
}
