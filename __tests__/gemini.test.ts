import { readPositionsWithGemini } from '@/data/provider/gemini';

/**
 * The network is faked here on purpose: what is under test is how the reader
 * behaves when Google misbehaves, and the free tier misbehaves often — three
 * of the first four real calls came back 503. The happy path is covered by a
 * live run against a rendered broker screen, which no unit test can do.
 */

function reply(status: number, body: unknown): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;
}

function scripted(steps: { status: number; body?: unknown }[]): { impl: typeof fetch; calls: () => number } {
  let i = 0;
  const impl = (async () => {
    const step = steps[Math.min(i, steps.length - 1)]!;
    i++;
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      json: async () => step.body ?? {},
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls: () => i };
}

const good = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              positions: [
                { ticker: 'nasdaq:aapl', shares: 25, averageCost: 180, confidence: 1 },
                { ticker: 'Total', shares: null, confidence: 0.2 },
              ],
              warnings: ['One column was cut off.'],
            }),
          },
        ],
      },
    },
  ],
};

const IMAGE = { base64: 'x', mediaType: 'image/png' as const };

describe('reading a screenshot with Gemini', () => {
  it('normalises what comes back and drops anything that is not a ticker', async () => {
    const read = await readPositionsWithGemini('k', IMAGE, undefined, reply(200, good));
    expect(read.positions.map((p) => p.ticker)).toEqual(['AAPL']);
    expect(read.positions[0]!.shares).toBe(25);
    expect(read.warnings).toEqual(['One column was cut off.']);
    // Fields the model never mentioned exist and are null, not undefined.
    expect(read.positions[0]!.marketValue).toBeNull();
    expect(read.account.cashUsd).toBeNull();
  });

  it('rides out the free tier being busy rather than failing on the first 503', async () => {
    const { impl, calls } = scripted([{ status: 503 }, { status: 503 }, { status: 200, body: good }]);
    const read = await readPositionsWithGemini('k', IMAGE, undefined, impl);
    expect(read.positions).toHaveLength(1);
    expect(calls()).toBe(3);
  }, 30000);

  it('gives up in plain words when the overload outlasts the retries', async () => {
    const { impl } = scripted([{ status: 503 }]);
    await expect(readPositionsWithGemini('k', IMAGE, undefined, impl)).rejects.toThrow(/busy/i);
  }, 30000);

  it('says the key is the problem when the key is the problem', async () => {
    await expect(readPositionsWithGemini('bad', IMAGE, undefined, reply(403, {}))).rejects.toThrow(/key/i);
  });

  it('refuses to invent positions when the answer is not the expected shape', async () => {
    const prose = { candidates: [{ content: { parts: [{ text: 'Sure! Here are your holdings…' }] } }] };
    await expect(readPositionsWithGemini('k', IMAGE, undefined, reply(200, prose))).rejects.toThrow(/shape/i);
  });

  it('surfaces a refusal rather than returning an empty book as if it were true', async () => {
    const blocked = { promptFeedback: { blockReason: 'SAFETY' } };
    await expect(readPositionsWithGemini('k', IMAGE, undefined, reply(200, blocked))).rejects.toThrow(/declined/i);
  });
});
