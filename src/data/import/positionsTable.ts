import type { ParsedPosition } from '../provider/claude';

/**
 * Reading a whole book out of a broker's own export.
 *
 * The screenshot path needs an Anthropic API key, and a Claude.ai
 * subscription is not one — so for an owner without API credits the app had
 * no way at all to learn what they hold, which made every number in it
 * hypothetical. This is the path that needs nothing: every broker can export
 * positions as CSV, or the table can be selected on the broker's own page and
 * pasted. Both arrive here as text, and both bring the entire book at once —
 * no typing a position, and no typing the next one either.
 *
 * It is deliberately forgiving about shape and strict about meaning. Brokers
 * disagree on nearly everything: the delimiter, the column names, where the
 * currency symbol goes, whether a loss wears a minus or brackets, whether
 * thousands are split by commas, spaces or apostrophes. What they agree on is
 * that a position has a symbol and a quantity. Anything else is a bonus, and
 * anything unreadable stays null rather than being guessed — the review diff
 * downstream shows the owner exactly what was understood before a single
 * number is written.
 */

export interface TableImport {
  positions: ParsedPosition[];
  /** Human-readable notes about what could not be used, for the review screen. */
  warnings: string[];
  /** What the parser decided it was looking at, so the screen can say so. */
  shape: { delimiter: string; rows: number; columns: string[] };
}

/** Header synonyms, lowercased and stripped of punctuation. */
const FIELDS: { key: keyof ParsedPosition | 'skip'; names: string[] }[] = [
  { key: 'ticker', names: ['symbol', 'ticker', 'instrument', 'security', 'stock', 'name/symbol', 'symbol/name', 'asset'] },
  { key: 'companyName', names: ['name', 'description', 'company', 'security name', 'company name', 'security description'] },
  { key: 'shares', names: ['quantity', 'qty', 'shares', 'position', 'units', 'no of shares', 'number of shares', 'share quantity', 'amount'] },
  { key: 'averageCost', names: ['average cost', 'avg cost', 'cost basis', 'average price', 'avg price', 'price paid', 'cost per share', 'avg cost per share', 'purchase price', 'break even', 'unit cost'] },
  { key: 'price', names: ['price', 'last', 'last price', 'market price', 'current price', 'close', 'last trade', 'mark'] },
  { key: 'marketValue', names: ['market value', 'value', 'current value', 'position value', 'mkt value', 'market val', 'total value'] },
  { key: 'unrealizedPnl', names: ['unrealized p&l', 'unrealised p&l', 'unrealized pnl', 'unrealised pnl', 'unrealized gain', 'total gain', 'gain/loss', 'gain loss', 'p&l', 'profit/loss', 'open p&l', 'total p&l'] },
  { key: 'unrealizedPnlPct', names: ['unrealized p&l %', 'gain/loss %', 'total gain %', 'return %', 'p&l %', 'percent gain', 'gain %', 'total return %'] },
  { key: 'dayChangePct', names: ["day change %", 'daily change %', 'change %', 'day %', "today's change %", 'chg %', '% change', 'day gain %'] },
];

/** Strip the noise brokers put in headers: units, currency, punctuation. */
function normaliseHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[_"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchField(header: string): (keyof ParsedPosition) | null {
  const h = normaliseHeader(header);
  if (!h) return null;
  // Exact first: "price" must not win the "average price" column.
  for (const f of FIELDS) {
    if (f.key === 'skip') continue;
    if (f.names.includes(h)) return f.key as keyof ParsedPosition;
  }
  for (const f of FIELDS) {
    if (f.key === 'skip') continue;
    if (f.names.some((n) => h === n.replace(/ /g, '') || h.startsWith(n + ' ') || h.endsWith(' ' + n))) {
      return f.key as keyof ParsedPosition;
    }
  }
  return null;
}

/**
 * A number as a broker wrote it. Handles $ € £ ₪, thousands separated by
 * commas, spaces or apostrophes, trailing %, and a loss written either with a
 * minus or in brackets. Returns null rather than NaN, because null is a value
 * the rest of the app already knows how to render honestly.
 */
export function parseNumber(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s || s === '-' || s === '—' || s === 'N/A' || s === 'n/a' || s === '--') return null;
  const negative = /^\(.*\)$/.test(s) || s.includes('−') || /^-/.test(s);
  s = s.replace(/[()]/g, '').replace(/[−-]/g, '');
  s = s.replace(/[$€£₪]/g, '').replace(/%/g, '').replace(/[\s'’]/g, '');
  // A European decimal comma ("1.234,56" or "12,5") versus thousands commas.
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Split one line, honouring quoted fields for the comma case. */
function splitLine(line: string, delimiter: string): string[] {
  if (delimiter !== ',') return line.split(delimiter).map((c) => c.trim());
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Which separator this text is built on. */
function sniffDelimiter(lines: string[]): string {
  const candidates = ['\t', ',', ';', '|'];
  let best = '\t';
  let bestScore = 0;
  for (const d of candidates) {
    const counts = lines.slice(0, 12).map((l) => splitLine(l, d).length);
    const min = Math.min(...counts);
    // Consistency across rows is what marks the real delimiter, not raw count.
    const score = min >= 2 ? min : 0;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  // A table copied off a web page arrives space-aligned with no delimiter at
  // all; two or more spaces is the only thing separating its columns.
  if (bestScore < 2) {
    const spaceCounts = lines.slice(0, 12).map((l) => l.split(/\s{2,}/).length);
    if (Math.min(...spaceCounts) >= 2) return '  +';
  }
  return best;
}

function looksLikeTicker(v: string): boolean {
  return /^[A-Z][A-Z.\-]{0,6}$/.test(v.trim());
}

export function parsePositionsTable(text: string): TableImport {
  const warnings: string[] = [];
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { positions: [], warnings: ['There was nothing to read.'], shape: { delimiter: '', rows: 0, columns: [] } };
  }

  const delimiter = sniffDelimiter(lines);
  const split = (l: string) => (delimiter === '  +' ? l.split(/\s{2,}/).map((c) => c.trim()) : splitLine(l, delimiter));

  const rows = lines.map(split).filter((r) => r.some((c) => c.length > 0));
  const header = rows[0] ?? [];
  const mapping = header.map(matchField);
  const named = mapping.filter(Boolean).length;

  // A header row is one where the columns say what they hold. Without it, the
  // parser falls back to position: symbol first, then the first two numbers as
  // quantity and cost — which is what a pasted broker table looks like.
  const hasHeader = named >= 2 && mapping.includes('ticker');
  const body = hasHeader ? rows.slice(1) : rows;
  if (!hasHeader) {
    warnings.push('No column headings were recognised, so the first column was read as the ticker and the next two numbers as quantity and average cost.');
  }

  const positions: ParsedPosition[] = [];
  const skipped: string[] = [];

  for (const row of body) {
    const get = (key: keyof ParsedPosition): string | undefined => {
      if (!hasHeader) return undefined;
      const i = mapping.indexOf(key);
      return i === -1 ? undefined : row[i];
    };

    let ticker = (hasHeader ? get('ticker') : row[0]) ?? '';
    // "AAPL - Apple Inc." and "Apple Inc. (AAPL)" both happen.
    const bracketed = ticker.match(/\(([A-Z][A-Z.\-]{0,6})\)/);
    if (bracketed) ticker = bracketed[1]!;
    else ticker = ticker.split(/[\s\-–—:]/)[0] ?? ticker;
    ticker = ticker.replace(/[^A-Za-z.\-]/g, '').toUpperCase();

    if (!ticker || !looksLikeTicker(ticker)) {
      const label = (row[0] ?? '').slice(0, 24);
      if (label && !/^(total|cash|sum|subtotal|grand total)/i.test(label)) skipped.push(label);
      continue;
    }

    let shares: number | null;
    let averageCost: number | null;
    if (hasHeader) {
      shares = parseNumber(get('shares'));
      averageCost = parseNumber(get('averageCost'));
    } else {
      const numbers = row.slice(1).map(parseNumber).filter((n): n is number => n != null);
      shares = numbers[0] ?? null;
      averageCost = numbers[1] ?? null;
    }

    const price = hasHeader ? parseNumber(get('price')) : null;
    const marketValue = hasHeader ? parseNumber(get('marketValue')) : null;
    const unrealizedPnl = hasHeader ? parseNumber(get('unrealizedPnl')) : null;
    const unrealizedPnlPct = hasHeader ? parseNumber(get('unrealizedPnlPct')) : null;
    const dayChangePct = hasHeader ? parseNumber(get('dayChangePct')) : null;
    const companyName = hasHeader ? (get('companyName')?.trim() || null) : null;

    if (shares == null) {
      skipped.push(`${ticker} (no quantity)`);
      continue;
    }

    // Confidence is about what the file said, not about how sure a model is:
    // a row carrying a quantity and a cost is complete for this app's
    // purposes; one missing the cost still imports, flagged, because the
    // review screen is where a thin row gets looked at.
    const complete = averageCost != null || marketValue != null || price != null;
    positions.push({
      ticker,
      companyName,
      shares,
      price,
      marketValue,
      averageCost,
      unrealizedPnl,
      unrealizedPnlPct,
      dayChangePct,
      confidence: complete ? 1 : 0.6,
      note: complete ? null : 'No cost or price in this row — the app kept whatever it already had.',
    });
  }

  if (skipped.length) {
    warnings.push(
      `${skipped.length} row${skipped.length === 1 ? '' : 's'} skipped: ${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? '…' : ''}.`,
    );
  }
  if (positions.length === 0) {
    warnings.push('No positions could be read. Check that the export has a symbol column and a quantity column.');
  }

  return {
    positions,
    warnings,
    shape: { delimiter: delimiter === '  +' ? 'aligned columns' : delimiter === '\t' ? 'tab' : delimiter, rows: positions.length, columns: hasHeader ? header : [] },
  };
}

/** Web-only: open the file picker and read one text file. */
export function pickPositionsFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,text/csv,text/plain';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}
