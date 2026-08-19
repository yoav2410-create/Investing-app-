// Asserts that nothing personal reaches the published app.
//
//   npm run build:pages && node scripts/privacy-check.mjs
//
// The seed data is compiled into the bundle, and a GitHub Pages site is
// publicly reachable on every plan — password-protected Pages is an Enterprise
// feature. So the repository being private protects nothing about what the app
// shows. The bundle is the boundary, and this is the check on it.
//
// Two things are checked, because they fail differently:
//
//   1. No credentials anywhere. This should never regress, and if it does the
//      damage is immediate and irreversible.
//   2. No trace of the original owner-specific seed data. This regresses the
//      moment someone "makes the demo more realistic" by pasting in figures
//      from a real account, which is an easy and well-meant mistake.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] ?? 'dist';
if (!existsSync(DIR)) {
  console.error(`No ${DIR}/ — run \`npm run build:pages\` first.`);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const textFiles = walk(DIR).filter((f) => /\.(js|html|json|map|txt|css)$/.test(f));
const bundle = textFiles.map((f) => ({ file: f, body: readFileSync(f, 'utf8') }));
const problems = [];

// --- 1. Credentials --------------------------------------------------------
const CREDENTIALS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'a GitHub token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
];
for (const { file, body } of bundle) {
  for (const [re, what] of CREDENTIALS) {
    if (re.test(body)) problems.push(`${file} contains ${what}`);
  }
}

// --- 2. The original owner-specific seed data ------------------------------
// Exact strings and patterns from the pre-sanitised bundle. Each one is here
// because it was actually in a shipped build at some point.
//
// The numeric ones are matched *in context*, not bare. A first version of this
// check looked for "18420" on its own and flagged LLY's quarterly revenue —
// $18.42bn, a published figure about a public company. A privacy check that
// cries wolf gets switched off, so the field name has to be part of the match.
const PERSONAL = [
  [/Raise cash to the 30% floor/, 'the original plan summary'],
  [/Lowest conviction in the book/, 'the original plan rationale'],
  [/same thesis, contracted rather than merchant/, 'the original plan rationale'],
  [/Proceeds fund the Constellation add/, 'the original plan rationale'],
  [/currency\s*:\s*["']ILS["']/, 'the original account currency'],
  [/amount\s*:\s*18[_,]?420/, 'the original USD cash balance'],
  [/amount\s*:\s*5[_,]?200/, 'the original second-currency balance'],
  [/realizedPnl\s*[=:]\s*4[_,]?318\.6/, 'the original realised P&L'],
  // The owner's risk rules leaked through a stock narrative once, not through
  // the plan object, so the pair is matched wherever it appears in prose.
  [/\b15% cap\b/, "the original position cap"],
  [/\b30% floor\b/, "the original cash floor"],
];
for (const { file, body } of bundle) {
  for (const [re, what] of PERSONAL) {
    const hit = body.match(re);
    if (hit) problems.push(`${file} still contains ${what} (matched "${hit[0]}")`);
  }
}

// --- 3. The check has to be able to fail -----------------------------------
// A matcher that silently stops matching is worse than no matcher, and this
// project has already shipped two assertions that passed vacuously. Prove the
// haystack is real before trusting a miss.
const totalBytes = bundle.reduce((n, b) => n + b.body.length, 0);
if (totalBytes < 100_000) {
  problems.push(`only ${totalBytes} bytes of text scanned — the build looks empty, so a pass here means nothing`);
}
const sentinel = bundle.some((b) => b.body.includes('Three-tranche rebalance'));
if (!sentinel) {
  problems.push(
    'could not find the demo plan name in the bundle — the scan is not reaching the seed data, ' +
      'so the "no personal data" result is not trustworthy',
  );
}

console.log(`Scanned ${bundle.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)}MB of text in ${DIR}/`);
if (problems.length) {
  console.error('\nPERSONAL DATA WOULD BE PUBLISHED:\n' + problems.map((p) => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log('No credentials and no owner-specific data in the build.');
console.log('Sentinel found, so the scan is genuinely reaching the seed data.');
