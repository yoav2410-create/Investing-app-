import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './ui';
import { useApp } from '@/data/store';
import { currency, percent, tone } from '@/domain/format';

/**
 * Quick-jump search over the book, opened from the magnifier in any header.
 *
 * It searches what the app actually knows — held names and the watchlist, by
 * ticker, company name or thesis. It deliberately does not accept arbitrary
 * tickers: a page for a name with no position, no research and no history
 * would be an empty screen wearing a real ticker, which is worse than saying
 * "not in the book".
 */
export function SearchOverlay({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { palette, spacing, radius } = useTheme();
  const router = useRouter();
  const stocks = useApp((s) => s.stocks);
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = Object.values(stocks);
    const list = q
      ? all.filter(
          (s) =>
            s.ticker.toLowerCase().includes(q) ||
            s.name.toLowerCase().includes(q) ||
            (s.narrative.thesis ?? '').toLowerCase().includes(q),
        )
      : all;
    return list.sort((a, b) => a.ticker.localeCompare(b.ticker)).slice(0, 12);
  }, [stocks, query]);

  const open = (ticker: string) => {
    setQuery('');
    onClose();
    router.push({ pathname: '/stock/[ticker]', params: { ticker } });
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.xl + spacing.lg,
            paddingBottom: spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: palette.border,
          }}
        >
          <Ionicons name="search" size={18} color={palette.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search ticker or company"
            placeholderTextColor={palette.textFaint}
            autoFocus
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Search the book"
            style={{
              flex: 1,
              color: palette.text,
              fontSize: 17,
              paddingVertical: spacing.sm,
            }}
          />
          <Pressable
            onPress={() => {
              setQuery('');
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel="Close search"
            hitSlop={10}
          >
            <Text variant="label" style={{ color: palette.accent }}>
              Cancel
            </Text>
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.md }}>
          {results.length === 0 ? (
            <View style={{ padding: spacing.xl, alignItems: 'center', gap: spacing.xs }}>
              <Text variant="body" muted>
                Nothing in the book matches “{query}”.
              </Text>
              <Text variant="caption" faint style={{ textAlign: 'center' }}>
                Search covers held names and the watchlist. New positions arrive through a
                screenshot import.
              </Text>
            </View>
          ) : (
            results.map((s) => {
              const q = s.quote.value;
              return (
                <Pressable
                  key={s.ticker}
                  onPress={() => open(s.ticker)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${s.ticker}`}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                    paddingVertical: spacing.md - 2,
                    paddingHorizontal: spacing.sm,
                    borderRadius: radius.md,
                    backgroundColor: pressed ? palette.accentMuted : 'transparent',
                  })}
                >
                  <View style={{ width: 58 }}>
                    <Text variant="label" style={{ fontWeight: '700' }}>
                      {s.ticker}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="body" numberOfLines={1}>
                      {s.name}
                    </Text>
                    {s.watchlistOnly ? (
                      <Text variant="caption" faint>
                        Watchlist
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text variant="label" style={{ fontVariant: ['tabular-nums'] }}>
                      {q ? currency(q.price) : '—'}
                    </Text>
                    {q ? (
                      <Text variant="caption" tone={tone(q.changePct)}>
                        {percent(q.changePct)}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
