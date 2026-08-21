import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Card, Divider, Label, Row, Section, Stat, Text } from '@/components/ui';
import { FanChart, Histogram } from '@/components/charts';
import { useApp } from '@/data/store';
import { compactCurrency, percent, ratio, tone } from '@/domain/format';
import {
  DEFAULT_ASSUMPTIONS,
  histogram,
  runSimulation,
  type ReturnBasis,
} from '@/domain/montecarlo';

/**
 * "Where this book could end up", as one block the Portfolio screen renders.
 *
 * This lived on the Market screen, which framed it as market commentary. It is
 * not — it is the risk statement of the owner's own book, and the owner asked
 * for it where the book is. The whole block moves rather than being split,
 * because the horizon and return-basis controls change the simulation the
 * stats describe; separating controls from outputs across screens would let
 * the two silently disagree.
 */
export function MonteCarloBlock() {
  const { palette, spacing, radius } = useTheme();
  const market = useApp((s) => s.market);
  const stocks = useApp((s) => s.stocks);
  const holdings = useApp((s) => s.holdings);
  const cash = useApp((s) => s.cashUsd)();
  const nlv = useApp((s) => s.account)().netLiquidationValue;

  const [years, setYears] = useState(5);
  const [basis, setBasis] = useState<ReturnBasis>('capm');
  const [showInputs, setShowInputs] = useState(false);

  // The 10-year yield is the risk-free rate the projection discounts against,
  // so the Market screen and this block cannot disagree about it.
  const riskFreePct =
    market.instruments.find((i) => i.symbol === 'US10Y')?.last ?? DEFAULT_ASSUMPTIONS.riskFreePct;

  const sim = useMemo(
    () =>
      runSimulation(holdings, stocks, cash, nlv, {
        ...DEFAULT_ASSUMPTIONS,
        riskFreePct,
        years,
        basis,
      }),
    [holdings, stocks, cash, nlv, riskFreePct, years, basis],
  );

  const dist = useMemo(() => histogram(sim.terminal, 26), [sim.terminal]);

  return (
    <>
      <Section
        title="Where this book could end up"
        term="monteCarlo"
        subtitle={`${sim.paths.toLocaleString('en-US')} simulated paths over ${sim.years} year${sim.years === 1 ? '' : 's'}, against the S&P 500`}
      >
        <Card style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {[1, 3, 5, 10].map((y) => (
              <Chip key={y} label={`${y}y`} active={years === y} onPress={() => setYears(y)} />
            ))}
          </View>

          <FanChart
            bands={sim.portfolioBands}
            benchmark={sim.benchmarkBands}
            format={(v) => compactCurrency(v)}
            label={`Projected value of the book over ${sim.years} years against the S&P 500`}
          />

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            <LegendKey color={palette.accent} label="Your book (median)" />
            <LegendKey color={palette.textMuted} label="S&P 500 (median)" dashed />
          </View>

          <Divider />

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
            <Stat
              label="Median outcome"
              value={compactCurrency(sim.portfolioBands[sim.years]!.p50)}
              detail={`${percent(sim.annualised.p50, { decimals: 1 })} a year`}
              tone={tone(sim.annualised.p50)}
              term="monteCarlo"
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Beats the S&P"
              value={`${sim.beatBenchmarkPct.toFixed(0)}%`}
              detail="of paths"
              tone={sim.beatBenchmarkPct >= 50 ? 'up' : 'down'}
              term="probabilityOfBeating"
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Ends below today"
              value={`${sim.lossPct.toFixed(0)}%`}
              detail="of paths"
              tone={sim.lossPct > 30 ? 'down' : 'flat'}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Worst 5%"
              value={compactCurrency(sim.valueAtRisk5)}
              detail={`${percent(sim.annualised.p5, { decimals: 1 })} a year`}
              tone="down"
              term="valueAtRisk"
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Best 5%"
              value={compactCurrency(sim.portfolioBands[sim.years]!.p95)}
              detail={`${percent(sim.annualised.p95, { decimals: 1 })} a year`}
              tone="up"
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="S&P median"
              value={compactCurrency(sim.benchmarkMedian)}
              detail={`book is ${sim.portfolioBands[sim.years]!.p50 >= sim.benchmarkMedian ? 'ahead' : 'behind'}`}
              tone={sim.portfolioBands[sim.years]!.p50 >= sim.benchmarkMedian ? 'up' : 'down'}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
          </View>

          <Text variant="body">{readSimulation(sim)}</Text>

          <Divider />

          <Label variant="label" muted term="monteCarlo">
            Where the {sim.paths.toLocaleString('en-US')} paths landed
          </Label>
          <Histogram
            buckets={dist.buckets}
            marker={sim.startingValue}
            format={(v) => compactCurrency(v)}
            label="Distribution of final portfolio values"
          />
          <Text variant="caption" faint>
            The dashed line is today's value; red bars are paths that ended below it. Compounded
            returns are log-normal, so the axis is clipped to the middle 98% — the{' '}
            {dist.clippedAbove} best and {dist.clippedBelow} worst paths are folded into the end
            bars rather than stretching the scale.
          </Text>
        </Card>
      </Section>

      <Section title="What the projection assumes" term="singleFactorModel">
        <Card style={{ gap: spacing.sm }}>
          <Text variant="body" muted>
            Every holding is driven by one shared market factor scaled by its beta, plus its own
            independent noise. That is what stops the simulation treating {sim.inputs.length}{' '}
            positions as {sim.inputs.length} independent bets — they fall together because they
            share the factor.
          </Text>

          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Chip label="CAPM returns" active={basis === 'capm'} onPress={() => setBasis('capm')} />
            <Chip
              label="Analyst targets"
              active={basis === 'analyst'}
              onPress={() => setBasis('analyst')}
            />
          </View>

          <Row
            term="expectedReturn"
            label="Expected returns from"
            value={basis === 'capm' ? 'Risk-free + beta x ERP' : 'Analyst targets, capped at ±40%'}
          />
          <Row label="Risk-free rate" value={`${riskFreePct.toFixed(2)}%`} hint="US 10-year yield, from the Market screen" />
          <Row
            term="equityRiskPremium"
            label="Equity risk premium"
            value={`${DEFAULT_ASSUMPTIONS.equityRiskPremiumPct.toFixed(1)}%`}
          />
          <Row label="Market volatility" value={`${DEFAULT_ASSUMPTIONS.marketVolPct.toFixed(0)}%`} />
          <Row label="Portfolio beta" value={ratio(sim.effectiveBeta)} term="portfolioBeta" />
          <Row
            label="Cash sleeve"
            value={`${(sim.cashWeight * 100).toFixed(1)}%`}
            hint="Compounds at the risk-free rate"
          />

          <Pressable
            onPress={() => setShowInputs((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showInputs }}
            style={{ paddingVertical: spacing.sm, minHeight: 44, justifyContent: 'center' }}
          >
            <Text variant="label" style={{ color: palette.accent }}>
              {showInputs ? 'Hide' : 'Show'} the per-holding inputs
            </Text>
          </Pressable>

          {showInputs ? (
            <View style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Text variant="caption" faint style={{ width: 58 }}>
                  Ticker
                </Text>
                <Text variant="caption" faint style={{ width: 46, textAlign: 'right' }}>
                  Weight
                </Text>
                <Text variant="caption" faint style={{ width: 42, textAlign: 'right' }}>
                  Beta
                </Text>
                <Text variant="caption" faint style={{ width: 52, textAlign: 'right' }}>
                  Return
                </Text>
                <Text variant="caption" faint style={{ flex: 1, textAlign: 'right' }}>
                  Vol
                </Text>
              </View>
              {sim.inputs.map((i) => (
                <View
                  key={i.ticker}
                  style={{ flexDirection: 'row', gap: spacing.sm }}
                  accessible
                  accessibilityLabel={`${i.ticker}: weight ${(i.weight * 100).toFixed(1)} percent, beta ${i.beta.toFixed(2)}, expected return ${(i.mu * 100).toFixed(1)} percent, volatility ${(i.sigma * 100).toFixed(0)} percent from the ${i.volSource} estimate.`}
                >
                  <Text variant="caption" style={{ width: 58 }}>
                    {i.ticker}
                  </Text>
                  <Text variant="caption" muted style={{ width: 46, textAlign: 'right' }}>
                    {(i.weight * 100).toFixed(1)}%
                  </Text>
                  <Text variant="caption" muted style={{ width: 42, textAlign: 'right' }}>
                    {i.beta.toFixed(2)}
                  </Text>
                  <Text variant="caption" tone={tone(i.mu)} style={{ width: 52, textAlign: 'right' }}>
                    {percent(i.mu * 100, { decimals: 1, sign: false })}
                  </Text>
                  <Text variant="caption" muted style={{ flex: 1, textAlign: 'right' }}>
                    {(i.sigma * 100).toFixed(0)}%
                  </Text>
                </View>
              ))}
              <Label variant="caption" faint term="volatilityEstimate" style={{ marginTop: spacing.xs }}>
                Volatility is estimated from each 52-week range and floored at beta times market
                volatility
              </Label>
            </View>
          ) : null}

          <Text variant="caption" faint>
            These are outcome ranges, not forecasts. The model draws from a normal distribution;
            real markets have fatter tails, so the worst case shown is optimistic about how bad
            things can get.
          </Text>
        </Card>
      </Section>
    </>
  );
}

function LegendKey({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      <View
        style={{
          width: 18,
          height: 3,
          backgroundColor: dashed ? 'transparent' : color,
          borderTopWidth: dashed ? 2 : 0,
          borderTopColor: color,
          borderStyle: dashed ? 'dashed' : 'solid',
        }}
      />
      <Text variant="caption" muted>
        {label}
      </Text>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { palette, radius, spacing } = useTheme();
  return (
    <Text
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      variant="caption"
      style={{
        color: active ? palette.accent : palette.textMuted,
        backgroundColor: active ? palette.accentMuted : palette.cardMuted,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.md,
        paddingVertical: 8,
        overflow: 'hidden',
        fontWeight: '600',
        minWidth: 48,
        textAlign: 'center',
      }}
    >
      {label}
    </Text>
  );
}

/** A plain reading of the simulation, stated without hedging into nothing. */
function readSimulation(sim: ReturnType<typeof runSimulation>): string {
  const median = sim.portfolioBands[sim.years]!.p50;
  const ahead = median >= sim.benchmarkMedian;
  const edge = Math.abs(median / sim.benchmarkMedian - 1) * 100;
  const parts: string[] = [];

  parts.push(
    `The middle path ends at ${compactCurrency(median)}, which is ${edge.toFixed(0)}% ${
      ahead ? 'above' : 'below'
    } the S&P's middle path.`,
  );
  parts.push(
    sim.beatBenchmarkPct >= 55
      ? `The book beats the index in ${sim.beatBenchmarkPct.toFixed(0)}% of paths.`
      : sim.beatBenchmarkPct <= 45
        ? `The book beats the index in only ${sim.beatBenchmarkPct.toFixed(0)}% of paths — the extra risk is not being paid for.`
        : `At ${sim.beatBenchmarkPct.toFixed(0)}% of paths beating the index, this is close to a coin flip against simply owning the S&P.`,
  );
  parts.push(
    `A portfolio beta of ${sim.effectiveBeta.toFixed(2)} means the spread of outcomes is ${
      sim.effectiveBeta > 1.1 ? 'wider' : sim.effectiveBeta < 0.9 ? 'narrower' : 'similar'
    } than the index in both directions.`,
  );
  return parts.join(' ');
}
