import * as Notifications from 'expo-notifications';
import type { AppState } from './store';
import { trendRead } from '@/domain/technicals';
import { daysUntil } from '@/domain/format';

/**
 * Threshold alerts.
 *
 * These are computed from state the app already has rather than pushed from a
 * server, so they cost nothing and work offline. The check runs after every
 * screenshot import and on demand from Settings.
 */

export interface Alert {
  id: string;
  title: string;
  body: string;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export function computeAlerts(state: AppState): Alert[] {
  const out: Alert[] = [];
  const { settings, stocks, plan } = state;
  const held = new Set(state.holdings.map((h) => h.ticker));

  for (const s of Object.values(stocks)) {
    const price = s.quote.value?.price ?? null;

    if (settings.alertOnTrendChange && price != null) {
      const t = trendRead(price, s.technicals.value);
      const ma = s.technicals.value;
      // A 50-day break is the level most owners actually act on, so it gets its
      // own alert rather than being folded into the score.
      if (ma?.sma50 != null) {
        const above = price > ma.sma50;
        const distance = Math.abs((price - ma.sma50) / ma.sma50) * 100;
        if (distance < 1.5) {
          out.push({
            id: `ma50-${s.ticker}`,
            title: `${s.ticker} is at its 50-day`,
            body: `${above ? 'Just above' : 'Just below'} the 50-day average at ${ma.sma50.toFixed(2)}. Trend reads ${t.label.toLowerCase()}.`,
          });
        }
      }
      if (t.available >= 4 && t.score <= 1) {
        out.push({
          id: `trend-${s.ticker}`,
          title: `${s.ticker} trend has broken`,
          body: `${t.label}, ${t.score.toFixed(1)} of 5 checks passing.`,
        });
      }
    }

    if (settings.alertOnInsiderSelling) {
      if (s.sentiment.value?.insiderActivity === 'selling' && held.has(s.ticker)) {
        out.push({
          id: `insiders-${s.ticker}`,
          title: `${s.ticker} insiders read as net sellers`,
          body: s.sentiment.value.insiderDetail ?? 'Recent filings lean toward selling.',
        });
      }
    }

    const days = daysUntil(s.nextEarningsDate);
    if (days != null && days >= 0 && days <= settings.alertOnEarningsWithinDays) {
      out.push({
        id: `earnings-${s.ticker}`,
        title: `${s.ticker} reports in ${days} day${days === 1 ? '' : 's'}`,
        body:
          plan.legs.some((l) => l.ticker === s.ticker && !l.done && l.action !== 'hold')
            ? 'You still have an open plan leg on this name.'
            : 'Worth re-reading the write-up before the print.',
      });
    }
  }

  // Constraint breaches are portfolio-level, not per-stock.
  const nlv = state.account().netLiquidationValue;
  const cashPct = nlv === 0 ? 0 : (state.cashUsd() / nlv) * 100;
  const floorPct = plan.constraints.cashFloorPct * 100;
  if (cashPct < floorPct) {
    out.push({
      id: 'cash-floor',
      title: 'Cash is under the floor',
      body: `${cashPct.toFixed(1)}% against a ${floorPct.toFixed(0)}% floor.`,
    });
  }

  return out;
}

/** Compute, then post as local notifications if the owner has enabled them. */
export async function runAlertCheck(state: AppState): Promise<Alert[]> {
  const alerts = computeAlerts(state);
  if (!state.settings.notificationsEnabled || alerts.length === 0) return alerts;

  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return alerts;
    // One notification per alert would be a pile-up; the digest is one tap.
    await Notifications.scheduleNotificationAsync({
      content: {
        title:
          alerts.length === 1
            ? alerts[0]!.title
            : `${alerts.length} things worth a look`,
        body:
          alerts.length === 1
            ? alerts[0]!.body
            : alerts.slice(0, 4).map((a) => a.title).join(' · '),
      },
      trigger: null,
    });
  } catch {
    // A failed notification must never break the refresh that triggered it.
  }
  return alerts;
}
