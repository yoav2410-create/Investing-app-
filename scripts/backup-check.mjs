// Verifies the backup is actually a backup.
//
//   npm run build:web && npm run serve:web
//   node scripts/backup-check.mjs
//
// A file that exports cleanly but cannot be restored is worse than no backup,
// because the owner stops worrying. So this drives the whole round trip:
// change the book, export it, wipe storage to nothing, restore, and check the
// change came back.
//
// The wipe is checked too. If clearing storage did not actually reset the
// book, then "it restored" would be true no matter what the file contained,
// and the whole pass would be vacuous — the failure mode this project keeps
// running into.

import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';

const BASE = process.env.APP_URL ?? 'http://localhost:8080';
const TMP = fileURLToPath(new URL('../.backup-check', import.meta.url));
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const problems = [];
const browser = await launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  acceptDownloads: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const doneCount = async () => (await body()).match(/(\d)\/8 done/)?.[1];

async function openPlanAndScroll() {
  await page.goto(`${BASE}/plan`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')]
      .filter((d) => d.scrollHeight > d.clientHeight + 50)
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (el) {
      el.setAttribute('data-scroller', '1');
      el.scrollTop = 1200;
    }
  });
  await page.waitForTimeout(400);
}

// 1. An edit worth losing.
await openPlanAndScroll();
await page.getByRole('checkbox', { name: /Exit VST/i }).first().click();
await page.waitForTimeout(900);
const marked = await doneCount();
if (marked !== '1') problems.push(`expected 1/8 after ticking a leg, got ${marked}/8`);
console.log(`edit made: tranche A ${marked}/8 done`);

// 2. Settings states where the book lives rather than implying it is safe.
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const settings = await body();
if (!settings.includes('Your data')) problems.push('Settings has no "Your data" section');
if (!/persistent storage|marked the book as persistent|will not say/i.test(settings)) {
  problems.push('Settings does not state whether storage is durable');
}
console.log('settings state where the book is kept');

// 3. Export, and check the file is what it claims.
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.getByText('Save a backup', { exact: true }).click(),
]);
const file = `${TMP}/${download.suggestedFilename()}`;
await download.saveAs(file);
const parsed = JSON.parse(readFileSync(file, 'utf8'));
if (parsed.format !== 'portfolio-brief-backup') problems.push(`wrong format marker: ${parsed.format}`);
if (!parsed.state?.holdings?.length) problems.push('the backup carries no holdings');
console.log(
  `exported ${download.suggestedFilename()}: ${parsed.contents.holdings} holdings, ` +
    `${parsed.contents.stocks} stocks, ${parsed.contents.planLegs} legs`,
);

// 4. A credential must never ride along. Plant one and look for it.
const SENTINEL = 'sk-ant-MUST-NOT-BE-EXPORTED';
await page.evaluate((v) => localStorage.setItem('anthropic.apiKey', v), SENTINEL);
const [second] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.getByText('Save a backup', { exact: true }).click(),
]);
await second.saveAs(`${TMP}/with-key.json`);
if (readFileSync(`${TMP}/with-key.json`, 'utf8').includes(SENTINEL)) {
  problems.push('the backup file contains the API key');
} else {
  console.log('API key is not written into the backup');
}

// 5. Wipe. If this does not reset the book, nothing below proves anything.
await page.evaluate(() => localStorage.clear());
await openPlanAndScroll();
const wiped = await doneCount();
if (wiped !== '0') {
  problems.push(`clearing storage left the book at ${wiped}/8 — the restore check would be vacuous`);
}
console.log(`storage cleared: back to ${wiped}/8 done`);

// 6. Restore, via the picker the screen actually uses.
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  // The picker is created and clicked in one go, so there is no element to
  // target until it exists. Catch it on the way past.
  const original = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function patched() {
    if (this.type === 'file') {
      window.__pickedInput = this;
      return undefined;
    }
    return original.call(this);
  };
});
await page.getByText('Restore from a backup', { exact: true }).click();
await page.waitForTimeout(400);
const input = await page.evaluateHandle(() => window.__pickedInput);
const el = input.asElement();
if (!el) {
  problems.push('the restore button did not open a file picker');
} else {
  await el.setInputFiles(file);
  await page.waitForTimeout(1200);
  if (!(await body()).includes('Replace the book with this backup')) {
    problems.push('the backup was read but no confirmation step appeared');
  }
  await page.getByText('Replace the book with this backup', { exact: true }).click();
  await page.waitForTimeout(1200);
}

await openPlanAndScroll();
const restored = await doneCount();
if (restored !== marked) {
  problems.push(`restore did not bring the edit back (${marked}/8 before, ${restored}/8 after)`);
}
console.log(`restored: tranche A ${restored}/8 done`);

await browser.close();
rmSync(TMP, { recursive: true, force: true });

if (problems.length) {
  console.error('\nPROBLEMS:\n' + problems.map((p) => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log('\nBackup round trip holds: export, wipe, restore returns the book.');
