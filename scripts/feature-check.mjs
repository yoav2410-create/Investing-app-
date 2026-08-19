import { chromium } from 'playwright';
const OUT = '/home/user/Investing-app-/docs/screenshots';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
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
  if (n < 20) problems.push(`only ${n} explainers on the detail page`);
  await ctx.close();
}

// 3. Insights page computes without a Claude call.
{
  const { ctx, p, text } = await open('/insights');
  const t = await text();
  for (const need of ['Effective positions','Weighted beta','Breadth','Event risk','What carries the book']) {
    if (!t.includes(need)) problems.push(`insights missing "${need}"`);
  }
  const eff = t.match(/Effective positions ([\d.]+)/)?.[1];
  const beta = t.match(/Weighted beta ([\d.]+)/)?.[1];
  console.log(`insights computed offline: effective positions ${eff}, weighted beta ${beta}`);
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
