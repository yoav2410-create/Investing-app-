import { resolveTargets, stanceProblems, summariseSimulation } from '@/domain/allocation';
import type { AllocationStance, RebalancePlan } from '@/domain/types';
import { runSimulation, DEFAULT_ASSUMPTIONS } from '@/domain/montecarlo';
import { SEED_HOLDINGS, SEED_STOCKS } from '@/data/seed';

const plan: RebalancePlan = {
  name: 'test',
  summary: '',
  legs: [],
  constraints: {
    cashFloorPct: 0.25,
    maxPositionPct: 0.16,
    targetMix: {
      tech: 0.24,
      industrials: 0.16,
      consumer: 0.1,
      power: 0.1,
      financials: 0.08,
      healthcare: 0.07,
      cash: 0.25,
    },
  },
};

function stance(over: Partial<AllocationStance> = {}): AllocationStance {
  return {
    targetMix: [
      { sector: 'tech', targetPct: 28, previousPct: 24, why: 'because' },
      { sector: 'cash', targetPct: 72, previousPct: 25, why: 'because' },
    ],
    cashFloorPct: 30,
    maxPositionPct: 12,
    reasoning: 'r',
    moves: [
      {
        kind: 'trim',
        ticker: 'PLTR',
        sector: null,
        sizePctOfNlv: 4,
        action: 'a',
        basis: 'top weight 14.5%',
        urgency: 'now',
      },
    ],
    caveats: [],
    ...over,
  };
}

describe('resolveTargets', () => {
  it('falls back to the bundled plan and says so when no read is on file', () => {
    const r = resolveTargets(plan, null);
    expect(r.source).toBe('seed');
    // The plan stores shares; the screen and the model speak percentages.
    expect(r.mix.tech).toBeCloseTo(24);
    expect(r.mix.cash).toBeCloseTo(25);
    expect(r.label).toMatch(/bundled plan/i);
    expect(r.asOf).toBeNull();
  });

  it('prefers the read, and carries its timestamp and reasoning', () => {
    const r = resolveTargets(plan, { at: '2026-08-19T10:00:00Z', stance: stance() });
    expect(r.source).toBe('manual');
    expect(r.mix.tech).toBe(28);
    expect(r.asOf).toBe('2026-08-19T10:00:00Z');
    expect(r.why.tech).toBe('because');
  });

  it('does not invent a target for a sector the read did not name', () => {
    const r = resolveTargets(plan, { at: 'x', stance: stance() });
    // The stance named only tech and cash. Healthcare must be absent rather
    // than zero — zero is a claim that it should hold nothing.
    expect(r.mix.healthcare).toBeUndefined();
    expect('healthcare' in r.mix).toBe(false);
  });

  it('falls back when a read exists but carries no stance', () => {
    const r = resolveTargets(plan, { at: 'x', stance: null });
    expect(r.source).toBe('seed');
  });

  it('falls back when the stance has an empty mix', () => {
    const r = resolveTargets(plan, { at: 'x', stance: stance({ targetMix: [] }) });
    expect(r.source).toBe('seed');
  });
});

describe('stanceProblems', () => {
  it('accepts a mix that totals 100', () => {
    expect(stanceProblems(stance())).toEqual([]);
  });

  it('catches a mix that does not total 100', () => {
    // This is the failure worth catching: 80% would make every sector look
    // underweight and the drift list would be confidently wrong.
    const bad = stance({
      targetMix: [
        { sector: 'tech', targetPct: 30, previousPct: null, why: 'w' },
        { sector: 'cash', targetPct: 50, previousPct: null, why: 'w' },
      ],
    });
    expect(stanceProblems(bad).join(' ')).toMatch(/total 80\.0%/);
  });

  it('tolerates rounding but not real drift', () => {
    const rounded = stance({
      targetMix: [
        { sector: 'tech', targetPct: 33.3, previousPct: null, why: 'w' },
        { sector: 'power', targetPct: 33.3, previousPct: null, why: 'w' },
        { sector: 'cash', targetPct: 33.3, previousPct: null, why: 'w' },
      ],
    });
    expect(stanceProblems(rounded)).toEqual([]);
  });

  it('catches a duplicated sector', () => {
    const dup = stance({
      targetMix: [
        { sector: 'tech', targetPct: 50, previousPct: null, why: 'w' },
        { sector: 'tech', targetPct: 50, previousPct: null, why: 'w' },
      ],
    });
    expect(stanceProblems(dup).join(' ')).toMatch(/twice/);
  });

  it('catches a target that is not a share of the book', () => {
    const silly = stance({
      targetMix: [
        { sector: 'tech', targetPct: 140, previousPct: null, why: 'w' },
        { sector: 'cash', targetPct: -40, previousPct: null, why: 'w' },
      ],
    });
    const out = stanceProblems(silly).join(' ');
    expect(out).toMatch(/140/);
    expect(out).toMatch(/-40/);
  });

  it('flags a move that cites no figure, but lets a hold through', () => {
    const noBasis = stance({
      moves: [
        { kind: 'exit', ticker: 'VST', sector: null, sizePctOfNlv: null, action: 'a', basis: '  ', urgency: 'now' },
      ],
    });
    expect(stanceProblems(noBasis).join(' ')).toMatch(/cites no figure/);

    const hold = stance({
      moves: [
        { kind: 'hold', ticker: null, sector: null, sizePctOfNlv: null, action: 'a', basis: '', urgency: 'watch' },
      ],
    });
    expect(stanceProblems(hold)).toEqual([]);
  });

  it('catches a cash floor that is not a percentage', () => {
    expect(stanceProblems(stance({ cashFloorPct: 250 })).join(' ')).toMatch(/Cash floor/);
  });
});

describe('summariseSimulation', () => {
  it('reports the spread the stance is meant to reason from', () => {
    const sim = runSimulation(SEED_HOLDINGS, SEED_STOCKS, 15000, 104691, DEFAULT_ASSUMPTIONS);
    const text = summariseSimulation(sim);
    expect(text).toMatch(/Monte Carlo over \d+ years/);
    expect(text).toMatch(/worst 5%/);
    expect(text).toMatch(/beats the S&P/);
    expect(text).toMatch(/effective beta/);
    // The shared-factor caveat is the reason the downside is believable; it
    // must reach the model rather than being left in a code comment.
    expect(text).toMatch(/shared market factor/);
  });
});
