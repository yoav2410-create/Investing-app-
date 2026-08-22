import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Card, Divider, Empty, Screen, Section, Text } from '@/components/ui';
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
      {/* The header already says "Watchlist" — repeating it as a section title
          stacked two bold headings saying the same word. The section names the
          content instead, and the explainer is a subtitle, not a full card
          shouting over the names it introduces. */}
      <Section
        title="Being considered"
        term="watchlistOnly"
        subtitle="Same analysis as a holding — no share count behind it, so position figures stay blank by design"
      >
        {watch.length === 0 ? (
          <Card>
            <Empty
              title="The watchlist is empty."
              detail="Every tracked name is currently held."
            />
          </Card>
        ) : (
          <Card style={{ gap: spacing.xs }}>
            {watch.map((s, i) => {
              const legs = legsForTicker(plan, s.ticker).filter((l) => l.action === 'buy');
              const totalShares = legs.reduce((sum, l) => sum + (l.shares ?? 0), 0);
              const totalCash = legs.reduce((sum, l) => sum + Math.abs(l.estimatedCash ?? 0), 0);
              return (
                <View key={s.ticker} style={{ gap: spacing.xs }}>
                  {i > 0 ? <Divider /> : null}
                  <StockRow stock={s} hideWatchlistPill />
                  {legs.length ? (
                    <Text variant="caption" faint>
                      Plan opens {totalShares} shares across {legs.length} tranche
                      {legs.length === 1 ? '' : 's'} — about {currency(totalCash, { decimals: 0 })}.
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </Card>
        )}
      </Section>
    </Screen>
  );
}
