import type { Quote } from '@/domain/types';

/**
 * Prices from a Google Sheet the owner publishes themselves.
 *
 * There is no Google Finance API — Google withdrew it in 2012, and
 * `GOOGLEFINANCE()` exists only inside Sheets. So the owner builds the sheet,
 * publishes it to the web as CSV, and the app reads that. The quotes are
 * genuinely Google's; the sheet is the API.
 *
 * This does not replace the broker screenshot and is not allowed to. The
 * screenshot is where positions come from — share counts, cost basis, cash,
 * the account figures — and it is the only thing that knows what the owner
 * actually owns. This refreshes the *price* on names already held. A sheet row
 * for a ticker not in the book is ignored rather than treated as a position.
 *
 * Published CSV is fetchable from a browser: docs.google.com reflects the
 * requesting origin in Access-Control-Allow-Origin on both the `pub?output=csv`
 * and `gviz/tq` paths. Checked before this was built, because if it had not
 * been, none of it would work from the phone and the failure would have looked
 * like a bug in the app.
 */

export interface SheetQuote {
  ticker: string;
  price: number;
  previousClose: number | null;
  changePct: number | null;
  /** What the sheet said, when it said anything, for the Data sources screen. */
  name: string | null;
}

export interface SheetReadResult {
  quotes: SheetQuote[];
  /** Rows that could not be used, and why. Never silently dropped. */
  skipped: string[];
  /** Header names the sheet actually had, to explain a bad mapping. */
  headers: string[];
}

export class SheetError extends Error {
  constructor(
    message: string,
    readonly kind: 'url' | 'network' | 'notPublished' | 'empty' | 'noColumns',
  ) {
    super(message);
    this.name = 'SheetError';
  }
}

/**
 * Turn whatever the owner pasted into something fetchable.
 *
 * People paste the address bar, not the publish dialog's URL, so an ordinary
 * edit link is accepted and converted. Rejecting it with "wrong URL" would be
 * technically correct and useless.
 */
export function toCsvUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new SheetError('Paste the link to your Google Sheet first.', 'url');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SheetError('That is not a link. Copy the whole address, starting with https://', 'url');
  }
  if (!/(^|\.)google\.com$/.test(url.hostname)) {
    throw new SheetError('That link is not a Google Sheet.', 'url');
  }

  // Already a published-to-web link: keep it, just force CSV.
  if (url.pathname.includes('/spreadsheets/d/e/') && url.pathname.endsWith('/pub')) {
    url.searchParams.set('output', 'csv');
    return url.toString();
  }
  if (url.pathname.includes('/gviz/tq')) return url.toString();
  if (url.searchParams.get('output') === 'csv') return url.toString();

  // An ordinary sheet link. Use the gviz endpoint, which serves any sheet the
  // link-holder can read and keeps the gid when the owner copied a specific tab.
  const id = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (!id) throw new SheetError('That Google link is not a spreadsheet.', 'url');
  const gid = url.hash.match(/gid=(\d+)/)?.[1] ?? url.searchParams.get('gid');
  const out = new URL(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq`);
  out.searchParams.set('tqx', 'out:csv');
  if (gid) out.searchParams.set('gid', gid);
  return out.toString();
}

/** RFC 4180 enough for what Sheets emits, including quoted commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** A number as a sheet writes it: "1,234.50", "$612.40", "-0.62%", "". */
export function parseNumber(cell: string | undefined): number | null {
  if (cell == null) return null;
  const cleaned = cell.replace(/[$€£,\s%]/g, '').replace(/[()]/g, '');
  if (!cleaned || !/[0-9]/.test(cleaned)) return null;
  const negative = /^\(.*\)$/.test(cell.trim());
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const HEADER_ALIASES: Record<string, string[]> = {
  ticker: ['ticker', 'symbol', 'stock', 'code'],
  price: ['price', 'last', 'close', 'currentprice', 'marketprice'],
  previousClose: ['previousclose', 'prevclose', 'closeyest', 'yesterday', 'priorclose'],
  changePct: ['changepct', 'changepercent', 'change%', 'pctchange', 'percentchange', 'daychange'],
  name: ['name', 'company', 'companyname', 'description'],
};

function mapHeaders(header: string[]): Partial<Record<keyof typeof HEADER_ALIASES, number>> {
  const norm = header.map((h) => h.toLowerCase().replace(/[^a-z%]/g, ''));
  const out: Partial<Record<string, number>> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = norm.findIndex((h) => aliases.includes(h));
    if (idx >= 0) out[field] = idx;
  }
  return out;
}

export function parseSheet(text: string): SheetReadResult {
  // A sheet that is not published comes back as an HTML sign-in page, not an
  // error, so the CSV parse would otherwise "succeed" on a page of markup.
  if (/^\s*</.test(text) || /<!DOCTYPE|<html/i.test(text.slice(0, 400))) {
    throw new SheetError(
      'Google returned a web page instead of data, which means the sheet is not published. In Sheets: File → Share → Publish to web → Comma-separated values.',
      'notPublished',
    );
  }

  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new SheetError('That sheet has no rows under its header.', 'empty');
  }

  const header = rows[0]!;
  const cols = mapHeaders(header);
  if (cols.ticker == null || cols.price == null) {
    throw new SheetError(
      `The sheet needs a ticker column and a price column. It has: ${header.join(', ')}.`,
      'noColumns',
    );
  }

  const quotes: SheetQuote[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const row of rows.slice(1)) {
    const ticker = (row[cols.ticker] ?? '').trim().toUpperCase().replace(/^[A-Z]+:/, '');
    if (!ticker) continue;
    const price = parseNumber(row[cols.price]);
    if (price == null) {
      // GOOGLEFINANCE returns #N/A while it loads and for symbols it cannot
      // resolve. Saying which is more useful than dropping the row.
      skipped.push(`${ticker}: no usable price (${(row[cols.price] ?? '').trim() || 'blank'})`);
      continue;
    }
    if (price <= 0) {
      skipped.push(`${ticker}: price of ${price} is not a price`);
      continue;
    }
    if (seen.has(ticker)) {
      skipped.push(`${ticker}: listed more than once, later row ignored`);
      continue;
    }
    seen.add(ticker);
    quotes.push({
      ticker,
      price,
      previousClose: cols.previousClose == null ? null : parseNumber(row[cols.previousClose]),
      changePct: cols.changePct == null ? null : parseNumber(row[cols.changePct]),
      name: cols.name == null ? null : (row[cols.name] ?? '').trim() || null,
    });
  }

  if (quotes.length === 0) {
    throw new SheetError('No row in that sheet had both a ticker and a price.', 'empty');
  }
  return { quotes, skipped, headers: header };
}

export async function fetchSheet(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SheetReadResult> {
  const csvUrl = toCsvUrl(url);
  let res: Response;
  try {
    res = await fetchImpl(csvUrl, { redirect: 'follow' });
  } catch (e) {
    throw new SheetError(
      `Could not reach the sheet. ${e instanceof Error ? e.message : ''}`.trim(),
      'network',
    );
  }
  if (res.status === 404) {
    throw new SheetError('Google says that sheet does not exist, or is not shared.', 'notPublished');
  }
  if (!res.ok) {
    throw new SheetError(`Google answered ${res.status} for that sheet.`, 'network');
  }
  return parseSheet(await res.text());
}

/**
 * Turn a sheet row into the app's quote shape.
 *
 * `previousClose` is what makes a day move meaningful. When the sheet gives a
 * percentage but no previous close, it is derived; when it gives neither, the
 * day move is zero rather than invented, and the price still updates — a fresh
 * price with an unknown day move is worth more than no price.
 */
export function toQuote(s: SheetQuote, tradingDay: string): Quote {
  let previousClose = s.previousClose;
  if (previousClose == null && s.changePct != null && s.changePct !== -100) {
    previousClose = s.price / (1 + s.changePct / 100);
  }
  const prev = previousClose ?? s.price;
  const change = s.price - prev;
  return {
    price: s.price,
    previousClose: prev,
    change,
    changePct: prev === 0 ? 0 : (change / prev) * 100,
    volume: null,
    tradingDay,
  };
}
