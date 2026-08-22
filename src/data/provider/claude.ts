import Anthropic from '@anthropic-ai/sdk';
import type { AllocationStance, Holding, SectorId, Verdict } from '@/domain/types';
import { SECTORS } from '@/domain/types';

/**
 * Claude integration.
 *
 * Two jobs, both on the Messages API with Claude Opus 5:
 *
 *   1. `readPositionsFromImage` — the owner photographs their broker's
 *      positions screen; Claude reads it and returns structured positions.
 *      This is how prices and share counts get into the app. There is no
 *      market-data subscription behind it and none is needed: the screenshot
 *      already carries the marks the broker is using.
 *
 *   2. `researchStock` — Claude fills in the analytical layer for one ticker
 *      (multiples, reported figures, trend read, catalyst, risk, verdict),
 *      using web search so the figures are current rather than recalled.
 *
 * Both use tool-shaped structured output: a single tool with `strict: true`
 * whose input schema *is* the return type. That is what stops the model from
 * answering in prose when the app needs JSON.
 */

export const CLAUDE_MODEL = 'claude-opus-5';

export interface ClaudeOptions {
  apiKey: string;
  /** Needed for the web preview; native builds do not set it. */
  allowBrowser?: boolean;
}

export function createClaude({ apiKey, allowBrowser }: ClaudeOptions): Anthropic {
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: allowBrowser,
    maxRetries: 2,
  });
}

// ---------------------------------------------------------------------------
// 1. Reading positions out of a broker screenshot
// ---------------------------------------------------------------------------

export interface ParsedPosition {
  ticker: string;
  companyName: string | null;
  shares: number | null;
  price: number | null;
  marketValue: number | null;
  averageCost: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  dayChangePct: number | null;
  /** 0–1. Anything the model could only partially read comes back low. */
  confidence: number;
  /** What was unreadable, in the model's words. */
  note: string | null;
}

export interface ParsedAccount {
  netLiquidationValue: number | null;
  cashUsd: number | null;
  dayPnl: number | null;
  unrealizedPnl: number | null;
  asOfLabel: string | null;
}

export interface PositionsReadResult {
  positions: ParsedPosition[];
  account: ParsedAccount;
  /** Model's summary of anything it could not read confidently. */
  warnings: string[];
}

const POSITIONS_TOOL: Anthropic.Tool = {
  name: 'report_positions',
  description:
    'Report every position and account figure visible in the screenshot. Report only what is actually legible; never infer a number that is not shown.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['positions', 'account', 'warnings'],
    properties: {
      positions: {
        type: 'array',
        description: 'One entry per position row visible in the image.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'ticker',
            'companyName',
            'shares',
            'price',
            'marketValue',
            'averageCost',
            'unrealizedPnl',
            'unrealizedPnlPct',
            'dayChangePct',
            'confidence',
            'note',
          ],
          properties: {
            ticker: { type: 'string', description: 'Exchange ticker, uppercase.' },
            companyName: { type: ['string', 'null'] },
            shares: { type: ['number', 'null'], description: 'Negative for a short position.' },
            price: { type: ['number', 'null'], description: 'Last / mark price per share.' },
            marketValue: { type: ['number', 'null'] },
            averageCost: { type: ['number', 'null'], description: 'Average cost per share.' },
            unrealizedPnl: { type: ['number', 'null'] },
            unrealizedPnlPct: { type: ['number', 'null'] },
            dayChangePct: { type: ['number', 'null'] },
            confidence: {
              type: 'number',
              description: '0 to 1. Below 0.7 means at least one field was hard to read.',
            },
            note: { type: ['string', 'null'], description: 'What was unclear, if anything.' },
          },
        },
      },
      account: {
        type: 'object',
        additionalProperties: false,
        required: ['netLiquidationValue', 'cashUsd', 'dayPnl', 'unrealizedPnl', 'asOfLabel'],
        properties: {
          netLiquidationValue: { type: ['number', 'null'] },
          cashUsd: { type: ['number', 'null'] },
          dayPnl: { type: ['number', 'null'] },
          unrealizedPnl: { type: ['number', 'null'] },
          asOfLabel: {
            type: ['string', 'null'],
            description: 'Any timestamp printed on the screen, copied verbatim.',
          },
        },
      },
      warnings: {
        type: 'array',
        items: { type: 'string' },
        description: 'Rows that were cut off, blurred, or otherwise not fully readable.',
      },
    },
  },
};

const POSITIONS_SYSTEM = `You read brokerage account screenshots and transcribe them exactly.

Rules that matter more than being helpful:
- Transcribe only what is visibly printed. If a column is cut off, blurred, or scrolled out of frame, report null for that field and say so in the warnings.
- Never estimate, derive, or "fill in" a number that is not on screen. A null is always better than a plausible guess: the owner is going to trade off these figures.
- Strip currency symbols, thousands separators and percent signs. "1,234.56" becomes 1234.56, "(1,234.56)" and "-1,234.56" both become -1234.56, "+2.34%" becomes 2.34.
- Ticker symbols only, uppercase, without exchange prefixes. "NASDAQ:META" becomes "META".
- Ignore watchlist rows, order tickets, and anything that is not a held position. If you cannot tell whether a row is a holding, leave it out and note it.
- If the image is not a brokerage screen at all, return an empty positions array and say so in warnings.`;

export async function readPositionsFromImage(
  client: Anthropic,
  image: { base64: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' },
  hint?: string,
): Promise<PositionsReadResult> {
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    system: POSITIONS_SYSTEM,
    thinking: { type: 'adaptive' },
    tools: [POSITIONS_TOOL],
    tool_choice: { type: 'tool', name: 'report_positions' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
          },
          {
            type: 'text',
            text: hint
              ? `Transcribe every position in this screenshot. Context from the owner: ${hint}`
              : 'Transcribe every position in this screenshot.',
          },
        ],
      },
    ],
  });

  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'report_positions',
  );
  if (!block) {
    throw new Error(
      response.stop_reason === 'refusal'
        ? 'Claude declined to read this image.'
        : 'Claude did not return structured positions. Try a clearer screenshot.',
    );
  }
  return normaliseRead(block.input as PositionsReadResult);
}

/** Defensive tidy-up: the schema is strict but the values still come from OCR. */
function normaliseRead(raw: PositionsReadResult): PositionsReadResult {
  const positions = (raw.positions ?? [])
    .map((p) => ({
      ...p,
      ticker: String(p.ticker ?? '').trim().toUpperCase().replace(/^[A-Z]+:/, ''),
      confidence: Number.isFinite(p.confidence) ? Math.max(0, Math.min(1, p.confidence)) : 0,
    }))
    .filter((p) => /^[A-Z][A-Z.\-]{0,6}$/.test(p.ticker));
  return {
    positions,
    account: raw.account ?? {
      netLiquidationValue: null,
      cashUsd: null,
      dayPnl: null,
      unrealizedPnl: null,
      asOfLabel: null,
    },
    warnings: raw.warnings ?? [],
  };
}

/**
 * Turn a read into a holdings diff the owner can approve. Nothing is applied
 * until they do — a misread screenshot must never silently rewrite the book.
 */
export interface HoldingDiff {
  ticker: string;
  kind: 'added' | 'removed' | 'changed' | 'unchanged';
  before: { shares: number; costBasis: number } | null;
  after: { shares: number; costBasis: number } | null;
  price: number | null;
  confidence: number;
  note: string | null;
}

export function diffHoldings(
  current: Holding[],
  parsed: ParsedPosition[],
  sectorFor: (ticker: string) => SectorId,
): HoldingDiff[] {
  const byTicker = new Map(current.map((h) => [h.ticker, h]));
  const seen = new Set<string>();
  const out: HoldingDiff[] = [];

  for (const p of parsed) {
    seen.add(p.ticker);
    const existing = byTicker.get(p.ticker) ?? null;
    const shares = p.shares;
    if (shares == null) {
      out.push({
        ticker: p.ticker,
        kind: 'unchanged',
        before: existing ? { shares: existing.shares, costBasis: existing.costBasis } : null,
        after: existing ? { shares: existing.shares, costBasis: existing.costBasis } : null,
        price: p.price,
        confidence: p.confidence,
        note: 'Share count was not readable — left untouched.',
      });
      continue;
    }
    // Derive cost basis when the broker shows P&L but not average cost.
    const cost =
      p.averageCost ??
      (p.price != null && p.unrealizedPnl != null && shares !== 0
        ? p.price - p.unrealizedPnl / shares
        : (existing?.costBasis ?? p.price ?? 0));

    const after = { shares, costBasis: cost };
    if (!existing) {
      out.push({ ticker: p.ticker, kind: 'added', before: null, after, price: p.price, confidence: p.confidence, note: p.note });
    } else if (Math.abs(existing.shares - shares) > 1e-6) {
      out.push({
        ticker: p.ticker,
        kind: 'changed',
        before: { shares: existing.shares, costBasis: existing.costBasis },
        after,
        price: p.price,
        confidence: p.confidence,
        note: p.note,
      });
    } else {
      out.push({
        ticker: p.ticker,
        kind: 'unchanged',
        before: { shares: existing.shares, costBasis: existing.costBasis },
        after,
        price: p.price,
        confidence: p.confidence,
        note: p.note,
      });
    }
  }

  for (const h of current) {
    if (seen.has(h.ticker)) continue;
    out.push({
      ticker: h.ticker,
      kind: 'removed',
      before: { shares: h.shares, costBasis: h.costBasis },
      after: null,
      price: null,
      confidence: 1,
      note: 'Not present in the screenshot.',
    });
  }

  void sectorFor;
  return out.sort((a, b) => {
    const order = { changed: 0, added: 1, removed: 2, unchanged: 3 } as const;
    return order[a.kind] - order[b.kind] || a.ticker.localeCompare(b.ticker);
  });
}

// ---------------------------------------------------------------------------
// 2. Per-stock research refresh
// ---------------------------------------------------------------------------

export interface ResearchResult {
  ticker: string;
  companyName: string;
  about: string | null;
  primaryMultiple: 'evEbitda' | 'forwardPe' | 'trailingPe' | 'ps';
  primaryMultipleRationale: string;
  peerGroup: string | null;
  peerMedianMultiple: number | null;
  valuation: {
    trailingPe: number | null;
    forwardPe: number | null;
    priceToSales: number | null;
    evToEbitda: number | null;
    peg: number | null;
    profitMargin: number | null;
    operatingMargin: number | null;
    shortInterestPct: number | null;
    beta: number | null;
    week52ChangePct: number | null;
    dividendYield: number | null;
    analystTargetPrice: number | null;
    analystRating: string | null;
    week52High: number | null;
    week52Low: number | null;
    debtToEquity: number | null;
  };
  /** Newest quarter first. Revenue / income in millions of USD. */
  quarters: {
    period: string;
    revenue: number | null;
    operatingIncome: number | null;
    netIncome: number | null;
    eps: number | null;
    trailingPe: number | null;
    evToEbitda: number | null;
    priceToSales: number | null;
  }[];
  earnings: {
    date: string | null;
    quarter: string | null;
    reportedEps: number | null;
    estimatedEps: number | null;
    surprisePct: number | null;
    revenue: number | null;
    callSummary: string | null;
    managementSaid: string | null;
    guidance: string | null;
    watchNext: string | null;
    reactionPct: number | null;
    quotes: { speaker: string; text: string; topic: string | null }[];
  };
  sentiment: {
    score: number | null;
    label: 'very negative' | 'negative' | 'mixed' | 'positive' | 'very positive' | null;
    summary: string | null;
    analystRevisions: string | null;
    insiderActivity: 'buying' | 'selling' | 'quiet' | null;
    insiderDetail: string | null;
    headlines: {
      headline: string;
      source: string | null;
      date: string | null;
      url: string | null;
      sentiment: number | null;
      soWhat: string | null;
    }[];
  };
  quality: {
    returnOnEquity: number | null;
    returnOnInvestedCapital: number | null;
    grossMargin: number | null;
    freeCashFlowMargin: number | null;
    netDebtToEbitda: number | null;
    revenueCagr3y: number | null;
    revenueGrowthYoY: number | null;
    epsGrowthYoY: number | null;
    insiderOwnershipPct: number | null;
    institutionalOwnershipPct: number | null;
    shareCountChangePct: number | null;
  };
  cashFlow: {
    adjustedEbitda: number | null;
    stockBasedCompensation: number | null;
    cashInterest: number | null;
    cashTaxes: number | null;
    workingCapitalChange: number | null;
    capitalExpenditure: number | null;
    otherItems: number | null;
    operatingCashFlow: number | null;
    freeCashFlow: number | null;
  };
  momentum: {
    oneMonth: number | null;
    threeMonth: number | null;
    sixMonth: number | null;
    oneYear: number | null;
    yearToDate: number | null;
    fromHighPct: number | null;
    fromLowPct: number | null;
  };
  technicals: {
    rsi14: number | null;
    rsi20: number | null;
    sma20: number | null;
    sma50: number | null;
    sma100: number | null;
    sma200: number | null;
    plusDi: number | null;
    minusDi: number | null;
  };
  narrative: {
    thesis: string;
    catalyst: string;
    risk: string;
    bullCase: string;
    bearCase: string;
    whatWouldChangeMyMind: string;
    verdict: Verdict;
    verdictReasoning: string;
  };
  nextEarningsDate: string | null;
  sources: string[];
}

const numberOrNull = { type: ['number', 'null'] as const };

const RESEARCH_TOOL: Anthropic.Tool = {
  name: 'report_research',
  description:
    'Report the current fundamental picture for one stock. Every numeric field is null unless you found the actual figure.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'ticker',
      'companyName',
      'about',
      'primaryMultiple',
      'primaryMultipleRationale',
      'peerGroup',
      'peerMedianMultiple',
      'valuation',
      'quarters',
      'quality',
      'cashFlow',
      'momentum',
      'technicals',
      'earnings',
      'sentiment',
      'narrative',
      'nextEarningsDate',
      'sources',
    ],
    properties: {
      ticker: { type: 'string' },
      companyName: { type: 'string' },
      about: {
        type: ['string', 'null'],
        description:
          'Two or three matter-of-fact sentences on what the business is: what it makes or sells, through which channels (direct sales force, subscriptions, marketplaces, distributors, government contracts…), and who the end customer is. Description, not pitch — no adjectives of praise, no thesis. For an ETF: what the fund holds and who runs it. Null only if you genuinely could not establish it.',
      },
      primaryMultiple: {
        type: 'string',
        enum: ['evEbitda', 'forwardPe', 'trailingPe', 'ps'],
        description:
          'The multiple that is actually the right yardstick for this business: EV/EBITDA for capital-intensive or leveraged names, forward P/E for profitable growers, trailing P/E for steady earners, P/S where earnings are not yet meaningful.',
      },
      primaryMultipleRationale: { type: 'string' },
      peerGroup: { type: ['string', 'null'] },
      peerMedianMultiple: numberOrNull,
      valuation: {
        type: 'object',
        additionalProperties: false,
        required: [
          'trailingPe', 'forwardPe', 'priceToSales', 'evToEbitda', 'peg',
          'profitMargin', 'operatingMargin', 'shortInterestPct', 'beta',
          'week52ChangePct', 'dividendYield', 'analystTargetPrice',
          'analystRating', 'week52High', 'week52Low', 'debtToEquity',
        ],
        properties: {
          trailingPe: numberOrNull,
          forwardPe: numberOrNull,
          priceToSales: numberOrNull,
          evToEbitda: numberOrNull,
          peg: numberOrNull,
          profitMargin: { type: ['number', 'null'], description: 'Percent, e.g. 29.8 not 0.298.' },
          operatingMargin: { type: ['number', 'null'], description: 'Percent.' },
          shortInterestPct: numberOrNull,
          beta: numberOrNull,
          week52ChangePct: numberOrNull,
          dividendYield: { type: ['number', 'null'], description: 'Percent.' },
          analystTargetPrice: numberOrNull,
          analystRating: { type: ['string', 'null'] },
          week52High: numberOrNull,
          week52Low: numberOrNull,
          debtToEquity: numberOrNull,
        },
      },
      quarters: {
        type: 'array',
        description:
          'Twelve most recent fiscal quarters, newest first. Twelve rather than eight because the financials view rolls complete calendar years, and eight quarters can only ever complete one of them.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['period', 'revenue', 'operatingIncome', 'netIncome', 'eps', 'trailingPe', 'evToEbitda', 'priceToSales'],
          properties: {
            period: { type: 'string', description: 'Fiscal quarter end, YYYY-MM-DD.' },
            revenue: { type: ['number', 'null'], description: 'Millions of USD.' },
            operatingIncome: { type: ['number', 'null'], description: 'Millions of USD.' },
            netIncome: { type: ['number', 'null'], description: 'Millions of USD.' },
            eps: { type: ['number', 'null'], description: 'Diluted EPS for the quarter.' },
            trailingPe: { type: ['number', 'null'], description: 'Trailing P/E as at that quarter end.' },
            evToEbitda: numberOrNull,
            priceToSales: numberOrNull,
          },
        },
      },
      quality: {
        type: 'object',
        description: 'Business quality and balance-sheet health. All percentages as percentages.',
        additionalProperties: false,
        required: [
          'returnOnEquity', 'returnOnInvestedCapital', 'grossMargin',
          'freeCashFlowMargin', 'netDebtToEbitda', 'revenueCagr3y',
          'revenueGrowthYoY', 'epsGrowthYoY', 'insiderOwnershipPct',
          'institutionalOwnershipPct', 'shareCountChangePct',
        ],
        properties: {
          returnOnEquity: numberOrNull,
          returnOnInvestedCapital: numberOrNull,
          grossMargin: numberOrNull,
          freeCashFlowMargin: { type: ['number', 'null'], description: 'Free cash flow as a percent of revenue.' },
          netDebtToEbitda: { type: ['number', 'null'], description: 'Negative when the company holds net cash.' },
          revenueCagr3y: numberOrNull,
          revenueGrowthYoY: numberOrNull,
          epsGrowthYoY: numberOrNull,
          insiderOwnershipPct: numberOrNull,
          institutionalOwnershipPct: numberOrNull,
          shareCountChangePct: { type: ['number', 'null'], description: 'Year-on-year change in diluted share count. Negative means buybacks.' },
        },
      },
      cashFlow: {
        type: 'object',
        description:
          'The trailing-twelve-month walk from adjusted EBITDA down to free cash flow. All figures in millions of USD.',
        additionalProperties: false,
        required: [
          'adjustedEbitda', 'stockBasedCompensation', 'cashInterest', 'cashTaxes',
          'workingCapitalChange', 'capitalExpenditure', 'otherItems',
          'operatingCashFlow', 'freeCashFlow',
        ],
        properties: {
          adjustedEbitda: { type: ['number', 'null'], description: 'Millions of USD, TTM.' },
          stockBasedCompensation: {
            type: ['number', 'null'],
            description: 'Positive number, TTM. Reported as a positive cost even though EBITDA adds it back.',
          },
          cashInterest: { type: ['number', 'null'], description: 'Positive number, cash interest paid TTM.' },
          cashTaxes: { type: ['number', 'null'], description: 'Positive number, cash taxes paid TTM, not the income-statement charge.' },
          workingCapitalChange: {
            type: ['number', 'null'],
            description: 'Positive when working capital consumed cash, negative when it released cash.',
          },
          capitalExpenditure: { type: ['number', 'null'], description: 'Positive number, TTM purchases of property and equipment.' },
          otherItems: { type: ['number', 'null'], description: 'Signed. Anything the lines above do not capture.' },
          operatingCashFlow: { type: ['number', 'null'], description: 'As reported, TTM.' },
          freeCashFlow: { type: ['number', 'null'], description: 'As reported or as the company defines it, TTM.' },
        },
      },
      momentum: {
        type: 'object',
        description: 'Total price return over each window, in percent.',
        additionalProperties: false,
        required: ['oneMonth', 'threeMonth', 'sixMonth', 'oneYear', 'yearToDate', 'fromHighPct', 'fromLowPct'],
        properties: {
          oneMonth: numberOrNull,
          threeMonth: numberOrNull,
          sixMonth: numberOrNull,
          oneYear: numberOrNull,
          yearToDate: numberOrNull,
          fromHighPct: { type: ['number', 'null'], description: 'Percent below the 52-week high; negative.' },
          fromLowPct: { type: ['number', 'null'], description: 'Percent above the 52-week low; positive.' },
        },
      },
      technicals: {
        type: 'object',
        description: 'Current technical readings. Null anything you cannot source.',
        additionalProperties: false,
        required: ['rsi14', 'rsi20', 'sma20', 'sma50', 'sma100', 'sma200', 'plusDi', 'minusDi'],
        properties: {
          rsi14: numberOrNull,
          rsi20: numberOrNull,
          sma20: { type: ['number', 'null'], description: '20-day simple moving average, in price terms.' },
          sma50: numberOrNull,
          sma100: numberOrNull,
          sma200: numberOrNull,
          plusDi: { type: ['number', 'null'], description: '+DI, 14 period.' },
          minusDi: { type: ['number', 'null'], description: '-DI, 14 period.' },
        },
      },
      earnings: {
        type: 'object',
        additionalProperties: false,
        required: [
          'date', 'quarter', 'reportedEps', 'estimatedEps', 'surprisePct', 'revenue',
          'callSummary', 'managementSaid', 'guidance', 'watchNext', 'reactionPct', 'quotes',
        ],
        properties: {
          date: { type: ['string', 'null'], description: 'YYYY-MM-DD.' },
          quarter: { type: ['string', 'null'] },
          reportedEps: numberOrNull,
          estimatedEps: numberOrNull,
          surprisePct: numberOrNull,
          revenue: { type: ['number', 'null'], description: 'Absolute USD for the quarter.' },
          callSummary: {
            type: ['string', 'null'],
            description:
              'Two or three sentences on the call as a whole: what the numbers showed, what management emphasised, and how the tone compared with the previous quarter.',
          },
          managementSaid: {
            type: ['string', 'null'],
            description:
              'What management actually said, with specific figures. Do not invent quotes — if you have the figures but not the words, give the figures and say the commentary is not sourced.',
          },
          guidance: { type: ['string', 'null'] },
          watchNext: { type: ['string', 'null'] },
          reactionPct: {
            type: ['number', 'null'],
            description: 'How the shares moved on the day of the report, in percent.',
          },
          quotes: {
            type: 'array',
            description:
              'Two to four verbatim lines from the call, chosen for substance: what the CEO or CFO said about demand momentum, backlog or bookings, forward guidance, or the margin trajectory — the sentences a holder would underline, not pleasantries. Only include a quote you actually found in a transcript or reputable report of the call; an empty array is correct when you did not.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['speaker', 'text', 'topic'],
              properties: {
                speaker: { type: 'string', description: 'Name and role, e.g. "Susan Li, CFO".' },
                text: { type: 'string' },
                topic: {
                  type: ['string', 'null'],
                  description:
                    'One or two words on what the line is about: "momentum", "backlog", "guidance", "margins". Null if it fits none.',
                },
              },
            },
          },
        },
      },
      sentiment: {
        type: 'object',
        description: 'How the market is currently talking about this name.',
        additionalProperties: false,
        required: ['score', 'label', 'summary', 'analystRevisions', 'insiderActivity', 'insiderDetail', 'headlines'],
        properties: {
          score: {
            type: ['number', 'null'],
            description: 'Weighted tone of recent coverage, -1 to +1.',
          },
          label: {
            type: ['string', 'null'],
            enum: ['very negative', 'negative', 'mixed', 'positive', 'very positive', null],
          },
          summary: {
            type: ['string', 'null'],
            description: 'One paragraph on what is driving the tone right now.',
          },
          analystRevisions: {
            type: ['string', 'null'],
            description: 'Target and rating changes since the last quarter, with the firms named.',
          },
          insiderActivity: {
            type: ['string', 'null'],
            enum: ['buying', 'selling', 'quiet', null],
            description:
              'Net direction of insider open-market filings over roughly the last quarter. Weigh purchases far above sales, ignore routine 10b5-1 programs and option exercises, and use null only when you could not find filing data at all.',
          },
          insiderDetail: {
            type: ['string', 'null'],
            description:
              'The filings behind that read: who, roughly how much, and when — e.g. "CFO bought $2.1M on the post-earnings dip; two scheduled sales otherwise." Null only when insiderActivity is null.',
          },
          headlines: {
            type: 'array',
            description: 'Up to six recent pieces of coverage, newest first.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['headline', 'source', 'date', 'url', 'sentiment', 'soWhat'],
              properties: {
                headline: { type: 'string' },
                source: { type: ['string', 'null'] },
                date: { type: ['string', 'null'], description: 'YYYY-MM-DD.' },
                url: { type: ['string', 'null'] },
                sentiment: { type: ['number', 'null'], description: '-1 to +1.' },
                soWhat: {
                  type: ['string', 'null'],
                  description: 'One line on why a holder should care. Not a restatement of the headline.',
                },
              },
            },
          },
        },
      },
      narrative: {
        type: 'object',
        additionalProperties: false,
        required: ['thesis', 'catalyst', 'risk', 'bullCase', 'bearCase', 'whatWouldChangeMyMind', 'verdict', 'verdictReasoning'],
        properties: {
          thesis: { type: 'string', description: 'One line, under 90 characters.' },
          catalyst: { type: 'string', description: 'The specific, dated thing that could re-rate the shares.' },
          risk: { type: 'string' },
          bullCase: { type: 'string', description: 'The strongest honest case for owning it, stated without hedging.' },
          bearCase: { type: 'string', description: 'The strongest honest case against, stated without hedging.' },
          whatWouldChangeMyMind: {
            type: 'string',
            description: 'One concrete, observable thing that would flip the verdict. Must be checkable, not a mood.',
          },
          verdict: { type: 'string', enum: ['buy', 'add', 'hold', 'trim', 'sell', 'challenge', 'watch'] },
          verdictReasoning: { type: 'string' },
        },
      },
      nextEarningsDate: { type: ['string', 'null'], description: 'YYYY-MM-DD if scheduled.' },
      sources: { type: 'array', items: { type: 'string' }, description: 'URLs you actually used.' },
    },
  },
};

function researchSystem(today: string): string {
  return `You are the analyst behind a single investor's daily portfolio brief. Today is ${today}.

Use web search to get current figures. Do not answer from memory — filings, multiples and analyst targets move, and a stale number here becomes a trade.

Standards:
- Every numeric field is null unless you found the actual reported figure. Never interpolate a quarter you could not find.
- Percentages are percentages: an operating margin of 34.8% is 34.8, not 0.348.
- Revenue, operating income and net income in the quarters array are millions of USD.
- managementSaid must be grounded in what was actually said or reported. Quote only what you can source. If you have the figures but not the words, give the figures and say the commentary is not sourced.
- The quotes array is the owner's window into the room: search for the call transcript (or detailed coverage of it) and bring back the CEO's or CFO's own sentences on demand momentum, backlog or bookings, and the guidance they gave — the words behind the numbers, each attributed and labelled by topic. A paraphrase is not a quote; put paraphrases in managementSaid.
- Pick primaryMultiple honestly: EV/EBITDA where debt matters, forward P/E for a profitable grower, P/S where earnings are not yet meaningful. Say why in one sentence.
- The verdict is a judgement and should read like one: state what would change your mind. Do not hedge into meaninglessness, and do not pretend to a confidence the evidence does not support.
- For an ETF, most company fields are legitimately null. Say so rather than inventing a P/E.
- The cash-flow walk matters more than any multiple: report the lines from the actual cash-flow statement, not from the income statement. Cash taxes and cash interest are what was paid, which is usually not the reported charge. Report every deduction as a positive number.
- Sentiment is about coverage and analyst behaviour, not your own opinion. Cite real pieces with their source and date, and make soWhat say why a holder cares rather than restating the headline.
- Prefer coverage from the last 30 days. If the most recent thing you can find is months old, say that in the summary — silence reads as "nothing happened", which is a different claim.
- whatWouldChangeMyMind must name something observable — a margin level, a guidance change, a moving-average break — not a feeling. If you cannot name one, your verdict is not well formed; go back and sharpen it.`;
}

export async function researchStock(
  client: Anthropic,
  ticker: string,
  context?: { name?: string; shares?: number; costBasis?: number; planNote?: string },
): Promise<ResearchResult> {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [`Research ${ticker}${context?.name ? ` (${context.name})` : ''}.`];
  if (context?.shares != null) {
    lines.push(
      `The owner holds ${context.shares} shares at an average cost of ${context.costBasis ?? 'unknown'}.`,
    );
  }
  if (context?.planNote) lines.push(`Their current plan for this name: ${context.planNote}`);
  lines.push(
    'Search for the most recent information available: the latest earnings call and what was',
    'actually said on it, current analyst targets and any revisions, and news coverage from the',
    'last month. Then report the full picture through the report_research tool.',
  );

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    system: researchSystem(today),
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    tools: [
      { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
      RESEARCH_TOOL,
    ],
    messages: [{ role: 'user', content: lines.join('\n') }],
  });

  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'report_research',
  );
  if (!block) {
    throw new Error(
      response.stop_reason === 'refusal'
        ? 'Claude declined this research request.'
        : `Claude did not return structured research for ${ticker}.`,
    );
  }
  return block.input as ResearchResult;
}

// ---------------------------------------------------------------------------
// 3. Portfolio-level read
// ---------------------------------------------------------------------------

/**
 * The model does not compute any of the figures here — they arrive already
 * calculated from `src/domain/insights.ts`. Its job is the part arithmetic
 * cannot do: noticing that three positions in three different sectors are one
 * bet, or that the cheap half of the book is cheap for the same reason.
 */
export interface PortfolioReadResult {
  headline: string;
  /** What the book is actually betting on, in the owner's terms. */
  whatThisBookIs: string;
  observations: {
    title: string;
    detail: string;
    severity: 'good' | 'watch' | 'risk';
    /** Tickers this observation is about. */
    tickers: string[];
  }[];
  /** Groups that would move together regardless of their sector labels. */
  themeClusters: {
    theme: string;
    tickers: string[];
    weightPct: number | null;
    why: string;
  }[];
  /** The single biggest risk, named rather than hedged. */
  biggestRisk: string;
  /** The most useful thing to do next, and why. */
  nextAction: string;
  /** What is not knowable from the data on file. */
  blindSpots: string[];
  /**
   * The recommended shape of the book, and the moves that would get there.
   *
   * Optional in the type, not in the schema: reads written before this existed
   * are still on file in the owner's storage, and a stored read with no stance
   * has to keep rendering rather than crash the Insights screen.
   */
  allocation?: AllocationStance;
}

const PORTFOLIO_TOOL: Anthropic.Tool = {
  name: 'report_portfolio_read',
  description:
    'Report the cross-cutting read on a portfolio, given figures that have already been computed.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'headline',
      'whatThisBookIs',
      'observations',
      'themeClusters',
      'biggestRisk',
      'nextAction',
      'blindSpots',
      'allocation',
    ],
    properties: {
      headline: {
        type: 'string',
        description: 'One sentence a person could read and immediately know where they stand.',
      },
      whatThisBookIs: {
        type: 'string',
        description:
          'Two or three sentences on what this portfolio is actually betting on, stripped of sector labels.',
      },
      observations: {
        type: 'array',
        description: 'Four to seven things worth knowing, most important first.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'detail', 'severity', 'tickers'],
          properties: {
            title: { type: 'string', description: 'Under 60 characters.' },
            detail: { type: 'string', description: 'Two sentences at most. Cite the figure you are reasoning from.' },
            severity: { type: 'string', enum: ['good', 'watch', 'risk'] },
            tickers: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      themeClusters: {
        type: 'array',
        description:
          'Groups of holdings that would move together for the same underlying reason, even when they sit in different sectors. Empty array if the book has none.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['theme', 'tickers', 'weightPct', 'why'],
          properties: {
            theme: { type: 'string', description: 'Short name, e.g. "AI infrastructure build-out".' },
            tickers: { type: 'array', items: { type: 'string' } },
            weightPct: { type: ['number', 'null'], description: 'Combined share of the book, if you can total it.' },
            why: { type: 'string', description: 'The shared driver, in one sentence.' },
          },
        },
      },
      biggestRisk: {
        type: 'string',
        description: 'Name it specifically. "Market risk" is not an answer.',
      },
      nextAction: {
        type: 'string',
        description: 'The most useful next step and the reason, in two sentences.',
      },
      blindSpots: {
        type: 'array',
        items: { type: 'string' },
        description: 'What the data on file cannot tell you. Be concrete.',
      },
      allocation: {
        type: 'object',
        additionalProperties: false,
        description:
          'The shape you think this book should have, and the moves that would get there. This replaces the targets the app ships with, so give a full mix rather than only the sectors you want to change.',
        required: ['targetMix', 'cashFloorPct', 'maxPositionPct', 'reasoning', 'moves', 'caveats'],
        properties: {
          targetMix: {
            type: 'array',
            description:
              'A target for every sector that should carry weight, including cash. The percentages must total 100. Omit a sector only if it should genuinely hold nothing.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['sector', 'targetPct', 'previousPct', 'why'],
              properties: {
                sector: { type: 'string', enum: SECTORS.map((s) => s.id) },
                targetPct: { type: 'number', description: 'Share of net liquidation value, in percent.' },
                previousPct: {
                  type: ['number', 'null'],
                  description: 'The target this replaces, if one was given to you.',
                },
                why: {
                  type: 'string',
                  description:
                    'One sentence. Why this number rather than the previous one, citing the figure that drove it.',
                },
              },
            },
          },
          cashFloorPct: {
            type: ['number', 'null'],
            description:
              'Recommended minimum cash as a percent of NLV. Null to leave the existing floor alone. Reason from the downside percentiles, not from a rule of thumb.',
          },
          maxPositionPct: {
            type: ['number', 'null'],
            description: 'Recommended cap on any single position, as a percent of NLV. Null to leave it alone.',
          },
          reasoning: {
            type: 'string',
            description:
              'Two or three sentences on what this stance is and what specifically it is reacting to.',
          },
          moves: {
            type: 'array',
            description:
              'Concrete moves, most important first. Four to eight. If the right answer is to do nothing, say so with a single hold move rather than inventing activity.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'ticker', 'sector', 'sizePctOfNlv', 'action', 'basis', 'urgency'],
              properties: {
                kind: { type: 'string', enum: ['trim', 'exit', 'add', 'enter', 'raise-cash', 'hold'] },
                ticker: {
                  type: ['string', 'null'],
                  description: 'The name this is about, or null when it is about a whole sleeve.',
                },
                sector: {
                  type: ['string', 'null'],
                  enum: [...SECTORS.map((s) => s.id), null],
                  description: 'The sleeve this is about, or null when it is about one name.',
                },
                sizePctOfNlv: {
                  type: ['number', 'null'],
                  description: 'How much of the book this would shift. Null if you cannot size it honestly.',
                },
                action: { type: 'string', description: 'What to do, in one sentence.' },
                basis: {
                  type: 'string',
                  description:
                    'The figure you are reasoning from, quoted. A move with no number behind it is an opinion and will be shown as one.',
                },
                urgency: { type: 'string', enum: ['now', 'soon', 'watch'] },
              },
            },
          },
          caveats: {
            type: 'array',
            items: { type: 'string' },
            description:
              'What this stance could not be based on — coverage gaps, missing betas, stale marks. Empty array if none.',
          },
        },
      },
    },
  },
};

const PORTFOLIO_SYSTEM = `You are reading one investor's portfolio and telling them what they are actually holding.

The figures you are given have already been computed from their positions. Do not recompute them, do not contradict them, and cite them when you reason from them.

What is useful here is the part arithmetic cannot do:
- Sector buckets hide correlated bets. Three positions in three sectors that all depend on data-centre capital expenditure are one bet, and saying so is the most valuable thing in this report.
- Note when several holdings are cheap or expensive for the same underlying reason — that is a factor exposure, not diversification.
- Concentration is not automatically bad. Say what the concentration is a bet on, and what would have to be true for it to be the right one.
- When a coverage figure is low, say the average is thin rather than reasoning confidently from it.

Tone: direct, specific, and willing to say something uncomfortable. Do not pad, do not hedge into meaninglessness, and do not recommend generic diversification. If the book looks sensible, say that plainly rather than manufacturing concerns.

You also set the targets. The sector targets this app shipped with are a placeholder, and the owner has asked for targets that come from analysis instead. So:

- Give a full mix that totals 100, including cash. A partial mix would leave the app measuring drift against a mixture of your numbers and the placeholder's.
- Every target says why it is that number, citing the figure that drove it. "Reduce tech" is not a reason; "tech is 34% while the downside percentile shows the book losing a third in the worst 5% of paths, and eight of those points sit in two names that move together" is.
- Set the cash floor from the projection's downside, not from a convention. The simulation tells you what this specific book does when the market falls; a 25% floor that nothing justifies is the same placeholder in a different place.
- Moves are concrete: which name, which direction, how much of the book, and the number behind it. Size them when you honestly can and say null when you cannot — a made-up size is worse than an unsized instruction.
- If the right answer is that the book is already shaped correctly, return the current weights as the targets and a single hold move. Manufacturing activity to look useful is the specific failure to avoid here.

Never propose entering a name you have no data on without saying that is what you are doing, and put it in the caveats.`;

export async function analysePortfolio(
  client: Anthropic,
  summary: string,
  extra?: { verdicts?: string; plan?: string; simulation?: string },
): Promise<PortfolioReadResult> {
  const parts = ['Here is the computed picture of the portfolio.', '', summary];
  if (extra?.simulation) {
    parts.push('', 'The projection already run on this book:', extra.simulation);
  }
  if (extra?.plan) parts.push('', 'The owner\'s current rebalancing plan:', extra.plan);
  if (extra?.verdicts) parts.push('', 'Per-stock verdicts on file:', extra.verdicts);
  parts.push('', 'Report your read through the report_portfolio_read tool.');

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    system: PORTFOLIO_SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    tools: [PORTFOLIO_TOOL],
    tool_choice: { type: 'tool', name: 'report_portfolio_read' },
    messages: [{ role: 'user', content: parts.join('\n') }],
  });

  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'report_portfolio_read',
  );
  if (!block) {
    throw new Error(
      response.stop_reason === 'refusal'
        ? 'Claude declined this request.'
        : 'Claude did not return a structured portfolio read.',
    );
  }
  return block.input as PortfolioReadResult;
}
