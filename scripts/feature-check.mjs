import { launch } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// See the note in screenshots.mjs: an absolute path here writes the PNGs
// outside the repository instead of failing, so the check passes and its
// evidence disappears.
const OUT = fileURLToPath(new URL('../docs/screenshots', import.meta.url));
mkdirSync(OUT, { recursive: true });

const b = await launch();
const problems = [];

async function open(route, scheme='light') {
  const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, colorScheme:scheme, isMobile:true, hasTouch:true });
  const p = await ctx.newPage();
  p.on('pageerror', e => problems.push(route+': '+e.message));
  await p.goto('http://localhost:8080'+route, { waitUntil:'networkidle' });
  await p.waitForTimeout(800);
  await p.evaluate(() => {
    const el = [...document.querySelectorAll('div')].filter(d=>d.scrollHeight>d.clientHeight+50)
      .sort((a,b)=>b.scrollHeight-a.scrollHeight)[0];
    if (el) el.setAttribute('data-scroller','1');
  });
  return { ctx, p, text: async () => (await p.locator('body').innerText()).replace(/\s+/g,' ') };
}

// 1. The "?" opens a real explanation with all three sections.
{
  const { ctx, p, text } = await open('/stock/META');
  // The quote page is sectioned now; valuation lives under Analysis.
  await p.getByRole('tab', { name: 'Analysis' }).click();
  await p.waitForTimeout(400);
  const btn = p.getByLabel('What is Trailing P/E?').first();
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await p.waitForTimeout(600);
  const t = await text();
  for (const need of ['WHAT IT IS','HOW TO READ IT','WHERE IT MISLEADS','Backward-looking']) {
    if (!t.includes(need)) problems.push(`glossary sheet missing "${need}"`);
  }
  console.log('glossary sheet:', t.includes('WHERE IT MISLEADS') ? 'opens with what / how to read / where it misleads' : 'INCOMPLETE');
  await p.screenshot({ path: `${OUT}/interaction-glossary.png` });
  // Dismiss by tapping the scrim.
  await p.mouse.click(195, 60);
  await p.waitForTimeout(400);
  const after = await text();
  if (after.includes('WHERE IT MISLEADS')) problems.push('glossary sheet did not dismiss');
  else console.log('glossary sheet dismisses on tap-away');
  await ctx.close();
}

// 2. How many "?" buttons a detail page actually carries — summed across the
// four tabs, since the page is sectioned now and no single tab holds them all.
{
  const { ctx, p } = await open('/stock/META');
  let n = 0;
  const perTab = {};
  for (const tabName of ['Summary', 'News', 'Analysis', 'Financials']) {
    await p.getByRole('tab', { name: tabName }).click();
    await p.waitForTimeout(350);
    const c = await p.getByRole('button', { name: /^What is / }).count();
    perTab[tabName] = c;
    n += c;
  }
  console.log(`stock detail carries ${n} metric explainers across its tabs (${JSON.stringify(perTab)})`);
  if (n < 40) problems.push(`only ${n} explainers on the detail page`);
  // The headings and chart captions matter as much as the table rows. Each
  // named explainer is asserted on the tab that owns it, so a tab silently
  // dropping its sections cannot pass.
  const where = { 'EV / EBITDA': 'Analysis', 'Operating income': 'Financials', 'Multiple history': 'Financials', 'Trend score': 'Analysis', 'Verdict': 'Summary' };
  for (const [needed, tabName] of Object.entries(where)) {
    await p.getByRole('tab', { name: tabName }).click();
    await p.waitForTimeout(300);
    if ((await p.getByLabel(`What is ${needed}?`).count()) === 0) {
      problems.push(`no explainer beside "${needed}"`);
    }
  }
  console.log('headings and chart captions carry their own explainers');
  await ctx.close();
}

// 3. Insights page computes without a Claude call.
{
  const { ctx, p, text } = await open('/insights');
  const t = await text();
  for (const need of ['Effective positions','Weighted beta','Breadth','Event risk','What carries the book']) {
    if (!t.includes(need)) problems.push(`insights missing "${need}"`);
  }
  // The "?" sits between a label and its value, so allow for it rather than
  // requiring adjacency — an over-tight regex here would pass while checking
  // nothing.
  const valueAfter = (label) => t.match(new RegExp(label + '\\D{0,4}([\\d.]+)'))?.[1];
  const eff = valueAfter('Effective positions');
  const beta = valueAfter('Weighted beta');
  console.log(`insights computed offline: effective positions ${eff}, weighted beta ${beta}`);
  if (!eff || !beta) problems.push('insights figures did not render');
  else if (Number(eff) > 14) problems.push(`effective positions ${eff} exceeds the holding count`);
  if (!t.includes('No portfolio read yet')) problems.push('insights did not offer the Claude run');
  for (let i=0;i<4;i++){
    await p.evaluate(y => { document.querySelector('[data-scroller]').scrollTop = y; }, i*760);
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/insights-slice-${i}.png` });
  }
  await ctx.close();
}

// 4. The read happens in the conversation, and the app can take it back.
// There is no API key anywhere in this build, so what has to be true is that
// the screen offers a route that works without one and refuses nonsense.
{
  const { ctx, p, text } = await open('/insights');
  const t = await text();
  for (const need of ['Copy the request', 'Open the conversation', 'Apply the read']) {
    if (!t.includes(need)) problems.push(`insights is missing "${need}"`);
  }
  if (/Run analysis|Anthropic API key/.test(t)) {
    problems.push('insights still offers an API route that this build cannot use');
  }
  // Junk must be refused in words rather than half-applied.
  await p.getByPlaceholder(/Paste the/).fill('good morning');
  await p.getByRole('button', { name: 'Apply the read' }).click();
  await p.waitForTimeout(800);
  const after = await text();
  if (!/not contain a JSON object|no headline|did not parse/i.test(after)) {
    problems.push('a junk paste was not refused with a reason');
  } else {
    console.log('the read comes from the conversation, and junk is refused with a reason');
  }
  await ctx.close();
}

// 5. Sentiment card present and honest before any research. It lives on the
// News tab now.
{
  const { ctx, p, text } = await open('/stock/PLTR', 'dark');
  await p.getByRole('tab', { name: 'News' }).click();
  await p.waitForTimeout(400);
  const t = await text();
  if (!t.includes('What the market is saying')) problems.push('sentiment card missing');
  if (!t.includes('No coverage read yet')) problems.push('sentiment card claimed data it does not have');
  else console.log('sentiment card: present and states it has no coverage yet');
  await ctx.close();
}

await b.close();
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : '\nAll new-feature checks passed.');
