// Verifies that the sector targets actually come from the portfolio read.
//
//   npm run build:web && npm run serve:web
//   node scripts/allocation-check.mjs
//
// The read itself needs an Anthropic key and costs money, so this does not call
// it. It writes a stance into the store the way a real read would and checks
// what the screens do with it — which is the part that can silently be wrong.
//
// The check that matters is the *change*: the seed target for tech is read
// first, a different one is planted, and the screen is required to show the new
// number. Asserting only that "a target renders" would pass just as happily
// with the placeholder still in force, which is the whole thing being fixed.

import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { launch } from './browser.mjs';

const BASE = process.env.APP_URL ?? 'http://localhost:8080';
const OUT = fileURLToPath(new URL('../docs/screenshots', import.meta.url));
mkdirSync(OUT, { recursive: true });

const STORE_KEY = 'portfolio-brief-v1';
const PLANTED_TECH_TARGET = 41;

const STANCE = {
  targetMix: [
    { sector: 'tech', targetPct: PLANTED_TECH_TARGET, previousPct: 24, why: 'Planted by allocation-check.' },
    { sector: 'industrials', targetPct: 14, previousPct: 16, why: 'Planted by allocation-check.' },
    { sector: 'consumer', targetPct: 8, previousPct: 10, why: 'Planted by allocation-check.' },
    { sector: 'power', targetPct: 9, previousPct: 10, why: 'Planted by allocation-check.' },
    { sector: 'financials', targetPct: 6, previousPct: 8, why: 'Planted by allocation-check.' },
    { sector: 'healthcare', targetPct: 5, previousPct: 7, why: 'Planted by allocation-check.' },
    { sector: 'cash', targetPct: 17, previousPct: 25, why: 'Planted by allocation-check.' },
  ],
  cashFloorPct: 17,
  maxPositionPct: 11,
  reasoning: 'A stance written by the verification script, not by a model.',
  moves: [
    {
      kind: 'trim',
      ticker: 'PLTR',
      sector: null,
      sizePctOfNlv: 3.5,
      action: 'Take PLTR back under the cap.',
      basis: 'Top weight 14.5% against an 11% proposed cap.',
      urgency: 'now',
    },
    {
      kind: 'raise-cash',
      ticker: null,
      sector: 'cash',
      sizePctOfNlv: null,
      action: 'Let the trim settle in cash.',
      basis: 'Worst 5% of paths ends near $79.7K.',
      urgency: 'soon',
    },
  ],
  caveats: ['Planted stance — no model produced this.'],
};

const problems = [];
const browser = await launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
// The row reads "<current>% / <target>%"; the target is the half under test.
const techTarget = (text) => text.match(/Tech \/ AI & Software\s*([\d.]+)%\s*\/\s*([\d.]+)%/)?.[2];

// ---- 1. Before any read: the bundled placeholder, labelled as one ----------
await page.goto(`${BASE}/sectors`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
const before = await body();
const seedTarget = techTarget(before);
console.log(`without a read: tech target ${seedTarget}%`);
if (!seedTarget) problems.push('no sector target rendered at all before a read');
if (!/bundled plan/i.test(before)) {
  problems.push('the screen does not say the targets came from the bundled plan');
}
if (String(seedTarget) === String(PLANTED_TECH_TARGET)) {
  problems.push(`the seed target is already ${PLANTED_TECH_TARGET}% — this check would prove nothing`);
}

// ---- 2. Plant a read the way analysePortfolioNow would --------------------
await page.evaluate(
  ([key, stance]) => {
    const raw = JSON.parse(localStorage.getItem(key));
    raw.state.portfolioRead = {
      at: '2026-08-19T12:00:00.000Z',
      result: {
        headline: 'Planted.',
        whatThisBookIs: 'Planted.',
        observations: [],
        themeClusters: [],
        biggestRisk: 'Planted.',
        nextAction: 'Planted.',
        blindSpots: [],
        allocation: stance,
      },
    };
    localStorage.setItem(key, JSON.stringify(raw));
  },
  [STORE_KEY, STANCE],
);

// ---- 3. The targets must now be the read's, not the placeholder's ---------
await page.goto(`${BASE}/sectors`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
const after = await body();
const readTarget = techTarget(after);
console.log(`with a read   : tech target ${readTarget}%`);
if (String(readTarget) !== String(PLANTED_TECH_TARGET)) {
  problems.push(`the read's target did not reach the chart (wanted ${PLANTED_TECH_TARGET}, got ${readTarget})`);
}
if (!/portfolio read/i.test(after)) problems.push('the screen does not say the targets came from the read');
if (!after.includes('Why these targets')) problems.push('the per-target reasoning is not shown');
if (!after.includes('Planted by allocation-check')) problems.push('the reason behind a target is not rendered');
await page.screenshot({ path: `${OUT}/allocation-targets.png`, fullPage: true });

// Drift is measured against the new target, so it has to move with it.
const drift = after.match(/Tech \/ AI & Software is ([+−-]?[\d.]+)%/)?.[1];
console.log(`drift now reads: ${drift ?? 'no tech drift line'}`);

// ---- 4. The moves reach the Insights screen -------------------------------
await page.goto(`${BASE}/insights`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const insights = await body();
for (const need of ['What to change', 'Take PLTR back under the cap', 'Top weight 14.5%', 'Cash floor', 'Position cap']) {
  if (!insights.includes(need)) problems.push(`insights missing "${need}"`);
}
if (!insights.includes('Planted stance')) problems.push('the caveats on the stance are not shown');
// A proposed floor sitting next to the one the plan still enforces, unlabelled,
// would read as though it had already been applied.
if (!/in force/i.test(insights)) {
  problems.push('the proposed floor and cap do not say what is still in force');
}
console.log('insights: moves, basis, and proposed-vs-in-force limits all rendered');
// Park the section itself in frame rather than guessing a pixel offset.
await page.getByText('What to change', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/allocation-moves.png` });

// ---- 5. A stance whose mix does not add up must be called out -------------
await page.evaluate(
  ([key]) => {
    const raw = JSON.parse(localStorage.getItem(key));
    raw.state.portfolioRead.result.allocation.targetMix = [
      { sector: 'tech', targetPct: 30, previousPct: 24, why: 'w' },
      { sector: 'cash', targetPct: 30, previousPct: 25, why: 'w' },
    ];
    localStorage.setItem(key, JSON.stringify(raw));
  },
  [STORE_KEY],
);
await page.goto(`${BASE}/insights`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const broken = await body();
if (!/Check these targets/i.test(broken) || !/total 60/i.test(broken)) {
  problems.push('a mix totalling 60% was not flagged on screen');
} else {
  console.log('a mix that does not total 100 is flagged rather than drawn as fact');
}

await browser.close();

if (problems.length) {
  console.error('\nPROBLEMS:\n' + problems.map((p) => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log('\nTargets come from the portfolio read, with their reasoning and their arithmetic checked.');
