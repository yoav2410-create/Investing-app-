import type { Technicals, TrendLabel } from './types';

export interface Candle {
  date: string;
  high: number;
  low: number;
  close: number;
}

/** Simple moving average of the most recent `period` closes. */
export function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const window = closes.slice(0, period);
  return window.reduce((a, b) => a + b, 0) / period;
}

/**
 * Wilder's RSI — the smoothing Alpha Vantage and most charting packages use.
 * `closes` is newest-first; we walk it oldest-first to seed the averages.
 */
export function rsi(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  const asc = [...closes].reverse();
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = asc[i]! - asc[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < asc.length; i++) {
    const diff = asc[i]! - asc[i - 1]!;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Wilder's +DI / -DI. `candles` is newest-first.
 * Returns nulls when there is not enough history to seed the smoothing.
 */
export function directionalIndicators(
  candles: Candle[],
  period = 14,
): { plusDi: number | null; minusDi: number | null } {
  if (candles.length < period + 1) return { plusDi: null, minusDi: null };
  const asc = [...candles].reverse();

  const plusDm: number[] = [];
  const minusDm: number[] = [];
  const trueRange: number[] = [];

  for (let i = 1; i < asc.length; i++) {
    const cur = asc[i]!;
    const prev = asc[i - 1]!;
    const upMove = cur.high - prev.high;
    const downMove = prev.low - cur.low;
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trueRange.push(
      Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close),
      ),
    );
  }

  const wilder = (series: number[]): number => {
    let acc = series.slice(0, period).reduce((a, b) => a + b, 0);
    for (let i = period; i < series.length; i++) {
      acc = acc - acc / period + series[i]!;
    }
    return acc;
  };

  const smoothedTr = wilder(trueRange);
  if (smoothedTr === 0) return { plusDi: null, minusDi: null };
  return {
    plusDi: (wilder(plusDm) / smoothedTr) * 100,
    minusDi: (wilder(minusDm) / smoothedTr) * 100,
  };
}

/** Derive the whole technical block from a newest-first candle series. */
export function computeTechnicals(candles: Candle[]): Technicals {
  const closes = candles.map((c) => c.close);
  const { plusDi, minusDi } = directionalIndicators(candles, 14);
  return {
    rsi14: rsi(closes, 14),
    rsi20: rsi(closes, 20),
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma100: sma(closes, 100),
    sma200: sma(closes, 200),
    plusDi,
    minusDi,
  };
}

export interface TrendRead {
  /** 0–5. One point per moving average the price sits above, one for RSI > 50,
   *  one for +DI > -DI — capped at 5 so the scale matches the brief. */
  score: number;
  /** How many of the six checks could actually be evaluated. */
  available: number;
  label: TrendLabel;
  checks: { label: string; passed: boolean | null; detail: string }[];
}

const TREND_LABELS: TrendLabel[] = [
  'Strong downtrend',
  'Downtrend',
  'Mild downtrend',
  'Mixed',
  'Mild uptrend',
  'Uptrend',
  'Strong uptrend',
];

/**
 * Trend score, tolerant of missing inputs: a stock with only 120 days of
 * history (no SMA200) is scored on what exists and scaled to 0–5 rather than
 * being silently penalised for the gap.
 */
export function trendRead(price: number | null, t: Technicals | null): TrendRead {
  const checks: TrendRead['checks'] = [];
  const push = (label: string, passed: boolean | null, detail: string) =>
    checks.push({ label, passed, detail });

  const ma = (name: string, value: number | null) => {
    if (price == null || value == null) {
      push(name, null, 'no data');
      return;
    }
    const delta = ((price - value) / value) * 100;
    push(name, price > value, `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`);
  };

  ma('Price > 20D', t?.sma20 ?? null);
  ma('Price > 50D', t?.sma50 ?? null);
  ma('Price > 100D', t?.sma100 ?? null);
  ma('Price > 200D', t?.sma200 ?? null);

  const r = t?.rsi14 ?? null;
  push('RSI-14 > 50', r == null ? null : r > 50, r == null ? 'no data' : r.toFixed(1));

  const plus = t?.plusDi ?? null;
  const minus = t?.minusDi ?? null;
  push(
    '+DI > −DI',
    plus == null || minus == null ? null : plus > minus,
    plus == null || minus == null ? 'no data' : `${plus.toFixed(1)} / ${minus.toFixed(1)}`,
  );

  const evaluated = checks.filter((c) => c.passed !== null);
  const passed = evaluated.filter((c) => c.passed).length;
  const score = evaluated.length === 0 ? 0 : (passed / evaluated.length) * 5;

  // Map 0–5 onto the seven labels; a stock with nothing measurable reads "Mixed".
  const label: TrendLabel =
    evaluated.length === 0
      ? 'Mixed'
      : TREND_LABELS[Math.min(6, Math.max(0, Math.round((score / 5) * 6)))]!;

  return { score: Math.round(score * 10) / 10, available: evaluated.length, label, checks };
}

export function trendLabelTone(label: TrendLabel): 'up' | 'down' | 'flat' {
  if (label.includes('uptrend')) return 'up';
  if (label.includes('downtrend')) return 'down';
  return 'flat';
}
