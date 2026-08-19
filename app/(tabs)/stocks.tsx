import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Pill, Screen, Text } from '@/components/ui';
import { StockRow } from '@/components/StockRow';
import { useApp } from '@/data/store';
import { positionViews } from '@/domain/portfolio';
import { trendRead } from '@/domain/technicals';
import { valuationRead } from '@/domain/valuation';
import { SECTORS, type SectorId, type Verdict } from '@/domain/types';

type Filter = 'all' | 'held' | 'watchlist' | 'cheap' | 'expensive' | 'downtrend' | Verdict;
type Sort = 'weight' | 'move' | 'trend' | 'valuation' | 'alpha';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'held', label: 'Held' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'cheap', label: 'Cheap' },
  { id: 'expensive', label: 'Expensive' },
  { id: 'downtrend', label: 'Downtrend' },
  { id: 'sell', label: 'Sell' },
  { id: 'add', label: 'Add' },
  { id: 'buy', label: 'Buy' },
];

const SORTS: { id: Sort; label: string }[] = [
  { id: 'weight', label: 'Weight' },
  { id: 'move', label: 'Day move' },
  { id: 'trend', label: 'Trend' },
  { id: 'valuation', label: 'Cheapness' },
  { id: 'alpha', label: 'A–Z' },
];

export default function StocksScreen() {
  const { palette, spacing, radius } = useTheme();
  const stocks = useApp((s) => s.stocks);
  const holdings = useApp((s) => s.holdings);
  const nlv = useApp((s) => s.account)().netLiquidationValue;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('weight');

  const positions = useMemo(() => positionViews(holdings, stocks, nlv), [holdings, stocks, nlv]);
  const weightByTicker = useMemo(
    () => new Map(positions.map((p) => [p.ticker, p.weightPct])),
    [positions],
  );
  const sharesByTicker = useMemo(
    () => new Map(holdings.map((h) => [h.ticker, h.shares])),
    [holdings],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = Object.values(stocks);

    if (q) {
      list = list.filter(
        (s) =>
          s.ticker.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.narrative.thesis ?? '').toLowerCase().includes(q),
      );
    }

    list = list.filter((s) => {
      switch (filter) {
        case 'all':
          return true;
        case 'held':
          return sharesByTicker.has(s.ticker);
        case 'watchlist':
          return !sharesByTicker.has(s.ticker);
        case 'cheap':
          return valuationRead(s).band === 'cheap';
        case 'expensive':
          return valuationRead(s).band === 'expensive';
        case 'downtrend':
          return trendRead(s.quote.value?.price ?? null, s.technicals.value).label.includes('downtrend');
        default:
          return s.narrative.verdict === filter;
      }
    });

    const score = (t: string) => {
      const s = stocks[t]!;
      return trendRead(s.quote.value?.price ?? null, s.technicals.value).score;
    };

    return [...list].sort((a, b) => {
      switch (sort) {
        case 'weight':
          return (weightByTicker.get(b.ticker) ?? -1) - (weightByTicker.get(a.ticker) ?? -1);
        case 'move':
          return (b.quote.value?.changePct ?? -999) - (a.quote.value?.changePct ?? -999);
        case 'trend':
          return score(b.ticker) - score(a.ticker);
        case 'valuation': {
          const pa = valuationRead(a).percentile ?? 2;
          const pb = valuationRead(b).percentile ?? 2;
          return pa - pb;
        }
        case 'alpha':
          return a.ticker.localeCompare(b.ticker);
      }
    });
  }, [stocks, query, filter, sort, weightByTicker, sharesByTicker]);

  return (
    <Screen>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search ticker, name or thesis"
        placeholderTextColor={palette.textFaint}
        autoCorrect={false}
        autoCapitalize="characters"
        accessibilityLabel="Search stocks"
        clearButtonMode="while-editing"
        style={{
          color: palette.text,
          backgroundColor: palette.card,
          borderColor: palette.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          minHeight: 44,
          fontSize: 15,
        }}
      />

      <ChipRow
        items={FILTERS.map((f) => ({ id: f.id as string, label: f.label }))}
        active={filter}
        onSelect={(id) => setFilter(id as Filter)}
        label="Filter"
      />
      <ChipRow
        items={SORTS.map((s) => ({ id: s.id as string, label: s.label }))}
        active={sort}
        onSelect={(id) => setSort(id as Sort)}
        label="Sort by"
      />

      <Text variant="caption" muted>
        {rows.length} of {Object.keys(stocks).length} names
      </Text>

      <View style={{ gap: spacing.sm }}>
        {rows.map((s) => (
          <StockRow
            key={s.ticker}
            stock={s}
            shares={sharesByTicker.get(s.ticker)}
            weightPct={weightByTicker.get(s.ticker) ?? null}
          />
        ))}
        {rows.length === 0 ? (
          <Text variant="body" muted>
            Nothing matches that. Clear the search or pick a different filter.
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

function ChipRow({
  items,
  active,
  onSelect,
  label,
}: {
  items: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  const { spacing } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="caption" faint>
        {label}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
        {items.map((i) => (
          <Chip key={i.id} label={i.label} active={active === i.id} onPress={() => onSelect(i.id)} />
        ))}
      </ScrollView>
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
        paddingVertical: 7,
        overflow: 'hidden',
        fontWeight: '600',
      }}
    >
      {label}
    </Text>
  );
}
