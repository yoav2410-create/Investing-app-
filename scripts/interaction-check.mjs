import { launch } from './browser.mjs';
const OUT = '/home/user/Investing-app-/docs/screenshots';
const browser = await launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light', isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

const text = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');

// ---- 1. Tranche projection recomputes the cash floor -----------------------
await page.goto('http://localhost:8080/plan', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const before = await text();
const headroomOf = (t) => t.match(/Headroom over \d+% floor\D{0,4}([+−-]?\d+\.\d)pp/)?.[1];
const beforeHeadroom = headroomOf(before);
console.log('as things stand, headroom =', beforeHeadroom);

await page.getByText('A', { exact: true }).first().click();
await page.waitForTimeout(600);
const afterA = await text();
const afterAHeadroom = headroomOf(afterA);
console.log('projecting tranche A, headroom =', afterAHeadroom);
if (!afterA.includes('If tranche A is finished')) problems.push('tranche A projection header missing');
if (!beforeHeadroom || !afterAHeadroom) problems.push('could not read the cash headroom figure');
else if (beforeHeadroom === afterAHeadroom) problems.push('projecting tranche A did not move the cash headroom');
await page.screenshot({ path: `${OUT}/interaction-plan-projection.png` });

// ---- 2. Marking a leg done actually moves the counter ----------------------
await page.getByText('C', { exact: true }).first().click(); // clear projection
await page.waitForTimeout(400);
const scroller = await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 50)
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  el.setAttribute('data-scroller', '1');
  return true;
});
await page.evaluate(() => { document.querySelector('[data-scroller]').scrollTop = 1200; });
await page.waitForTimeout(400);
const legBefore = await text();
const doneBefore = legBefore.match(/(\d)\/8 done/)?.[1];
// Target the leg by its role and what it does, not by its prose. The note text
// is demo copy and is meant to change; "the checkbox that exits VST" is the
// thing actually under test.
const vstLeg = page.getByRole('checkbox', { name: /Exit VST/i }).first();
if ((await vstLeg.count()) === 0) problems.push('could not find the VST exit leg to tick');
await vstLeg.click();
await page.waitForTimeout(600);
const legAfter = await text();
const doneAfter = legAfter.match(/(\d)\/8 done/)?.[1];
console.log(`marking the VST exit done: tranche A ${doneBefore}/8 -> ${doneAfter}/8`);
// Both halves have to be readable. A counter that becomes unreadable makes
// "it changed" trivially true, which is how a check like this passes while
// testing nothing.
if (!doneBefore || !doneAfter) {
  problems.push(`tranche counter unreadable (before=${doneBefore}, after=${doneAfter})`);
} else if (doneBefore === doneAfter) {
  problems.push('marking a leg done did not change the tranche counter');
}
await page.screenshot({ path: `${OUT}/interaction-leg-done.png` });

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
