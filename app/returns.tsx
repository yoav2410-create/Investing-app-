import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Link } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { Card, Row, Screen, Section, Stat, Text } from '@/components/ui';
import { useApp } from '@/data/store';
import { compactCurrency, currency, percent, tone } from '@/domain/format';
import { positionViews, sectorBuckets } from '@/domain/portfolio';

export default function ReturnsScreen() {
  const { palette, spacing } = useTheme();
  const holdings = useApp((s) => s.holdings);
  const stocks = useApp((s) => s.stocks);
  const plan = useApp((s) => s.plan);
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

  const totalCost = positions.reduce((s, p) => s + p.costValue, 0);
  const totalReturnPct = totalCost === 0 ? null : (account.unrealizedPnl / totalCost) * 100;

  const winners = positions
    .filter((p) => (p.unrealizedPnl ?? 0) > 0)
    .sort((a, b) => (b.unrealizedPnl ?? 0) - (a.unrealizedPnl ?? 0));
  const losers = positions
    .filter((p) => (p.unrealizedPnl ?? 0) < 0)
    .sort((a, b) => (a.unrealizedPnl ?? 0) - (b.unrealizedPnl ?? 0));

  return (
    <Screen>
      <Section title="Where the book stands">
        <Card>
          {/* flexBasis 40% pins the grid to two-up at every width — at 440pt a
              30% basis reflowed to three columns and orphaned the fourth stat
              alone on its own row. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
            <Stat
              label="Unrealised P&L" term="unrealizedPnl"
              value={compactCurrency(account.unrealizedPnl)}
              detail={totalReturnPct == null ? undefined : `${percent(totalReturnPct)} on cost`}
              tone={tone(account.unrealizedPnl)}
              style={{ flexBasis: '40%', flexGrow: 1 }}
            />
            {/* Realised P&L sat here — a seed constant the screenshot schema
                has no field for, so it could never move. Market value pairs
                with cost basis instead: the two numbers the unrealised line
                is literally the difference of. */}
            <Stat
              label="Market value" term="marketValue"
              value={compactCurrency(positions.reduce((s, p) => s + (p.marketValue ?? 0), 0))}
              style={{ flexBasis: '40%', flexGrow: 1 }}
            />
            <Stat
              label="Day P&L" term="dayPnl"
              value={compactCurrency(account.dayPnl)}
              detail={percent(account.dayPnlPct)}
              tone={tone(account.dayPnl)}
              style={{ flexBasis: '40%', flexGrow: 1 }}
            />
            <Stat label="Cost basis" value={compactCurrency(totalCost)} style={{ flexBasis: '40%', flexGrow: 1 }} />
          </View>
        </Card>
      </Section>

      {/* The daily attribution list sat here and answered a question the owner
          does not ask — who moved the book today. What they hold for years is
          the question of whether size and conviction line up with results. */}
      <Section
        title="Size against return"
        term="weight"
        subtitle="Is the money where the compounding is?"
      >
        <Card style={{ gap: spacing.xs }}>
          {(() => {
            const sized = positions
              .filter((p) => p.weightPct != null && p.unrealizedPnlPct != null)
              .sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0));
            if (sized.length < 2) {
              return (
                <Text variant="body" muted>
                  Not enough priced positions to compare size with return.
                </Text>
              );
            }
            const top = sized.slice(0, 3);
            const rest = sized.slice(3);
            const roc = (list: typeof sized) => {
              const cost = list.reduce((s, p) => s + p.costValue, 0);
              const pnl = list.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
              return cost === 0 ? null : (pnl / cost) * 100;
            };
            const topRoc = roc(top);
            const restRoc = roc(rest);
            return (
              <>
                {topRoc != null && restRoc != null ? (
                  <Text variant="body" style={{ marginBottom: spacing.sm }}>
                    The three largest positions return {percent(topRoc)} on cost; the rest of the
                    book returns {percent(restRoc)}.{' '}
                    {topRoc >= restRoc
                      ? 'The money is sitting where the compounding is.'
                      : 'The smaller names are out-compounding the size bets — worth knowing before adding to the top.'}
                  </Text>
                ) : null}
                {sized.map((p) => (
                  <Link
                    key={p.ticker}
                    href={{ pathname: '/stock/[ticker]', params: { ticker: p.ticker } }}
                    asChild
                  >
                    <View>
                      <Row
                        label={p.ticker}
                        hint={`${(p.weightPct ?? 0).toFixed(1)}% of the book`}
                        value={percent(p.unrealizedPnlPct)}
                        tone={tone(p.unrealizedPnlPct)}
                      />
                    </View>
                  </Link>
                ))}
              </>
            );
          })()}
        </Card>
      </Section>

      <Section title="Carrying the gains" term="unrealizedPnl">
        <Card>
          {winners.length === 0 ? (
            <Text variant="body" muted>
              Nothing showing an unrealised gain.
            </Text>
          ) : (
            winners.map((p) => (
              <Row
                key={p.ticker}
                label={p.ticker}
                hint={`${p.shares} sh at ${currency(p.shares === 0 ? null : p.costValue / p.shares)}`}
                value={`${compactCurrency(p.unrealizedPnl)}  ${percent(p.unrealizedPnlPct)}`}
                tone="up"
              />
            ))
          )}
        </Card>
      </Section>

      <Section title="Underwater" term="unrealizedPnl">
        <Card>
          {losers.length === 0 ? (
            <Text variant="body" muted>
              Nothing showing an unrealised loss.
            </Text>
          ) : (
            losers.map((p) => (
              <Row
                key={p.ticker}
                label={p.ticker}
                hint={`${p.shares} sh at ${currency(p.shares === 0 ? null : p.costValue / p.shares)}`}
                value={`${compactCurrency(p.unrealizedPnl)}  ${percent(p.unrealizedPnlPct)}`}
                tone="down"
              />
            ))
          )}
        </Card>
      </Section>

      <Section title="By sector">
        <Card>
          {buckets
            .filter((b) => b.sector !== 'cash')
            .map((b) => {
              const inBucket = positions.filter((p) => p.sector === b.sector);
              const pnl = inBucket.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
              const cost = inBucket.reduce((s, p) => s + p.costValue, 0);
              return (
                <Row
                  key={b.sector}
                  label={b.label}
                  hint={inBucket.map((p) => p.ticker).join(' · ') || 'nothing held'}
                  value={`${compactCurrency(pnl)}  ${cost === 0 ? '—' : percent((pnl / cost) * 100)}`}
                  tone={tone(pnl)}
                />
              );
            })}
        </Card>
      </Section>
    </Screen>
  );
}
