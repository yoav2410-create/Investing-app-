import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Divider, Pill, Row, Screen, Section, Stat, Text } from '@/components/ui';
import { TargetBars } from '@/components/charts';
import { useApp } from '@/data/store';
import { compactCurrency, currency, percent, shares as fmtShares } from '@/domain/format';
import {
  TRANCHES,
  actionLabel,
  actionTone,
  doneLegs,
  legsByTranche,
  project,
  throughTranche,
  trancheProgress,
} from '@/domain/plan';
import type { TrancheId } from '@/domain/types';

export default function PlanScreen() {
  const { palette, spacing, radius } = useTheme();
  const plan = useApp((s) => s.plan);
  const holdings = useApp((s) => s.holdings);
  const stocks = useApp((s) => s.stocks);
  const cash = useApp((s) => s.cashUsd)();
  const toggleLeg = useApp((s) => s.toggleLeg);
  const resetTranche = useApp((s) => s.resetTranche);

  const [preview, setPreview] = useState<TrancheId | null>(null);

  const progress = useMemo(() => trancheProgress(plan), [plan]);
  const now = useMemo(
    () => project(plan, holdings, stocks, cash, doneLegs(plan)),
    [plan, holdings, stocks, cash],
  );
  const projected = useMemo(
    () => (preview ? project(plan, holdings, stocks, cash, throughTranche(plan, preview)) : null),
    [preview, plan, holdings, stocks, cash],
  );
  const shown = projected ?? now;

  const floorPct = plan.constraints.cashFloorPct * 100;

  return (
    <Screen>
      <Section title={plan.name} subtitle={`${plan.legs.length} legs across three tranches`}>
        <Card>
          <Text variant="body">{plan.summary}</Text>
        </Card>
      </Section>

      <Section
        term="planProjection"
        title={projected ? `If tranche ${preview} is finished` : 'As things stand'}
        subtitle="Tap a tranche below to project it"
      >
        <Card style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
            <Stat
              label="Net liquidation"
              value={compactCurrency(shown.netLiquidationValue)}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Cash"
              value={compactCurrency(shown.cash)}
              detail={`${shown.cashPct.toFixed(1)}% of book`}
              tone={shown.cashPct < floorPct ? 'down' : 'up'}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label={`Headroom over ${floorPct.toFixed(0)}% floor`}
              term="cashFloor"
              value={`${shown.cashFloorHeadroomPct >= 0 ? '+' : '−'}${Math.abs(shown.cashFloorHeadroomPct).toFixed(1)}pp`}
              tone={shown.cashFloorHeadroomPct >= 0 ? 'up' : 'down'}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
            <Stat
              label="Positions"
              value={String(shown.positions.length)}
              style={{ flexBasis: '30%', flexGrow: 1 }}
            />
          </View>

          {shown.breaches.length ? (
            <View style={{ gap: spacing.xs }}>
              {shown.breaches.map((b, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                  <Ionicons
                    name={b.severity === 'error' ? 'alert-circle' : 'warning-outline'}
                    size={16}
                    color={b.severity === 'error' ? palette.down : palette.warn}
                  />
                  <Text variant="caption" tone={b.severity === 'error' ? 'down' : 'warn'} style={{ flex: 1 }}>
                    {b.message}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
              <Ionicons name="checkmark-circle" size={16} color={palette.up} />
              <Text variant="caption" tone="up">
                Every constraint satisfied.
              </Text>
            </View>
          )}

          <Divider />
          <TargetBars
            rows={shown.sectors.map((s) => ({
              label: s.short,
              current: s.weightPct,
              target: s.targetPct,
            }))}
          />
        </Card>
      </Section>

      <Section title="Tranches" term="tranche">
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {progress.map((p) => {
            const active = preview === p.tranche;
            return (
              <Pressable
                key={p.tranche}
                onPress={() => setPreview(active ? null : p.tranche)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Tranche ${p.tranche}, ${p.done} of ${p.total} legs done. ${
                  active ? 'Projection shown' : 'Tap to project'
                }`}
                style={{
                  flex: 1,
                  backgroundColor: active ? palette.accentMuted : palette.card,
                  borderColor: active ? palette.accent : palette.border,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderRadius: radius.md,
                  padding: spacing.md,
                  gap: 2,
                }}
              >
                <Text variant="heading" style={{ color: active ? palette.accent : palette.text }}>
                  {p.tranche}
                </Text>
                <Text variant="caption" muted>
                  {p.done}/{p.total} done
                </Text>
                <Text variant="caption" tone={p.remainingCash >= 0 ? 'up' : 'down'}>
                  {p.remainingCash >= 0 ? '+' : '−'}
                  {compactCurrency(Math.abs(p.remainingCash)).replace('$', '$')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      {TRANCHES.map((t) => (
        <Section
          key={t}
          title={`Tranche ${t}`}
          term="planLeg"
          action={
            <Text
              variant="caption"
              onPress={() => resetTranche(t)}
              accessibilityRole="button"
              style={{ color: palette.accent }}
            >
              Reset
            </Text>
          }
        >
          <View style={{ gap: spacing.sm }}>
            {legsByTranche(plan, t).map((leg) => {
              const actionable = leg.action !== 'hold' && leg.action !== 'defer';
              return (
                <Pressable
                  key={leg.id}
                  onPress={() => actionable && toggleLeg(leg.id)}
                  disabled={!actionable}
                  accessibilityRole={actionable ? 'checkbox' : undefined}
                  accessibilityState={actionable ? { checked: leg.done } : undefined}
                  accessibilityLabel={`${actionLabel(leg.action)} ${leg.ticker}${
                    leg.shares ? `, ${leg.shares} shares` : ''
                  }. ${leg.note}`}
                  style={{
                    backgroundColor: palette.card,
                    borderColor: leg.done ? palette.up : palette.border,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderRadius: radius.md,
                    padding: spacing.md,
                    gap: spacing.xs,
                    opacity: leg.done ? 0.65 : 1,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    {actionable ? (
                      <Ionicons
                        name={leg.done ? 'checkmark-circle' : 'ellipse-outline'}
                        size={20}
                        color={leg.done ? palette.up : palette.textFaint}
                      />
                    ) : (
                      <Ionicons name="remove-circle-outline" size={20} color={palette.textFaint} />
                    )}
                    <Link
                      href={{ pathname: '/stock/[ticker]', params: { ticker: leg.ticker } }}
                      style={{ flexShrink: 0 }}
                    >
                      <Text variant="heading" style={{ color: palette.accent }}>
                        {leg.ticker}
                      </Text>
                    </Link>
                    <Pill label={actionLabel(leg.action)} tone={actionTone(leg.action)} compact />
                    {leg.shares != null ? (
                      <Text variant="caption" muted>
                        {fmtShares(leg.shares)} sh
                      </Text>
                    ) : null}
                    <View style={{ flex: 1 }} />
                    {leg.estimatedCash != null ? (
                      <Text variant="caption" tone={leg.estimatedCash >= 0 ? 'up' : 'down'}>
                        {leg.estimatedCash >= 0 ? '+' : '−'}
                        {currency(Math.abs(leg.estimatedCash), { decimals: 0 }).replace('−', '')}
                      </Text>
                    ) : null}
                  </View>
                  <Text variant="caption" muted>
                    {leg.note}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Section>
      ))}

      <Section title="Constraints">
        <Card>
          <Row term="cashFloor" label="Cash floor" value={`${floorPct.toFixed(0)}% of NLV`} />
          <Row
            term="positionCap"
            label="Max single position"
            value={`${(plan.constraints.maxPositionPct * 100).toFixed(0)}% of NLV`}
          />
          {shown.sectors
            .filter((s) => s.targetPct != null)
            .map((s) => (
              <Row key={s.sector} label={`Target — ${s.label}`} value={`${s.targetPct!.toFixed(0)}%`} />
            ))}
        </Card>
      </Section>
    </Screen>
  );
}
