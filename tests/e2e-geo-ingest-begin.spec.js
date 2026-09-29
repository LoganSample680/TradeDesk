// ── ONE TRIP PER UPLOAD, AND THE HAT DECIDES THE ACCOUNT (2026-09-28) ──────
//
// Phones uploaded 14,212 times on 2026-09-27 and each upload made its database
// calls one after another. geo_ingest_begin (migration 20261055) does the key
// check, the account decision, the store and the state read in one trip.
//
// The same audit found the old account lookup had never worked: it asked
// team_members for a `status` column the table does not have, every call came
// back 400, and every crew member was filed as the owner of their own
// business. Owner 2026-09-28: "fix crew". A person can be crew by day and an
// owner on the side (9.10), and only the phone knows which hat is on, so the
// phone names the business and the server checks it is allowed.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const MIG = () => read('supabase/migrations/20261055_geo_ingest_begin.sql');
const SERVER = () => read('supabase/functions/ingest-geo/index.ts');

test.describe('geo_ingest_begin: the migration', () => {
  test('the flush key must match user, device and key, or nothing else happens', () => {
    const sql = MIG();
    expect(sql).toMatch(/where user_id = p_uid and device_id = coalesce\(p_device, ''\) and key = p_key/);
    const keyCheck = sql.indexOf('from geo_flush_keys');
    expect(keyCheck, 'checked before anything is written').toBeLessThan(sql.indexOf('insert into geo_events'));
  });

  test('a named business is used only with an ACTIVE crew link, else the poster', () => {
    const sql = MIG();
    expect(sql).toMatch(/tm\.employee_user_id = p_uid and tm\.contractor_user_id = p_cid and tm\.active/);
    expect(sql).toContain('v_cid uuid := p_uid;');
    expect(sql).toContain('if found then v_cid := p_cid; else v_name := null; end if;');
    // The column that never existed, and never will be read again.
    expect(sql).not.toMatch(/tm\.status/);
  });

  test('events go in on the same dedupe index as the old upsert', () => {
    const sql = MIG();
    expect(sql).toContain('on conflict (employee_user_id, type, ts, region_id) do nothing');
    for (const col of ['type text', 'ts timestamptz', 'lat numeric', 'lon numeric', 'region_id text',
      'kind text', 'flip_id text', 'arrival_ts timestamptz', 'detail jsonb']) expect(sql).toContain(col);
  });

  test('service_role only, and nothing writes device_status', () => {
    const sql = MIG();
    expect(sql).toMatch(/revoke all on function public\.geo_ingest_begin\(uuid, text, text, jsonb, uuid\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.geo_ingest_begin\(uuid, text, text, jsonb, uuid\) to service_role/);
    expect(sql).not.toMatch(/update device_status/i);
  });
});

test.describe('ingest-geo: one trip, and the hat', () => {
  test('uploads go through geo_ingest_begin with the named business', () => {
    const src = SERVER();
    expect(src).toContain('svc.rpc("geo_ingest_begin"');
    expect(src).toContain('p_cid: wantCid');
    expect(src).toContain('new URL(req.url).searchParams.get("cid")');
    expect(src).toContain('uuidOrNull(body.cid)');
  });

  test('the broken lookups are gone', () => {
    const src = SERVER();
    expect(src, 'team_members has no status column').not.toContain('contractor_user_id,name,status');
    expect(src, 'device_status has no location_checked_at column').not.toContain('location_checked_at');
    expect(src).not.toMatch(/from\("device_status"\)/);
  });

  test('the fallback path, until the migration is live, applies the same account rule', () => {
    const src = SERVER();
    expect(src).toMatch(/\.eq\("employee_user_id", uid\)\.eq\("contractor_user_id", wantCid\)\.eq\("active", true\)/);
    expect(src).toContain('error.code === "PGRST202"');
  });

  test('the first state-machine pass starts from the state the trip already read', () => {
    const src = SERVER();
    expect(src).toContain('if (attempt === 0) {');
    expect(src).toContain('stRow = began.stateUpdatedAt ? { state: began.state, updated_at: began.stateUpdatedAt } : null;');
  });
});

test.describe('the phone names the business it is working for', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the native upload address carries the business, and only when there is one', async () => {
    const r = await page.evaluate(() => {
      const keep = window._SUPA_DIRECT_URL;
      try {
        return {
          withCid: _geoIngestUrl('30a2b589-e081-4351-9f18-b1efba238c2d'),
          empty: _geoIngestUrl(''),
          none: _geoIngestUrl(null),
        };
      } finally { window._SUPA_DIRECT_URL = keep; }
    });
    expect(r.withCid).toMatch(/\/functions\/v1\/ingest-geo\?cid=30a2b589-e081-4351-9f18-b1efba238c2d$/);
    expect(r.empty).toMatch(/\/functions\/v1\/ingest-geo$/);
    expect(r.none).toMatch(/\/functions\/v1\/ingest-geo$/);
  });

  test('_geoFlushCid is _geoCid as a string, and never throws', async () => {
    const r = await page.evaluate(() => {
      const keep = window._geoCid;
      const out = {};
      try {
        window._geoCid = () => 'abc'; out.value = _geoFlushCid();
        window._geoCid = () => null; out.nul = _geoFlushCid();
        window._geoCid = () => { throw new Error('boom'); }; out.thrown = _geoFlushCid();
      } finally { window._geoCid = keep; }
      return out;
    });
    expect(r).toEqual({ value: 'abc', nul: '', thrown: '' });
  });

  test('configure runs again when the hat changes, and not otherwise', async () => {
    const r = await page.evaluate(async () => {
      const keep = { td: window._geoTdPlugin, cid: window._geoCid, en: window.supaEnabled, dev: window._initDeviceId,
        done: window._geoFlushCfgDone, dcid: window._geoFlushCfgCid, user: _supaUser, supa: _supa };
      const calls = [];
      try {
        window._geoTdPlugin = () => ({ configureFlush: async (o) => { calls.push(o.url); } });
        window.supaEnabled = () => true;
        window._initDeviceId = () => 'dev_hat_test';
        _supaUser = { id: '16ada395-ff1f-40f3-b990-515f420cfa80' };
        _supa = { from: () => ({ upsert: async () => ({ error: null }) }) };
        window._geoFlushCfgDone = false; window._geoFlushCfgCid = undefined;
        window._geoCid = () => '16ada395-ff1f-40f3-b990-515f420cfa80';
        await _geoConfigureFlush();
        await _geoConfigureFlush();                       // same hat: no second configure
        window._geoCid = () => '30a2b589-e081-4351-9f18-b1efba238c2d';
        await _geoConfigureFlush();                       // crew hat: configured again
        return { calls, done: window._geoFlushCfgDone, cid: window._geoFlushCfgCid };
      } finally {
        window._geoTdPlugin = keep.td; window._geoCid = keep.cid; window.supaEnabled = keep.en;
        window._initDeviceId = keep.dev; window._geoFlushCfgDone = keep.done; window._geoFlushCfgCid = keep.dcid;
        _supaUser = keep.user; _supa = keep.supa;
      }
    });
    expect(r.calls).toHaveLength(2);
    expect(r.calls[0]).toContain('?cid=16ada395-ff1f-40f3-b990-515f420cfa80');
    expect(r.calls[1]).toContain('?cid=30a2b589-e081-4351-9f18-b1efba238c2d');
    expect(r.done).toBe(true);
    expect(r.cid).toBe('30a2b589-e081-4351-9f18-b1efba238c2d');
  });

  test('a failed key registration configures nothing and is retried next time', async () => {
    const r = await page.evaluate(async () => {
      const keep = { td: window._geoTdPlugin, en: window.supaEnabled, dev: window._initDeviceId,
        done: window._geoFlushCfgDone, dcid: window._geoFlushCfgCid, user: _supaUser, supa: _supa };
      const calls = [];
      try {
        window._geoTdPlugin = () => ({ configureFlush: async (o) => { calls.push(o.url); } });
        window.supaEnabled = () => true;
        window._initDeviceId = () => 'dev_hat_test';
        _supaUser = { id: '16ada395-ff1f-40f3-b990-515f420cfa80' };
        _supa = { from: () => ({ upsert: async () => ({ error: { message: 'offline' } }) }) };
        window._geoFlushCfgDone = false; window._geoFlushCfgCid = undefined;
        await _geoConfigureFlush();
        return { calls, done: !!window._geoFlushCfgDone };
      } finally {
        window._geoTdPlugin = keep.td; window.supaEnabled = keep.en; window._initDeviceId = keep.dev;
        window._geoFlushCfgDone = keep.done; window._geoFlushCfgCid = keep.dcid; _supaUser = keep.user; _supa = keep.supa;
      }
    });
    expect(r).toEqual({ calls: [], done: false });
  });

  test('the JS poster names the business in its body, and leaves it out when there is none', async () => {
    const r = await page.evaluate(async () => {
      const keep = { fetch: window.fetch, cid: window._geoCid, supa: _supa };
      const bodies = [];
      try {
        window.fetch = (url, opts) => { bodies.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({ ok: true }); };
        _supa = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } };
        window._geoCid = () => '30a2b589-e081-4351-9f18-b1efba238c2d';
        _geoIngestPost([{ type: 'clock-in', ts: 1 }]);
        await new Promise((res) => setTimeout(res, 30));
        window._geoCid = () => null;
        _geoIngestPost([{ type: 'clock-in', ts: 2 }]);
        await new Promise((res) => setTimeout(res, 30));
        return bodies;
      } finally { window.fetch = keep.fetch; window._geoCid = keep.cid; _supa = keep.supa; }
    });
    expect(r).toHaveLength(2);
    expect(r[0].url).toMatch(/\/functions\/v1\/ingest-geo$/);
    expect(r[0].body.cid).toBe('30a2b589-e081-4351-9f18-b1efba238c2d');
    expect(r[1].body).not.toHaveProperty('cid');
  });

  test('no console errors', async () => {
    assertNoErrors(page, 'geo ingest begin');
  });
});
