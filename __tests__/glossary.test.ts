import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GLOSSARY, glossary, type GlossaryKey } from '@/domain/glossary';

/**
 * A mistyped `term="…"` renders nothing at all rather than failing, so the only
 * way to catch one is to check the source. This walks the screens, pulls out
 * every term reference, and asserts it resolves.
 */

const ROOT = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

const sources = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'src'))].map((path) => ({
  path,
  text: readFileSync(path, 'utf8'),
}));

function termsIn(text: string): string[] {
  // Literal form: term="rsi"
  const literal = [...text.matchAll(/\bterm=["']([a-zA-Z0-9]+)["']/g)].map((m) => m[1]!);
  // Expression form: term={MULTIPLE_TERM[x]} or term={helper(y)}. Anything that
  // computes its key goes through a helper returning GlossaryKey, so the
  // compiler already checks it — here we only need the identifier so screens
  // that use one are not counted as having no explainers.
  const expressions = [...text.matchAll(/\bterm=\{/g)].map(() => '__computed__');
  return [...literal, ...expressions];
}

describe('every metric explainer resolves', () => {
  it('references only keys that exist in the glossary', () => {
    const bad: string[] = [];
    for (const { path, text } of sources) {
      for (const term of termsIn(text)) {
        if (term === '__computed__') continue;
        if (!(term in GLOSSARY)) bad.push(`${path.replace(ROOT, '.')}: ${term}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('gives every entry all three parts filled in', () => {
    const thin: string[] = [];
    for (const key of Object.keys(GLOSSARY) as GlossaryKey[]) {
      const e = glossary(key);
      if (!e.title.trim()) thin.push(`${key}: no title`);
      if (e.what.trim().length < 25) thin.push(`${key}: "what" is too thin`);
      if (e.read.trim().length < 25) thin.push(`${key}: "read" is too thin`);
      if (e.caveat != null && e.caveat.trim().length < 25) thin.push(`${key}: "caveat" is too thin`);
    }
    expect(thin).toEqual([]);
  });

  it('warns about the metrics that are most often misread', () => {
    // These four mislead in specific, well-known ways. An explainer for any of
    // them that omits the caveat is the kind that does more harm than good.
    for (const key of ['trailingPe', 'evEbitda', 'beta', 'insiderActivity'] as const) {
      expect(glossary(key).caveat).toBeTruthy();
    }
  });

  it('routes every trend check to a real explainer', () => {
    // The detail page picks these from the check label, so exercise all three.
    for (const key of ['rsi', 'directionalIndicators', 'movingAverage'] as const) {
      expect(glossary(key).title).toBeTruthy();
    }
  });

  it('covers the complex terms on the stock detail page', () => {
    const detail = sources.find((s) => s.path.endsWith('[ticker].tsx'))!;
    const used = new Set(termsIn(detail.text));
    for (const expected of [
      'evEbitda',
      'trailingPe',
      'forwardPe',
      'priceToSales',
      'revenue',
      'operatingIncome',
      'netIncome',
      'eps',
      'multipleHistory',
      'trendScore',
      'sentiment',
      'verdict',
      'bullBearCase',
      'whatWouldChangeMyMind',
      'dataProvenance',
    ]) {
      expect(used).toContain(expected);
    }
  });

  it('puts explainers on every screen, not just the stock page', () => {
    const screens = sources.filter((s) => s.path.includes('/app/') && s.path.endsWith('.tsx'));
    const without = screens
      .filter((s) => !s.path.endsWith('_layout.tsx'))
      .filter((s) => termsIn(s.text).length === 0)
      .map((s) => s.path.replace(ROOT, '.'));
    // Sync, settings and the More hub carry instructions and navigation rather
    // than metrics, so there is nothing on them to explain.
    expect(without.filter((p) => !/sync|settings|more/.test(p))).toEqual([]);
  });
});
