#!/usr/bin/env node
// Cloudflare Pages build step, swaps hardcoded Supabase credentials with
// environment variables so preview deployments point at Supabase preview
// branches instead of production.
//
// Required env vars (set in Cloudflare Pages → Settings → Environment Variables):
//   SUPABASE_URL       production: https://mwtsmctajhrrybblgorf.supabase.co
//   SUPABASE_ANON_KEY  production: the anon/public JWT for the project
//
// Supabase's Cloudflare Pages integration sets these automatically per-PR
// when Preview Branching is enabled in the Supabase dashboard.
// If neither var is set this script is a no-op (safe for local dev).

const fs = require('fs');

const PROD_URL = 'https://mwtsmctajhrrybblgorf.supabase.co';
const PROD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13dHNtY3RhamhycnliYmxnb3JmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjIwNjMsImV4cCI6MjA5MDczODA2M30.-FMn1pEs9PpCvv8eGwSbtucWAWvcfEcQ1SYx4nD207M';

const url = process.env.SUPABASE_URL      || PROD_URL;
const key = process.env.SUPABASE_ANON_KEY || PROD_KEY;

if (url === PROD_URL && key === PROD_KEY) {
  console.log('[cf-build] No Supabase env vars set, using production values as-is.');
  process.exit(0);
}

const targets = ['sign.html', 'client.html', 'js/cloud.js'];
let patched = 0;
for (const f of targets) {
  const before = fs.readFileSync(f, 'utf8');
  const after  = before.replaceAll(PROD_URL, url).replaceAll(PROD_KEY, key);
  if (after !== before) {
    fs.writeFileSync(f, after);
    console.log(`[cf-build] Patched ${f}`);
    patched++;
  }
}

if (patched === 0) {
  console.warn('[cf-build] No substitutions made, check that SUPABASE_URL / SUPABASE_ANON_KEY match the hardcoded strings.');
} else {
  console.log(`[cf-build] Done. ${patched} file(s) patched. Pointing at: ${url}`);
}
