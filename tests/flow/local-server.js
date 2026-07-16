// Local test server, serves the static TradeDesk app AND proxies /api/* to
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

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL-STACK anon-key swap (GATED on E2E_LOCAL_STACK==='1').
//
// When the flag is OFF this is dormant, served HTML/JS is byte-for-byte the
// cloud files. When ON, the app must authenticate against the LOCAL Supabase
// stack, which uses a DIFFERENT publishable key than the baked cloud one. We
// rewrite the cloud anon key(s) → the local publishable key on the fly as files
// are served (the on-disk source is never touched). Two key forms exist:
//   • js/cloud.js (main app)        : sb_publishable_… (new format)
//   • client/sign/intake .html      : eyJhbGciOiJ… (legacy anon JWT)
// Both map to the single local publishable key below.
// ─────────────────────────────────────────────────────────────────────────────
const LOCAL_STACK = process.env.E2E_LOCAL_STACK === '1';
const LOCAL_PUBLISHABLE_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const CLOUD_PUBLISHABLE_KEY = 'sb_publishable_kaahEa5tFydocUuYi8plHg_K78HPyvJ';
const CLOUD_ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13dHNtY3RhamhycnliYmxnb3JmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjIwNjMsImV4cCI6MjA5MDczODA2M30.-FMn1pEs9PpCvv8eGwSbtucWAWvcfEcQ1SYx4nD207M';

// Swap every cloud anon-key form → the local publishable key. No-op when the
// local-stack flag is off, so cloud serving is completely untouched.
function swapAnonKey(text) {
  if (!LOCAL_STACK) return text;
  return text
    .split(CLOUD_PUBLISHABLE_KEY).join(LOCAL_PUBLISHABLE_KEY)
    .split(CLOUD_ANON_JWT).join(LOCAL_PUBLISHABLE_KEY)
    // client/sign/intake.html hardcode the CLOUD Supabase URL (not the /api proxy
    // like the main app), so in local mode they'd talk to cloud Supabase with the
    // local key (→ 401) instead of the local stack. Rewrite that quoted literal to
    // the same-origin /api path so they route through THIS server → local stack.
    .split("'https://mwtsmctajhrrybblgorf.supabase.co'").join("(location.origin+'/api')");
}

const proxy = httpProxy.createProxyServer({ target: UPSTREAM, changeOrigin: true, secure: true, ws: true, xfwd: false });
proxy.on('error', (err, _req, res) => {
  if (res && !res.headersSent && res.writeHead) { res.writeHead(502, { 'content-type': 'text/plain' }); }
  if (res && res.end) res.end('upstream error: ' + err.message);
});

// Log every non-GET /api round-trip's upstream status (and any GET that errors).
// A "cloud ABSENT" failure is diagnosable from this: a 2xx on POST/PATCH /rest/v1/*
// means the write landed (test read too early); a 4xx means auth/RLS rejected it.
proxy.on('proxyRes', (proxyRes, req) => {
  const m = req.method, u = (req.url || '').split('?')[0], s = proxyRes.statusCode;
  if (m !== 'GET' || s >= 400) console.log(`[api] ${m} ${u} -> ${s}`);
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
    const ext = path.extname(filePath).toLowerCase();
    const ctype = MIME[ext] || 'application/octet-stream';
    // For HTML, inject a tiny script pinning the app to PROXY mode. The local server
    // IS the /api proxy (it forwards to Supabase), so the app must NOT try direct-to-
    // supabase.co: on the runner that's unreachable, so its 2.5s boot probe times out
    // and falls back anyway, adding ~2.5s to EVERY test boot (→ slow boot → inputs
    // "resolved to hidden" → the timeout failures). Pinning proxy skips the probe.
    if (ext === '.html') {
      fs.readFile(filePath, 'utf8', (e2, html) => {
        if (e2) { res.writeHead(500); return res.end('read error'); }
        const inject = '<script>try{localStorage.setItem("zp3_supa_mode","proxy")}catch(e){}</script>';
        html = /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, '<head$1>' + inject) : inject + html;
        // The standalone client pages (sign.html / client.html / intake.html) hardcode
        // the DIRECT https://<ref>.supabase.co URL in their own `const SUPA_URL='...'`
        // (they don't share cloud.js's bridge logic). On the runner that host is
        // unreachable, so their proposal/hub/account fetches fail and the page sits on
        // its error screen (#f-name / #approve-btn never shown). Rewrite that literal to
        // the same-origin /api bridge this server proxies, exactly what the main app
        // uses (location.origin+'/api'): so they load live data identically. Only those
        // pages contain the literal; index.html (cloud.js) is untouched.
        html = html.replace(/'https:\/\/[a-z0-9-]+\.supabase\.co'/gi, "(location.origin+'/api')");
        // LOCAL STACK ONLY: point the app's anon key at the local stack's key.
        html = swapAnonKey(html);
        res.writeHead(200, { 'content-type': ctype, 'cache-control': 'no-store' });
        res.end(html);
      });
      return;
    }
    // LOCAL STACK ONLY: the main app's anon key lives in js/cloud.js (a .js file),
    // so rewrite JS text the same way as HTML. Cloud path streams unchanged.
    if (LOCAL_STACK && ext === '.js') {
      fs.readFile(filePath, 'utf8', (e3, js) => {
        if (e3) { res.writeHead(500); return res.end('read error'); }
        res.writeHead(200, { 'content-type': ctype, 'cache-control': 'no-store' });
        res.end(swapAnonKey(js));
      });
      return;
    }
    res.writeHead(200, { 'content-type': ctype, 'cache-control': 'no-store' });
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
