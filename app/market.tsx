import React from 'react';
import { useTheme } from '@/theme/ThemeProvider';
import { Card, Row, Screen, Section } from '@/components/ui';
import { useApp } from '@/data/store';
import { percent, relativeAsOf, tone } from '@/domain/format';

/**
 * The market backdrop: indices, ETFs and yields.
 *
 * The Monte Carlo projection moved to the Portfolio screen — it is the risk
 * statement of the owner's own book, not market commentary. The options
 * sentiment table that used to close this screen is gone with the rest of the
 * options positioning feature: a whole-chain put/call ratio blurs hedging with
 * conviction, and insider filings — read during the research pass and shown on
 * each stock — answer the same question with less ambiguity.
 */
export default function MarketScreen() {
  const { spacing } = useTheme();
  const market = useApp((s) => s.market);

  const indices = market.instruments.filter((i) => i.kind === 'index');
  const etfs = market.instruments.filter((i) => i.kind === 'etf');
  const yields = market.instruments.filter((i) => i.kind === 'yield');

  return (
    <Screen>
      <Section title="Indices" term="marketIndex" subtitle={`As of ${relativeAsOf(market.asOf)}`}>
        <Card>
          {indices.map((i) => (
            <Row
              key={i.symbol}
              label={i.name}
              value={`${i.last?.toLocaleString('en-US', { maximumFractionDigits: 2 }) ?? '—'}  ${percent(i.changePct)}`}
              tone={tone(i.changePct)}
            />
          ))}
        </Card>
      </Section>

      <Section title="ETFs" term="etf">
        <Card>
          {etfs.map((i) => (
            <Row
              key={i.symbol}
              label={`${i.symbol} · ${i.name}`}
              value={`${i.last?.toFixed(2) ?? '—'}  ${percent(i.changePct)}`}
              tone={tone(i.changePct)}
            />
          ))}
        </Card>
      </Section>

      <Section title="Treasury yields" term="treasuryYield">
        <Card style={{ marginBottom: spacing.lg }}>
          {yields.map((i) => (
            <Row
              key={i.symbol}
              label={i.name}
              value={`${i.last?.toFixed(2) ?? '—'}%  ${percent(i.changePct)}`}
              tone={tone(i.changePct)}
            />
          ))}
        </Card>
      </Section>
    </Screen>
  );
}
