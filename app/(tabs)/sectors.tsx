import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Card, Pill, Row, Screen, Section, Text } from '@/components/ui';
import { ConcentrationBar, TargetBars, sectorColor } from '@/components/charts';
import { useApp } from '@/data/store';
import { compactCurrency, percent } from '@/domain/format';
import { positionViews, sectorBuckets } from '@/domain/portfolio';
import { resolveTargets } from '@/domain/allocation';

export default function SectorsScreen() {
  const { palette, spacing } = useTheme();
  const holdings = useApp((s) => s.holdings);
  const stocks = useApp((s) => s.stocks);
  const plan = useApp((s) => s.plan);
  const portfolioRead = useApp((s) => s.portfolioRead);
  const nlv = useApp((s) => s.account)().netLiquidationValue;
  const cash = useApp((s) => s.cashUsd)();

  // Targets come from the portfolio read when there is one. The bundled mix is
  // the fallback, and the caption below says which is in force — a target with
  // no stated origin is exactly the thing this screen was measuring against
  // before.
  const targets = useMemo(
    () =>
      resolveTargets(
        plan,
        portfolioRead ? { at: portfolioRead.at, stance: portfolioRead.result.allocation ?? null } : null,
      ),
    [plan, portfolioRead],
  );

  const positions = useMemo(() => positionViews(holdings, stocks, nlv), [holdings, stocks, nlv]);
  const buckets = useMemo(
    // sectorBuckets takes shares of NLV; resolveTargets reports percentages,
    // because that is what both the model and the screen speak.
    () =>
      sectorBuckets(
        positions,
        cash,
        nlv,
        Object.fromEntries(Object.entries(targets.mix).map(([k, v]) => [k, v / 100])),
      ),
    [positions, cash, nlv, targets.mix],
  );

  const overweight = buckets
    .filter((b) => b.driftPct != null && b.driftPct > 3)
    .sort((a, b) => (b.driftPct ?? 0) - (a.driftPct ?? 0));
  const underweight = buckets
    .filter((b) => b.driftPct != null && b.driftPct < -3)
    .sort((a, b) => (a.driftPct ?? 0) - (b.driftPct ?? 0));

  return (
    <Screen>
      <Section title="Concentration" term="concentration" subtitle="Share of net liquidation value">
        <Card style={{ gap: spacing.md }}>
          <ConcentrationBar
            height={26}
            slices={buckets
              .filter((b) => b.weightPct > 0)
              .map((b) => ({
                label: b.short,
                pct: b.weightPct,
                // By identity, never by position in the visible list — the
                // same stable mapping the Portfolio donut uses, so one sector
                // is one colour on every tab.
                color: sectorColor(palette, b.sector),
              }))}
          />
          <Text variant="caption" muted>
            {buckets.filter((b) => b.weightPct > 0).length} buckets in use. The heaviest is{' '}
            {buckets.slice().sort((a, b) => b.weightPct - a.weightPct)[0]?.short} at{' '}
            {buckets.slice().sort((a, b) => b.weightPct - a.weightPct)[0]?.weightPct.toFixed(1)}%.
          </Text>
        </Card>
      </Section>

      <Section
        title="Current vs target"
        term="sectorTarget"
        subtitle="Bar is current, the notch is the target"
      >
        <Card style={{ gap: spacing.sm }}>
          <TargetBars
            rows={buckets.map((b) => ({ label: b.label, current: b.weightPct, target: b.targetPct }))}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Pill
              label={targets.source === 'manual' ? 'Claude' : 'Seed'}
              tone={targets.source === 'manual' ? 'accent' : 'warn'}
              compact
            />
            <Text variant="caption" faint style={{ flex: 1 }}>
              {targets.label}
              {targets.asOf ? ` · ${targets.asOf.slice(0, 10)}` : ''}
            </Text>
          </View>
        </Card>
      </Section>

      {Object.keys(targets.why).length > 0 && (
        <Section title="Why these targets" subtitle="Each number, and what moved it">
          <Card style={{ gap: spacing.sm }}>
            {buckets
              .filter((b) => targets.why[b.sector])
              .map((b) => (
                <View key={b.sector} style={{ gap: 2 }}>
                  <Text variant="body">
                    {b.label} — {b.targetPct == null ? '—' : `${b.targetPct.toFixed(0)}%`}
                  </Text>
                  <Text variant="caption" muted>
                    {targets.why[b.sector]}
                  </Text>
                </View>
              ))}
          </Card>
        </Section>
      )}

      {(overweight.length > 0 || underweight.length > 0) && (
        <Section title="Drift" term="drift" subtitle="More than 3 points away from target">
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
