import type { PortfolioReadResult } from './provider/claude';
import { SECTORS, type AllocationMoveKind, type SectorId } from '@/domain/types';

/**
 * Handing the portfolio read to a conversation and back.
 *
 * The read is the most valuable thing in this app and the only part that
 * needs judgement rather than arithmetic — and it is also the part the owner
 * cannot buy, because a Claude.ai subscription is not API access. The way
 * out is not a lesser model: it is to let the conversation do the work. The
 * app packages the book as text, the owner pastes it into the session they
 * already pay for, and pastes the answer back.
 *
 * Which makes this file the airlock, and it is written like one. Anything
 * coming back in is treated as untrusted text: shape-checked field by field,
 * numbers bounded, sectors matched against the app's own list, and every
 * complaint reported in words the owner can act on. A malformed paste must
 * fail loudly rather than half-populate the screen that drives real trades.
 */

export interface ParseOutcome {
  ok: boolean;
  /** What to say on screen — the reason it failed, or what was accepted. */
  message: string;
  result?: PortfolioReadResult;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const pct = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= -1000 && v <= 1000 ? v : null;

/** Tickers, uppercased and filtered to things that look like tickers. */
function tickers(v: unknown): string[] {
  return arr(v)
    .map((t) => String(t ?? '').trim().toUpperCase())
    .filter((t) => /^[A-Z][A-Z.\-]{0,6}$/.test(t));
}

/**
 * The sector a label means. The prompt states the seven ids, but a reader
 * writing prose reaches for the word rather than the key — "defense" for
 * industrials, "health" for healthcare — and dropping that row silently
 * breaks the mix total, which then rejects the entire read. Recognising a
 * synonym is not inventing data; it is reading the label the app itself
 * prints on that slice.
 */
const SECTOR_ALIASES: Record<string, SectorId> = {
  defense: 'industrials',
  defence: 'industrials',
  aerospace: 'industrials',
  industrial: 'industrials',
  health: 'healthcare',
  healthcare: 'healthcare',
  pharma: 'healthcare',
  technology: 'tech',
  software: 'tech',
  ai: 'tech',
  utilities: 'power',
  nuclear: 'power',
  energy: 'power',
  finance: 'financials',
  financial: 'financials',
  banks: 'financials',
  'cash & equivalents': 'cash',
  'cash-like': 'cash',
};

function toSector(v: unknown): SectorId | null {
  const raw = String(v ?? '').trim().toLowerCase();
  if (!raw) return null;
  const direct = SECTORS.find((s) => s.id === raw);
  if (direct) return direct.id;
  const byLabel = SECTORS.find(
    (s) => s.label.toLowerCase() === raw || s.short.toLowerCase() === raw,
  );
  if (byLabel) return byLabel.id;
  return SECTOR_ALIASES[raw] ?? null;
}

function severity(v: unknown): 'good' | 'watch' | 'risk' {
  const s = String(v ?? '').toLowerCase();
  return s === 'good' || s === 'risk' ? s : 'watch';
}

/**
 * The prompt handed to the conversation, with the book baked in. It states
 * the output contract exactly, because a read that comes back in the wrong
 * shape is a read the owner has to redo.
 */
export function buildReadRequest(bookSummary: string, previous?: string): string {
  return [
    'You are doing the portfolio read for my investment app. Study the book below and answer with ONE fenced ```json block and nothing else — no preamble, no commentary after it.',
    '',
    'The JSON must have exactly these keys:',
    '{',
    '  "headline": "one sentence a person would repeat out loud",',
    '  "whatThisBookIs": "what this portfolio is actually betting on, in plain words",',
    '  "observations": [{ "title": "...", "detail": "...", "severity": "good|watch|risk", "tickers": ["..."] }],',
    '  "themeClusters": [{ "theme": "...", "tickers": ["..."], "weightPct": 12.5, "why": "why these move together" }],',
    '  "biggestRisk": "the single biggest risk, named rather than hedged",',
    '  "nextAction": "the most useful thing to do next, and why",',
    '  "blindSpots": ["what is not knowable from the data on file"],',
    '  "allocation": {',
    '    "targetMix": [{ "sector": "tech", "targetPct": 24, "previousPct": null, "why": "why this number" }],',
    '    "cashFloorPct": 25, "maxPositionPct": 16, "reasoning": "how the mix was set",',
    '    "moves": [{ "kind": "trim|add|exit|enter|hold|raise-cash", "ticker": "PLTR", "sector": null, "sizePctOfNlv": 3, "action": "what to do", "basis": "the figure behind it", "urgency": "now|soon|watch" }],',
    '    "caveats": ["what would make this wrong"]',
    '  }',
    '}',
    '',
    `Sector ids must come from this list: ${SECTORS.map((s) => s.id).join(', ')}. targetMix must total 100.`,
    'Every move must cite a figure from the book in "basis". Do not invent numbers that are not below; if something matters and is missing, say so in blindSpots.',
    '',
    previous ? previous + '\n' : '',
    'THE BOOK:',
    bookSummary,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Read back what the conversation produced. Accepts a bare JSON object or one
 * inside a fenced block, because a person copying an answer out of a chat
 * will copy the fence with it more often than not.
 */
export function parsePastedRead(text: string): ParseOutcome {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, message: 'Nothing was pasted.' };

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1]! : raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return { ok: false, message: 'That does not contain a JSON object. Copy the whole ```json block.' };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch (e) {
    return {
      ok: false,
      message: `The JSON did not parse: ${e instanceof Error ? e.message : 'unknown error'}. Paste the block exactly as it was written.`,
    };
  }

  const headline = str(parsed.headline);
  if (!headline) {
    return { ok: false, message: 'The read has no headline, so this is probably not a portfolio read.' };
  }

  const complaints: string[] = [];

  const allocationRaw = parsed.allocation as Record<string, unknown> | undefined;
  let allocation: PortfolioReadResult['allocation'] = undefined;
  if (allocationRaw && typeof allocationRaw === 'object') {
    const mix = arr(allocationRaw.targetMix)
      .map((m) => m as Record<string, unknown>)
      .map((m) => ({
        sector: toSector(m.sector),
        raw: String(m.sector ?? ''),
        targetPct: pct(m.targetPct),
        previousPct: pct(m.previousPct),
        why: str(m.why) ?? '',
      }))
      .filter((m) => {
        if (!m.sector) complaints.push(`unknown sector "${m.raw}" was dropped`);
        return m.sector != null && m.targetPct != null;
      })
      .map(({ raw, ...m }) => {
        void raw;
        return { ...m, sector: m.sector as SectorId, targetPct: m.targetPct as number };
      });

    const total = mix.reduce((s, m) => s + m.targetPct, 0);
    // The screens measure drift against this mix; a total that is not 100
    // makes every sector look over- or under-weight at once. Better to reject
    // the read than to draw a confidently wrong page from it.
    if (mix.length && Math.abs(total - 100) > 1.5) {
      return {
        ok: false,
        message: `The target mix totals ${total.toFixed(1)}%, not 100%. Ask for it again — every sector would read as drifting.`,
      };
    }

    allocation = {
      targetMix: mix,
      cashFloorPct: pct(allocationRaw.cashFloorPct),
      maxPositionPct: pct(allocationRaw.maxPositionPct),
      reasoning: str(allocationRaw.reasoning) ?? '',
      moves: arr(allocationRaw.moves)
        .map((m) => m as Record<string, unknown>)
        .map((m) => {
          const kind = String(m.kind ?? '').toLowerCase();
          // The app's own vocabulary, not an approximation of it: a kind it
          // does not know would render as a blank pill and apply as nothing.
          const known: AllocationMoveKind[] = ['trim', 'exit', 'add', 'enter', 'raise-cash', 'hold'];
          return {
            kind: (known.includes(kind as AllocationMoveKind) ? kind : 'hold') as AllocationMoveKind,
            ticker: str(m.ticker)?.toUpperCase() ?? null,
            sector: toSector(m.sector),
            sizePctOfNlv: pct(m.sizePctOfNlv),
            action: str(m.action) ?? '',
            basis: str(m.basis) ?? '',
            urgency: (['now', 'soon', 'watch'].includes(String(m.urgency))
              ? String(m.urgency)
              : 'watch') as 'now' | 'soon' | 'watch',
          };
        })
        .filter((m) => m.action.length > 0),
      caveats: arr(allocationRaw.caveats).map((c) => String(c)).filter(Boolean),
    };
  } else {
    complaints.push('no allocation block, so the sector targets are unchanged');
  }

  const result: PortfolioReadResult = {
    headline,
    whatThisBookIs: str(parsed.whatThisBookIs) ?? '',
    observations: arr(parsed.observations)
      .map((o) => o as Record<string, unknown>)
      .map((o) => ({
        title: str(o.title) ?? '',
        detail: str(o.detail) ?? '',
        severity: severity(o.severity),
        tickers: tickers(o.tickers),
      }))
      .filter((o) => o.title || o.detail),
    themeClusters: arr(parsed.themeClusters)
      .map((t) => t as Record<string, unknown>)
      .map((t) => ({
        theme: str(t.theme) ?? '',
        tickers: tickers(t.tickers),
        weightPct: pct(t.weightPct),
        why: str(t.why) ?? '',
      }))
      .filter((t) => t.theme),
    biggestRisk: str(parsed.biggestRisk) ?? '',
    nextAction: str(parsed.nextAction) ?? '',
    blindSpots: arr(parsed.blindSpots).map((b) => String(b)).filter(Boolean),
    allocation,
  };

  const moves = allocation?.moves.length ?? 0;
  return {
    ok: true,
    result,
    message:
      `Read applied: ${result.observations.length} observation${result.observations.length === 1 ? '' : 's'}, ` +
      `${moves} move${moves === 1 ? '' : 's'} pinned` +
      (complaints.length ? ` — ${complaints.join('; ')}.` : '.'),
  };
}
