import React, { useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Divider, Empty, Pill, Row, Screen, Section, Stat, Text } from '@/components/ui';
import { BarChart, LineChart, MaDistanceChart, RangeMeter } from '@/components/charts';
import { VERDICT_LABEL, VERDICT_TONE } from '@/components/StockRow';
import { useApp } from '@/data/store';
import {
  compactCurrency,
  currency,
  daysUntil,
  longDate,
  multiple,
  percent,
  ratio,
  relativeAsOf,
  shares as fmtShares,
  tone,
} from '@/domain/format';
import { trendLabelTone, trendRead } from '@/domain/technicals';
import { bandLabel, bandTone, valuationRead } from '@/domain/valuation';
import { optionsRead, optionsSentence, readTone } from '@/domain/options';
import { legsForTicker, actionLabel, actionTone } from '@/domain/plan';
import type { Stock } from '@/domain/types';

export default function StockDetailScreen() {
  const { ticker: raw } = useLocalSearchParams<{ ticker: string }>();
  const ticker = String(raw ?? '').toUpperCase();
  const { palette, spacing } = useTheme();

  const stock = useApp((s) => s.stocks[ticker]);
  const holding = useApp((s) => s.holdings.find((h) => h.ticker === ticker));
  const plan = useApp((s) => s.plan);
  const nlv = useApp((s) => s.account)().netLiquidationValue;
  const researching = useApp((s) => s.researching.includes(ticker));
  const researchTicker = useApp((s) => s.researchTicker);
  const staleNarrative = useApp((s) => s.staleNarratives.includes(ticker));
  const [status, setStatus] = useState<string | null>(null);

  if (!stock) {
    return (
      <Screen>
        <Stack.Screen options={{ title: ticker }} />
        <Empty title={`${ticker} is not in the book.`} detail="Import a screenshot that includes it, or add it in Settings." />
      </Screen>
    );
  }

  const quote = stock.quote.value;
  const val = valuationRead(stock);
  const trend = trendRead(quote?.price ?? null, stock.technicals.value);
  const legs = legsForTicker(plan, ticker);
  const marketValue = holding && quote ? holding.shares * quote.price : null;
  const weightPct = marketValue != null && nlv > 0 ? (marketValue / nlv) * 100 : null;
  const unrealized = holding && quote ? (quote.price - holding.costBasis) * holding.shares : null;

  const research = async () => {
    setStatus('Researching with Claude…');
    const res = await researchTicker(ticker);
    setStatus(res.message);
  };

  const share = async () => {
    const text = buildBrief(stock, holding?.shares ?? null, weightPct);
    try {
      const dir = FileSystem.Paths.cache;
      const file = new FileSystem.File(dir, `${ticker}-brief.txt`);
      file.write(text);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', dialogTitle: `${ticker} brief` });
      } else {
        setStatus('Sharing is not available on this device.');
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not share this brief.');
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: stock.ticker }} />

      {/* ---------------------------------------------------------- header */}
      <View style={{ gap: spacing.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Text variant="title">{stock.name}</Text>
          {stock.isEtf ? <Pill label="ETF" tone="flat" compact /> : null}
          {stock.watchlistOnly ? <Pill label="Watchlist" tone="accent" compact /> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.md }}>
          <Text variant="display" style={{ fontVariant: ['tabular-nums'] }}>
            {quote ? currency(quote.price) : '—'}
          </Text>
          {quote ? (
            <Text variant="heading" tone={tone(quote.changePct)}>
              {percent(quote.changePct)}
            </Text>
          ) : null}
        </View>
        <Text variant="caption" faint>
          Mark as of {relativeAsOf(stock.quote.asOf)}
          {stock.quote.source === 'manual' ? ' · read from your screenshot' : ''}
          {stock.quote.source === 'seed' ? ' · seed data' : ''}
        </Text>
      </View>

      {holding ? (
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
            <Stat label="Shares" value={fmtShares(holding.shares)} style={{ flexBasis: '28%', flexGrow: 1 }} />
            <Stat label="Market value" value={compactCurrency(marketValue)} style={{ flexBasis: '28%', flexGrow: 1 }} />
            <Stat
              label="Unrealised"
              value={compactCurrency(unrealized)}
              detail={
                unrealized != null && holding.costBasis > 0
                  ? percent(((quote?.price ?? 0) / holding.costBasis - 1) * 100)
                  : undefined
              }
              tone={tone(unrealized)}
              style={{ flexBasis: '28%', flexGrow: 1 }}
            />
            <Stat label="Avg cost" value={currency(holding.costBasis)} style={{ flexBasis: '28%', flexGrow: 1 }} />
            <Stat
              label="Weight"
              value={weightPct == null ? '—' : `${weightPct.toFixed(1)}%`}
              detail={`cap ${(plan.constraints.maxPositionPct * 100).toFixed(0)}%`}
              tone={weightPct != null && weightPct > plan.constraints.maxPositionPct * 100 ? 'down' : 'flat'}
              style={{ flexBasis: '28%', flexGrow: 1 }}
            />
          </View>
        </Card>
      ) : null}

      {/* --------------------------------------------------------- verdict */}
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Pill
            label={VERDICT_LABEL[stock.narrative.verdict]}
            tone={VERDICT_TONE[stock.narrative.verdict]}
          />
          <Text variant="caption" faint style={{ flex: 1 }}>
            Written {relativeAsOf(stock.narrativeAsOf)}
          </Text>
        </View>
        {stock.narrative.verdictReasoning ? (
          <Text variant="body">{stock.narrative.verdictReasoning}</Text>
        ) : (
          <Text variant="body" muted>
            No verdict written yet. Tap Re-research to have Claude work this name up.
          </Text>
        )}
        {staleNarrative ? (
          <Text variant="caption" tone="warn">
            This name has reported since the write-up — the reasoning above predates the latest
            quarter.
          </Text>
        ) : null}
      </Card>

      {/* ------------------------------------------------------- valuation */}
      <Section title="Valuation" subtitle={val.rationale}>
        <Card style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Text variant="title" style={{ fontVariant: ['tabular-nums'] }}>
              {val.current == null ? '—' : multiple(val.current)}
            </Text>
            <Text variant="label" muted>
              {val.label}
            </Text>
            <Pill label={bandLabel(val.band)} tone={bandTone(val.band)} compact />
          </View>

          <Text variant="body">{val.sentence}</Text>

          {val.historyLow != null && val.historyHigh != null && val.current != null ? (
            <RangeMeter
              low={val.historyLow}
              high={val.historyHigh}
              current={val.current}
              format={(v) => multiple(v)}
              label={`${val.label} against its own ${val.sampleSize}-quarter range`}
            />
          ) : null}

          {val.sampleSize > 0 && val.sampleSize < 6 ? (
            <Text variant="caption" tone="warn">
              Only {val.sampleSize} quarters of history behind that band — treat it as directional.
            </Text>
          ) : null}

          <Divider />

          <View style={{ gap: 0 }}>
            <Row label="Trailing P/E" value={ratio(stock.valuation.value?.trailingPe, 1)} />
            <Row label="Forward P/E" value={ratio(stock.valuation.value?.forwardPe, 1)} />
            <Row label="EV / EBITDA" value={ratio(stock.valuation.value?.evToEbitda, 1)} />
            <Row label="Price / sales" value={ratio(stock.valuation.value?.priceToSales, 1)} />
            <Row label="PEG" value={ratio(stock.valuation.value?.peg, 2)} />
            <Row
              label="Profit margin"
              value={percent(stock.valuation.value?.profitMargin, { sign: false, decimals: 1 })}
            />
            <Row
              label="Operating margin"
              value={percent(stock.valuation.value?.operatingMargin, { sign: false, decimals: 1 })}
            />
            <Row
              label="Debt / equity"
              value={ratio(stock.valuation.value?.debtToEquity, 2)}
              hint={
                (stock.valuation.value?.debtToEquity ?? 0) < 0
                  ? 'Negative — shareholder equity is negative, so this ratio is not comparable'
                  : undefined
              }
            />
            <Row label="Beta" value={ratio(stock.valuation.value?.beta, 2)} />
            <Row
              label="Short interest"
              value={percent(stock.valuation.value?.shortInterestPct, { sign: false, decimals: 1 })}
              hint={stock.valuation.value?.shortInterestPct == null ? 'No source wired up for this field' : undefined}
            />
            <Row
              label="Dividend yield"
              value={percent(stock.valuation.value?.dividendYield, { sign: false, decimals: 2 })}
            />
            <Row
              label="Analyst target"
              value={currency(stock.valuation.value?.analystTargetPrice)}
              hint={stock.valuation.value?.analystRating ?? undefined}
              tone={
                stock.valuation.value?.analystTargetPrice != null && quote
                  ? stock.valuation.value.analystTargetPrice >= quote.price
                    ? 'up'
                    : 'down'
                  : undefined
              }
            />
            <Row
              label="52-week range"
              value={`${currency(stock.valuation.value?.week52Low)} – ${currency(stock.valuation.value?.week52High)}`}
            />
            <Row
              label="52-week change"
              value={percent(stock.valuation.value?.week52ChangePct)}
              tone={tone(stock.valuation.value?.week52ChangePct)}
            />
          </View>
        </Card>
      </Section>

      {/* ----------------------------------------------------------- trend */}
      <Section title="Trend" subtitle={`${trend.available} of 6 checks measurable`}>
        <Card style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text variant="title" style={{ fontVariant: ['tabular-nums'] }}>
              {trend.score.toFixed(1)}
              <Text variant="body" muted>
                {' '}/ 5
              </Text>
            </Text>
            <Pill label={trend.label} tone={trendLabelTone(trend.label)} />
          </View>

          <MaDistanceChart
            price={quote?.price ?? null}
            averages={[
              { label: '20-day', value: stock.technicals.value?.sma20 ?? null },
              { label: '50-day', value: stock.technicals.value?.sma50 ?? null },
              { label: '100-day', value: stock.technicals.value?.sma100 ?? null },
              { label: '200-day', value: stock.technicals.value?.sma200 ?? null },
            ]}
          />

          <Divider />
          <View>
            {trend.checks.map((c) => (
              <Row
                key={c.label}
                label={c.label}
                value={c.passed == null ? '—' : c.passed ? `✓ ${c.detail}` : `✗ ${c.detail}`}
                tone={c.passed == null ? undefined : c.passed ? 'up' : 'down'}
              />
            ))}
          </View>
          <Text variant="caption" faint>
            Technicals as of {relativeAsOf(stock.technicals.asOf)}.
          </Text>
        </Card>
      </Section>

      {/* --------------------------------------------------------- quality */}
      {stock.quality.value ? (
        <Section title="Business quality" subtitle="Is this a good business, separate from its price">
          <Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
              <Stat label="Return on equity" value={percent(stock.quality.value.returnOnEquity, { sign: false, decimals: 1 })} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat label="ROIC" value={percent(stock.quality.value.returnOnInvestedCapital, { sign: false, decimals: 1 })} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat label="Gross margin" value={percent(stock.quality.value.grossMargin, { sign: false, decimals: 1 })} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat label="FCF margin" value={percent(stock.quality.value.freeCashFlowMargin, { sign: false, decimals: 1 })} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat
                label="Net debt / EBITDA"
                value={ratio(stock.quality.value.netDebtToEbitda, 2)}
                detail={(stock.quality.value.netDebtToEbitda ?? 0) < 0 ? 'net cash' : undefined}
                tone={(stock.quality.value.netDebtToEbitda ?? 0) > 3 ? 'down' : 'flat'}
                style={{ flexBasis: '28%', flexGrow: 1 }}
              />
              <Stat label="Revenue CAGR 3y" value={percent(stock.quality.value.revenueCagr3y, { decimals: 1 })} tone={tone(stock.quality.value.revenueCagr3y)} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat label="Revenue YoY" value={percent(stock.quality.value.revenueGrowthYoY, { decimals: 1 })} tone={tone(stock.quality.value.revenueGrowthYoY)} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat label="EPS YoY" value={percent(stock.quality.value.epsGrowthYoY, { decimals: 1 })} tone={tone(stock.quality.value.epsGrowthYoY)} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat
                label="Share count YoY"
                value={percent(stock.quality.value.shareCountChangePct, { decimals: 1 })}
                detail={(stock.quality.value.shareCountChangePct ?? 0) < 0 ? 'buying back' : 'diluting'}
                tone={(stock.quality.value.shareCountChangePct ?? 0) < 0 ? 'up' : 'down'}
                style={{ flexBasis: '28%', flexGrow: 1 }}
              />
              <Stat label="Institutional" value={percent(stock.quality.value.institutionalOwnershipPct, { sign: false, decimals: 1 })} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat label="Insider" value={percent(stock.quality.value.insiderOwnershipPct, { sign: false, decimals: 2 })} style={{ flexBasis: '28%', flexGrow: 1 }} />
            </View>
          </Card>
        </Section>
      ) : null}

      {/* -------------------------------------------------------- momentum */}
      {stock.momentum.value ? (
        <Section title="Momentum">
          <Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
              <Stat label="1 month" value={percent(stock.momentum.value.oneMonth)} tone={tone(stock.momentum.value.oneMonth)} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat label="3 month" value={percent(stock.momentum.value.threeMonth)} tone={tone(stock.momentum.value.threeMonth)} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat label="6 month" value={percent(stock.momentum.value.sixMonth)} tone={tone(stock.momentum.value.sixMonth)} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat label="1 year" value={percent(stock.momentum.value.oneYear)} tone={tone(stock.momentum.value.oneYear)} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat label="Year to date" value={percent(stock.momentum.value.yearToDate)} tone={tone(stock.momentum.value.yearToDate)} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat
                label="From 52w high"
                value={percent(stock.momentum.value.fromHighPct)}
                tone={tone(stock.momentum.value.fromHighPct)}
                style={{ flexBasis: '28%', flexGrow: 1 }}
              />
              <Stat
                label="Above 52w low"
                value={percent(stock.momentum.value.fromLowPct)}
                tone={tone(stock.momentum.value.fromLowPct)}
                style={{ flexBasis: '28%', flexGrow: 1 }}
              />
            </View>
          </Card>
        </Section>
      ) : null}

      {/* --------------------------------------------------------- options */}
      <Section title="Options positioning">
        <Card style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Pill
              label={
                optionsRead(stock.options.value?.putCallVolume ?? null)?.toUpperCase() ?? 'NO DATA'
              }
              tone={readTone(optionsRead(stock.options.value?.putCallVolume ?? null))}
            />
            <Text variant="caption" faint style={{ flex: 1 }}>
              as of {relativeAsOf(stock.options.asOf)}
            </Text>
          </View>
          <Text variant="body">{optionsSentence(stock.options.value)}</Text>
          <Row label="Put/call by volume" value={ratio(stock.options.value?.putCallVolume)} />
          <Row label="Put/call by open interest" value={ratio(stock.options.value?.putCallOpenInterest)} />
          <Text variant="caption" faint>
            Reading the source's own convention: at or below 0.70 is bullish, at or above 1.00 is
            bearish.
          </Text>
        </Card>
      </Section>

      {/* -------------------------------------------------------- earnings */}
      <Section
        title="Latest earnings call"
        subtitle={
          stock.nextEarningsDate
            ? `Next report ${longDate(stock.nextEarningsDate)}${
                daysUntil(stock.nextEarningsDate) != null
                  ? ` · in ${daysUntil(stock.nextEarningsDate)} days`
                  : ''
              }`
            : undefined
        }
      >
        <Card style={{ gap: spacing.sm }}>
          {stock.earnings.value?.date ? (
            <>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
                <Text variant="heading">{stock.earnings.value.quarter}</Text>
                <Text variant="caption" muted>
                  reported {longDate(stock.earnings.value.date)}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
                <Stat label="Revenue" value={compactCurrency(stock.earnings.value.revenue)} style={{ flexBasis: '28%', flexGrow: 1 }} />
                <Stat label="EPS" value={currency(stock.earnings.value.reportedEps)} style={{ flexBasis: '28%', flexGrow: 1 }} />
                <Stat label="Consensus" value={currency(stock.earnings.value.estimatedEps)} style={{ flexBasis: '28%', flexGrow: 1 }} />
                <Stat
                  label="Surprise"
                  value={percent(stock.earnings.value.surprisePct, { decimals: 1 })}
                  tone={tone(stock.earnings.value.surprisePct)}
                  style={{ flexBasis: '28%', flexGrow: 1 }}
                />
              </View>
              {stock.earnings.value.managementSaid ? (
                <>
                  <Divider />
                  <Text variant="label" muted>
                    What management said
                  </Text>
                  <Text variant="body">{stock.earnings.value.managementSaid}</Text>
                </>
              ) : null}
              {stock.earnings.value.guidance ? (
                <>
                  <Text variant="label" muted>
                    Guidance
                  </Text>
                  <Text variant="body">{stock.earnings.value.guidance}</Text>
                </>
              ) : null}
              {stock.earnings.value.watchNext ? (
                <>
                  <Text variant="label" muted>
                    What to watch next call
                  </Text>
                  <Text variant="body">{stock.earnings.value.watchNext}</Text>
                </>
              ) : null}
            </>
          ) : (
            <Empty
              title={stock.isEtf ? 'An ETF does not report earnings.' : 'No earnings call on file yet.'}
              detail={stock.isEtf ? undefined : 'Tap Re-research to have Claude pull the latest quarter.'}
            />
          )}
        </Card>
      </Section>

      {/* ---------------------------------------------------------- charts */}
      <Section title="Fundamentals" subtitle="Eight quarters, newest on the right">
        <Card style={{ gap: spacing.xl }}>
          <View style={{ gap: spacing.sm }}>
            <Text variant="label">Revenue</Text>
            <BarChart
              points={stock.fundamentals.value?.revenue ?? []}
              format={(v) => compactCurrency(v)}
              title="Revenue"
              tone="accent"
            />
          </View>
          <View style={{ gap: spacing.sm }}>
            <Text variant="label">Operating income</Text>
            <BarChart
              points={stock.fundamentals.value?.operatingIncome ?? []}
              format={(v) => compactCurrency(v)}
              title="Operating income"
              tone="up"
            />
          </View>
          <View style={{ gap: spacing.sm }}>
            <Text variant="label">Net income</Text>
            <BarChart
              points={stock.fundamentals.value?.netIncome ?? []}
              format={(v) => compactCurrency(v)}
              title="Net income"
              tone="up"
            />
          </View>
          <View style={{ gap: spacing.sm }}>
            <Text variant="label">Diluted EPS</Text>
            <LineChart
              points={stock.fundamentals.value?.eps ?? []}
              format={(v) => currency(v)}
              title="EPS"
              tone="accent"
            />
          </View>
        </Card>
      </Section>

      <Section title="Multiple history" subtitle="Ten quarters, with today marked">
        <Card style={{ gap: spacing.xl }}>
          <View style={{ gap: spacing.sm }}>
            <Text variant="label">Trailing P/E</Text>
            <LineChart
              points={stock.multipleHistory.value?.peHistory ?? []}
              format={(v) => multiple(v)}
              title="Trailing P/E"
              tone="accent"
              marker={
                stock.valuation.value?.trailingPe != null
                  ? { value: stock.valuation.value.trailingPe, label: 'now' }
                  : null
              }
            />
          </View>
          <View style={{ gap: spacing.sm }}>
            <Text variant="label">EV / EBITDA</Text>
            <LineChart
              points={stock.multipleHistory.value?.evEbitdaHistory ?? []}
              format={(v) => multiple(v)}
              title="EV to EBITDA"
              tone="warn"
              marker={
                stock.valuation.value?.evToEbitda != null
                  ? { value: stock.valuation.value.evToEbitda, label: 'now' }
                  : null
              }
            />
          </View>
          <View style={{ gap: spacing.sm }}>
            <Text variant="label">Price / sales</Text>
            <LineChart
              points={stock.multipleHistory.value?.psHistory ?? []}
              format={(v) => multiple(v)}
              title="Price to sales"
              tone="down"
              marker={
                stock.valuation.value?.priceToSales != null
                  ? { value: stock.valuation.value.priceToSales, label: 'now' }
                  : null
              }
            />
          </View>
        </Card>
      </Section>

      {/* ------------------------------------------------------- narrative */}
      <Section title="The case">
        <Card style={{ gap: spacing.md }}>
          {stock.narrative.catalyst ? (
            <Field label="Catalyst" tone="up" text={stock.narrative.catalyst} />
          ) : null}
          {stock.narrative.risk ? (
            <Field label="Key risk" tone="down" text={stock.narrative.risk} />
          ) : null}
          {stock.narrative.bullCase ? (
            <Field label="Bull case" tone="up" text={stock.narrative.bullCase} />
          ) : null}
          {stock.narrative.bearCase ? (
            <Field label="Bear case" tone="down" text={stock.narrative.bearCase} />
          ) : null}
          {stock.narrative.whatWouldChangeMyMind ? (
            <Field
              label="What would change the verdict"
              tone="accent"
              text={stock.narrative.whatWouldChangeMyMind}
            />
          ) : null}
          {!stock.narrative.catalyst && !stock.narrative.risk ? (
            <Empty title="Nothing written up for this name yet." />
          ) : null}
        </Card>
      </Section>

      {/* ------------------------------------------------------------ plan */}
      {legs.length ? (
        <Section title="In the plan">
          <Card style={{ gap: spacing.sm }}>
            {legs.map((l) => (
              <View key={l.id} style={{ gap: 2 }}>
                <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                  <Pill label={`Tranche ${l.tranche}`} tone="flat" compact />
                  <Pill label={actionLabel(l.action)} tone={actionTone(l.action)} compact />
                  {l.shares != null ? (
                    <Text variant="caption" muted>
                      {fmtShares(l.shares)} sh
                    </Text>
                  ) : null}
                  {l.done ? <Pill label="Done" tone="up" compact /> : null}
                </View>
                <Text variant="caption" muted>
                  {l.note}
                </Text>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {/* ----------------------------------------------------- provenance */}
      <Section title="Where these numbers came from">
        <Card>
          <Row label="Price" value={sourceLabel(stock, 'quote')} hint={relativeAsOf(stock.quote.asOf)} />
          <Row label="Valuation" value={sourceLabel(stock, 'valuation')} hint={relativeAsOf(stock.valuation.asOf)} />
          <Row label="Technicals" value={sourceLabel(stock, 'technicals')} hint={relativeAsOf(stock.technicals.asOf)} />
          <Row label="Options" value={sourceLabel(stock, 'options')} hint={relativeAsOf(stock.options.asOf)} />
          <Row label="Reported figures" value={sourceLabel(stock, 'fundamentals')} hint={relativeAsOf(stock.fundamentals.asOf)} />
          <Row label="Multiple history" value={sourceLabel(stock, 'multipleHistory')} hint={relativeAsOf(stock.multipleHistory.asOf)} />
          <Row label="Earnings" value={sourceLabel(stock, 'earnings')} hint={relativeAsOf(stock.earnings.asOf)} />
        </Card>
      </Section>

      <View style={{ gap: spacing.sm }}>
        <Button
          label={researching ? 'Researching…' : 'Re-research with Claude'}
          onPress={research}
          disabled={researching}
          accessibilityHint="Asks Claude to refresh the figures and the write-up for this stock"
        />
        <Button label="Share this brief" onPress={share} variant="quiet" />
        {researching ? <ActivityIndicator color={palette.accent} /> : null}
        {status ? (
          <Text variant="caption" muted>
            {status}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

function Field({ label, tone, text }: { label: string; tone: 'up' | 'down' | 'accent'; text: string }) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Pill label={label} tone={tone} compact />
      <Text variant="body">{text}</Text>
    </View>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  alphavantage: 'Alpha Vantage',
  computed: 'Computed in-app',
  seed: 'Seed data',
  manual: 'Claude',
  unavailable: 'Not available',
};

function sourceLabel(
  stock: Stock,
  key: 'quote' | 'valuation' | 'technicals' | 'options' | 'fundamentals' | 'multipleHistory' | 'earnings',
): string {
  return SOURCE_LABEL[stock[key].source] ?? stock[key].source;
}

function buildBrief(stock: Stock, shares: number | null, weightPct: number | null): string {
  const val = valuationRead(stock);
  const trend = trendRead(stock.quote.value?.price ?? null, stock.technicals.value);
  const lines = [
    `${stock.ticker} — ${stock.name}`,
    `Price ${currency(stock.quote.value?.price)} (${percent(stock.quote.value?.changePct)})`,
    shares != null
      ? `Position ${fmtShares(shares)} shares${weightPct != null ? `, ${weightPct.toFixed(1)}% of book` : ''}`
      : 'Watchlist only',
    '',
    `Verdict: ${VERDICT_LABEL[stock.narrative.verdict]}`,
    stock.narrative.verdictReasoning ?? '',
    '',
    `Valuation: ${val.sentence}`,
    `Trend: ${trend.label}, ${trend.score.toFixed(1)}/5`,
    `Options: ${optionsSentence(stock.options.value)}`,
    '',
    stock.narrative.catalyst ? `Catalyst: ${stock.narrative.catalyst}` : '',
    stock.narrative.risk ? `Risk: ${stock.narrative.risk}` : '',
    stock.narrative.whatWouldChangeMyMind
      ? `Would change the verdict: ${stock.narrative.whatWouldChangeMyMind}`
      : '',
    '',
    `Prices as of ${relativeAsOf(stock.quote.asOf)}. Generated by Portfolio Brief.`,
  ];
  return lines.filter((l) => l !== undefined).join('\n');
}
