#!/usr/bin/env node
// Serves the repo root the way Cloudflare Pages serves this project, so the
// marketing site's clean URLs and the "/" gate (functions/index.js) can be
// exercised locally and in the offline test shards without a Cloudflare build.
//
// Cloudflare's static rules, mirrored here (docs: "Serving Pages"):
//   /foo.html         -> 308 to /foo            (and /foo serves foo.html)
//   /foo/             -> 308 to /foo            (when foo.html exists)
//   /foo/index.html   -> 308 to /foo/
//   /index.html       -> 308 to /
//   anything else on disk is served as-is (support.js, _ds/*, robots.txt)
//   no match          -> 404
// Plus the one function this project mounts on "/": wantsApp() from
// functions/index.js decides between index.html (the app) and landing.html
// (the marketing page), with the same headers the function sets.
//
// Usage:  node scripts/serve-site.js [port]        (default 8790)
//   or    const { start } = require('./scripts/serve-site'); await start(0);
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (_e) { return false; }
}

// Resolve a request path to {status, location} or {status, file}.
function resolve(rawPath) {
  let p;
  try { p = decodeURIComponent(rawPath.split('?')[0]); } catch (_e) { return { status: 400 }; }
  if (p.includes('..')) return { status: 404 };
  if (p === '' || p === '/') return { status: 200, file: path.join(ROOT, 'index.html') };

  // A .html path only collapses to its clean URL when that file exists; a
  // .html path that is not on disk is a 404 like any other miss.
  if (p.endsWith('.html')) {
    if (!isFile(path.join(ROOT, p))) return { status: 404 };
    if (p.endsWith('/index.html')) return { status: 308, location: p.slice(0, -'index.html'.length) };
    return { status: 308, location: p.slice(0, -'.html'.length) };
  }

  if (p.endsWith('/')) {
    const bare = p.slice(0, -1);
    if (isFile(path.join(ROOT, p, 'index.html'))) return { status: 200, file: path.join(ROOT, p, 'index.html') };
    if (isFile(path.join(ROOT, bare + '.html'))) return { status: 308, location: bare };
    return { status: 404 };
  }

  const direct = path.join(ROOT, p);
  if (isFile(direct)) return { status: 200, file: direct };
  if (isFile(direct + '.html')) return { status: 200, file: direct + '.html' };
  if (isFile(path.join(direct, 'index.html'))) return { status: 308, location: p + '/' };
  return { status: 404 };
}

function send(res, r, extra) {
  const type = TYPES[path.extname(r.file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store' }, extra || {}));
  fs.createReadStream(r.file).pipe(res);
}

function makeHandler(wantsApp) {
  return function handler(req, res) {
    const rawUrl = req.url || '/';
    const pathOnly = rawUrl.split('?')[0];
    // The "/" gate, exactly as functions/index.js decides it.
    if ((pathOnly === '/' || pathOnly === '') && (req.method === 'GET' || req.method === 'HEAD')) {
      const request = new Request('http://local' + rawUrl, { headers: req.headers });
      const app = wantsApp(request);
      return send(res, { file: path.join(ROOT, app ? 'index.html' : 'landing.html') }, {
        'Cache-Control': 'no-store, must-revalidate',
        'Vary': 'Cookie, User-Agent',
        'X-TD-Page': app ? 'app' : 'landing',
      });
    }
    const r = resolve(rawUrl);
    if (r.status === 308) {
      const q = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : '';
      res.writeHead(308, { Location: r.location + q });
      return res.end();
    }
    if (r.status !== 200) {
      res.writeHead(r.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(r.status === 404 ? 'Not found' : 'Bad request');
    }
    send(res, r);
  };
}

// functions/index.js is an ES module (Pages Functions are), and this file is
// CommonJS loaded through Playwright's transform, which turns a dynamic
// import() into require() and then trips on `export`. Evaluating the source
// with the export keywords stripped keeps the gate rule single-sourced: the
// same text Cloudflare runs is what the emulator and the spec exercise.
function loadGate() {
  const src = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8').replace(/^export\s+/mg, '');
  const out = {};
  new Function('exports', src + '\nexports.wantsApp = wantsApp;')(out);
  return out;
}

async function start(port = 8790) {
  const { wantsApp } = loadGate();
  return new Promise((resolveStart, reject) => {
    const server = http.createServer(makeHandler(wantsApp));
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolveStart({
        server,
        port: actual,
        url: `http://127.0.0.1:${actual}`,
        close: () => new Promise(done => server.close(done)),
      });
    });
  });
}

module.exports = { start, resolve, loadGate, ROOT };

if (require.main === module) {
  const port = Number(process.argv[2]) || 8790;
  start(port).then(s => console.log(`[serve-site] ${s.url} -> ${ROOT}`));
}
