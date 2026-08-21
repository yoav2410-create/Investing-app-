import { launch } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// See the note in screenshots.mjs: an absolute path here writes the PNGs
// outside the repository instead of failing, so the check passes and its
// evidence disappears.
const OUT = fileURLToPath(new URL('../docs/screenshots', import.meta.url));
mkdirSync(OUT, { recursive: true });

const browser = await launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light', isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

const text = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');

// ---- 1. The dynamic plan: propose, pin, tick, survive a reload -------------
// The Plan tab is gone. The plan is now the read's proposed moves, pinned on
// the insights screen as a checklist. A real read needs a key and costs money,
// so a stance is planted the way analysePortfolioNow would store one; what is
// under test is everything after that point — rendering, ticking, persistence.
await page.goto('http://localhost:8080/insights', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('portfolio-brief-v1'));
  raw.state.portfolioRead = {
    at: '2026-08-20T09:00:00.000Z',
    result: {
      headline: 'Planted.', whatThisBookIs: 'Planted.', observations: [], themeClusters: [],
      biggestRisk: 'Planted.', nextAction: 'Planted.', blindSpots: [],
      allocation: {
        targetMix: [
          { sector: 'tech', targetPct: 60, previousPct: null, why: 'w' },
          { sector: 'cash', targetPct: 40, previousPct: null, why: 'w' },
        ],
        cashFloorPct: null, maxPositionPct: null, reasoning: 'Planted stance.',
        moves: [
          { kind: 'trim', ticker: 'PLTR', sector: null, sizePctOfNlv: 3, action: 'Trim PLTR.', basis: 'weight 14.5%', urgency: 'now' },
          { kind: 'raise-cash', ticker: null, sector: 'cash', sizePctOfNlv: null, action: 'Hold the proceeds.', basis: 'floor', urgency: 'soon' },
          { kind: 'hold', ticker: 'META', sector: null, sizePctOfNlv: null, action: 'Leave META.', basis: '', urgency: 'watch' },
        ],
        caveats: [],
      },
    },
  };
  raw.state.stanceDone = [];
  localStorage.setItem('portfolio-brief-v1', JSON.stringify(raw));
});
await page.goto('http://localhost:8080/insights', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const doneOf = (t) => t.match(/(\d)\/(\d) done/);
const before = doneOf(await text());
console.log(`plan pinned: ${before?.[1]}/${before?.[2]} done`);
// The hold move must not be counted — there is nothing to execute.
if (!before) problems.push('the pinned plan shows no done counter');
else if (before[2] !== '2') problems.push(`expected 2 actionable moves, counter says ${before[2]}`);

const move = page.getByRole('checkbox', { name: /trim PLTR/i }).first();
if ((await move.count()) === 0) problems.push('could not find the PLTR move to tick');
await move.click();
await page.waitForTimeout(700);
const after = doneOf(await text());
console.log(`ticked the PLTR trim: ${before?.[1]}/2 -> ${after?.[1]}/2`);
if (!after || after[1] !== '1') problems.push(`ticking a move did not advance the counter (${after?.[1]})`);
await page.screenshot({ path: `${OUT}/interaction-plan-tick.png` });

// The tick is the execution record; losing it on a reload would make the
// checklist decorative.
await page.goto('http://localhost:8080/insights', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const reloaded = doneOf(await text());
console.log(`after a reload: ${reloaded?.[1]}/2 done`);
if (!reloaded || reloaded[1] !== '1') problems.push('the tick did not survive a reload');

// ---- 3. Every list row navigates to the right detail screen ----------------
await page.goto('http://localhost:8080/stocks', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const tickers = ['META', 'PLTR', 'SMH', 'TSSI', 'LLY'];
for (const t of tickers) {
  await page.goto('http://localhost:8080/stocks', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.getByText(t, { exact: true }).first().click();
  await page.waitForTimeout(700);
  const url = page.url();
  if (!url.endsWith('/stock/' + t)) problems.push(`${t} row navigated to ${url}`);
  const body = await text();
  if (!body.includes(t)) problems.push(`${t} detail did not render its own ticker`);
  await page.goBack();
  await page.waitForTimeout(500);
  if (!page.url().includes('/stocks')) problems.push(`back from ${t} landed on ${page.url()}`);
}
console.log(`navigated into and back out of ${tickers.length} detail screens`);

// ---- 4. Search and filter -------------------------------------------------
await page.goto('http://localhost:8080/stocks', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.getByPlaceholder('Search ticker, name or thesis').fill('nuclear');
await page.waitForTimeout(500);
const searched = await text();
console.log('search "nuclear" ->', searched.match(/(\d+) of 17 names/)?.[0]);
await page.getByPlaceholder('Search ticker, name or thesis').fill('');
await page.getByText('Cheap', { exact: true }).click();
await page.waitForTimeout(500);
const cheap = await text();
console.log('filter Cheap ->', cheap.match(/(\d+) of 17 names/)?.[0]);
await page.screenshot({ path: `${OUT}/interaction-filter-cheap.png` });

// ---- 5. Degradation when Claude has no key --------------------------------
await page.goto('http://localhost:8080/sync', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.goto('http://localhost:8080/stock/META', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 50)
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  el.setAttribute('data-scroller', '1');
  el.scrollTop = 99999;
});
await page.waitForTimeout(500);
await page.getByText('Re-research with Claude').click();
await page.waitForTimeout(1500);
const noKey = await text();
if (!noKey.includes('Anthropic API key')) problems.push('no-key path did not explain itself: ' + noKey.slice(-300));
else console.log('no API key set -> app explains rather than crashing');
await page.screenshot({ path: `${OUT}/interaction-no-key.png` });

await browser.close();
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'All interaction checks passed.');
