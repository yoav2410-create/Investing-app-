import { buildReadRequest, parsePastedRead } from '@/data/readExchange';

/**
 * This parser is the one place in the app where text a person pasted becomes
 * the numbers that drive sector targets and a trade checklist. So the tests
 * are mostly about what it refuses.
 */

const MINIMAL = {
  headline: 'Concentrated in AI infrastructure, and under the cash floor.',
  whatThisBookIs: 'A levered bet on data-centre buildout.',
  observations: [
    { title: 'PLTR is oversized', detail: 'It is 19.7% of the book.', severity: 'risk', tickers: ['PLTR'] },
  ],
  themeClusters: [{ theme: 'AI buildout', tickers: ['PLTR', 'VST'], weightPct: 31.2, why: 'Same demand driver.' }],
  biggestRisk: 'One theme dressed as five sectors.',
  nextAction: 'Trim PLTR to the cap and hold the proceeds.',
  blindSpots: ['No view on private credit exposure.'],
  allocation: {
    targetMix: [
      { sector: 'tech', targetPct: 40, previousPct: 45, why: 'Still the engine, but capped.' },
      { sector: 'cash', targetPct: 60, previousPct: 55, why: 'Dry powder while the VIX is low.' },
    ],
    cashFloorPct: 25,
    maxPositionPct: 16,
    reasoning: 'Sized off the drawdown in the projection.',
    moves: [
      { kind: 'trim', ticker: 'PLTR', sector: null, sizePctOfNlv: 3.7, action: 'Trim PLTR to 16%.', basis: 'weight 19.7% against a 16% cap', urgency: 'now' },
    ],
    caveats: ['Assumes the cost basis on file is right.'],
  },
};

const wrap = (o: unknown) => '```json\n' + JSON.stringify(o, null, 2) + '\n```';

describe('taking a portfolio read back from a conversation', () => {
  it('accepts a fenced block and keeps every field', () => {
    const out = parsePastedRead(wrap(MINIMAL));
    expect(out.ok).toBe(true);
    expect(out.result!.headline).toBe(MINIMAL.headline);
    expect(out.result!.allocation!.targetMix).toHaveLength(2);
    expect(out.result!.allocation!.moves[0]!.kind).toBe('trim');
    expect(out.result!.allocation!.moves[0]!.sizePctOfNlv).toBeCloseTo(3.7, 4);
  });

  it('accepts a bare object, and prose either side of it', () => {
    const messy = `Here is the read you asked for:\n\n${JSON.stringify(MINIMAL)}\n\nHope that helps!`;
    expect(parsePastedRead(messy).ok).toBe(true);
  });

  it('refuses a mix that does not total 100, rather than making every sector drift', () => {
    const bad = { ...MINIMAL, allocation: { ...MINIMAL.allocation, targetMix: [
      { sector: 'tech', targetPct: 40, previousPct: null, why: 'x' },
      { sector: 'cash', targetPct: 30, previousPct: null, why: 'x' },
    ] } };
    const out = parsePastedRead(wrap(bad));
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/70.0%/);
  });

  it('drops a sector the app does not know and says so', () => {
    const bad = { ...MINIMAL, allocation: { ...MINIMAL.allocation, targetMix: [
      { sector: 'tech', targetPct: 40, previousPct: null, why: 'x' },
      { sector: 'cash', targetPct: 60, previousPct: null, why: 'x' },
      { sector: 'crypto', targetPct: 0, previousPct: null, why: 'x' },
    ] } };
    const out = parsePastedRead(wrap(bad));
    expect(out.ok).toBe(true);
    expect(out.result!.allocation!.targetMix).toHaveLength(2);
    expect(out.message).toMatch(/unknown sector "crypto"/);
  });

  it('falls back to hold for a move kind the app cannot act on', () => {
    const bad = { ...MINIMAL, allocation: { ...MINIMAL.allocation, moves: [
      { kind: 'yolo', ticker: 'PLTR', sector: null, sizePctOfNlv: 3, action: 'Do something.', basis: 'x', urgency: 'now' },
    ] } };
    expect(parsePastedRead(wrap(bad)).result!.allocation!.moves[0]!.kind).toBe('hold');
  });

  it('drops a move with no action rather than pinning a blank checklist row', () => {
    const bad = { ...MINIMAL, allocation: { ...MINIMAL.allocation, moves: [
      { kind: 'trim', ticker: 'PLTR', sector: null, sizePctOfNlv: 3, action: '', basis: 'x', urgency: 'now' },
    ] } };
    expect(parsePastedRead(wrap(bad)).result!.allocation!.moves).toHaveLength(0);
  });

  it('rejects text that is not a read at all', () => {
    for (const junk of ['', 'hello', '```json\nnot json\n```', '{"foo":1}']) {
      expect(parsePastedRead(junk).ok).toBe(false);
    }
  });

  it('names the parse error instead of failing silently', () => {
    const out = parsePastedRead('```json\n{ "headline": "x", }\n```');
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/did not parse/i);
  });

  it('survives a read with no allocation, and says the targets are unchanged', () => {
    const { allocation, ...rest } = MINIMAL;
    void allocation;
    const out = parsePastedRead(wrap(rest));
    expect(out.ok).toBe(true);
    expect(out.result!.allocation).toBeUndefined();
    expect(out.message).toMatch(/sector targets are unchanged/);
  });

  it('throws away a ticker that is not a ticker', () => {
    const bad = { ...MINIMAL, observations: [
      { title: 't', detail: 'd', severity: 'risk', tickers: ['PLTR', 'this is a sentence', ''] },
    ] };
    expect(parsePastedRead(wrap(bad)).result!.observations[0]!.tickers).toEqual(['PLTR']);
  });
});

describe('the request handed to the conversation', () => {
  it('carries the book, the previous moves and the output contract', () => {
    const prompt = buildReadRequest('BOOK GOES HERE', 'Previous recommendations: trim PLTR [executed]');
    expect(prompt).toContain('BOOK GOES HERE');
    expect(prompt).toContain('trim PLTR [executed]');
    expect(prompt).toContain('"targetMix"');
    expect(prompt).toContain('targetMix must total 100');
    // The sector list must be the app's own, or the answer cannot be applied.
    expect(prompt).toMatch(/tech, /);
  });
});

describe('sector labels a reader actually writes', () => {
  const mixWith = (sectors: [string, number][]) => ({
    headline: 'x',
    allocation: {
      targetMix: sectors.map(([sector, targetPct]) => ({ sector, targetPct, previousPct: null, why: 'w' })),
      cashFloorPct: 25, maxPositionPct: 16, reasoning: 'r', moves: [], caveats: [],
    },
  });

  it('accepts the words the app itself prints on the slices', () => {
    const out = parsePastedRead(JSON.stringify(mixWith([['defense', 30], ['health', 20], ['Tech/AI', 30], ['cash', 20]])));
    expect(out.ok).toBe(true);
    expect(out.result!.allocation!.targetMix.map((m) => m.sector).sort()).toEqual(
      ['cash', 'healthcare', 'industrials', 'tech'],
    );
  });

  it('still refuses a sector that means nothing here', () => {
    const out = parsePastedRead(JSON.stringify(mixWith([['tech', 60], ['crypto', 20], ['cash', 20]])));
    expect(out.ok).toBe(false); // dropping crypto leaves 80%, which must not pass
    expect(out.message).toMatch(/80.0%/);
  });
});
