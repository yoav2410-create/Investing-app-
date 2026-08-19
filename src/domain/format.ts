/** Formatting helpers. Everything tolerates null so screens never print "NaN". */

const DASH = '—';

export function currency(n: number | null | undefined, opts: { decimals?: number; sign?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const { decimals = 2, sign = false } = opts;
  const abs = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const prefix = n < 0 ? '−$' : sign ? '+$' : '$';
  return `${prefix}${abs}`;
}

/** Compact money for tiles: $102.4K, $1.2M, $18.8B. */
export function compactCurrency(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

/**
 * The tightest honest rendering of a magnitude, for labels sitting on a chart.
 *
 * `compactCurrency` is right in a table and too wide on a bar: eight quarters
 * across a 390pt phone leaves about 42pt a slot, and "$82.40B" does not fit in
 * it. This drops the currency symbol and a digit — the unit is stated once in
 * the caption instead of eight times in the picture.
 */
export function compactNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  // Below a thousand the figure is usually a per-share number, where the second
  // decimal is the information rather than noise.
  return `${sign}${abs.toFixed(2)}`;
}

export function percent(
  n: number | null | undefined,
  opts: { decimals?: number; sign?: boolean } = {},
): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const { decimals = 2, sign = true } = opts;
  const s = sign && n > 0 ? '+' : n < 0 ? '−' : '';
  return `${s}${Math.abs(n).toFixed(decimals)}%`;
}

export function ratio(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return n.toFixed(decimals);
}

export function multiple(n: number | null | undefined, decimals = 1): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return `${n.toFixed(decimals)}x`;
}

export function shares(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return n.toLocaleString('en-US');
}

export function tone(n: number | null | undefined): 'up' | 'down' | 'flat' {
  if (n == null || !Number.isFinite(n) || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
}

/** "2026-08-18" -> "18 Aug". */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function longDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "as of" phrasing that degrades to a date once it stops being useful. */
export function relativeAsOf(iso: string | null | undefined): string {
  if (!iso) return 'never refreshed';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 8) return `${days}d ago`;
  return longDate(iso);
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.ceil((then - Date.now()) / 86400000);
}

/** "2026-06-30" -> "Q2 26". */
export function quarterLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${q} ${String(d.getUTCFullYear()).slice(2)}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}
