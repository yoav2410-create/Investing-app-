import React, { useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Divider, Empty, Pill, Row, Screen, Section, Stat, Text } from '@/components/ui';
import { ConcentrationBar } from '@/components/charts';
import { InfoButton } from '@/components/InfoButton';
import { VERDICT_LABEL, VERDICT_TONE } from '@/components/StockRow';
import { useApp } from '@/data/store';
import { buildInsights, type BreadthInsight, type Coverage } from '@/domain/insights';
import { compactCurrency, longDate, percent, ratio, relativeAsOf, tone } from '@/domain/format';
import type { Tone } from '@/theme/tokens';

/**
 * The portfolio-level view.
 *
 * Deliberately split in two: the computed half is always present and always
 * honest, and Claude's read sits on top of it. If the API key is missing or the
 * call fails, everything below the first card still works — the numbers do not
 * depend on the model.
 */
export default function InsightsScreen() {
  const { palette, spacing } = useTheme();
  const holdings = useApp((s) => s.holdings);
  const stocks = useApp((s) => s.stocks);
  const plan = useApp((s) => s.plan);
  const cash = useApp((s) => s.cashUsd)();
  const nlv = useApp((s) => s.account)().netLiquidationValue;
  const read = useApp((s) => s.portfolioRead);
  const analysing = useApp((s) => s.analysingPortfolio);
  const analyse = useApp((s) => s.analysePortfolioNow);
  const [status, setStatus] = useState<string | null>(null);

  const i = useMemo(
    () => buildInsights(holdings, stocks, plan, cash, nlv),
    [holdings, stocks, plan, cash, nlv],
  );

  const run = async () => {
    setStatus(null);
    const res = await analyse();
    setStatus(res.ok ? null : res.message);
  };

  const severityTone: Record<'good' | 'watch' | 'risk', Tone> = {
    good: 'up',
    watch: 'warn',
    risk: 'down',
  };

  return (
    <Screen>
      {/* ------------------------------------------------- Claude's read --- */}
      <Section
        title="What Claude sees"
        subtitle={read ? `Written ${relativeAsOf(read.at)}` : 'Not run yet'}
        action={
          <Button
            label={analysing ? 'Reading…' : read ? 'Refresh' : 'Run analysis'}
            onPress={run}
            disabled={analysing}
            variant="quiet"
          />
        }
      >
        {analysing ? (
          <Card style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
            <ActivityIndicator color={palette.accent} />
            <Text variant="body" muted style={{ flex: 1 }}>
              Reading the whole book — concentration, what the positions have in common, and where
              the risk actually sits.
            </Text>
          </Card>
        ) : null}

        {status ? (
          <Card style={{ borderColor: palette.down }}>
            <Text variant="body" tone="down">
              {status}
            </Text>
          </Card>
        ) : null}

        {read ? (
          <Card style={{ gap: spacing.md }}>
            <Text variant="title">{read.result.headline}</Text>
            <Text variant="body">{read.result.whatThisBookIs}</Text>

            <Divider />

            {read.result.observations.map((o, n) => (
              <View key={n} style={{ gap: spacing.xs }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                  <Pill
                    label={o.severity === 'good' ? 'Working' : o.severity === 'watch' ? 'Watch' : 'Risk'}
                    tone={severityTone[o.severity]}
                    compact
                  />
                  <Text variant="heading" style={{ flexShrink: 1 }}>
                    {o.title}
                  </Text>
                </View>
                <Text variant="body" muted>
                  {o.detail}
                </Text>
                {o.tickers.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    {o.tickers.map((t) => (
                      <Link key={t} href={{ pathname: '/stock/[ticker]', params: { ticker: t } }} asChild>
                        <Text variant="caption" style={{ color: palette.accent }}>
                          {t}
                        </Text>
                      </Link>
                    ))}
                  </View>
                ) : null}
              </View>
            ))}

            {read.result.themeClusters.length ? (
              <>
                <Divider />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Text variant="label">Bets that move together</Text>
                  <InfoButton term="themeOverlap" size={14} />
                </View>
                {read.result.themeClusters.map((c, n) => (
                  <View key={n} style={{ gap: 2 }}>
                    <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Text variant="body">{c.theme}</Text>
                      {c.weightPct != null ? (
                        <Pill label={`${c.weightPct.toFixed(0)}% of book`} tone="warn" compact />
                      ) : null}
                    </View>
                    <Text variant="caption" muted>
                      {c.tickers.join(' · ')} — {c.why}
                    </Text>
                  </View>
                ))}
              </>
            ) : null}

            <Divider />
            <View style={{ gap: spacing.xs }}>
              <Pill label="Biggest risk" tone="down" compact />
              <Text variant="body">{read.result.biggestRisk}</Text>
            </View>
            <View style={{ gap: spacing.xs }}>
              <Pill label="Next" tone="accent" compact />
              <Text variant="body">{read.result.nextAction}</Text>
            </View>

            {read.result.blindSpots.length ? (
              <>
                <Divider />
                <Text variant="label" muted>
                  What this cannot tell you
                </Text>
                {read.result.blindSpots.map((b, n) => (
                  <Text key={n} variant="caption" faint>
                    • {b}
                  </Text>
                ))}
              </>
            ) : null}
          </Card>
        ) : !analysing ? (
          <Card>
            <Empty
              title="No portfolio read yet."
              detail="Everything below is computed from your positions and is always available. Run the analysis to have Claude read across it — what the book is actually betting on, which positions move together, and where the risk sits."
            />
          </Card>
        ) : null}
      </Section>

      {/* ------------------------------------------------------ computed --- */}
      <Section title="Concentration" term="concentration">
        <Card style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
            <Stat
              label="Largest position"
              value={i.concentration.topTicker ?? '—'}
              detail={`${i.concentration.topWeightPct.toFixed(1)}% of book`}
              tone={i.concentration.overCap.length ? 'down' : 'flat'}
              term="weight"
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Top 3"
              value={`${i.concentration.top3WeightPct.toFixed(1)}%`}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Top 5"
              value={`${i.concentration.top5WeightPct.toFixed(1)}%`}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Effective positions"
              value={i.concentration.effectivePositions.toFixed(1)}
              detail={`of ${i.concentration.positions} held`}
              term="hhi"
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
          </View>
          <Text variant="caption" muted>
            {i.concentration.positions} holdings, but concentration equivalent to{' '}
            {i.concentration.effectivePositions.toFixed(1)} equally sized ones — the outcome rests
            on fewer decisions than the position count suggests.
          </Text>
          {i.concentration.overCap.length ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
              <Ionicons name="alert-circle" size={16} color={palette.down} />
              <Text variant="caption" tone="down" style={{ flex: 1 }}>
                Over the {(plan.constraints.maxPositionPct * 100).toFixed(0)}% cap:{' '}
                {i.concentration.overCap.map((o) => `${o.ticker} ${o.weightPct.toFixed(1)}%`).join(', ')}
              </Text>
            </View>
          ) : null}
        </Card>
      </Section>

      <Section title="Market exposure">
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
            <Stat
              label="Weighted beta"
              value={ratio(i.beta.value)}
              detail={coverageDetail(i.beta.coverage)}
              tone={(i.beta.value ?? 1) > 1.2 ? 'warn' : 'flat'}
              term="portfolioBeta"
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Cash"
              value={`${i.cashPct.toFixed(1)}%`}
              detail={`floor ${i.cashFloorPct.toFixed(0)}%`}
              tone={i.cashHeadroomPct < 0 ? 'down' : 'up'}
              term="cashDrag"
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Weighted drawdown"
              value={percent(i.drawdown.value)}
              detail={coverageDetail(i.drawdown.coverage)}
              tone={tone(i.drawdown.value)}
              term="fromHigh"
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Weighted trend"
              value={i.trendScore.value == null ? '—' : `${i.trendScore.value.toFixed(1)}/5`}
              detail={coverageDetail(i.trendScore.coverage)}
              tone={(i.trendScore.value ?? 0) >= 3.5 ? 'up' : (i.trendScore.value ?? 0) <= 1.5 ? 'down' : 'flat'}
              term="trendScore"
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Weighted ROE"
              value={percent(i.quality.value, { sign: false, decimals: 1 })}
              detail={coverageDetail(i.quality.coverage)}
              term="returnOnEquity"
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Weighted leverage"
              value={ratio(i.leverage.value)}
              detail={coverageDetail(i.leverage.coverage)}
              tone={(i.leverage.value ?? 0) > 2.5 ? 'warn' : 'flat'}
              term="netDebtToEbitda"
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Weighted sentiment"
              value={i.sentiment.value == null ? '—' : i.sentiment.value.toFixed(2)}
              detail={coverageDetail(i.sentiment.coverage)}
              tone={tone(i.sentiment.value)}
              term="sentiment"
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Valuation percentile"
              value={
                i.valuationPercentile.value == null
                  ? '—'
                  : `${(i.valuationPercentile.value * 100).toFixed(0)}th`
              }
              detail="within own histories"
              tone={
                (i.valuationPercentile.value ?? 0.5) >= 0.67
                  ? 'down'
                  : (i.valuationPercentile.value ?? 0.5) <= 0.33
                    ? 'up'
                    : 'flat'
              }
              term="valuationBand"
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
          </View>
        </Card>
      </Section>

      <Section title="Breadth" term="breadth" subtitle="Is this happening to one name or to the book">
        <Card style={{ gap: spacing.lg }}>
          <BreadthRow
            title="Trend"
            buckets={[
              { key: 'up', label: 'Uptrend', tone: 'up' },
              { key: 'mixed', label: 'Mixed', tone: 'flat' },
              { key: 'down', label: 'Downtrend', tone: 'down' },
            ]}
            data={i.trendBreadth}
          />
          <BreadthRow
            title="Valuation against own history"
            buckets={[
              { key: 'cheap', label: 'Cheap', tone: 'up' },
              { key: 'fair', label: 'Fair', tone: 'flat' },
              { key: 'expensive', label: 'Expensive', tone: 'down' },
            ]}
            data={i.valueBreadth}
          />
          <BreadthRow
            title="Options flow"
            buckets={[
              { key: 'bullish', label: 'Bullish', tone: 'up' },
              { key: 'neutral', label: 'Neutral', tone: 'flat' },
              { key: 'bearish', label: 'Bearish', tone: 'down' },
            ]}
            data={i.flowBreadth}
          />
        </Card>
      </Section>

      <Section title="Event risk" term="earningsClustering" subtitle="Reporting in the next 30 days">
        <Card style={{ gap: spacing.sm }}>
          {i.earnings.upcoming.length === 0 ? (
            <Text variant="body" muted>
              Nothing in the book reports within 30 days.
            </Text>
          ) : (
            <>
              <Text variant="body">
                {i.earnings.upcoming.length} name
                {i.earnings.upcoming.length === 1 ? '' : 's'} covering{' '}
                {i.earnings.weightPct.toFixed(1)}% of the book report in the next 30 days
                {i.earnings.busiestWeekCount > 1
                  ? `, with ${i.earnings.busiestWeekCount} of them inside a single week`
                  : ''}
                .
              </Text>
              {i.earnings.upcoming.map((u) => (
                <Row
                  key={u.ticker}
                  label={u.ticker}
                  hint={longDate(u.date)}
                  value={`in ${u.days}d · ${u.weightPct.toFixed(1)}%`}
                  tone={u.days <= 7 ? 'warn' : undefined}
                />
              ))}
            </>
          )}
        </Card>
      </Section>

      <Section title="Sector drift">
        <Card style={{ gap: spacing.md }}>
          <ConcentrationBar
            slices={i.sectors
              .filter((s) => s.weightPct > 0)
              .map((s, n) => ({
                label: s.short,
                pct: s.weightPct,
                color: s.sector === 'cash' ? palette.flat : palette.series[n % palette.series.length]!,
              }))}
          />
          {i.drift.length === 0 ? (
            <Text variant="body" muted>
              Every sector is within three points of its target.
            </Text>
          ) : (
            i.drift.map((d) => (
              <Row
                key={d.sector}
                label={d.label}
                value={`${d.driftPct > 0 ? '+' : ''}${d.driftPct.toFixed(1)}pp`}
                tone={d.driftPct > 0 ? 'warn' : 'accent'}
                hint={d.driftPct > 0 ? 'above target' : 'below target'}
              />
            ))
          )}
        </Card>
      </Section>

      <Section title="What carries the book">
        <Card>
          {i.keyPositions.map((k) => (
            <Link key={k.ticker} href={{ pathname: '/stock/[ticker]', params: { ticker: k.ticker } }} asChild>
              <View>
                <Row
                  label={k.ticker}
                  hint={`${k.name} · trend ${k.trendScore.toFixed(1)}/5${k.valuationBand ? ` · ${k.valuationBand}` : ''}`}
                  value={`${k.weightPct.toFixed(1)}%  ${VERDICT_LABEL[k.verdict as keyof typeof VERDICT_LABEL]}`}
                  tone={VERDICT_TONE[k.verdict as keyof typeof VERDICT_TONE] as Tone}
                />
              </View>
            </Link>
          ))}
        </Card>
      </Section>

      {i.gaps.length ? (
        <Section title="How much to trust the above">
          <Card style={{ gap: spacing.xs }}>
            {i.gaps.map((g, n) => (
              <Text key={n} variant="caption" muted>
                • {g}
              </Text>
            ))}
            <Text variant="caption" faint style={{ marginTop: spacing.xs }}>
              Coverage improves as you research each holding — open a stock and tap Re-research.
            </Text>
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}

function coverageDetail(c: Coverage): string {
  if (c.total === 0) return 'no positions';
  if (c.available === c.total) return 'all positions';
  return `${c.available}/${c.total} · ${c.weightCoveredPct.toFixed(0)}% of book`;
}

function BreadthRow<T extends string>({
  title,
  buckets,
  data,
}: {
  title: string;
  buckets: { key: T; label: string; tone: Tone }[];
  data: BreadthInsight<T>;
}) {
  const { palette, spacing, radius } = useTheme();
  const total = buckets.reduce((s, b) => s + data.weights[b.key], 0);
  const spoken = buckets
    .map((b) => `${data.counts[b.key]} ${b.label.toLowerCase()}`)
    .join(', ');

  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text variant="label">{title}</Text>
        <Text variant="caption" faint>
          {coverageDetail(data.coverage)}
        </Text>
      </View>
      <View
        style={{ flexDirection: 'row', height: 20, borderRadius: radius.sm, overflow: 'hidden' }}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${title}: ${spoken}.`}
      >
        {buckets.map((b) => {
          const w = data.weights[b.key];
          if (w <= 0) return null;
          const c =
            b.tone === 'up' ? palette.up : b.tone === 'down' ? palette.down : palette.borderStrong;
          return <View key={b.key} style={{ flexGrow: w / (total || 1), backgroundColor: c }} />;
        })}
        {total === 0 ? <View style={{ flex: 1, backgroundColor: palette.cardMuted }} /> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
        {buckets.map((b) => (
          <Text key={b.key} variant="caption" muted>
            {b.label} {data.counts[b.key]}
            {data.weights[b.key] > 0 ? ` (${data.weights[b.key].toFixed(0)}%)` : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}
