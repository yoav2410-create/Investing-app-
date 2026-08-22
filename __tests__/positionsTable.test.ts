import { parseNumber, parsePositionsTable } from '@/data/import/positionsTable';

/**
 * Real broker exports, in the shapes they actually arrive in. Every fixture
 * here is a format some broker really uses — comma files with quoted names,
 * tab-separated downloads, a table copied off a web page with nothing but
 * spaces between the columns, European decimal commas, losses in brackets.
 */

describe('reading numbers the way brokers write them', () => {
  it('handles currency, thousands and percent', () => {
    expect(parseNumber('$1,234.56')).toBeCloseTo(1234.56, 4);
    expect(parseNumber('€2 500')).toBe(2500);
    expect(parseNumber("1'234.5")).toBeCloseTo(1234.5, 4);
    expect(parseNumber('12.5%')).toBe(12.5);
    expect(parseNumber('₪980')).toBe(980);
  });

  it('reads a loss whether it wears a minus or brackets', () => {
    expect(parseNumber('-563.30')).toBeCloseTo(-563.3, 4);
    expect(parseNumber('(563.30)')).toBeCloseTo(-563.3, 4);
    expect(parseNumber('−563.30')).toBeCloseTo(-563.3, 4);
  });

  it('tells a European decimal comma from a thousands comma', () => {
    expect(parseNumber('1.234,56')).toBeCloseTo(1234.56, 4);
    expect(parseNumber('1,234.56')).toBeCloseTo(1234.56, 4);
    expect(parseNumber('12,5')).toBeCloseTo(12.5, 4);
  });

  it('returns null for the blanks brokers leave, never NaN', () => {
    for (const blank of ['', '  ', '-', '—', 'N/A', '--']) expect(parseNumber(blank)).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
  });
});

describe('reading a whole book out of one file', () => {
  it('reads a comma export with quoted company names', () => {
    const csv = [
      'Symbol,Description,Quantity,Average Cost,Last Price,Market Value,Total Gain/Loss',
      '"AAPL","Apple Inc.",25,180.00,309.35,7733.75,3233.75',
      '"META","Meta Platforms, Inc.",10,600.00,543.67,5436.70,(563.30)',
    ].join('\n');
    const { positions, warnings } = parsePositionsTable(csv);
    expect(positions.map((p) => p.ticker)).toEqual(['AAPL', 'META']);
    expect(positions[0]!.shares).toBe(25);
    expect(positions[0]!.averageCost).toBe(180);
    expect(positions[1]!.unrealizedPnl).toBeCloseTo(-563.3, 4);
    expect(positions[1]!.companyName).toBe('Meta Platforms, Inc.');
    expect(warnings).toEqual([]);
  });

  it('reads a tab-separated download', () => {
    const tsv = ['Ticker\tQty\tAvg Price\tValue', 'PLTR\t100\t70.00\t15230', 'VST\t25\t180\t3405'].join('\n');
    const { positions } = parsePositionsTable(tsv);
    expect(positions).toHaveLength(2);
    expect(positions[0]!.shares).toBe(100);
    expect(positions[1]!.averageCost).toBe(180);
  });

  it('reads a table copied off a web page, with only spaces between columns', () => {
    const pasted = [
      'Symbol      Quantity    Avg Cost    Market Value',
      'MSFT        12          420.10      5,801.88',
      'LMT         6           540.00      3,381.42',
    ].join('\n');
    const { positions } = parsePositionsTable(pasted);
    expect(positions.map((p) => p.ticker)).toEqual(['MSFT', 'LMT']);
    expect(positions[0]!.marketValue).toBeCloseTo(5801.88, 2);
  });

  it('pulls the ticker out of a combined name column', () => {
    const csv = ['Instrument,Shares,Cost basis', 'Apple Inc. (AAPL),25,180', 'NVDA - NVIDIA Corp,8,120'].join('\n');
    const { positions } = parsePositionsTable(csv);
    expect(positions.map((p) => p.ticker)).toEqual(['AAPL', 'NVDA']);
  });

  it('skips the totals row rather than importing a position called Total', () => {
    const csv = ['Symbol,Quantity,Avg Cost', 'AAPL,25,180', 'Total,,,', 'Cash,,,'].join('\n');
    const { positions } = parsePositionsTable(csv);
    expect(positions.map((p) => p.ticker)).toEqual(['AAPL']);
  });

  it('says which rows it could not use instead of dropping them silently', () => {
    const csv = ['Symbol,Quantity,Avg Cost', 'AAPL,25,180', 'SOMEFUND2024,,'].join('\n');
    const { positions, warnings } = parsePositionsTable(csv);
    expect(positions).toHaveLength(1);
    expect(warnings.join(' ')).toMatch(/skipped/i);
  });

  it('flags a row with a quantity but no cost rather than inventing one', () => {
    const csv = ['Symbol,Quantity,Avg Cost', 'AAPL,25,'].join('\n');
    const { positions } = parsePositionsTable(csv);
    expect(positions[0]!.averageCost).toBeNull();
    expect(positions[0]!.confidence).toBeLessThan(1);
    expect(positions[0]!.note).toMatch(/no cost/i);
  });

  it('falls back to column order when the export has no headings', () => {
    const raw = ['AAPL,25,180', 'META,10,600'].join('\n');
    const { positions, warnings } = parsePositionsTable(raw);
    expect(positions.map((p) => p.ticker)).toEqual(['AAPL', 'META']);
    expect(positions[0]!.shares).toBe(25);
    expect(positions[0]!.averageCost).toBe(180);
    expect(warnings.join(' ')).toMatch(/no column headings/i);
  });

  it('does not confuse the average price column with the last price', () => {
    const csv = ['Symbol,Quantity,Average Price,Price', 'AAPL,25,180.00,309.35'].join('\n');
    const { positions } = parsePositionsTable(csv);
    expect(positions[0]!.averageCost).toBe(180);
    expect(positions[0]!.price).toBeCloseTo(309.35, 2);
  });

  it('reports honestly when the text is not a positions table at all', () => {
    const { positions, warnings } = parsePositionsTable('hello there\njust some prose');
    expect(positions).toEqual([]);
    expect(warnings.join(' ')).toMatch(/no positions could be read/i);
  });
});

/**
 * What iOS Live Text hands over when the owner copies the table straight out
 * of a screenshot: no delimiter at all, just single spaces, and a heading row
 * that arrives as ordinary words. This is the path the app leads with, so it
 * is the path with the most fixtures.
 */
describe('a table copied out of a screenshot with Live Text', () => {
  it('reads single-space rows with no headings', () => {
    const live = ['AAPL 25 180.00 309.35', 'META 10 600.00 549.90', 'PLTR 150 72.50 179.94'].join('\n');
    const { positions } = parsePositionsTable(live);
    expect(positions.map((p) => p.ticker)).toEqual(['AAPL', 'META', 'PLTR']);
    expect(positions[0]!.shares).toBe(25);
    expect(positions[0]!.averageCost).toBe(180);
    expect(positions[2]!.shares).toBe(150);
  });

  it('reads single-space rows that do carry headings', () => {
    const live = ['Symbol Qty Avg cost Last', 'AAPL 25 180.00 309.35', 'KO 40 58.20 62.10'].join('\n');
    const { positions } = parsePositionsTable(live);
    expect(positions.map((p) => p.ticker)).toEqual(['AAPL', 'KO']);
    expect(positions[1]!.averageCost).toBeCloseTo(58.2, 2);
  });

  it('copes with the company name sitting between the ticker and the numbers', () => {
    const live = ['AAPL Apple Inc. 25 180.00', 'META Meta Platforms 10 600.00'].join('\n');
    const { positions } = parsePositionsTable(live);
    expect(positions.map((p) => p.ticker)).toEqual(['AAPL', 'META']);
    expect(positions[0]!.shares).toBe(25);
    expect(positions[0]!.averageCost).toBe(180);
  });

  it('ignores the percentages a broker row trails', () => {
    const live = ['META 10 600.00 549.90 -8.35% -501.00'].join('\n');
    const { positions } = parsePositionsTable(live);
    expect(positions[0]!.shares).toBe(10);
    expect(positions[0]!.averageCost).toBe(600);
  });
});
