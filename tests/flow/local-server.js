// Local test server — serves the static TradeDesk app AND proxies /api/* to
// Supabase, so the live flow suite can run on a self-hosted runner (Proxmox) with
// ZERO Cloudflare Worker usage. It reproduces what functions/api/[[path]].js does
// on Cloudflare, but locally: /api/<path> -> <SUPABASE_UPSTREAM>/<path>, including
// the Realtime WebSocket upgrade.
//
//   SUPABASE_UPSTREAM  where /api forwards to.
//                      Default: the cloud Supabase project (today).
//                      Later (self-hosted): http://<proxmox-supabase>:8000
//   PORT               listen port (default 8788).
//
// Run:  SUPABASE_UPSTREAM=https://<ref>.supabase.co node tests/flow/local-server.js
// Dep:  npm i --no-save http-proxy   (handles HTTP + WebSocket proxying)
const http = require('http');
const fs = require('fs');
const path = require('path');
const httpProxy = require('http-proxy');

const PORT = parseInt(process.env.PORT || '8788', 10);
const UPSTREAM = (process.env.SUPABASE_UPSTREAM || 'https://mwtsmctajhrrybblgorf.supabase.co').replace(/\/$/, '');
const ROOT = path.resolve(__dirname, '..', '..'); // repo root (where index.html lives)

const proxy = httpProxy.createProxyServer({ target: UPSTREAM, changeOrigin: true, secure: true, ws: true, xfwd: false });
proxy.on('error', (err, _req, res) => {
  if (res && !res.headersSent && res.writeHead) { res.writeHead(502, { 'content-type': 'text/plain' }); }
  if (res && res.end) res.end('upstream error: ' + err.message);
});

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function isApi(url) { return url === '/api' || url.startsWith('/api/') || url.startsWith('/api?'); }
function stripApi(url) { return url.replace(/^\/api/, '') || '/'; }

function serveStatic(req, res) {
  // Map the URL path to a file under the repo root. Default '/' -> index.html.
  let urlPath = decodeURIComponent((req.url.split('?')[0]) || '/');
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  // Block path traversal.
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found: ' + urlPath); }
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (isApi(req.url)) {
    // CORS for any tooling that calls /api cross-origin (the app is same-origin, but harmless).
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
      });
      return res.end();
    }
    req.url = stripApi(req.url);          // /api/auth/v1/... -> /auth/v1/...
    return proxy.web(req, res, { target: UPSTREAM });
  }
  serveStatic(req, res);
});

// Realtime WebSocket: /api/realtime/... -> upstream wss. http-proxy forwards the
// Upgrade with the target as https; Supabase serves the socket directly.
server.on('upgrade', (req, socket, head) => {
  if (isApi(req.url)) {
    req.url = stripApi(req.url);
    proxy.ws(req, socket, head, { target: UPSTREAM });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[local-server] serving ${ROOT} on http://localhost:${PORT}  (/api -> ${UPSTREAM})`);
});
