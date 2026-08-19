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
  await p.evaluate(() => { document.querySelector('[data-scroller]').scrollTop = 1400; });
  await p.waitForTimeout(400);
  const btn = p.getByLabel('What is Trailing P/E?').first();
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

// 2. How many "?" buttons a detail page actually carries.
{
  const { ctx, p } = await open('/stock/META');
  const n = await p.getByRole('button', { name: /^What is / }).count();
  console.log(`stock detail carries ${n} metric explainers`);
  if (n < 40) problems.push(`only ${n} explainers on the detail page`);
  // The headings and chart captions matter as much as the table rows.
  for (const needed of ['EV / EBITDA', 'Net income', 'Multiple history', 'Trend score', 'Verdict']) {
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

// 4. Insights degrades cleanly with no API key.
{
  const { ctx, p, text } = await open('/insights');
  await p.getByText('Run analysis').click();
  await p.waitForTimeout(1500);
  const t = await text();
  if (!t.includes('Anthropic API key')) problems.push('insights no-key path did not explain itself');
  else console.log('insights with no key: explains rather than failing silently');
  await ctx.close();
}

// 5. Sentiment card present and honest before any research.
{
  const { ctx, p, text } = await open('/stock/PLTR', 'dark');
  const t = await text();
  if (!t.includes('What the market is saying')) problems.push('sentiment card missing');
  if (!t.includes('No coverage read yet')) problems.push('sentiment card claimed data it does not have');
  else console.log('sentiment card: present and states it has no coverage yet');
  await ctx.close();
}

await b.close();
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : '\nAll new-feature checks passed.');
