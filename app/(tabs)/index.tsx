import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Empty, Pill, Screen, Section, Stat, Text } from '@/components/ui';
import { DonutChart, Sparkline, VixCashChart } from '@/components/charts';
import { MonteCarloBlock } from '@/components/MonteCarloBlock';
import { StockRow } from '@/components/StockRow';
import { InfoButton } from '@/components/InfoButton';
import { useApp } from '@/data/store';
import { FX_TO_USD } from '@/data/seed';
import {
  compactCurrency,
  currency,
  percent,
  relativeAsOf,
  tone,
} from '@/domain/format';
import {
  capitalSplit,
  concentration,
  dividendIncome,
  positionViews,
  sectorBuckets,
  topMovers,
  yearGrowth,
} from '@/domain/portfolio';
import { resolveTargets } from '@/domain/allocation';
import { trendRead } from '@/domain/technicals';

export default function PortfolioScreen() {
  const router = useRouter();
  const { palette, spacing, radius } = useTheme();
  const holdings = useApp((s) => s.holdings);
  const stocks = useApp((s) => s.stocks);
  const plan = useApp((s) => s.plan);
  const portfolioRead = useApp((s) => s.portfolioRead);
  const snapshots = useApp((s) => s.snapshots);
  const staleNarratives = useApp((s) => s.staleNarratives);
  const researching = useApp((s) => s.researching);
  const researchQueue = useApp((s) => s.researchQueue);
  const account = useApp((s) => s.account)();
  const cash = useApp((s) => s.cashUsd)();
  const vix = useApp((s) => s.vix);
  const streamStatus = useApp((s) => s.streamStatus);

  const positions = useMemo(
    () => positionViews(holdings, stocks, account.netLiquidationValue),
    [holdings, stocks, account.netLiquidationValue],
  );
  // The same target resolution the Sectors screen uses, so the two screens
  // cannot describe the same book against different targets.
  const targets = useMemo(
    () =>
      resolveTargets(
        plan,
        portfolioRead ? { at: portfolioRead.at, stance: portfolioRead.result.allocation ?? null } : null,
      ),
    [plan, portfolioRead],
  );
  const buckets = useMemo(
    () =>
      sectorBuckets(
        positions,
        cash,
        account.netLiquidationValue,
        Object.fromEntries(Object.entries(targets.mix).map(([k, v]) => [k, v / 100])),
      ),
    [positions, cash, account.netLiquidationValue, targets.mix],
  );
  const movers = useMemo(() => topMovers(positions), [positions]);
  const conc = useMemo(() => concentration(positions), [positions]);
  const split = useMemo(
    () => capitalSplit(positions, cash, account.netLiquidationValue),
    [positions, cash, account.netLiquidationValue],
  );
  const growth = useMemo(() => yearGrowth(snapshots), [snapshots]);
  const income = useMemo(
    () => dividendIncome(positions, stocks, account.netLiquidationValue),
    [positions, stocks, account.netLiquidationValue],
  );
  const invested = useMemo(() => positions.reduce((s, p) => s + p.costValue, 0), [positions]);

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
      {/* ------------------------------------------------------- hero ---- */}
      <View
        style={{
          borderRadius: radius.lg,
          overflow: 'hidden',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border,
        }}
        accessible
        accessibilityLabel={`Net liquidation value ${currency(account.netLiquidationValue, { decimals: 0 })}, ${currency(account.dayPnl, { sign: true })} today.`}
      >
        <Svg
          width="100%"
          height="100%"
          style={StyleSheet.absoluteFill}
          preserveAspectRatio="none"
        >
          <Defs>
            <LinearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={palette.accentMuted} stopOpacity={1} />
              <Stop offset="1" stopColor={palette.card} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#hero)" />
        </Svg>
        <View style={{ padding: spacing.lg, gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <Text variant="caption" muted>
              Net liquidation value ·{' '}
              {streamStatus === 'open' ? 'streaming live' : `marks as of ${relativeAsOf(oldestQuote)}`}
            </Text>
            {streamStatus === 'open' ? (
              <View
                accessibilityLabel="Live trade stream connected"
                style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.up }}
              />
            ) : null}
            <InfoButton term="netLiquidationValue" size={13} />
          </View>
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
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button
          label="Update from screenshot"
          onPress={() => router.push('/sync')}
          accessibilityHint="Photograph your broker's positions screen and Claude will read it"
          style={{ flex: 1 }}
        />
        <Button
          label="AI insights"
          onPress={() => router.push('/insights')}
          variant="quiet"
          accessibilityHint="Claude's read across the whole portfolio"
          style={{ flex: 1 }}
        />
      </View>

      {researching.length || researchQueue.length ? (
        <Card style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <ActivityIndicator color={palette.accent} />
          <Text variant="caption" muted style={{ flex: 1 }}>
            Claude is researching {researching[0] ?? researchQueue[0]}
            {researchQueue.length ? ` · ${researchQueue.length} more queued` : ''} — latest results,
            what management said, and current coverage.
          </Text>
        </Card>
      ) : null}

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

      {/* Claude's read, surfaced where the owner actually starts. The computed
          headline above never depends on it; this card simply disappears when
          no read is on file rather than nagging for one. */}
      {portfolioRead ? (
        <Card style={{ gap: spacing.xs, borderColor: palette.accent }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Pill label="Claude" tone="accent" compact />
            <Text variant="caption" faint style={{ flex: 1 }}>
              Portfolio read · {relativeAsOf(portfolioRead.at)}
            </Text>
          </View>
          <Text variant="body">{portfolioRead.result.headline}</Text>
          <Text variant="caption" muted>
            {portfolioRead.result.nextAction}
          </Text>
          <Link href="/insights" asChild>
            <Button label="See the full read and what to change" onPress={() => {}} variant="quiet" />
          </Link>
        </Card>
      ) : null}

      <Section
        title="Allocation"
        term="concentration"
        subtitle={`Share of net liquidation value · targets: ${targets.source === 'manual' ? "Claude's" : 'bundled'} · tap for the breakdown`}
      >
        {/* The donut is the door to its own detail: the Sectors tab opens the
            same chart with every slice broken into its positions, in the same
            colours by construction. */}
        <Pressable
          onPress={() => router.push('/(tabs)/sectors')}
          accessibilityRole="button"
          accessibilityLabel="Allocation donut. Opens the sector breakdown with every position inside each slice."
          style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
        >
          <Card>
            <DonutChart
              slices={buckets
                .filter((b) => b.weightPct > 0)
                .map((b) => ({ sector: b.sector, label: b.short, pct: b.weightPct }))}
            />
          </Card>
        </Pressable>
      </Section>

      <Section title="The book" subtitle="Where the capital sits, and what it has done">
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
            <Stat
              label="Total value"
              term="netLiquidationValue"
              value={currency(account.netLiquidationValue, { decimals: 0 })}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="In equities"
              term="weight"
              value={`${split.equityPct.toFixed(1)}%`}
              detail={compactCurrency(account.marketValue)}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="In cash"
              term="cashFloor"
              value={`${split.cashPct.toFixed(1)}%`}
              detail={compactCurrency(cash)}
              tone={underFloor ? 'down' : 'up'}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="T-bill ETFs" term="tbillEtfs"
              value={split.cashLikePct > 0 ? `${split.cashLikePct.toFixed(1)}%` : '—'}
              detail={split.cashLikeTickers.length ? split.cashLikeTickers.join(', ') : 'none held'}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Unrealised P&L" term="unrealizedPnl"
              value={`${account.unrealizedPnl > 0 ? '+' : ''}${compactCurrency(account.unrealizedPnl)}`}
              tone={tone(account.unrealizedPnl)}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            {/* Realised P&L used to sit here — a seed constant no source can
                ever update, since the broker screenshot does not carry it.
                A number that can only ever be the demo's is worse than none.
                Return on cost is the honest neighbour: fully computable from
                the holdings on file. */}
            <Stat
              label="Return on cost"
              term="unrealizedPnl"
              value={
                invested > 0 && account.unrealizedPnl != null
                  ? percent((account.unrealizedPnl / invested) * 100, { decimals: 1 })
                  : '—'
              }
              detail={invested > 0 ? `on ${compactCurrency(invested)} invested` : 'no cost basis on file'}
              tone={tone(account.unrealizedPnl)}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Est. dividends / yr"
              term="dividendYield"
              value={income.annualUsd == null ? '—' : compactCurrency(income.annualUsd)}
              detail={
                income.annualUsd == null
                  ? 'no yields on file yet'
                  : `${income.weightedYieldPct!.toFixed(2)}% yield · covers ${income.coveragePct.toFixed(0)}% of the book`
              }
              tone={income.annualUsd != null && income.annualUsd > 0 ? 'up' : 'flat'}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Largest position" term="positionCap"
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

      <Section
        title="Growth"
        term="snapshot"
        subtitle="Year over year, from the daily snapshots"
      >
        <Card style={{ gap: spacing.sm }}>
          {growth.length === 0 ? (
            <Empty
              title="Not enough history yet."
              detail="A snapshot is taken every day the app prices the book. The first year-over-year bar appears once two snapshots exist; a completed year is measured end to end."
            />
          ) : (
            <>
              {growth.map((g) => (
                <View
                  key={g.label}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
                  accessible
                  accessibilityLabel={`${g.label}: ${g.changePct >= 0 ? 'up' : 'down'} ${Math.abs(g.changePct).toFixed(1)} percent, ending at ${compactCurrency(g.endValue)}.`}
                >
                  <Text variant="label" muted style={{ width: 74 }}>
                    {g.label}
                  </Text>
                  <View style={{ flex: 1, height: 18, justifyContent: 'center' }}>
                    <View
                      style={{
                        height: 18,
                        borderRadius: 5,
                        width: `${Math.min(100, Math.max(4, Math.abs(g.changePct) * 2.2))}%`,
                        backgroundColor: g.changePct >= 0 ? palette.up : palette.down,
                        alignSelf: 'flex-start',
                      }}
                    />
                  </View>
                  <Text variant="mono" tone={g.changePct >= 0 ? 'up' : 'down'} style={{ width: 62, textAlign: 'right' }}>
                    {percent(g.changePct, { decimals: 1 })}
                  </Text>
                </View>
              ))}
              <Text variant="caption" faint>
                Each bar is the change in net liquidation value over that year; the running year is
                measured from its earliest snapshot, so it understates rather than extrapolates.
              </Text>
            </>
          )}
        </Card>
      </Section>

      {/* Cash against fear: the ladder chart only — the methodology and its
          contrarian logic live behind the "?", per the owner's spec. */}
      <Section title="Cash vs fear" term="vixCashLevels" subtitle="The VIX, its regimes, and where we are">
        <Card style={{ borderColor: underFloor ? palette.down : palette.border, gap: spacing.sm }}>
          {underFloor ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Ionicons name="alert-circle" size={18} color={palette.down} />
              <Text variant="label" tone="down" style={{ flex: 1 }}>
                Cash is {(floorPct - cashPct).toFixed(1)} points under the {floorPct.toFixed(0)}% floor
              </Text>
            </View>
          ) : null}
          {vix ? (
            <VixCashChart series={vix.series} last={vix.last} />
          ) : (
            <Text variant="caption" faint>
              No VIX history on file yet — it arrives with the next scheduled feed.
            </Text>
          )}
          {underFloor ? (
            <Link href="/insights" asChild>
              <Button label="See what to change" onPress={() => {}} variant="quiet" />
            </Link>
          ) : null}
        </Card>
      </Section>

      <MonteCarloBlock />

      {snapshots.length > 1 ? (
        <Section title="Value over time" term="snapshot" subtitle={`${snapshots.length} daily snapshots`}>
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

      <Section title="Today's movers" term="topMovers">
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

      <Section title="Needs attention" term="needsAttention">
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
    if (s.sentiment.value?.insiderActivity === 'selling') {
      out.push({
        key: `insider-${ticker}`,
        tag: ticker,
        tone: 'warn',
        text: `Insider filings read as net selling. ${s.sentiment.value.insiderDetail ?? ''}`.trim(),
      });
    }
  }
  if (out.length === 0) {
    out.push({ key: 'none', tag: 'Clear', tone: 'up', text: 'Nothing is breaching a constraint or flashing a trend break.' });
  }
  return out.slice(0, 8);
}
