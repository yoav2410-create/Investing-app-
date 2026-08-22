// The store module reaches for device storage at import time; this test is
// about the pure migration function, so the storage is stubbed rather than
// the function being moved out of the module that owns it.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { normalisePersisted } from '@/data/store';
import { SEED_HOLDINGS, SEED_STOCKS, isSeedBook } from '@/data/seed';
import type { Stock } from '@/domain/types';

/**
 * What an upgrade does to a book that is already on disk.
 *
 * Every bug this file guards against reached a real phone: a persisted store
 * survives upgrades, so anything added to the bundle is invisible to an
 * install that already has its own copy. The business descriptions shipped
 * and nobody with the app installed saw one.
 */

/** A stored stock the way an older build would have written it. */
function storedWithout(ticker: string, drop: 'about' | 'value' | 'none'): Stock {
  const seed = SEED_STOCKS[ticker]!;
  const copy = JSON.parse(JSON.stringify(seed)) as Stock & { about?: Stock['about'] };
  if (drop === 'about') delete (copy as Partial<Stock>).about;
  if (drop === 'value') copy.about = { value: null, asOf: null, source: 'unavailable' };
  return copy as Stock;
}

describe('upgrading a store that is already on disk', () => {
  it('fills in a business description the stored stock never had', () => {
    const before = { stocks: { META: storedWithout('META', 'about') } };
    const after = normalisePersisted(before) as unknown as { stocks: Record<string, Stock> };
    expect(SEED_STOCKS.META!.about.value).toBeTruthy();
    expect(after.stocks.META!.about.value).toBe(SEED_STOCKS.META!.about.value);
  });

  it('fills one in that was stored as an empty placeholder', () => {
    const before = { stocks: { PLTR: storedWithout('PLTR', 'value') } };
    const after = normalisePersisted(before) as unknown as { stocks: Record<string, Stock> };
    expect(after.stocks.PLTR!.about.value).toBe(SEED_STOCKS.PLTR!.about.value);
  });

  it('never overwrites a description a research pass wrote', () => {
    const researched = storedWithout('MSFT', 'none');
    researched.about = {
      value: 'Written by a research pass, and newer than the bundle.',
      asOf: '2026-08-22T00:00:00.000Z',
      source: 'manual',
    };
    const before = { stocks: { MSFT: researched } };
    const after = normalisePersisted(before) as unknown as { stocks: Record<string, Stock> };
    expect(after.stocks.MSFT!.about.value).toBe('Written by a research pass, and newer than the bundle.');
    expect(after.stocks.MSFT!.about.source).toBe('manual');
  });

  it('leaves a ticker the bundle has never heard of with an honest blank', () => {
    const imported = storedWithout('META', 'about');
    imported.ticker = 'ZZZZ';
    const before = { stocks: { ZZZZ: imported } };
    const after = normalisePersisted(before) as unknown as { stocks: Record<string, Stock> };
    expect(after.stocks.ZZZZ!.about).toEqual({ value: null, asOf: null, source: 'unavailable' });
  });

  it('every seeded stock carries a description for the migration to hand over', () => {
    const missing = Object.values(SEED_STOCKS)
      .filter((s) => !s.about.value)
      .map((s) => s.ticker);
    expect(missing).toEqual([]);
  });

  // The card sits above the verdict on a phone. Three sentences of plain
  // prose is a card; six is a page the owner scrolls past, which is how the
  // first draft of these came back — accurate and unreadable.
  it('keeps every description card-sized', () => {
    const tooLong = Object.values(SEED_STOCKS)
      .map((s) => ({ ticker: s.ticker, words: (s.about.value ?? '').split(/\s+/).filter(Boolean).length }))
      .filter((x) => x.words > 85);
    expect(tooLong).toEqual([]);
  });

  it('says where in the world each business operates', () => {
    // Not a grammar check — just that the geography sentence did not get
    // dropped in an edit. Every description names a place or a region.
    const PLACES =
      /United States|US\b|America|Europe|Asia|Latin America|Texas|California|Washington|Japan|India|China|Canada|Britain|United Kingdom|global|worldwide|international|Middle East|Pacific|Nasdaq|New York/i;
    const silent = Object.values(SEED_STOCKS)
      .filter((s) => !PLACES.test(s.about.value ?? ''))
      .map((s) => s.ticker);
    expect(silent).toEqual([]);
  });
});

describe('telling the demo book from a real one', () => {
  it('recognises the untouched seed', () => {
    expect(isSeedBook(SEED_HOLDINGS)).toBe(true);
  });

  it('stops claiming demo the moment one position is replaced', () => {
    const real = SEED_HOLDINGS.map((h, i) => (i === 0 ? { ...h, ticker: 'ZZZZ' } : h));
    expect(isSeedBook(real)).toBe(false);
  });

  it('stops claiming demo when a position is added or removed', () => {
    expect(isSeedBook(SEED_HOLDINGS.slice(1))).toBe(false);
    expect(isSeedBook([...SEED_HOLDINGS, { ticker: 'ZZZZ', shares: 1, costBasis: 1, sector: 'tech' }])).toBe(false);
  });

  it('still says demo when only the marks moved, since the names are the giveaway', () => {
    const remarked = SEED_HOLDINGS.map((h) => ({ ...h, costBasis: h.costBasis * 1.1 }));
    expect(isSeedBook(remarked)).toBe(true);
  });
});
