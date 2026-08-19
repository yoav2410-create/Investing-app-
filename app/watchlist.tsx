import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Card, Screen, Section, Text } from '@/components/ui';
import { StockRow } from '@/components/StockRow';
import { useApp } from '@/data/store';
import { legsForTicker } from '@/domain/plan';
import { currency } from '@/domain/format';

export default function WatchlistScreen() {
  const { spacing } = useTheme();
  const stocks = useApp((s) => s.stocks);
  const plan = useApp((s) => s.plan);
  const holdings = useApp((s) => s.holdings);

  const held = useMemo(() => new Set(holdings.map((h) => h.ticker)), [holdings]);
  const watch = useMemo(
    () => Object.values(stocks).filter((s) => !held.has(s.ticker)),
    [stocks, held],
  );

  return (
    <Screen>
      <Section title="Watchlist" term="watchlistOnly">
        <Card>
          <Text variant="body" muted>
            Names being considered but not yet held. Each one carries the same analysis as a
            holding — the difference is that there is no share count behind it, so position-level
            figures are blank by design.
          </Text>
        </Card>
      </Section>

      {watch.length === 0 ? (
        <Text variant="body" muted>
          The watchlist is empty — every tracked name is currently held.
        </Text>
      ) : null}

      <View style={{ gap: spacing.md }}>
        {watch.map((s) => {
          const legs = legsForTicker(plan, s.ticker).filter((l) => l.action === 'buy');
          const totalShares = legs.reduce((sum, l) => sum + (l.shares ?? 0), 0);
          const totalCash = legs.reduce((sum, l) => sum + Math.abs(l.estimatedCash ?? 0), 0);
          return (
            <View key={s.ticker} style={{ gap: spacing.xs }}>
              <StockRow stock={s} />
              {legs.length ? (
                <Text variant="caption" faint style={{ paddingHorizontal: spacing.sm }}>
                  Plan opens {totalShares} shares across {legs.length} tranche
                  {legs.length === 1 ? '' : 's'} — about {currency(totalCash, { decimals: 0 })}.
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </Screen>
  );
}
