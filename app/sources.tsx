import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Card, Pill, Row, Screen, Section, Text } from '@/components/ui';
import { useApp } from '@/data/store';
import { relativeAsOf } from '@/domain/format';
import type { DataSourceId, Stock } from '@/domain/types';

const BLOCKS = [
  ['quote', 'Price'],
  ['valuation', 'Valuation'],
  ['technicals', 'Technicals'],
  ['quality', 'Quality'],
  ['momentum', 'Momentum'],
  ['options', 'Options'],
  ['fundamentals', 'Reported figures'],
  ['multipleHistory', 'Multiple history'],
  ['earnings', 'Earnings'],
] as const;

const SOURCE_META: Record<DataSourceId, { label: string; tone: 'up' | 'accent' | 'warn' | 'flat' | 'down' }> = {
  manual: { label: 'Claude', tone: 'accent' },
  alphavantage: { label: 'Alpha Vantage', tone: 'up' },
  finnhub: { label: 'Finnhub live', tone: 'up' },
  googlesheet: { label: 'Google Finance', tone: 'up' },
  computed: { label: 'Computed', tone: 'flat' },
  seed: { label: 'Seed', tone: 'warn' },
  unavailable: { label: 'None', tone: 'down' },
};

export default function SourcesScreen() {
  const { spacing } = useTheme();
  const stocks = useApp((s) => s.stocks);
  const refresh = useApp((s) => s.refresh);
  const settings = useApp((s) => s.settings);

  const tally = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of Object.values(stocks)) {
      for (const [key] of BLOCKS) {
        const src = (s[key as keyof Stock] as { source: DataSourceId }).source;
        counts[src] = (counts[src] ?? 0) + 1;
      }
    }
    return counts;
  }, [stocks]);

  return (
    <Screen>
      <Section title="How this app gets its numbers">
        <Card style={{ gap: spacing.sm }}>
          <Text variant="body">
            Prices and position sizes come from screenshots of your own broker account, read by
            Claude. There is no market-data subscription behind the price you see — it is the mark
            your broker was showing when you took the picture.
          </Text>
          <Text variant="body">
            The analytical layer — multiples, reported figures, quality metrics, the write-up — is
            researched by Claude on demand, per stock, using web search. Every block carries the
            timestamp of when it was last refreshed, and nothing is quietly re-dated.
          </Text>
          <Text variant="body" muted>
            An optional Alpha Vantage key adds precise daily technicals. It is not required and is
            off unless you set a key in Settings.
          </Text>
        </Card>
      </Section>

      <Section title="What is on file right now">
        <Card style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {Object.entries(tally)
              .sort((a, b) => b[1] - a[1])
              .map(([src, n]) => (
                <Pill
                  key={src}
                  label={`${SOURCE_META[src as DataSourceId]?.label ?? src}: ${n}`}
                  tone={SOURCE_META[src as DataSourceId]?.tone ?? 'flat'}
                  compact
                />
              ))}
          </View>
          <Text variant="caption" faint>
            Counted across {Object.keys(stocks).length} stocks × {BLOCKS.length} data blocks. Anything
            still marked Seed has never been refreshed — open that stock and tap Re-research.
          </Text>
        </Card>
      </Section>

      <Section title="Per stock" term="dataProvenance">
        <View style={{ gap: spacing.sm }}>
          {Object.values(stocks).map((s) => (
            <Card key={s.ticker} style={{ gap: spacing.xs }}>
              <Text variant="heading">{s.ticker}</Text>
              {BLOCKS.map(([key, label]) => {
                const block = s[key as keyof Stock] as { source: DataSourceId; asOf: string | null };
                return (
                  <Row
                    key={key}
                    label={label}
                    value={SOURCE_META[block.source]?.label ?? block.source}
                    hint={block.asOf ? relativeAsOf(block.asOf) : 'never'}
                  />
                );
              })}
            </Card>
          ))}
        </View>
      </Section>

      <Section title="Known gaps" subtitle="Stated rather than hidden">
        <Card style={{ gap: spacing.sm }}>
          <Text variant="body" muted>
            • Short interest has no automatic source. It stays null unless Claude finds it during a
            research pass.
          </Text>
          <Text variant="body" muted>
            • Put/call open interest is not returned by the free options endpoint; only the
            volume-based ratio refreshes automatically.
          </Text>
          <Text variant="body" muted>
            • Multiple histories are derived — quarter-end price over trailing earnings or EBITDA —
            not published series. They are marked as their own block for that reason.
          </Text>
          <Text variant="body" muted>
            • Seed narratives were written from reported figures. Where a direct quote is not
            available, the text says so instead of inventing one.
          </Text>
        </Card>
      </Section>

      {refresh.log.length ? (
        <Section title="Alpha Vantage refresh log" subtitle={`Budget ${settings.dailyCallBudget} calls/day`}>
          <Card style={{ gap: spacing.sm }}>
            {refresh.log.slice(0, 5).map((entry, i) => (
              <View key={i} style={{ gap: 2 }}>
                <Text variant="label">
                  {relativeAsOf(entry.at)} · {entry.status} · {entry.callsUsed} calls
                </Text>
                {entry.messages.slice(0, 4).map((m, j) => (
                  <Text key={j} variant="caption" muted>
                    {m}
                  </Text>
                ))}
              </View>
            ))}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
