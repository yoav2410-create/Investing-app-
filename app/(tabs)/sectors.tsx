import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { Link } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Pill, Screen, Section, Text } from '@/components/ui';
import { DonutChart, TargetBars, sectorColor } from '@/components/charts';
import { useApp } from '@/data/store';
import { compactCurrency, percent, tone } from '@/domain/format';
import { positionViews, sectorBuckets, type PositionView } from '@/domain/portfolio';
import { resolveTargets } from '@/domain/allocation';

/**
 * The detail page behind the allocation donut.
 *
 * The Portfolio page answers "what is the shape of the book" with the donut;
 * tapping it lands here, where the same donut sits on top and every slice is
 * opened up — which names are inside each sector, at what weight, doing what
 * today. Same colours by construction: both screens draw through
 * `sectorColor`, so a slice and its breakdown group can never disagree.
 */
export default function SectorsScreen() {
  const { palette, spacing, radius } = useTheme();
  const holdings = useApp((s) => s.holdings);
  const stocks = useApp((s) => s.stocks);
  const plan = useApp((s) => s.plan);
  const portfolioRead = useApp((s) => s.portfolioRead);
  const nlv = useApp((s) => s.account)().netLiquidationValue;
  const cash = useApp((s) => s.cashUsd)();

  // Targets come from the portfolio read when there is one; the caption says
  // which is in force. Same resolution as the Portfolio page.
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
    () =>
      sectorBuckets(
        positions,
        cash,
        nlv,
        Object.fromEntries(Object.entries(targets.mix).map(([k, v]) => [k, v / 100])),
      ),
    [positions, cash, nlv, targets.mix],
  );

  const byTicker = useMemo(() => {
    const m = new Map<string, PositionView>();
    for (const p of positions) m.set(p.ticker, p);
    return m;
  }, [positions]);

  const shown = buckets.filter((b) => b.weightPct > 0).sort((a, b) => b.weightPct - a.weightPct);

  return (
    <Screen>
      <Section
        title="Allocation"
        term="concentration"
        subtitle={`Share of net liquidation value · targets: ${targets.source === 'manual' ? "Claude's" : 'bundled'}`}
      >
        <Card>
          <DonutChart
            slices={shown.map((b) => ({ sector: b.sector, label: b.short, pct: b.weightPct }))}
          />
        </Card>
      </Section>

      {/* ------------------------------------------- inside each slice ---- */}
      <Section title="Inside each slice" subtitle="Every position, grouped the way the donut cuts">
        <View style={{ gap: spacing.sm }}>
          {shown.map((b) => {
            const color = sectorColor(palette, b.sector);
            const rows = b.tickers
              .map((t) => byTicker.get(t))
              .filter((p): p is PositionView => !!p)
              .sort((a, x) => (x.weightPct ?? 0) - (a.weightPct ?? 0));
            return (
              <Card key={b.sector} padded={false} style={{ flexDirection: 'row' }}>
                {/* The slice's colour, carried down the group's spine. */}
                <View
                  style={{
                    width: 5,
                    borderTopLeftRadius: radius.lg,
                    borderBottomLeftRadius: radius.lg,
                    backgroundColor: color,
                  }}
                />
                <View style={{ flex: 1, padding: spacing.md, gap: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
                    <Text variant="heading" style={{ flex: 1 }}>
                      {b.label}
                    </Text>
                    <Text variant="mono">{b.weightPct.toFixed(1)}%</Text>
                    {b.targetPct != null ? (
                      <Text variant="caption" faint>
                        target {b.targetPct.toFixed(0)}%
                      </Text>
                    ) : null}
                  </View>

                  {b.sector === 'cash' ? (
                    <Text variant="caption" muted>
                      {compactCurrency(b.marketValue)} across the currency balances — the sleeve the
                      floor is measured against.
                    </Text>
                  ) : rows.length === 0 ? (
                    <Text variant="caption" muted>
                      Nothing held here right now.
                    </Text>
                  ) : (
                    rows.map((p) => (
                      <Link
                        key={p.ticker}
                        href={{ pathname: '/stock/[ticker]', params: { ticker: p.ticker } }}
                        asChild
                      >
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${p.ticker}, ${p.weightPct == null ? 'unpriced' : `${p.weightPct.toFixed(1)} percent of the book`}. Opens the full analysis.`}
                          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                        >
                          {/* The row lives in its own View: under Link asChild
                              the pressable becomes an anchor on web, and flex
                              set on the anchor itself does not survive. */}
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: spacing.sm,
                              minHeight: 34,
                            }}
                          >
                            <Text variant="body" style={{ width: 62, color: palette.accent }}>
                              {p.ticker}
                            </Text>
                            <Text variant="caption" muted numberOfLines={1} style={{ flex: 1 }}>
                              {p.name}
                            </Text>
                            <Text variant="caption" tone={tone(p.dayPnlPct)} style={{ width: 58, textAlign: 'right' }}>
                              {percent(p.dayPnlPct)}
                            </Text>
                            <Text variant="mono" style={{ width: 52, textAlign: 'right' }}>
                              {p.weightPct == null ? '—' : `${p.weightPct.toFixed(1)}%`}
                            </Text>
                          </View>
                        </Pressable>
                      </Link>
                    ))
                  )}

                  {b.driftPct != null && Math.abs(b.driftPct) > 3 ? (
                    <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                      <Pill label={b.driftPct > 0 ? 'Over' : 'Under'} tone={b.driftPct > 0 ? 'warn' : 'accent'} compact />
                      <Text variant="caption" muted style={{ flex: 1 }}>
                        {percent(b.driftPct)} against the target.
                      </Text>
                    </View>
                  ) : null}
                </View>
              </Card>
            );
          })}
        </View>
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
          {targets.source !== 'manual' ? (
            <Link href="/insights" asChild>
              <Button label="Run a read to set real targets" onPress={() => {}} variant="quiet" />
            </Link>
          ) : null}
        </Card>
      </Section>

      {Object.keys(targets.why).length > 0 && (
        <Section title="Why these targets" subtitle="Each number, and what moved it">
          <Card style={{ gap: spacing.sm }}>
            {buckets
              .filter((b) => targets.why[b.sector])
              .map((b) => (
                <View key={b.sector} style={{ gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <View
                      style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: sectorColor(palette, b.sector) }}
                    />
                    <Text variant="body">
                      {b.label} — {b.targetPct == null ? '—' : `${b.targetPct.toFixed(0)}%`}
                    </Text>
                  </View>
                  <Text variant="caption" muted>
                    {targets.why[b.sector]}
                  </Text>
                </View>
              ))}
          </Card>
        </Section>
      )}
    </Screen>
  );
}
