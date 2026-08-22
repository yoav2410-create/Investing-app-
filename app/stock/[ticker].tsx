import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { useTheme } from '@/theme/ThemeProvider';
import {
  Button,
  Card,
  Divider,
  Empty,
  Label,
  Pill,
  Row,
  Screen,
  Section,
  SegmentedTabs,
  Skeleton,
  Stat,
  Text,
} from '@/components/ui';
import { SearchOverlay } from '@/components/SearchOverlay';
import { BarChart, GroupedBarChart, LineChart, MaDistanceChart, RangeMeter, WaterfallChart } from '@/components/charts';
import { VERDICT_LABEL, VERDICT_TONE } from '@/components/StockRow';
import { InfoButton } from '@/components/InfoButton';
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
import { stanceMoveKey } from '@/domain/allocation';
import { buildBridge, conversionTone, fcfYield } from '@/domain/cashflow';
import type { QuarterPoint, Stock } from '@/domain/types';
import type { GlossaryKey } from '@/domain/glossary';
import type { PrimaryMultiple } from '@/domain/types';

/**
 * Which explainer belongs with a trend check. Typed rather than inlined so a
 * wrong key is a compile error instead of a "?" that silently opens nothing.
 */
function trendCheckTerm(label: string): GlossaryKey {
  if (label.startsWith('RSI')) return 'rsi';
  if (label.startsWith('+DI')) return 'directionalIndicators';
  return 'movingAverage';
}

/**
 * Quarterly points as-is, or rolled up: every complete calendar year in the
 * data, plus the trailing twelve months.
 *
 * "Complete" is load-bearing. A year holding three quarters is not a smaller
 * year, it is an unknown one, and a bar quietly covering nine months next to
 * bars covering twelve would be the invented number this app exists not to
 * show. Such a year is left out rather than drawn short.
 *
 * Points arrive newest-first and the charts reverse them, so TTM is built
 * first and the years follow in descending order.
 */
function finSeries(
  pts: QuarterPoint[] | null | undefined,
  period: 'quarterly' | 'annual',
): QuarterPoint[] {
  const list = pts ?? [];
  if (period === 'quarterly') return list;

  const sum = (qs: QuarterPoint[]): number | null => {
    const vals = qs.map((q) => q.value);
    return vals.every((v) => v != null) ? vals.reduce((s, v) => s + (v ?? 0), 0) : null;
  };

  const out: QuarterPoint[] = [];
  const ttm = list.slice(0, 4);
  if (ttm.length === 4) out.push({ period: ttm[0]!.period, label: 'TTM', value: sum(ttm) });

  const byYear = new Map<string, QuarterPoint[]>();
  for (const p of list) {
    const y = p.period.slice(0, 4);
    const bucket = byYear.get(y);
    if (bucket) bucket.push(p);
    else byYear.set(y, [p]);
  }
  for (const [y, qs] of [...byYear.entries()].sort(([a], [b]) => b.localeCompare(a))) {
    if (qs.length < 4) continue;
    out.push({ period: `${y}-12-31`, label: y, value: sum(qs) });
  }
  return out;
}

/** Which explainer belongs with each headline multiple. */
const MULTIPLE_TERM: Record<PrimaryMultiple, GlossaryKey> = {
  evEbitda: 'evEbitda',
  forwardPe: 'forwardPe',
  trailingPe: 'trailingPe',
  ps: 'priceToSales',
};

export default function StockDetailScreen() {
  const { ticker: raw } = useLocalSearchParams<{ ticker: string }>();
  const ticker = String(raw ?? '').toUpperCase();
  const { palette, spacing } = useTheme();

  const stock = useApp((s) => s.stocks[ticker]);
  const holding = useApp((s) => s.holdings.find((h) => h.ticker === ticker));
  const plan = useApp((s) => s.plan);
  const portfolioRead = useApp((s) => s.portfolioRead);
  const stanceDone = useApp((s) => s.stanceDone);
  const stanceMoves = (portfolioRead?.result.allocation?.moves ?? []).filter(
    (m) => m.ticker === ticker,
  );
  const nlv = useApp((s) => s.account)().netLiquidationValue;
  const researching = useApp((s) => s.researching.includes(ticker));
  const researchTicker = useApp((s) => s.researchTicker);
  const staleNarrative = useApp((s) => s.staleNarratives.includes(ticker));
  const [status, setStatus] = useState<string | null>(null);
  // One quote page, four sections, one continuous piece of navigation —
  // the way a finance product organises a name rather than one long scroll.
  const [tab, setTab] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [finPeriod, setFinPeriod] = useState<'quarterly' | 'annual'>('quarterly');

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
  const bridge = buildBridge(stock.cashFlow.value);
  // Share count is not stored as its own field, so back it out of price-to-sales
  // against trailing revenue: market cap = P/S x revenue, shares = cap / price.
  const sharesOutstanding = impliedShares(stock);
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
      <Stack.Screen
        options={{
          title: stock.ticker,
          // Ticker over price, centred — the price stays in sight while the
          // page scrolls, the way a quote page keeps its subject pinned.
          headerTitle: () => (
            <View style={{ alignItems: 'center' }}>
              <Text variant="caption" faint>
                {stock.ticker}
              </Text>
              <Text variant="label" style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                {quote ? currency(quote.price) : '—'}
              </Text>
            </View>
          ),
          headerRight: () => (
            <Pressable
              onPress={() => setSearchOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Search the book"
              hitSlop={10}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, paddingHorizontal: 4 })}
            >
              <Ionicons name="search" size={20} color={palette.text} />
            </Pressable>
          ),
        }}
      />
      <SearchOverlay visible={searchOpen} onClose={() => setSearchOpen(false)} />

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
            <Stat label="Market value" term="marketValue" value={compactCurrency(marketValue)} style={{ flexBasis: '28%', flexGrow: 1 }} />
            <Stat
              label="Unrealised" term="unrealizedPnl"
              value={compactCurrency(unrealized)}
              detail={
                unrealized != null && holding.costBasis > 0
                  ? percent(((quote?.price ?? 0) / holding.costBasis - 1) * 100)
                  : undefined
              }
              tone={tone(unrealized)}
              style={{ flexBasis: '28%', flexGrow: 1 }}
            />
            <Stat label="Avg cost" term="costBasis" value={currency(holding.costBasis)} style={{ flexBasis: '28%', flexGrow: 1 }} />
            <Stat
              label="Weight" term="weight"
              value={weightPct == null ? '—' : `${weightPct.toFixed(1)}%`}
              detail={`cap ${(plan.constraints.maxPositionPct * 100).toFixed(0)}%`}
              tone={weightPct != null && weightPct > plan.constraints.maxPositionPct * 100 ? 'down' : 'flat'}
              style={{ flexBasis: '28%', flexGrow: 1 }}
            />
          </View>
        </Card>
      ) : null}

      <SegmentedTabs
        tabs={['Summary', 'News', 'Analysis', 'Financials']}
        active={tab}
        onChange={setTab}
      />

      {/* ---------------------------------------------------- the business */}
      {tab === 0 ? (
        <>
      {stock.about.value ? (
        <Card style={{ gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Label variant="label" muted term="aboutBusiness">
              What this business is
            </Label>
          </View>
          <Text variant="body">{stock.about.value}</Text>
        </Card>
      ) : null}

      {/* --------------------------------------------------------- verdict */}
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Pill
            label={VERDICT_LABEL[stock.narrative.verdict]}
            tone={VERDICT_TONE[stock.narrative.verdict]}
          />
          <InfoButton term="verdict" size={15} />
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
        </>
      ) : null}

      {/* ------------------------------------------------------- valuation */}
      {tab === 2 ? (
        <>
      <Section title="Valuation" subtitle={val.rationale} term="valuationBand">
        <Card style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Text variant="title" style={{ fontVariant: ['tabular-nums'] }}>
              {val.current == null ? '—' : multiple(val.current)}
            </Text>
            <Label variant="label" muted term={MULTIPLE_TERM[val.multiple]}>
              {val.label}
            </Label>
            <Pill label={bandLabel(val.band)} tone={bandTone(val.band)} compact />
            <InfoButton term="valuationBand" size={14} />
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
            <Row term="trailingPe" label="Trailing P/E" value={ratio(stock.valuation.value?.trailingPe, 1)} />
            <Row term="forwardPe" label="Forward P/E" value={ratio(stock.valuation.value?.forwardPe, 1)} />
            <Row term="evEbitda" label="EV / EBITDA" value={ratio(stock.valuation.value?.evToEbitda, 1)} />
            <Row term="priceToSales" label="Price / sales" value={ratio(stock.valuation.value?.priceToSales, 1)} />
            <Row term="peg" label="PEG" value={ratio(stock.valuation.value?.peg, 2)} />
            <Row
              term="profitMargin"
              label="Profit margin"
              value={percent(stock.valuation.value?.profitMargin, { sign: false, decimals: 1 })}
            />
            <Row
              term="operatingMargin"
              label="Operating margin"
              value={percent(stock.valuation.value?.operatingMargin, { sign: false, decimals: 1 })}
            />
            <Row
              term="debtToEquity"
              label="Debt / equity"
              value={ratio(stock.valuation.value?.debtToEquity, 2)}
              hint={
                (stock.valuation.value?.debtToEquity ?? 0) < 0
                  ? 'Negative — shareholder equity is negative, so this ratio is not comparable'
                  : undefined
              }
            />
            <Row term="beta" label="Beta" value={ratio(stock.valuation.value?.beta, 2)} />
            <Row
              term="shortInterest"
              label="Short interest"
              value={percent(stock.valuation.value?.shortInterestPct, { sign: false, decimals: 1 })}
              hint={stock.valuation.value?.shortInterestPct == null ? 'No source wired up for this field' : undefined}
            />
            <Row
              term="dividendYield"
              label="Dividend yield"
              value={percent(stock.valuation.value?.dividendYield, { sign: false, decimals: 2 })}
            />
            <Row
              term="analystTarget"
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
              term="week52Range"
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
      <Section title="Trend" subtitle={`${trend.available} of 6 checks measurable`} term="trendScore">
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

          <Label variant="caption" muted term="maDistance">
            Distance from each moving average
          </Label>
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
                term={trendCheckTerm(c.label)}
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
      {/* Only the metrics that have a figure. Eleven stats of which nine were
          em dashes — the state of every name the research pass has not
          reached — read as a broken card rather than as an honest gap, and
          the owner said so. The gap is still stated, once, in words: these
          arrive with a research pass, so the card says that instead of
          drawing a grid of nothing. */}
      {(() => {
        const q = stock.quality.value;
        if (!q) return null;
        const stats: { label: string; term?: GlossaryKey; value: string; detail?: string; tone?: 'up' | 'down' | 'flat' }[] = [];
        const pushPct = (label: string, v: number | null, term?: GlossaryKey, signed = false) => {
          if (v == null) return;
          stats.push({
            label,
            term,
            value: percent(v, { sign: signed, decimals: 1 }),
            tone: signed ? tone(v) : undefined,
          });
        };
        pushPct('Return on equity', q.returnOnEquity, 'returnOnEquity');
        pushPct('ROIC', q.returnOnInvestedCapital, 'roic');
        pushPct('Gross margin', q.grossMargin, 'grossMargin');
        pushPct('FCF margin', q.freeCashFlowMargin, 'fcfMargin');
        if (q.netDebtToEbitda != null) {
          stats.push({
            label: 'Net debt / EBITDA',
            term: 'netDebtToEbitda',
            value: ratio(q.netDebtToEbitda, 2),
            detail: q.netDebtToEbitda < 0 ? 'net cash' : undefined,
            tone: q.netDebtToEbitda > 3 ? 'down' : 'flat',
          });
        }
        pushPct('Revenue CAGR 3y', q.revenueCagr3y, 'revenueCagr', true);
        pushPct('Revenue YoY', q.revenueGrowthYoY, undefined, true);
        pushPct('EPS YoY', q.epsGrowthYoY, undefined, true);
        if (q.shareCountChangePct != null) {
          stats.push({
            label: 'Share count YoY',
            term: 'shareCountChange',
            value: percent(q.shareCountChangePct, { decimals: 1 }),
            detail: q.shareCountChangePct < 0 ? 'buying back' : 'diluting',
            tone: q.shareCountChangePct < 0 ? 'up' : 'down',
          });
        }
        pushPct('Institutional', q.institutionalOwnershipPct, 'ownership');
        if (q.insiderOwnershipPct != null) {
          stats.push({
            label: 'Insider',
            value: percent(q.insiderOwnershipPct, { sign: false, decimals: 2 }),
          });
        }
        if (!stats.length) return null;
        const missing = 11 - stats.length;
        return (
          <Section
            title="Business quality"
            subtitle="Is this a good business, separate from its price"
            term="roic"
          >
            <Card style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
                {stats.map((s) => (
                  <Stat
                    key={s.label}
                    label={s.label}
                    term={s.term}
                    value={s.value}
                    detail={s.detail}
                    tone={s.tone}
                    style={{ flexBasis: '28%', flexGrow: 1 }}
                  />
                ))}
              </View>
              {missing > 0 ? (
                <Text variant="caption" faint>
                  {missing} more quality {missing === 1 ? 'measure' : 'measures'} — margins,
                  returns on capital, ownership — arrive when Claude researches this name.
                </Text>
              ) : null}
            </Card>
          </Section>
        );
      })()}
        </>
      ) : null}

      {/* -------------------------------------------------------- cashflow */}
      {tab === 3 ? (
        <>
      {bridge ? (
        <Section
          title="EBITDA to free cash flow"
          term="fcfConversion"
          subtitle={`Trailing twelve months · ${bridge.completeness.known} of ${bridge.completeness.total} deduction lines on file`}
        >
          <Card style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
              <Text variant="title" style={{ fontVariant: ['tabular-nums'] }}>
                {bridge.conversionPct == null ? '—' : `${bridge.conversionPct.toFixed(0)}%`}
              </Text>
              <Label variant="label" muted term="fcfConversion">
                converts to cash
              </Label>
              <Pill
                label={
                  bridge.conversionPct == null
                    ? 'no read'
                    : bridge.conversionPct >= 60
                      ? 'Strong conversion'
                      : bridge.conversionPct >= 30
                        ? 'Moderate conversion'
                        : 'Weak conversion'
                }
                tone={conversionTone(bridge.conversionPct)}
                compact
              />
            </View>

            <Text variant="body">{bridge.sentence}</Text>

            <WaterfallChart steps={bridge.steps} format={(v) => compactCurrency(v)} />

            <Divider />

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
              <Stat
                label="Adjusted EBITDA"
                term="adjustedEbitda"
                value={compactCurrency(stock.cashFlow.value?.adjustedEbitda)}
                style={{ flexBasis: '30%', flexGrow: 1 }}
              />
              <Stat
                label="Free cash flow"
                term="fcf"
                value={compactCurrency(bridge.reportedFcf ?? bridge.derivedFcf)}
                tone={tone(bridge.reportedFcf ?? bridge.derivedFcf)}
                style={{ flexBasis: '30%', flexGrow: 1 }}
              />
              <Stat
                label="Capex intensity"
                term="capex"
                value={percent(bridge.capexIntensityPct, { sign: false, decimals: 0 })}
                detail="of adjusted EBITDA"
                tone={(bridge.capexIntensityPct ?? 0) > 45 ? 'warn' : 'flat'}
                style={{ flexBasis: '30%', flexGrow: 1 }}
              />
              <Stat
                label="FCF yield"
                term="fcfYield"
                value={percent(
                  fcfYield(
                    bridge.reportedFcf ?? bridge.derivedFcf,
                    quote?.price ?? null,
                    sharesOutstanding,
                  ),
                  { sign: false, decimals: 2 },
                )}
                style={{ flexBasis: '30%', flexGrow: 1 }}
              />
            </View>

            <View>
              {stock.cashFlow.value?.stockBasedCompensation != null ? (
                <Row
                  term="stockBasedComp"
                  label="Stock-based compensation"
                  value={compactCurrency(stock.cashFlow.value.stockBasedCompensation)}
                  hint="Deducted here, not added back"
                />
              ) : null}
              <Row
                term="workingCapital"
                label="Working capital"
                value={compactCurrency(stock.cashFlow.value?.workingCapitalChange)}
                hint="Positive means growth consumed cash"
              />
              <Row
                term="cashTaxes"
                label="Cash taxes"
                value={compactCurrency(stock.cashFlow.value?.cashTaxes)}
              />
              {bridge.unexplained != null && Math.abs(bridge.unexplained) > 1e6 ? (
                <Row
                  label="Unexplained"
                  value={compactCurrency(bridge.unexplained)}
                  hint="Gap between the walk and the reported figure"
                  tone="warn"
                />
              ) : null}
            </View>
          </Card>
        </Section>
      ) : null}
        </>
      ) : null}

      {/* -------------------------------------------------------- momentum */}
      {tab === 0 && stock.momentum.value ? (
        <Section title="Momentum" term="momentum">
          <Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
              <Stat label="1 month" value={percent(stock.momentum.value.oneMonth)} tone={tone(stock.momentum.value.oneMonth)} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat label="3 month" value={percent(stock.momentum.value.threeMonth)} tone={tone(stock.momentum.value.threeMonth)} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat label="6 month" value={percent(stock.momentum.value.sixMonth)} tone={tone(stock.momentum.value.sixMonth)} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat label="1 year" value={percent(stock.momentum.value.oneYear)} tone={tone(stock.momentum.value.oneYear)} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat label="Year to date" value={percent(stock.momentum.value.yearToDate)} tone={tone(stock.momentum.value.yearToDate)} style={{ flexBasis: '28%', flexGrow: 1 }} />
              <Stat
                label="From 52w high" term="fromHigh"
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

      {/* -------------------------------------------------------- sentiment */}
      {tab === 1 ? (
        <>
      <Section
        title="What the market is saying"
        term="sentiment"
        subtitle={
          stock.sentiment.value ? `Coverage read ${relativeAsOf(stock.sentiment.asOf)}` : undefined
        }
      >
        <Card style={{ gap: spacing.sm }}>
          {stock.sentiment.value ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                {stock.sentiment.value.label ? (
                  <Pill
                    label={stock.sentiment.value.label.toUpperCase()}
                    tone={sentimentTone(stock.sentiment.value.score)}
                  />
                ) : null}
                {stock.sentiment.value.score != null ? (
                  <Text variant="mono" tone={sentimentTone(stock.sentiment.value.score)}>
                    {stock.sentiment.value.score >= 0 ? '+' : '−'}
                    {Math.abs(stock.sentiment.value.score).toFixed(2)}
                  </Text>
                ) : null}
              </View>
              {stock.sentiment.value.summary ? (
                <Text variant="body">{stock.sentiment.value.summary}</Text>
              ) : null}
              {stock.sentiment.value.analystRevisions ? (
                <>
                  <Label variant="label" muted term="analystRevisions">
                    Analyst revisions
                  </Label>
                  <Text variant="body">{stock.sentiment.value.analystRevisions}</Text>
                </>
              ) : null}
              {/* Coverage above is what people say; this is what the people
                  running the company did with their own money. */}
              {stock.sentiment.value.insiderActivity ? (
                <>
                  <Label variant="label" muted term="insiderActivity">
                    Insider activity
                  </Label>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                    <Pill
                      label={stock.sentiment.value.insiderActivity.toUpperCase()}
                      tone={
                        stock.sentiment.value.insiderActivity === 'buying'
                          ? 'up'
                          : stock.sentiment.value.insiderActivity === 'selling'
                            ? 'down'
                            : 'flat'
                      }
                      compact
                    />
                    <Text variant="body" style={{ flex: 1 }}>
                      {stock.sentiment.value.insiderDetail ?? 'No detail behind the filing read.'}
                    </Text>
                  </View>
                </>
              ) : null}
              {stock.sentiment.value.headlines.length ? (
                <>
                  <Divider />
                  <Label variant="label" muted term="sentiment">
                    Recent coverage
                  </Label>
                  {stock.sentiment.value.headlines.map((h, n) => (
                    <View key={n} style={{ gap: 2, paddingVertical: spacing.xs }}>
                      <Text variant="body">{h.headline}</Text>
                      <Text variant="caption" faint>
                        {[h.source, h.date ? longDate(h.date) : null].filter(Boolean).join(' · ')}
                      </Text>
                      {h.soWhat ? (
                        <Text variant="caption" tone={sentimentTone(h.sentiment)}>
                          {h.soWhat}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </>
              ) : null}
            </>
          ) : researching ? (
            <Skeleton lines={4} />
          ) : (
            <Empty
              title="No coverage read yet."
              detail="Tap Re-research below — Claude searches for the latest news, analyst revisions and what was said on the most recent call."
            />
          )}
        </Card>
      </Section>
        </>
      ) : null}

      {/* -------------------------------------------------------- earnings */}
      {tab === 3 ? (
        <>
      <Section
        term="earningsSurprise"
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
                  label="Surprise" term="earningsSurprise"
                  value={percent(stock.earnings.value.surprisePct, { decimals: 1 })}
                  tone={tone(stock.earnings.value.surprisePct)}
                  style={{ flexBasis: '28%', flexGrow: 1 }}
                />
              </View>
              {stock.earnings.value.reactionPct != null ? (
                <Text variant="caption" tone={tone(stock.earnings.value.reactionPct)}>
                  Shares moved {percent(stock.earnings.value.reactionPct)} on the day.
                </Text>
              ) : null}
              {stock.earnings.value.callSummary ? (
                <>
                  <Divider />
                  <Label variant="label" muted term="fundamentals">
                    The call in brief
                  </Label>
                  <Text variant="body">{stock.earnings.value.callSummary}</Text>
                </>
              ) : null}
              {stock.earnings.value.managementSaid ? (
                <>
                  <Divider />
                  <Label variant="label" muted term="fundamentals">
                    What management said
                  </Label>
                  <Text variant="body">{stock.earnings.value.managementSaid}</Text>
                </>
              ) : null}
              {stock.earnings.value.quotes.length ? (
                <View style={{ gap: spacing.sm }}>
                  {stock.earnings.value.quotes.map((q, n) => (
                    <View
                      key={n}
                      style={{
                        borderLeftWidth: 3,
                        borderLeftColor: palette.borderStrong,
                        paddingLeft: spacing.md,
                        gap: 2,
                      }}
                    >
                      <Text variant="body" style={{ fontStyle: 'italic' }}>
                        “{q.text}”
                      </Text>
                      <Text variant="caption" faint>
                        {q.speaker}
                        {q.topic ? ` · on ${q.topic}` : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {stock.earnings.value.guidance ? (
                <>
                  <Label variant="label" muted term="catalyst">
                    Guidance
                  </Label>
                  <Text variant="body">{stock.earnings.value.guidance}</Text>
                </>
              ) : null}
              {stock.earnings.value.watchNext ? (
                <>
                  <Label variant="label" muted term="whatWouldChangeMyMind">
                    What to watch next call
                  </Label>
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
      <Section
        title="Fundamentals"
        subtitle={
          finPeriod === 'quarterly'
            ? 'Newest on the right'
            : 'Complete calendar years, and the trailing twelve months'
        }
        term="fundamentals"
      >
        <Card style={{ gap: spacing.xl }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {(['quarterly', 'annual'] as const).map((p) => (
              <Button
                key={p}
                label={p === 'quarterly' ? 'Quarterly' : 'Annual'}
                onPress={() => setFinPeriod(p)}
                variant={finPeriod === p ? 'solid' : 'quiet'}
                style={{ flex: 1, minHeight: 36, paddingVertical: 6 }}
              />
            ))}
          </View>
          <View style={{ gap: spacing.sm }}>
            <Label term="revenue">Revenue vs earnings</Label>
            <GroupedBarChart
              series={[
                {
                  name: 'Revenue',
                  tone: 'accent',
                  points: finSeries(stock.fundamentals.value?.revenue, finPeriod),
                },
                {
                  name: 'Earnings',
                  tone: 'warn',
                  points: finSeries(stock.fundamentals.value?.netIncome, finPeriod),
                },
              ]}
              format={(v) => compactCurrency(v)}
              title="Revenue against earnings"
            />
          </View>
          <View style={{ gap: spacing.sm }}>
            <Label term="operatingIncome">Operating income</Label>
            <BarChart
              points={finSeries(stock.fundamentals.value?.operatingIncome, finPeriod)}
              format={(v) => compactCurrency(v)}
              title="Operating income"
              tone="up"
            />
          </View>
          <View style={{ gap: spacing.sm }}>
            <Label term="eps">Diluted EPS</Label>
            {finPeriod === 'quarterly' ? (
              <LineChart
                points={stock.fundamentals.value?.eps ?? []}
                format={(v) => currency(v)}
                title="EPS"
                tone="accent"
              />
            ) : (
              <BarChart
                points={finSeries(stock.fundamentals.value?.eps, finPeriod)}
                format={(v) => currency(v)}
                title="EPS"
                tone="accent"
              />
            )}
          </View>
        </Card>
      </Section>

      <Section title="Multiple history" subtitle="Ten quarters, with today marked" term="multipleHistory">
        <Card style={{ gap: spacing.xl }}>
          <View style={{ gap: spacing.sm }}>
            <Label term="trailingPe">Trailing P/E</Label>
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
            <Label term="evEbitda">EV / EBITDA</Label>
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
            <Label term="priceToSales">Price / sales</Label>
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

        </>
      ) : null}

      {/* ------------------------------------------------------- narrative */}
      {tab === 0 ? (
        <>
      <Section title="The case" term="bullBearCase">
        <Card style={{ gap: spacing.md }}>
          {stock.narrative.catalyst ? (
            <Field label="Catalyst" term="catalyst" tone="up" text={stock.narrative.catalyst} />
          ) : null}
          {stock.narrative.risk ? (
            <Field label="Key risk" term="keyRisk" tone="down" text={stock.narrative.risk} />
          ) : null}
          {stock.narrative.bullCase ? (
            <Field label="Bull case" term="bullBearCase" tone="up" text={stock.narrative.bullCase} />
          ) : null}
          {stock.narrative.bearCase ? (
            <Field label="Bear case" term="bullBearCase" tone="down" text={stock.narrative.bearCase} />
          ) : null}
          {stock.narrative.whatWouldChangeMyMind ? (
            <Field
              label="What would change the verdict"
              term="whatWouldChangeMyMind"
              tone="accent"
              text={stock.narrative.whatWouldChangeMyMind}
            />
          ) : null}
          {!stock.narrative.catalyst && !stock.narrative.risk ? (
            <Empty title="Nothing written up for this name yet." />
          ) : null}
        </Card>
      </Section>

      {/* ---------------------------------------------------- in the plan */}
      {/* The plan is dynamic now — the moves live in the portfolio read and
          are pinned on the AI insights screen. Any of them that names this
          ticker is surfaced here, so the stock page still answers "am I
          supposed to be doing something about this one?". */}
      {stanceMoves.length ? (
        <Section title="In the plan" term="planLeg">
          <Card style={{ gap: spacing.sm }}>
            {stanceMoves.map((m, n) => (
              <View key={n} style={{ gap: 2 }}>
                <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                  <Pill
                    label={m.kind === 'raise-cash' ? 'raise cash' : m.kind}
                    tone={m.kind === 'exit' || m.kind === 'trim' ? 'warn' : m.kind === 'hold' ? 'flat' : 'accent'}
                    compact
                  />
                  {m.sizePctOfNlv != null ? (
                    <Text variant="caption" muted>
                      {m.sizePctOfNlv.toFixed(1)}% of the book
                    </Text>
                  ) : null}
                  {stanceDone.includes(stanceMoveKey(m)) ? <Pill label="Done" tone="up" compact /> : null}
                </View>
                <Text variant="caption" muted>
                  {m.action} {m.basis ? `— ${m.basis}` : ''}
                </Text>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}
        </>
      ) : null}

      {/* ----------------------------------------------------- provenance */}
      <Section title="Where these numbers came from" term="dataProvenance">
        <Card>
          <Row label="Price" value={sourceLabel(stock, 'quote')} hint={relativeAsOf(stock.quote.asOf)} />
          <Row label="Valuation" value={sourceLabel(stock, 'valuation')} hint={relativeAsOf(stock.valuation.asOf)} />
          <Row label="Technicals" value={sourceLabel(stock, 'technicals')} hint={relativeAsOf(stock.technicals.asOf)} />
          <Row label="Sentiment" value={sourceLabel(stock, 'sentiment')} hint={relativeAsOf(stock.sentiment.asOf)} />
          <Row label="Cash flow" value={sourceLabel(stock, 'cashFlow')} hint={relativeAsOf(stock.cashFlow.asOf)} />
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

/**
 * Share count is not stored on its own, so it is backed out of price-to-sales
 * against trailing-twelve-month revenue: market cap = P/S x revenue, and shares
 * = cap / price. Returns null the moment any input is missing rather than
 * guessing, because an FCF yield built on a guessed share count is worse than
 * no FCF yield.
 */
function impliedShares(stock: Stock): number | null {
  const ps = stock.valuation.value?.priceToSales ?? null;
  const price = stock.quote.value?.price ?? null;
  const revenue = stock.fundamentals.value?.revenue ?? [];
  const ttm = revenue.slice(0, 4).reduce<number | null>(
    (sum, p) => (sum == null || p.value == null ? null : sum + p.value),
    0,
  );
  if (ps == null || price == null || ttm == null || price <= 0 || ttm <= 0) return null;
  return (ps * ttm) / price;
}

/** Score is −1 to +1; the midband is genuinely mixed rather than mildly good. */
function sentimentTone(score: number | null | undefined): 'up' | 'down' | 'flat' {
  if (score == null) return 'flat';
  if (score >= 0.2) return 'up';
  if (score <= -0.2) return 'down';
  return 'flat';
}

function Field({
  label,
  term,
  tone,
  text,
}: {
  label: string;
  term?: GlossaryKey;
  tone: 'up' | 'down' | 'accent';
  text: string;
}) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Pill label={label} tone={tone} compact />
        {term ? <InfoButton term={term} size={14} /> : null}
      </View>
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
  key:
    | 'quote'
    | 'valuation'
    | 'technicals'
    | 'sentiment'
    | 'cashFlow'
    | 'fundamentals'
    | 'multipleHistory'
    | 'earnings',
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
    stock.sentiment.value?.insiderActivity
      ? `Insiders: ${stock.sentiment.value.insiderActivity}${
          stock.sentiment.value.insiderDetail ? ` — ${stock.sentiment.value.insiderDetail}` : ''
        }`
      : '',
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
