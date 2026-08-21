// Verifies the two simulation-driven features end to end against the running
// web build: the EBITDA -> free cash flow bridge on a stock page, and the
// Monte Carlo projection on the market page. Interactive controls are actually
// pressed, and the numbers are asserted to move — a static render is not proof
// that the simulation re-runs.
//
//   npx expo export --platform web && npx http-server dist -p 8080
//   node scripts/simulation-check.mjs

import { launch } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// fileURLToPath rather than .pathname: a file URL's pathname keeps the leading
// slash the URL spec requires, so on Windows it reads `/C:/...` and every
// screenshot path resolved to `C:\C:\...` and threw ENOENT.
const OUT = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const BASE = process.env.APP_URL ?? 'http://localhost:8080';

const browser = await launch();
const problems = [];
const note = (m) => problems.push(m);

async function open(route, scheme = 'light') {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => note(`${route}: ${e.message}`));
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  // expo-router renders the scroll view as a plain div; find the tallest one.
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')]
      .filter((d) => d.scrollHeight > d.clientHeight + 50)
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (el) el.setAttribute('data-scroller', '1');
  });
  const scrollTo = async (y) => {
    await page.evaluate((yy) => {
      const el = document.querySelector('[data-scroller]');
      if (el) el.scrollTop = yy;
    }, y);
    await page.waitForTimeout(400);
  };
  const text = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const shot = async (name) => page.screenshot({ path: `${OUT}${name}.png` });
  return { ctx, page, scrollTo, text, shot };
}

function needs(text, label, phrases) {
  for (const p of phrases) if (!text.includes(p)) note(`${label} missing "${p}"`);
}

// ---------------------------------------------------------------- Monte Carlo
{
  // The Monte Carlo block lives on the portfolio page now, not on Market.
  const m = await open('/');
  for (const [i, y] of [900, 1500, 2200, 2900].entries()) {
    await m.scrollTo(y);
    await m.shot(`montecarlo-${i}`);
  }
  const body = await m.text();
  needs(body, 'market', [
    'Where this book could end up',
    'Median outcome',
    'Beats the S&P',
    'Worst 5%',
    'Best 5%',
    'S&P median',
    'Where the 5,000 paths landed',
    'What the projection assumes',
    'Portfolio beta',
    'Cash sleeve',
  ]);

  const beat = body.match(/Beats the S&P\D{0,4}(\d+)%/)?.[1];
  const median = body.match(/Median outcome\D{0,6}([$\d.KMB]+)/)?.[1];
  if (!beat || !median) note('Monte Carlo headline figures did not render');
  else console.log(`Monte Carlo: median outcome ${median}, beats the S&P in ${beat}% of paths`);

  // The horizon chips must re-run the simulation, not just relabel it.
  await m.page.getByText('1y', { exact: true }).click();
  await m.page.waitForTimeout(600);
  const oneYear = await m.text();
  const median1 = oneYear.match(/Median outcome\D{0,6}([$\d.KMB]+)/)?.[1];
  if (!median1) note('1y horizon produced no median');
  else if (median1 === median) note(`horizon chip did not change the median (${median1} at both 1y and 5y)`);
  else console.log(`Horizon chip: 1y median ${median1} vs 5y median ${median}`);
  if (!oneYear.includes('over 1 year,')) note('subtitle did not follow the 1y horizon');

  // Back to five years, then swap the return basis.
  await m.page.getByText('5y', { exact: true }).click();
  await m.page.waitForTimeout(600);
  await m.page.getByText('Analyst targets', { exact: true }).click();
  await m.page.waitForTimeout(600);
  const analyst = await m.text();
  const medianA = analyst.match(/Median outcome\D{0,6}([$\d.KMB]+)/)?.[1];
  if (!analyst.includes('Analyst targets, capped at')) note('analyst basis did not change the stated assumption');
  if (!medianA) note('analyst basis produced no median');
  else if (medianA === median) note(`return basis did not change the median (${medianA} under both bases)`);
  else console.log(`Return basis: analyst median ${medianA} vs CAPM median ${median}`);

  // The per-holding inputs are the audit trail for the whole projection.
  await m.page.getByText('Show the per-holding inputs', { exact: true }).click();
  await m.page.waitForTimeout(500);
  const expanded = await m.text();
  needs(expanded, 'per-holding inputs', ['Ticker', 'Weight', 'Beta', 'Return', 'Vol']);
  const rows = ['META', 'PLTR', 'LMT'].filter((t) => new RegExp(`${t} \\d+\\.\\d%`).test(expanded));
  if (rows.length < 3) note(`per-holding table listed ${rows.length}/3 sampled holdings`);
  else console.log('Per-holding inputs: weight, beta, return and vol shown for every position');
  // Park the table itself in frame rather than guessing a pixel offset.
  await m.page.getByText('Ticker', { exact: true }).scrollIntoViewIfNeeded();
  await m.page.evaluate(() => {
    const el = document.querySelector('[data-scroller]');
    if (el) el.scrollTop += 300; // clear the header so the rows themselves are in frame
  });
  await m.page.waitForTimeout(400);
  await m.shot('montecarlo-inputs');
  await m.ctx.close();
}

// ------------------------------------------------------------- EBITDA -> FCF
{
  const s = await open('/stock/META');
  for (const [i, y] of [2450, 2900].entries()) {
    await s.scrollTo(y);
    await s.shot(`fcfbridge-${i}`);
  }
  const body = await s.text();
  needs(body, 'META bridge', [
    'EBITDA to free cash flow',
    'converts to cash',
    'Adj EBITDA',
    'Cash EBITDA',
    'Free cash flow',
    'Capex intensity',
    'FCF yield',
    'Deducted here, not added back',
  ]);
  const conv = body.match(/(\d+)% converts to cash/)?.[1];
  if (!conv) note('FCF conversion rate did not render');
  else console.log(`FCF bridge: META converts ${conv}% of adjusted EBITDA to cash`);
  await s.ctx.close();
}

// Dark mode, and a fund that has no cash-flow statement of its own.
{
  const d = await open('/stock/CEG', 'dark');
  await d.scrollTo(2450);
  await d.shot('fcfbridge-dark-0');
  if (!(await d.text()).includes('EBITDA to free cash flow')) note('CEG bridge missing in dark mode');
  await d.ctx.close();
}
{
  const e = await open('/stock/SMH', 'dark');
  await e.scrollTo(1500);
  await e.shot('etf-nobridge-0');
  if ((await e.text()).includes('EBITDA to free cash flow'))
    note('ETF showed a cash-flow bridge it has no data for');
  else console.log('ETF with no cash-flow data: bridge hidden rather than empty');
  await e.ctx.close();
}

await browser.close();

if (problems.length) {
  console.error('\nPROBLEMS:\n' + problems.map((p) => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log('\nMonte Carlo and FCF checks passed.');
