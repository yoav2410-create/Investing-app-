import {
  parseCsv,
  parseNumber,
  parseSheet,
  SheetError,
  toCsvUrl,
  toQuote,
} from '@/data/provider/googleSheet';

describe('toCsvUrl', () => {
  it('converts an ordinary sheet link, keeping the tab', () => {
    const out = toCsvUrl('https://docs.google.com/spreadsheets/d/ABC123_x-y/edit#gid=456');
    expect(out).toContain('/spreadsheets/d/ABC123_x-y/gviz/tq');
    expect(out).toContain('tqx=out%3Acsv');
    expect(out).toContain('gid=456');
  });

  it('keeps a published link and forces CSV', () => {
    const out = toCsvUrl('https://docs.google.com/spreadsheets/d/e/2PACX-1vAbc/pub?output=xlsx');
    expect(out).toContain('/spreadsheets/d/e/2PACX-1vAbc/pub');
    expect(out).toContain('output=csv');
    expect(out).not.toContain('xlsx');
  });

  it('refuses things that are not sheets, in words', () => {
    expect(() => toCsvUrl('')).toThrow(/paste the link/i);
    expect(() => toCsvUrl('not a url')).toThrow(/not a link/i);
    expect(() => toCsvUrl('https://example.com/a.csv')).toThrow(/not a google sheet/i);
    expect(() => toCsvUrl('https://docs.google.com/document/d/xyz/edit')).toThrow(/not a spreadsheet/i);
  });
});

describe('parseCsv', () => {
  it('handles quoted commas and escaped quotes', () => {
    const rows = parseCsv('a,b\n"Smith, John","He said ""hi"""\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['Smith, John', 'He said "hi"'],
    ]);
  });

  it('drops blank lines rather than yielding empty rows', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseNumber', () => {
  it('reads the shapes a sheet actually emits', () => {
    expect(parseNumber('612.40')).toBe(612.4);
    expect(parseNumber('$1,234.50')).toBe(1234.5);
    expect(parseNumber('-0.62%')).toBeCloseTo(-0.62);
    expect(parseNumber('(45.20)')).toBeCloseTo(-45.2);
  });

  it('returns null rather than zero for things that are not numbers', () => {
    // The whole point: #N/A must not become 0 and get drawn as a price.
    expect(parseNumber('#N/A')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
    expect(parseNumber('  ')).toBeNull();
  });
});

describe('parseSheet', () => {
  it('maps columns by name, whatever they are called', () => {
    const csv = 'Symbol,Company,Last,Prev Close\nMETA,Meta Platforms,543.67,569.00\n';
    const out = parseSheet(csv);
    expect(out.quotes).toHaveLength(1);
    expect(out.quotes[0]).toMatchObject({
      ticker: 'META',
      price: 543.67,
      previousClose: 569,
      name: 'Meta Platforms',
    });
  });

  it('strips the exchange prefix GOOGLEFINANCE echoes back', () => {
    const out = parseSheet('ticker,price\nNASDAQ:PLTR,152.30\n');
    expect(out.quotes[0]!.ticker).toBe('PLTR');
  });

  it('names the rows it could not use instead of dropping them silently', () => {
    const csv = 'ticker,price\nMETA,543.67\nBADD,#N/A\nZERO,0\nMETA,999\n';
    const out = parseSheet(csv);
    expect(out.quotes.map((q) => q.ticker)).toEqual(['META']);
    expect(out.quotes[0]!.price).toBe(543.67); // the duplicate did not win
    expect(out.skipped.join(' ')).toMatch(/BADD/);
    expect(out.skipped.join(' ')).toMatch(/ZERO/);
    expect(out.skipped.join(' ')).toMatch(/more than once/);
  });

  it('recognises a sign-in page instead of parsing the markup as data', () => {
    // An unpublished sheet answers 200 with HTML. Parsing it as CSV would
    // "succeed" and produce nonsense.
    expect(() => parseSheet('<!DOCTYPE html><html><head><title>Sign in</title>')).toThrow(SheetError);
    expect(() => parseSheet('<!DOCTYPE html><html>')).toThrow(/not published/i);
  });

  it('says which columns it needed when it cannot find them', () => {
    expect(() => parseSheet('foo,bar\n1,2\n')).toThrow(/ticker column and a price column/i);
    expect(() => parseSheet('foo,bar\n1,2\n')).toThrow(/foo, bar/);
  });

  it('refuses a sheet with a header and nothing else', () => {
    expect(() => parseSheet('ticker,price\n')).toThrow(/no rows/i);
  });
});

describe('toQuote', () => {
  it('uses the previous close when the sheet gives one', () => {
    const q = toQuote(
      { ticker: 'META', price: 543.67, previousClose: 569, changePct: null, name: null },
      '2026-08-19',
    );
    expect(q.change).toBeCloseTo(-25.33);
    expect(q.changePct).toBeCloseTo(-4.45, 2);
  });

  it('derives the previous close from a percentage when that is all there is', () => {
    const q = toQuote(
      { ticker: 'X', price: 110, previousClose: null, changePct: 10, name: null },
      '2026-08-19',
    );
    expect(q.previousClose).toBeCloseTo(100);
    expect(q.change).toBeCloseTo(10);
  });

  it('reports no day move rather than inventing one, and still takes the price', () => {
    const q = toQuote(
      { ticker: 'X', price: 42, previousClose: null, changePct: null, name: null },
      '2026-08-19',
    );
    expect(q.price).toBe(42);
    expect(q.change).toBe(0);
    expect(q.changePct).toBe(0);
  });
});
