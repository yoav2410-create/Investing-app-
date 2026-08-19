import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Card, Screen, Section, Text } from '@/components/ui';
import { useApp } from '@/data/store';
import { relativeAsOf } from '@/domain/format';

type Item = {
  href: Href;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  detail: string;
};

export default function MoreScreen() {
  const router = useRouter();
  const { palette, spacing, radius } = useTheme();
  const stocks = useApp((s) => s.stocks);
  const snapshots = useApp((s) => s.snapshots);
  const market = useApp((s) => s.market);

  const watchlistCount = Object.values(stocks).filter((s) => s.watchlistOnly).length;

  const items: Item[] = [
    {
      href: '/insights',
      icon: 'sparkles-outline',
      title: 'AI insights',
      detail: 'What the book is actually betting on, concentration, and where the risk sits',
    },
    {
      href: '/sync',
      icon: 'camera-outline',
      title: 'Update from screenshot',
      detail: 'Claude reads your broker screen and updates the book',
    },
    {
      href: '/market',
      icon: 'globe-outline',
      title: 'Market overview',
      detail: `${market.instruments.length} instruments · book-wide options sentiment`,
    },
    {
      href: '/returns',
      icon: 'trending-up-outline',
      title: 'Returns & attribution',
      detail: 'Who moved the book today and who is carrying the gains',
    },
    {
      href: '/watchlist',
      icon: 'eye-outline',
      title: 'Watchlist',
      detail: `${watchlistCount} names being considered`,
    },
    {
      href: '/history',
      icon: 'time-outline',
      title: 'History',
      detail: `${snapshots.length} daily snapshot${snapshots.length === 1 ? '' : 's'}`,
    },
    {
      href: '/sources',
      icon: 'information-circle-outline',
      title: 'Data sources',
      detail: 'Exactly where every number came from and when',
    },
    {
      href: '/settings',
      icon: 'settings-outline',
      title: 'Settings',
      detail: 'API keys, alerts, Face ID, positions',
    },
  ];

  return (
    <Screen>
      <Section title="Everything else">
        <View style={{ gap: spacing.sm }}>
          {items.map((i) => (
            <Pressable
              key={i.title}
              onPress={() => router.push(i.href)}
              accessibilityRole="button"
              accessibilityLabel={`${i.title}. ${i.detail}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                backgroundColor: pressed ? palette.cardMuted : palette.card,
                borderColor: palette.border,
                borderWidth: StyleSheet.hairlineWidth,
                borderRadius: radius.lg,
                padding: spacing.md,
                minHeight: 44,
              })}
            >
              <Ionicons name={i.icon} size={22} color={palette.accent} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="heading">{i.title}</Text>
                <Text variant="caption" muted numberOfLines={2}>
                  {i.detail}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={palette.textFaint} />
            </Pressable>
          ))}
        </View>
      </Section>

      <Card>
        <Text variant="caption" faint>
          Market snapshot as of {relativeAsOf(market.asOf)}. Portfolio Brief keeps everything on the
          device — nothing is uploaded except the screenshots you choose to send to Claude.
        </Text>
      </Card>
    </Screen>
  );
}
