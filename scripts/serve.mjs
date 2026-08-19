// Serves an exported web build the way it is actually deployed. Zero
// dependencies, so a fresh clone can run it without fetching anything.
//
//   node scripts/serve.mjs [dir] [port] [basePath]
//
// The important part is the fallback: this is a single-page build, so a URL
// like /stock/META has no file behind it. A plain static server answers those
// with an empty 404 and every verification script dies on the first deep link —
// which is a property of the server, not of the app. GitHub Pages answers them
// with the repo's 404.html at status 404, and the router takes it from there.
// This does the same, so what runs locally matches what ships.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const DIR = process.argv[2] ?? 'dist';
const PORT = Number(process.argv[3] ?? 8080);
const BASE = (process.argv[4] ?? '').replace(/^\/+|\/+$/g, '');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export function createStaticServer({ dir = DIR, base = BASE } = {}) {
  return createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const send = (code, file) => {
      res.writeHead(code, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    };

    let rel = path;
    if (base) {
      if (!path.startsWith(`/${base}`)) return void res.writeHead(404).end();
      rel = path.slice(base.length + 1);
    }
    // Never let a request climb out of the served directory.
    rel = normalize(rel).replace(/^(\.\.[/\\])+/, '');

    const target = join(dir, rel);
    if (existsSync(target) && statSync(target).isFile()) return send(200, target);
    const index = join(dir, rel, 'index.html');
    if (existsSync(index)) return send(200, index);

    // The single-page fallback. 404.html when the build has one — that is what
    // Pages serves, at status 404 — otherwise index.html at 200, which is what
    // an ordinary SPA host does.
    const notFound = join(dir, '404.html');
    if (existsSync(notFound)) return send(404, notFound);
    const root = join(dir, 'index.html');
    if (existsSync(root)) return send(200, root);
    res.writeHead(404).end();
  });
}

// Only listen when run directly, so the checks can import the server rather
// than shelling out to it.
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(DIR)) {
    console.error(`No ${DIR}/ — run \`npm run build:web\` first.`);
    process.exit(1);
  }
  createStaticServer().listen(PORT, () => {
    console.log(`Serving ${DIR} at http://localhost:${PORT}/${BASE}`);
    console.log('Deep links fall back the way the deployed site does. Ctrl-C to stop.');
  });
}
