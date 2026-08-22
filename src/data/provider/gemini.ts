import type { ParsedPosition, PositionsReadResult } from './claude';

/**
 * Reading a broker screenshot with Gemini.
 *
 * The owner pays for a Claude.ai subscription, which is not API access, so
 * the Anthropic path was closed to them and the app could not learn what they
 * hold. Google's Generative Language API has a free tier and — the part that
 * decides it — answers a browser directly: measured from a real page on a
 * real origin, not from curl, because this project has twice been fooled by a
 * host that answers a terminal and refuses a browser.
 *
 * The contract is deliberately identical to the Anthropic reader's: the same
 * `PositionsReadResult`, so both feed the same review diff and nothing
 * downstream knows or cares which model read the picture.
 *
 * The rules in the prompt are the app's rules, not the model's habits:
 * transcribe what is printed, null anything unreadable, never derive a number
 * that is not on screen. A confident wrong figure here would corrupt the one
 * dataset the app cannot re-fetch from anywhere.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
export const GEMINI_MODEL = 'gemini-flash-latest';

const SYSTEM = `You read brokerage account screenshots and transcribe them exactly.

Rules that matter more than being helpful:
- Transcribe only what is visibly printed. If a column is cut off, blurred, or scrolled out of frame, report null for that field and say so in warnings.
- Never estimate, derive, or fill in a number that is not on screen. A null is always better than a plausible guess: the owner trades off these figures.
- Strip currency symbols, thousands separators and percent signs. "1,234.56" becomes 1234.56; "(1,234.56)" and "-1,234.56" both become -1234.56; "+2.34%" becomes 2.34.
- Ticker symbols only, uppercase, no exchange prefix. "NASDAQ:META" becomes "META".
- averageCost is the owner's cost per share, not the current price. If the screen shows only a total cost, divide by the quantity and note it. If it shows neither, use null.
- Ignore watchlist rows, pending orders and anything that is not a held position. If you cannot tell, leave it out and say so in warnings.
- If the image is not a brokerage screen at all, return an empty positions array and say so in warnings.`;

/** Gemini's schema dialect: OpenAPI-ish, with `nullable` rather than unions. */
const SCHEMA = {
  type: 'object',
  properties: {
    positions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ticker: { type: 'string' },
          companyName: { type: 'string', nullable: true },
          shares: { type: 'number', nullable: true },
          price: { type: 'number', nullable: true },
          marketValue: { type: 'number', nullable: true },
          averageCost: { type: 'number', nullable: true },
          unrealizedPnl: { type: 'number', nullable: true },
          unrealizedPnlPct: { type: 'number', nullable: true },
          dayChangePct: { type: 'number', nullable: true },
          confidence: { type: 'number' },
          note: { type: 'string', nullable: true },
        },
        required: ['ticker', 'confidence'],
      },
    },
    account: {
      type: 'object',
      properties: {
        netLiquidationValue: { type: 'number', nullable: true },
        cashUsd: { type: 'number', nullable: true },
        dayPnl: { type: 'number', nullable: true },
        unrealizedPnl: { type: 'number', nullable: true },
        asOfLabel: { type: 'string', nullable: true },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['positions', 'warnings'],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function readPositionsWithGemini(
  apiKey: string,
  image: { base64: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' },
  hint?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PositionsReadResult> {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [
      {
        parts: [
          { inline_data: { mime_type: image.mediaType, data: image.base64 } },
          {
            text: hint
              ? `Transcribe every position in this screenshot. Context from the owner: ${hint}`
              : 'Transcribe every position in this screenshot.',
          },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA },
  };

  // The free tier answers 503 "high demand" often enough that a single
  // attempt would make the feature feel broken rather than busy — three of
  // four calls came back 503 while this was being written, and the fourth
  // read the screenshot perfectly. Overload is temporary; say so only if it
  // outlasts the retries.
  let lastError = 'Gemini did not answer.';
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(`${ENDPOINT}/${GEMINI_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Could not reach Gemini. Check the connection and try again.');
    }

    if (res.status === 503 || res.status === 429) {
      lastError =
        res.status === 429
          ? 'Gemini is rate-limiting this key. Wait a minute and try again.'
          : 'Gemini is busy. It usually clears in under a minute.';
      if (attempt < 4) {
        await sleep(attempt * 2500);
        continue;
      }
      throw new Error(lastError);
    }
    if (res.status === 400 || res.status === 403) {
      throw new Error('Gemini rejected the key. Check it in Settings, or make a new one.');
    }
    if (!res.ok) throw new Error(`Gemini answered ${res.status}.`);

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    };
    if (json.promptFeedback?.blockReason) {
      throw new Error('Gemini declined to read this image.');
    }
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned nothing readable. Try a clearer screenshot.');

    let raw: PositionsReadResult;
    try {
      raw = JSON.parse(text) as PositionsReadResult;
    } catch {
      throw new Error('Gemini answered in prose rather than the expected shape. Try again.');
    }
    return normalise(raw);
  }
  throw new Error(lastError);
}

/** The same defensive tidy-up the Anthropic path does; OCR is OCR. */
function normalise(raw: PositionsReadResult): PositionsReadResult {
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const positions: ParsedPosition[] = (raw.positions ?? [])
    .map((p) => ({
      ticker: String(p.ticker ?? '').trim().toUpperCase().replace(/^[A-Z]+:/, ''),
      companyName: p.companyName ?? null,
      shares: num(p.shares),
      price: num(p.price),
      marketValue: num(p.marketValue),
      averageCost: num(p.averageCost),
      unrealizedPnl: num(p.unrealizedPnl),
      unrealizedPnlPct: num(p.unrealizedPnlPct),
      dayChangePct: num(p.dayChangePct),
      confidence: Number.isFinite(p.confidence) ? Math.max(0, Math.min(1, p.confidence)) : 0,
      note: p.note ?? null,
    }))
    .filter((p) => /^[A-Z][A-Z.\-]{0,6}$/.test(p.ticker))
    // A summary row reads as a ticker: "TOTAL" is six capitals and passes any
    // symbol test. The tell is that it carries no quantity — a real holding
    // always does. CASH is a genuine listed symbol, so the label alone is not
    // enough to throw a row away.
    .filter((p) => !(p.shares == null && /^(TOTAL|SUBTOTAL|SUM|CASH|EQUITY|BALANCE)$/.test(p.ticker)));

  return {
    positions,
    account: {
      netLiquidationValue: num(raw.account?.netLiquidationValue),
      cashUsd: num(raw.account?.cashUsd),
      dayPnl: num(raw.account?.dayPnl),
      unrealizedPnl: num(raw.account?.unrealizedPnl),
      asOfLabel: raw.account?.asOfLabel ?? null,
    },
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
  };
}
