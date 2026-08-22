import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Card, Empty, Pill, Row, Screen, Section, Text } from '@/components/ui';
import { Sparkline } from '@/components/charts';
import { VERDICT_LABEL, VERDICT_TONE } from '@/components/StockRow';
import { useApp } from '@/data/store';
import { compactCurrency, currency, longDate, percent, tone } from '@/domain/format';

export default function HistoryScreen() {
  const { spacing } = useTheme();
  const snapshots = useApp((s) => s.snapshots);
  const stocks = useApp((s) => s.stocks);

  const ordered = useMemo(() => [...snapshots].sort((a, b) => (a.date < b.date ? -1 : 1)), [snapshots]);

  /** Verdict and trend changes between the first and last snapshot on file. */
  const changes = useMemo(() => {
    if (ordered.length < 2) return [];
    const first = ordered[0]!;
    const last = ordered[ordered.length - 1]!;
    const out: { ticker: string; kind: string; detail: string }[] = [];
    for (const ticker of Object.keys(last.verdicts)) {
      const before = first.verdicts[ticker];
      const after = last.verdicts[ticker]!;
      if (before && before !== after) {
        out.push({
          ticker,
          kind: 'verdict',
          detail: `${VERDICT_LABEL[before]} → ${VERDICT_LABEL[after]}`,
        });
      }
      const tb = first.trendScores[ticker];
      const ta = last.trendScores[ticker];
      if (tb != null && ta != null && Math.abs(ta - tb) >= 1.5) {
        out.push({
          ticker,
          kind: 'trend',
          detail: `trend ${tb.toFixed(1)} → ${ta.toFixed(1)} of 5`,
        });
      }
    }
    return out;
  }, [ordered]);

  if (ordered.length === 0) {
    return (
      <Screen>
        <Empty
          title="No snapshots yet."
          detail="One is taken automatically each time the book is updated from a screenshot."
        />
      </Screen>
    );
  }

  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const change = last.netLiquidationValue - first.netLiquidationValue;
  const changePct =
    first.netLiquidationValue === 0 ? null : (change / first.netLiquidationValue) * 100;

  return (
    <Screen>
      <Section
        term="snapshot"
        title="Net liquidation value"
        subtitle={`${ordered.length} snapshot${ordered.length === 1 ? '' : 's'} from ${longDate(first.date)}`}
      >
        <Card style={{ gap: spacing.md }}>
          <Sparkline
            values={ordered.map((s) => s.netLiquidationValue)}
            height={72}
            label="Net liquidation value over the recorded period"
            tone={change >= 0 ? 'up' : 'down'}
          />
          {/* Labelled — three bare figures under a sparkline read as a
              rendering mistake, doubly so while first and latest are equal. */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {(
              [
                ['First', compactCurrency(first.netLiquidationValue), undefined],
                ['Change', `${currency(change, { sign: true, decimals: 0 })} (${percent(changePct)})`, tone(change)],
                ['Latest', compactCurrency(last.netLiquidationValue), undefined],
              ] as const
            ).map(([label, value, valueTone], i) => (
              <View key={label} style={{ alignItems: i === 0 ? 'flex-start' : i === 2 ? 'flex-end' : 'center' }}>
                <Text variant="caption" faint>
                  {label}
                </Text>
                <Text variant="caption" tone={valueTone} muted={valueTone == null}>
                  {value}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      </Section>

      {changes.length ? (
        <Section title="What changed" subtitle="Between the first and latest snapshot">
          <Card style={{ gap: spacing.sm }}>
            {changes.map((c, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <Pill
                  label={c.ticker}
                  tone={
                    c.kind === 'verdict'
                      ? VERDICT_TONE[stocks[c.ticker]?.narrative.verdict ?? 'hold']
                      : 'flat'
                  }
                  compact
                />
                <Text variant="caption" muted style={{ flex: 1 }}>
                  {c.detail}
                </Text>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Every snapshot" term="snapshot">
        <Card>
          {[...ordered].reverse().map((s) => (
            <Row
              key={s.date}
              label={longDate(s.date)}
              value={compactCurrency(s.netLiquidationValue)}
              hint={`day P&L ${currency(s.dayPnl, { sign: true, decimals: 0 })}`}
              tone={tone(s.dayPnl)}
            />
          ))}
        </Card>
      </Section>
    </Screen>
  );
}
