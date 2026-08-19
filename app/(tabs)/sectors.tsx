import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Card, Pill, Row, Screen, Section, Text } from '@/components/ui';
import { ConcentrationBar, TargetBars } from '@/components/charts';
import { useApp } from '@/data/store';
import { compactCurrency, percent } from '@/domain/format';
import { positionViews, sectorBuckets } from '@/domain/portfolio';

export default function SectorsScreen() {
  const { palette, spacing } = useTheme();
  const holdings = useApp((s) => s.holdings);
  const stocks = useApp((s) => s.stocks);
  const plan = useApp((s) => s.plan);
  const nlv = useApp((s) => s.account)().netLiquidationValue;
  const cash = useApp((s) => s.cashUsd)();

  const positions = useMemo(() => positionViews(holdings, stocks, nlv), [holdings, stocks, nlv]);
  const buckets = useMemo(
    () => sectorBuckets(positions, cash, nlv, plan.constraints.targetMix),
    [positions, cash, nlv, plan.constraints.targetMix],
  );

  const overweight = buckets
    .filter((b) => b.driftPct != null && b.driftPct > 3)
    .sort((a, b) => (b.driftPct ?? 0) - (a.driftPct ?? 0));
  const underweight = buckets
    .filter((b) => b.driftPct != null && b.driftPct < -3)
    .sort((a, b) => (a.driftPct ?? 0) - (b.driftPct ?? 0));

  return (
    <Screen>
      <Section title="Concentration" subtitle="Share of net liquidation value">
        <Card style={{ gap: spacing.md }}>
          <ConcentrationBar
            height={26}
            slices={buckets
              .filter((b) => b.weightPct > 0)
              .map((b, i) => ({
                label: b.short,
                pct: b.weightPct,
                color: b.sector === 'cash' ? palette.flat : palette.series[i % palette.series.length]!,
              }))}
          />
          <Text variant="caption" muted>
            {buckets.filter((b) => b.weightPct > 0).length} buckets in use. The heaviest is{' '}
            {buckets.slice().sort((a, b) => b.weightPct - a.weightPct)[0]?.short} at{' '}
            {buckets.slice().sort((a, b) => b.weightPct - a.weightPct)[0]?.weightPct.toFixed(1)}%.
          </Text>
        </Card>
      </Section>

      <Section title="Current vs target" subtitle="Bar is current, the notch is the plan's target">
        <Card>
          <TargetBars
            rows={buckets.map((b) => ({ label: b.label, current: b.weightPct, target: b.targetPct }))}
          />
        </Card>
      </Section>

      {(overweight.length > 0 || underweight.length > 0) && (
        <Section title="Drift" subtitle="More than 3 points away from target">
          <Card style={{ gap: spacing.sm }}>
            {overweight.map((b) => (
              <View key={b.sector} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <Pill label="Over" tone="warn" compact />
                <Text variant="caption" muted style={{ flex: 1 }}>
                  {b.label} is {percent(b.driftPct)} against target — {b.tickers.join(', ') || 'cash'}
                </Text>
              </View>
            ))}
            {underweight.map((b) => (
              <View key={b.sector} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <Pill label="Under" tone="accent" compact />
                <Text variant="caption" muted style={{ flex: 1 }}>
                  {b.label} is {percent(b.driftPct)} against target
                  {b.tickers.length ? ` — ${b.tickers.join(', ')}` : ''}
                </Text>
              </View>
            ))}
          </Card>
        </Section>
      )}

      <Section title="Every bucket">
        <Card>
          {buckets.map((b) => (
            <Row
              key={b.sector}
              label={b.label}
              hint={b.tickers.length ? b.tickers.join(' · ') : b.sector === 'cash' ? 'cash sleeve' : 'nothing held'}
              value={`${compactCurrency(b.marketValue)}  ${b.weightPct.toFixed(1)}%`}
              tone={b.driftPct == null ? undefined : Math.abs(b.driftPct) > 5 ? 'warn' : 'flat'}
            />
          ))}
        </Card>
      </Section>
    </Screen>
  );
}
