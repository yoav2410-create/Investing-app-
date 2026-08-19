import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Link } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { Card, Row, Screen, Section, Stat, Text } from '@/components/ui';
import { useApp } from '@/data/store';
import { compactCurrency, currency, percent, tone } from '@/domain/format';
import { attribution, positionViews, sectorBuckets } from '@/domain/portfolio';

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
  const rows = useMemo(() => attribution(positions), [positions]);
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
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
            <Stat
              label="Unrealised P&L"
              value={compactCurrency(account.unrealizedPnl)}
              detail={totalReturnPct == null ? undefined : `${percent(totalReturnPct)} on cost`}
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
              label="Day P&L"
              value={compactCurrency(account.dayPnl)}
              detail={percent(account.dayPnlPct)}
              tone={tone(account.dayPnl)}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat label="Cost basis" value={compactCurrency(totalCost)} style={{ flexBasis: '30%', flexGrow: 1 }} />
          </View>
        </Card>
      </Section>

      <Section title="Today's attribution" subtitle="Who actually moved the number">
        <Card>
          {rows.every((r) => r.contribution === 0) ? (
            <Text variant="body" muted>
              No day moves recorded. Import a screenshot to set today's marks.
            </Text>
          ) : (
            rows
              .filter((r) => r.contribution !== 0)
              .map((r) => (
                <Link key={r.ticker} href={{ pathname: '/stock/[ticker]', params: { ticker: r.ticker } }} asChild>
                  <View>
                    <Row
                      label={r.ticker}
                      hint={`${r.sharePct.toFixed(0)}% of today's total move`}
                      value={currency(r.contribution, { sign: true })}
                      tone={tone(r.contribution)}
                    />
                  </View>
                </Link>
              ))
          )}
        </Card>
      </Section>

      <Section title="Carrying the gains">
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

      <Section title="Underwater">
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
