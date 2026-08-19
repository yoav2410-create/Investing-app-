import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Pill, Screen, Section, Stat, Text } from '@/components/ui';
import { ConcentrationBar, Sparkline } from '@/components/charts';
import { StockRow } from '@/components/StockRow';
import { useApp } from '@/data/store';
import { FX_TO_USD } from '@/data/seed';
import {
  compactCurrency,
  currency,
  percent,
  relativeAsOf,
  tone,
} from '@/domain/format';
import { concentration, positionViews, sectorBuckets, topMovers } from '@/domain/portfolio';
import { SECTORS } from '@/domain/types';
import { trendRead } from '@/domain/technicals';

export default function PortfolioScreen() {
  const router = useRouter();
  const { palette, spacing } = useTheme();
  const holdings = useApp((s) => s.holdings);
  const stocks = useApp((s) => s.stocks);
  const plan = useApp((s) => s.plan);
  const snapshots = useApp((s) => s.snapshots);
  const staleNarratives = useApp((s) => s.staleNarratives);
  const account = useApp((s) => s.account)();
  const cash = useApp((s) => s.cashUsd)();

  const positions = useMemo(
    () => positionViews(holdings, stocks, account.netLiquidationValue),
    [holdings, stocks, account.netLiquidationValue],
  );
  const buckets = useMemo(
    () => sectorBuckets(positions, cash, account.netLiquidationValue, plan.constraints.targetMix),
    [positions, cash, account.netLiquidationValue, plan.constraints.targetMix],
  );
  const movers = useMemo(() => topMovers(positions), [positions]);
  const conc = useMemo(() => concentration(positions), [positions]);

  const cashPct = account.netLiquidationValue === 0 ? 0 : (cash / account.netLiquidationValue) * 100;
  const floorPct = plan.constraints.cashFloorPct * 100;
  const underFloor = cashPct < floorPct;

  const oldestQuote = useMemo(() => {
    const stamps = holdings
      .map((h) => stocks[h.ticker]?.quote.asOf)
      .filter((x): x is string => !!x)
      .sort();
    return stamps[0] ?? null;
  }, [holdings, stocks]);

  const headline = useMemo(() => buildHeadline(positions, buckets, cashPct, floorPct), [
    positions,
    buckets,
    cashPct,
    floorPct,
  ]);

  return (
    <Screen>
      <View style={{ gap: spacing.xs }}>
        <Text variant="caption" muted>
          Net liquidation value · marks as of {relativeAsOf(oldestQuote)}
        </Text>
        <Text variant="display" style={{ fontVariant: ['tabular-nums'] }}>
          {currency(account.netLiquidationValue, { decimals: 0 })}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text variant="heading" tone={tone(account.dayPnl)}>
            {currency(account.dayPnl, { sign: true })}
          </Text>
          <Text variant="heading" tone={tone(account.dayPnl)}>
            {percent(account.dayPnlPct)}
          </Text>
          <Text variant="caption" faint>
            today
          </Text>
        </View>
      </View>

      <Button
        label="Update from a screenshot"
        onPress={() => router.push('/sync')}
        accessibilityHint="Photograph your broker's positions screen and Claude will read it"
      />

      {staleNarratives.length > 0 ? (
        <Card style={{ borderColor: palette.warn, gap: spacing.xs }}>
          <Text variant="label" tone="warn">
            New earnings since the last analysis
          </Text>
          <Text variant="caption" muted>
            {staleNarratives.join(', ')} reported after their write-up. Open each one and tap
            Re-research to bring the analysis current.
          </Text>
        </Card>
      ) : null}

      <Card style={{ gap: spacing.sm }}>
        <Text variant="body">{headline}</Text>
      </Card>

      <Section title="Account">
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
            <Stat label="Market value" value={compactCurrency(account.marketValue)} style={{ flexBasis: '30%', flexGrow: 1 }} />
            <Stat
              label="Unrealised P&L"
              value={compactCurrency(account.unrealizedPnl)}
              tone={tone(account.unrealizedPnl)}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Realised P&L"
              value={compactCurrency(account.realizedPnl)}
              tone={tone(account.realizedPnl)}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Cash"
              value={compactCurrency(cash)}
              detail={`${cashPct.toFixed(1)}% of book`}
              tone={underFloor ? 'down' : 'up'}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat label="Excess liquidity" value={compactCurrency(account.excessLiquidity)} style={{ flexBasis: '30%', flexGrow: 1 }} />
            <Stat label="Maint. margin" value={compactCurrency(account.maintenanceMargin)} style={{ flexBasis: '30%', flexGrow: 1 }} />
            <Stat label="Buying power" value={compactCurrency(account.buyingPower)} style={{ flexBasis: '30%', flexGrow: 1 }} />
            <Stat
              label="Largest position"
              value={conc.topTicker ?? '—'}
              detail={`${conc.topWeightPct.toFixed(1)}% · cap ${(plan.constraints.maxPositionPct * 100).toFixed(0)}%`}
              tone={conc.topWeightPct > plan.constraints.maxPositionPct * 100 ? 'down' : 'flat'}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
          </View>
          {account.cash.length > 1 ? (
            <Text variant="caption" faint style={{ marginTop: spacing.sm }}>
              Cash by currency:{' '}
              {account.cash
                .map((c) => `${c.currency} ${c.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`)
                .join(' · ')}
              {' · converted at '}
              {Object.entries(FX_TO_USD)
                .filter(([k]) => k !== 'USD')
                .map(([k, v]) => `${k} ${v}`)
                .join(', ')}
            </Text>
          ) : null}
        </Card>
      </Section>

      {underFloor ? (
        <Card style={{ borderColor: palette.down, gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Ionicons name="alert-circle" size={18} color={palette.down} />
            <Text variant="label" tone="down">
              Cash is {(floorPct - cashPct).toFixed(1)} points under the {floorPct.toFixed(0)}% floor
            </Text>
          </View>
          <Text variant="caption" muted>
            That is what the rebalancing plan exists to fix. Open the Plan tab to see which legs get
            you back above it.
          </Text>
          <Link href="/(tabs)/plan" asChild>
            <Button label="Open the plan" onPress={() => {}} variant="quiet" />
          </Link>
        </Card>
      ) : null}

      <Section title="Concentration" subtitle="Share of net liquidation value">
        <Card style={{ gap: spacing.md }}>
          <ConcentrationBar
            slices={buckets
              .filter((b) => b.weightPct > 0)
              .map((b, i) => ({
                label: b.short,
                pct: b.weightPct,
                color: b.sector === 'cash' ? palette.flat : palette.series[i % palette.series.length]!,
              }))}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {buckets
              .filter((b) => b.weightPct > 0.05)
              .map((b, i) => (
                <View key={b.sector} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      backgroundColor:
                        b.sector === 'cash' ? palette.flat : palette.series[i % palette.series.length]!,
                    }}
                  />
                  <Text variant="caption" muted>
                    {b.short} {b.weightPct.toFixed(1)}%
                  </Text>
                </View>
              ))}
          </View>
        </Card>
      </Section>

      {snapshots.length > 1 ? (
        <Section title="Value over time" subtitle={`${snapshots.length} daily snapshots`}>
          <Card style={{ gap: spacing.sm }}>
            <Sparkline
              values={snapshots.map((s) => s.netLiquidationValue)}
              label="Net liquidation value over time"
            />
            <Link href="/history" asChild>
              <Button label="See history" onPress={() => {}} variant="quiet" />
            </Link>
          </Card>
        </Section>
      ) : null}

      <Section title="Today's movers">
        <View style={{ gap: spacing.sm }}>
          {movers.gainers.length === 0 && movers.losers.length === 0 ? (
            <Card>
              <Text variant="body" muted>
                No price moves recorded yet. Import a screenshot to set today's marks.
              </Text>
            </Card>
          ) : null}
          {[...movers.gainers, ...movers.losers].map((m) => {
            const stock = stocks[m.ticker];
            if (!stock) return null;
            const pos = positions.find((p) => p.ticker === m.ticker);
            return (
              <StockRow
                key={m.ticker}
                stock={stock}
                shares={pos?.shares}
                weightPct={pos?.weightPct}
                showValuation={false}
              />
            );
          })}
        </View>
      </Section>

      <Section title="Needs attention">
        <Card style={{ gap: spacing.sm }}>
          {attentionItems(positions, stocks, plan.constraints.maxPositionPct * 100).map((item) => (
            <View key={item.key} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
              <Pill label={item.tag} tone={item.tone} compact />
              <Text variant="caption" muted style={{ flex: 1 }}>
                {item.text}
              </Text>
            </View>
          ))}
        </Card>
      </Section>
    </Screen>
  );
}

function buildHeadline(
  positions: ReturnType<typeof positionViews>,
  buckets: ReturnType<typeof sectorBuckets>,
  cashPct: number,
  floorPct: number,
): string {
  const priced = positions.filter((p) => p.dayPnlPct != null);
  const up = priced.filter((p) => (p.dayPnlPct ?? 0) > 0).length;
  const down = priced.filter((p) => (p.dayPnlPct ?? 0) < 0).length;
  const biggest = buckets
    .filter((b) => b.sector !== 'cash')
    .sort((a, b) => b.weightPct - a.weightPct)[0];

  const parts: string[] = [];
  if (priced.length) {
    parts.push(`${up} up, ${down} down across ${priced.length} priced positions.`);
  } else {
    parts.push('No marks yet — import a screenshot to price the book.');
  }
  if (biggest) {
    parts.push(
      `${biggest.short} is the heaviest sector at ${biggest.weightPct.toFixed(1)}%${
        biggest.targetPct != null
          ? ` against a ${biggest.targetPct.toFixed(0)}% target`
          : ''
      }.`,
    );
  }
  parts.push(
    cashPct < floorPct
      ? `Cash sits at ${cashPct.toFixed(1)}%, below the ${floorPct.toFixed(0)}% floor.`
      : `Cash sits at ${cashPct.toFixed(1)}%, above the ${floorPct.toFixed(0)}% floor.`,
  );
  return parts.join(' ');
}

function attentionItems(
  positions: ReturnType<typeof positionViews>,
  stocks: Record<string, import('@/domain/types').Stock>,
  capPct: number,
) {
  const out: { key: string; tag: string; tone: 'up' | 'down' | 'warn' | 'accent' | 'flat'; text: string }[] = [];

  for (const p of positions) {
    if (p.weightPct != null && p.weightPct > capPct) {
      out.push({
        key: `cap-${p.ticker}`,
        tag: p.ticker,
        tone: 'down',
        text: `${p.weightPct.toFixed(1)}% of the book, over the ${capPct.toFixed(0)}% single-position cap.`,
      });
    }
  }
  for (const [ticker, s] of Object.entries(stocks)) {
    const t = trendRead(s.quote.value?.price ?? null, s.technicals.value);
    if (t.available >= 4 && t.score <= 1.7) {
      out.push({
        key: `trend-${ticker}`,
        tag: ticker,
        tone: 'warn',
        text: `${t.label} — only ${t.score.toFixed(1)} of 5 trend checks passing.`,
      });
    }
    const pc = s.options.value?.putCallVolume;
    if (pc != null && pc >= 1.0) {
      out.push({
        key: `opt-${ticker}`,
        tag: ticker,
        tone: 'warn',
        text: `Options flow reads bearish at a ${pc.toFixed(2)} put/call ratio.`,
      });
    }
  }
  if (out.length === 0) {
    out.push({ key: 'none', tag: 'Clear', tone: 'up', text: 'Nothing is breaching a constraint or flashing a trend break.' });
  }
  return out.slice(0, 8);
}
