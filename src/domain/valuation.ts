import type {
  PrimaryMultiple,
  QuarterPoint,
  MultipleHistory,
  Stock,
  ValuationBand,
  ValuationSnapshot,
} from './types';

export const MULTIPLE_LABEL: Record<PrimaryMultiple, string> = {
  evEbitda: 'EV/EBITDA',
  forwardPe: 'Forward P/E',
  trailingPe: 'Trailing P/E',
  ps: 'P/S',
};

/**
 * How the reading was produced, so the UI never implies more rigour than the
 * data supports: a band from two quarters of history is not the same claim as
 * one from ten.
 */
export interface ValuationRead {
  multiple: PrimaryMultiple;
  label: string;
  /** Current value of the leading multiple — the headline number. */
  current: number | null;
  /**
   * The value actually compared against the history. Differs from `current`
   * when the headline is a forward multiple and only a trailing history exists.
   */
  comparedValue: number | null;
  /** Label for `comparedValue` when it is not the same as `label`. */
  comparedLabel: string | null;
  /** Low/high of that multiple across the stock's own history. */
  historyLow: number | null;
  historyHigh: number | null;
  historyMedian: number | null;
  /** Where `current` sits in its own range, 0 = cheapest, 1 = most expensive. */
  percentile: number | null;
  band: ValuationBand | null;
  /** Quarters of history the band rests on. */
  sampleSize: number;
  /** Years the history spans, for the "two-year range" phrasing. */
  spanYears: number | null;
  /** Peer or index comparison, when a peer median is known. */
  peerGroup: string | null;
  peerMedian: number | null;
  peerDelta: number | null;
  /** One-sentence plain reading, e.g. "24.5x, near the low end of…". */
  sentence: string;
  /** Why this multiple leads for this business. */
  rationale: string;
}

const RATIONALE: Record<PrimaryMultiple, string> = {
  evEbitda:
    'Capital-intensive business — EV/EBITDA is the fair comparison because it prices the debt alongside the equity.',
  forwardPe:
    'Profitable grower — forward P/E against next-twelve-month earnings is what the market actually trades on here.',
  trailingPe: 'Steady earner — trailing P/E is a reliable read when earnings are not swinging.',
  ps: 'Earnings are not yet meaningful at scale, so price-to-sales is the honest yardstick.',
};

function pickHistory(
  multiple: PrimaryMultiple,
  history: MultipleHistory | null,
): QuarterPoint[] {
  if (!history) return [];
  if (multiple === 'evEbitda') return history.evEbitdaHistory ?? [];
  if (multiple === 'ps') return history.psHistory ?? [];
  // Forward P/E has no published history; the stock's own trailing P/E range is
  // the closest honest anchor, and we say so in the sentence.
  return history.peHistory ?? [];
}

export function currentMultiple(
  multiple: PrimaryMultiple,
  v: ValuationSnapshot | null,
): number | null {
  if (!v) return null;
  switch (multiple) {
    case 'evEbitda':
      return v.evToEbitda;
    case 'forwardPe':
      return v.forwardPe ?? v.trailingPe;
    case 'trailingPe':
      return v.trailingPe;
    case 'ps':
      return v.priceToSales;
  }
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function bandFor(percentile: number): ValuationBand {
  if (percentile <= 0.33) return 'cheap';
  if (percentile >= 0.67) return 'expensive';
  return 'fair';
}

function fmt(n: number): string {
  return `${n.toFixed(1)}x`;
}

function yearsBetween(a: string, b: string): number {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  return ms / (365.25 * 24 * 3600 * 1000);
}

/**
 * Turn a raw multiple into a cheap/fair/expensive reading against the stock's
 * own trailing range, and against its peer group when one is known.
 */
export function valuationRead(stock: Stock): ValuationRead {
  const multiple = stock.primaryMultiple;
  const label = MULTIPLE_LABEL[multiple];
  const v = stock.valuation.value;
  const current = currentMultiple(multiple, v);

  // A forward multiple against a trailing history is not a like-for-like
  // comparison — forward P/E sits below trailing P/E almost by construction, so
  // scoring it against trailing quarters would read "cheap" for nearly
  // everything. When the headline is forward P/E we still lead with it, but the
  // band is computed from the trailing P/E against the trailing history.
  const usesTrailingProxy = multiple === 'forwardPe';
  const comparedValue = usesTrailingProxy ? (v?.trailingPe ?? current) : current;
  const comparedLabel = usesTrailingProxy && v?.trailingPe != null ? 'Trailing P/E' : null;

  const history = pickHistory(multiple, stock.multipleHistory.value)
    .filter((p): p is QuarterPoint & { value: number } => p.value != null && p.value > 0);

  const values = history.map((p) => p.value);
  const low = values.length ? Math.min(...values) : null;
  const high = values.length ? Math.max(...values) : null;
  const med = values.length ? median(values) : null;

  let percentile: number | null = null;
  if (comparedValue != null && low != null && high != null && high > low) {
    percentile = Math.min(1, Math.max(0, (comparedValue - low) / (high - low)));
  }

  const band = percentile == null ? null : bandFor(percentile);

  const periods = history.map((p) => p.period).sort();
  const spanYears =
    periods.length >= 2 ? yearsBetween(periods[0]!, periods[periods.length - 1]!) : null;

  const peerMedian = stock.peerMedianMultiple;
  const peerDelta =
    current != null && peerMedian != null && peerMedian > 0
      ? (current / peerMedian - 1) * 100
      : null;

  const sentence = buildSentence({
    label,
    current,
    comparedValue,
    comparedLabel,
    low,
    high,
    med,
    percentile,
    band,
    sampleSize: values.length,
    spanYears,
    usesTrailingProxy,
    peerGroup: stock.peerGroup,
    peerDelta,
  });

  return {
    multiple,
    label,
    current,
    comparedValue,
    comparedLabel,
    historyLow: low,
    historyHigh: high,
    historyMedian: med,
    percentile,
    band,
    sampleSize: values.length,
    spanYears,
    peerGroup: stock.peerGroup,
    peerMedian,
    peerDelta,
    sentence,
    rationale: RATIONALE[multiple],
  };
}

function buildSentence(a: {
  label: string;
  current: number | null;
  comparedValue: number | null;
  comparedLabel: string | null;
  low: number | null;
  high: number | null;
  med: number | null;
  percentile: number | null;
  band: ValuationBand | null;
  sampleSize: number;
  spanYears: number | null;
  usesTrailingProxy: boolean;
  peerGroup: string | null;
  peerDelta: number | null;
}): string {
  if (a.current == null) {
    return `No ${a.label.toLowerCase()} available for this name — see Data sources for why.`;
  }
  if (a.low == null || a.high == null || a.percentile == null || a.sampleSize < 3) {
    return `Trading at ${fmt(a.current)} ${a.label.toLowerCase()}. Not enough quarterly history yet to place that in its own range.`;
  }
  const compared = a.comparedValue ?? a.current;

  const span =
    a.spanYears == null
      ? `${a.sampleSize}-quarter`
      : a.spanYears >= 1.5
        ? `${Math.round(a.spanYears)}-year`
        : `${a.sampleSize}-quarter`;

  const where =
    a.percentile <= 0.2
      ? 'at the low end of'
      : a.percentile <= 0.33
        ? 'near the low end of'
        : a.percentile >= 0.8
          ? 'at the top of'
          : a.percentile >= 0.67
            ? 'near the top of'
            : 'mid-range within';

  let s: string;
  if (a.comparedLabel && compared !== a.current) {
    // Say plainly which number was placed in the range, and which was not.
    s = `Trading at ${fmt(a.current)} ${a.label.toLowerCase()}. On ${a.comparedLabel.toLowerCase()} — the like-for-like comparison — ${fmt(compared)} sits ${where} its ${span} range of ${fmt(a.low)}–${fmt(a.high)}`;
  } else {
    s = `Trading at ${fmt(compared)}, ${where} its ${span} range of ${fmt(a.low)}–${fmt(a.high)}`;
  }
  if (a.med != null) s += ` (median ${fmt(a.med)})`;
  s += '.';

  if (a.peerGroup && a.peerDelta != null) {
    const dir = a.peerDelta >= 0 ? 'above' : 'below';
    s += ` That is ${Math.abs(a.peerDelta).toFixed(0)}% ${dir} the ${a.peerGroup} median.`;
  }
  return s;
}

export function bandTone(band: ValuationBand | null): 'up' | 'down' | 'flat' {
  if (band === 'cheap') return 'up';
  if (band === 'expensive') return 'down';
  return 'flat';
}

export function bandLabel(band: ValuationBand | null): string {
  if (band === 'cheap') return 'Cheap vs own range';
  if (band === 'expensive') return 'Expensive vs own range';
  if (band === 'fair') return 'Fair vs own range';
  return 'No range yet';
}
