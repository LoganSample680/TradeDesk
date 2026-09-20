// REAL flow: naming an unsaved stop from the Time Log day rail.
//
// Owner-designed 2026-09-20, after two reports on the same tap:
//   "I'm hitting save this address and it's a dead button"
//   "see how the screen jumps up a bit? Needs to be perfectly smooth"
//   "went to go save things on the day rail and the onsite didn't immediately
//    flip to the name I assigned, I want that"
//
// Three bugs on one control, all found by hand, none of them catchable by the
// offline shards: the shards stub the backend, so they can prove the button
// renders and the function runs, and they cannot prove that the row the button
// exists to fix actually changes. That is this spec's whole job.
//
// THE SEED IS THE REAL SERVER LANE, not a hand-written row. Since 2026-09-19
// (CLAUDE.md §17, "the phone no longer writes rows") the only thing that can
// put an automatic time row on file is the server deriver, reached by flushing
// raw evidence to ingest-geo. So the day here is POSTed exactly as a phone's
// wake handler would: a CoreMotion tape (the motion flips) plus the GPS fixes
// under it. The server derives it with the same geoDeriveDay the phone runs
// (gen-shared-deriver keeps them byte-identical, and CI fails if they drift),
// and writes through geo_replace_day. Nothing here fabricates a row.
//
// The day it builds, in one sentence: leave the shop, park somewhere no fence
// claims, sit there two hours, drive back to the shop. That produces exactly
// what the owner had on screen, an on-site row reading "Unsaved address" with
// a Save this address chip on it, and the mileage leg behind it that makes the
// chip live rather than dead.
//
// Seed data stays in the dev account per §12.7: the derived day, the clients,
// and the property this files on one of them are all left for the owner to
// poke at.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, tap, type, RUN_TAG } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'timelog/name-an-unsaved-stop';

// ── ON A REAL STREET, ON PURPOSE (first live run, 2026-09-20) ────────────
// This grid started on empty prairie (46N/102W) to stay clear of the other
// geo specs, and the run got all the way to the who-picker and then filed
// nothing: _mileWhoPick bails on `if (!addr) return false`, and out there the
// reverse lookup has no street to give, so the address line was empty. The
// spec is about naming a stop, so the stop has to be somewhere a map can
// name. Topeka, where the rest of this account's world already is.
//
// Still a per-run cell, for the reason every geo spec needs one: live tests
// never clean up (§12.7), so a fixed coordinate stacks fences on top of each
// other forever and a later run starts resolving an earlier run's place.
// 24 x 24 cells at 0.0012deg (~440ft) spreads runs over about two miles,
// which is wider than any fence and still inside the city.
const CELL = (process.pid + Date.now()) % 576;
const B_LAT = 39.0200 + (CELL % 24) * 0.0012;
const B_LON = -95.6600 - (Math.floor(CELL / 24) % 24) * 0.0012;
const SHOP = { lat: B_LAT, lon: B_LON };
// The kerb the day is about: about a mile and a half out, far enough to be a
// real drive, and inside nobody's fence, which is what makes it "unsaved".
const KERB = { lat: B_LAT + 0.0180, lon: B_LON - 0.0180 };
// A point on the road between them, so the trace is a line and not two dots.
const ROAD = { lat: B_LAT + 0.0090, lon: B_LON - 0.0090 };

// ── REACHING THE TIME LOG COSTS WHAT IT COSTS (12.6) ─────────────────────
// #nb-timelog is the WIDE nav and it is zero-sized on a phone, which is how
// the first run of this spec failed: the tap found the element, and the
// element had no box (412px viewport, covered by #mobile-topbar). On a narrow
// screen the Time Log lives behind More, which is two taps, not one. That
// difference is the whole reason this runs on three form factors, so it is
// counted rather than routed around.
const openTimeLog = async (p) => {
  const wide = await p.evaluate(() => {
    const b = document.getElementById('nb-timelog');
    if (!b) return false;
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (wide) return await tap(p, '#nb-timelog');
  let n = await tap(p, '#mtb-more');
  await p.waitForSelector('#mmi-timelog', { state: 'visible', timeout: 10000 });
  n += await tap(p, '#mmi-timelog');
  return n;
};

test.describe('Name an unsaved stop from the day rail', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('an unsaved stop becomes the customer you picked, and says so at once', async ({ page }) => {
    test.setTimeout(240000);

    const tag = RUN_TAG.slice(-5) + '-' + String(process.pid).slice(-4);
    const DEV = 'e2e-save-addr-' + tag;
    // The five customers the picker has to choose between. Deliberately
    // similar: the who-picker exists because going straight to "new customer"
    // made a duplicate every time somebody was already on the books, and a
    // picker that only ever has one row proves nothing about landing on the
    // RIGHT one.
    const KIN = ['Kinsley Roofing', 'Kinsey Plumbing', 'Kinsler Electric', 'Kingsley HVAC'];
    const TARGET = 'Kinsella Drywall ' + tag;
    let ctx = null;

    // ── 1. The world the tap happens in ────────────────────────────────────
    // ZERO interactions on purpose, and it is not a fudge: the ledger measures
    // what the PERSON spends on the journey being gated, and the journey here
    // starts at the rail. A shop address already in Settings, customers already
    // on the books and a device flush key are the account, not the flow. The
    // budget below stays honest because every tap from step 3 on is real.
    await step(page, {
      label: 'shop fence, five similar customers, device flush key', page: 'pg-dash', role: 'contractor',
      suspect: 'live-helpers signIn + cloud.js supaSaveToCloud + migration 20260830 geo_flush_keys',
      ruleText: 'the day needs a shop to leave from and the picker needs somebody to choose between',
      expected: 'flush key registered, shop coordinates on file, five customers in the cloud',
      act: async (p) => {
        ctx = await p.evaluate(async (a) => {
          const key = 'gfk_e2e_' + Math.random().toString(36).slice(2);
          const { error } = await _supa.from('geo_flush_keys')
            .upsert({ user_id: _supaUser.id, device_id: a.dev, key }, { onConflict: 'user_id,device_id' });
          S.officeLat = a.shop.lat; S.officeLon = a.shop.lon;
          S.baddr = 'E2E Shop ' + a.tag;
          const made = [];
          a.names.concat([a.target]).forEach((n, i) => {
            const c = { id: Date.now() * 1000 + i, name: n, phone: '3165550' + (100 + i),
                        addr: '', email: '', source: 'E2E', _e2e: 'save-addr' };
            clients.push(c); made.push(c.id);
          });
          saveAll();
          if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
          return { key, uid: _supaUser.id, url: _SUPA_DIRECT_URL, made,
                   targetId: made[made.length - 1], err: error && error.message };
        }, { dev: DEV, shop: SHOP, tag, names: KIN, target: TARGET });
        return 0;
      },
      rule: async (p) => {
        const n = await p.evaluate((ids) => ids.filter(id => clients.some(c => c && c.id === id)).length, ctx.made);
        return { ok: !ctx.err && n === 5, got: ctx.err || (n + ' customers on file') };
      },
    });

    // The day, as a dead phone's buffer would hold it. Motion flips are the
    // tape the deriver reads; fixes are the breadcrumbs under it. Both are
    // needed: a tape with no fixes resolves to nowhere and the server
    // correctly refuses to write the day (derive-day.mjs "no evidence").
    //
    // 8:00 at the shop, 8:30 drive, 9:00 parked at the kerb, 11:00 drive,
    // 11:30 back at the shop. Two legs and a two-hour dwell, all comfortably
    // over every minimum.
    const NOW = Date.now();
    const at = (h, m) => { const d = new Date(NOW); d.setHours(h, m, 0, 0); return d.getTime(); };
    const fix = (ts, c) => ({ type: 'fix', ts, lat: c.lat, lng: c.lon, accuracy: 8 });
    const motion = (ts, kind) => ({ type: 'motion', ts, kind });
    const events = [
      motion(at(8, 0), 'stationary'), fix(at(8, 0), SHOP), fix(at(8, 25), SHOP),
      motion(at(8, 30), 'automotive'),
      fix(at(8, 30), SHOP), fix(at(8, 45), ROAD), fix(at(8, 58), KERB),
      motion(at(9, 0), 'onFoot'),
      fix(at(9, 0), KERB), fix(at(10, 0), KERB), fix(at(10, 55), KERB),
      motion(at(11, 0), 'automotive'),
      fix(at(11, 0), KERB), fix(at(11, 15), ROAD), fix(at(11, 28), SHOP),
      motion(at(11, 30), 'onFoot'),
      fix(at(11, 30), SHOP), fix(at(11, 55), SHOP),
    ];

    // ── 2. Flush it, the way a phone that was never open does ──────────────
    let post = null;
    await step(page, {
      label: 'flush the day to ingest-geo and let the server derive it', page: 'pg-dash', role: 'contractor',
      suspect: 'supabase/functions/ingest-geo + _shared/derive-day.mjs deriveDayServer',
      ruleText: 'a tape with fixes under it must derive into an unsaved on-site row plus the leg that reached it',
      expected: 'job_time_entries has a source starting "unsaved", td_mileage has a leg with a toCoord',
      // ZERO, and for the same reason every other GPS flow says zero: a motion
      // transition is the phone noticing, not the person acting.
      act: async (p) => {
        post = await p.evaluate(async (a) => {
          const res = await fetch(a.url + '/functions/v1/ingest-geo', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: a.uid, device_id: a.dev, key: a.key, events: a.events }),
          });
          return { status: res.status, body: await res.json().catch(() => null) };
        }, { url: ctx.url, uid: ctx.uid, dev: DEV, key: ctx.key, events });
        return 0;
      },
      rule: async (p) => {
        const r = await p.evaluate(async () => {
          const { data: t } = await _supa.from('job_time_entries')
            .select('id,source,client_key,dest_place,minutes')
            .eq('employee_user_id', _supaUser.id).is('deleted_at', null)
            .gte('arrived_at', new Date(Date.now() - 24 * 3600000).toISOString());
          const { data: m } = await _supa.from('td_mileage')
            .select('id,data').eq('user_id', _supaUser.id).is('deleted_at', null)
            .gte('updated_at', new Date(Date.now() - 3600000).toISOString());
          const stop = (t || []).find(x => /^unsaved/.test(String(x.source || '')));
          const leg = (m || []).find(x => x && x.data && x.data.unsavedTo && x.data.toCoord);
          return { stop: stop ? { key: stop.client_key, mins: stop.minutes } : null,
                   leg: leg ? leg.id : null, rows: (t || []).length };
        });
        return { ok: !!(r.stop && r.leg),
                 got: 'post ' + (post && post.status) + ' · stop ' + JSON.stringify(r.stop) +
                      ' · leg ' + r.leg + ' · ' + r.rows + ' rows today' };
      },
    });

    // ── 3. Open the day the stop is on ─────────────────────────────────────
    // Three taps counted for the drill (month, then week, then day) although
    // it is driven through _tlDrillTo rather than three bar taps. The physical
    // drill is e2e-timelog-daynav's subject and is proven there; counting it
    // as free here would understate the real cost of reaching this screen and
    // quietly loosen the budget for everything after it.
    await step(page, {
      label: 'Time Log → this month → this week → today', page: 'pg-timelog', role: 'contractor',
      suspect: 'timelog.js renderTimeLog / _tlDrillTo',
      ruleText: 'the day rail must show the stop as unsaved AND offer a live Save this address',
      expected: 'a rail row reading "Unsaved address" with a Save this address chip on it',
      act: async (p) => {
        let n = await openTimeLog(p);
        await p.waitForTimeout(1500);
        await p.evaluate(() => _tlDrillTo('day', todayKey()));
        n += 3;
        await p.waitForTimeout(600);
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate(() => {
          const el = document.getElementById('tl-list');
          const txt = el ? el.textContent : '';
          const chips = [...document.querySelectorAll('.tl-rail-chip')]
            .filter(b => /Save this address/.test(b.textContent || ''));
          return { unsaved: /Unsaved address/.test(txt), chips: chips.length };
        });
        // The dead-button report is guarded right here: the chip is only drawn
        // when _mileStopCoord can actually place the stop behind it, so a chip
        // present at all is a chip with a coordinate under it.
        return { ok: r.unsaved && r.chips >= 1,
                 got: 'unsaved row ' + r.unsaved + ' · ' + r.chips + ' Save chips' };
      },
    });

    // ── 4. Tap Save, and watch the prompt hold still ───────────────────────
    // The owner filmed this one: the box used to be repainted wholesale when
    // the reverse lookup landed, which re-ran its entrance animation and moved
    // it up by half the height it gained. Measured in LAYOUT terms
    // (offsetHeight/offsetTop), because the rect carries the entrance's own
    // scale and reading through it measures the animation instead of the box.
    let box = null;
    await step(page, {
      label: 'Save this address → the kind prompt', page: 'pg-timelog', role: 'contractor',
      suspect: 'mileage.js _mileSaveStopAddress / _mileSaveAskKind',
      ruleText: 'the prompt opens and must not move or resize when the address lookup lands',
      expected: 'same height and same top before and after the name arrives',
      act: async (p) => {
        const n = await tap(p, '.tl-rail-chip:has-text("Save this address")');
        await p.waitForSelector('#_mile-kind-ov .zmodal', { timeout: 15000 });
        box = await p.evaluate(async () => {
          const ov = document.getElementById('_mile-kind-ov');
          const el = ov.querySelector('.zmodal');
          await Promise.all(el.getAnimations().map(x => x.finished.catch(() => {})));
          const before = { h: el.offsetHeight, top: el.offsetTop,
                           skel: ov.querySelectorAll('.td-skel').length };
          // The REAL Apple Maps lookup, so wait for it rather than sleeping a
          // guessed number of milliseconds.
          for (let i = 0; i < 100; i++) {
            if (!ov.querySelectorAll('.td-skel').length) break;
            await new Promise(r => setTimeout(r, 100));
          }
          await new Promise(r => setTimeout(r, 150));
          const after = document.getElementById('_mile-kind-ov').querySelector('.zmodal');
          return { before, same: after === el, boxes: ov.querySelectorAll('.zmodal').length,
                   h: after.offsetHeight, top: after.offsetTop,
                   skel: ov.querySelectorAll('.td-skel').length };
        });
        return n;
      },
      rule: async () => ({
        ok: !!box && box.before.skel === 1 && box.skel === 0 && box.same && box.boxes === 1 &&
            box.h === box.before.h && box.top === box.before.top,
        got: 'shimmer ' + (box && box.before.skel) + '→' + (box && box.skel) +
             ' · same box ' + (box && box.same) + ' · height ' + (box && box.before.h) + '→' + (box && box.h) +
             ' · top ' + (box && box.before.top) + '→' + (box && box.top),
      }),
    });

    // ── 5. It is a customer, not a supply house ────────────────────────────
    await step(page, {
      label: 'Lead or client → the who picker', page: 'pg-timelog', role: 'contractor',
      suspect: 'mileage.js _mileSaveKind / _mileSaveAskWho / _mileWhoRender',
      ruleText: 'picking customer must offer the customers already on the books, not a blank new-lead form',
      expected: 'the picker lists existing customers',
      act: async (p) => {
        const n = await tap(p, '#_mile-kind-ov button:has-text("Lead or client")');
        await p.waitForSelector('#_mile-who-q', { timeout: 15000 });
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate(() => ({
          rows: document.querySelectorAll('#_mile-who-hits button').length,
          text: (document.getElementById('_mile-who-hits') || {}).textContent || '',
        }));
        return { ok: r.rows >= 5, got: r.rows + ' customers offered' };
      },
    });

    // ── 6. The RIGHT one out of several ────────────────────────────────────
    // Typed key by key and then TAPPED, never called. The picker's buttons
    // carry their id through a JSON.stringify inside a double-quoted onclick,
    // and an unescaped quote there ended the attribute early and left WebKit
    // compiling "_mileWhoPick(" as the handler body, a syntax error that only
    // fired on a real tap (owner report 2026-09-20, from the live app). Every
    // offline test of this called the function directly and saw nothing.
    await step(page, {
      label: 'search, then tap the right customer', page: 'pg-timelog', role: 'contractor',
      suspect: 'mileage.js _mileWhoRender onclick escaping / _mileWhoPick / _mileFileAddressOn',
      ruleText: 'the pin must file as a property on the customer that was tapped, and on no other',
      expected: 'exactly one customer gains a property, and it is the one picked',
      act: async (p) => {
        let n = await type(p, '#_mile-who-q', 'Kinsella');
        await p.waitForTimeout(400);
        n += await tap(p, '#_mile-who-hits button');
        await p.waitForTimeout(1500);
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate((a) => {
          // What _mileWhoPick actually writes: the pin becomes the record's
          // primary address when it has none, else a card in extraAddresses.
          const filed = (c) => !!(c && ((c.addr && c.lat != null && c.lon != null) ||
            (Array.isArray(c.extraAddresses) && c.extraAddresses.length)));
          const withProp = clients.filter(c => c && a.made.includes(c.id) && filed(c));
          const t = clients.find(c => c && c.id === a.targetId);
          return { n: withProp.length, named: withProp.map(c => c.name), target: filed(t) };
        }, { made: ctx.made, targetId: ctx.targetId });
        return { ok: r.n === 1 && r.target, got: r.n + ' customers gained a property: ' + r.named.join(', ') };
      },
    });

    // ── 7. And the rail says so, at once ───────────────────────────────────
    // This is the report, in its own words: "the onsite didn't immediately flip
    // to the name I assigned, I want that." The elapsed time is measured inside
    // act() rather than left to step()'s eight-second settle poll, because a
    // name that lands in seven seconds passes that poll and is still not what
    // "immediately" means to the person who just tapped.
    let flip = null;
    await step(page, {
      label: 'the on-site row takes the name', page: 'pg-timelog', role: 'contractor',
      suspect: 'timelog.js _tlRowsFingerprint / _tlLiveRefresh · mileage.js _mileAddressSaved',
      ruleText: 'the stop must read the customer\'s name within a second of the save, without a reload',
      expected: 'the rail shows the customer and drops the Save chip, under 2000ms',
      act: async (p) => {
        flip = await p.evaluate(async (name) => {
          const t0 = Date.now();
          for (let i = 0; i < 120; i++) {
            const el = document.getElementById('tl-list');
            const txt = el ? el.textContent : '';
            if (txt.includes(name)) return { ms: Date.now() - t0, found: true,
              chips: [...document.querySelectorAll('.tl-rail-chip')]
                .filter(b => /Save this address/.test(b.textContent || '')).length,
              unsaved: /Unsaved address/.test(txt) };
            await new Promise(r => setTimeout(r, 100));
          }
          const el = document.getElementById('tl-list');
          return { ms: Date.now() - t0, found: false,
                   unsaved: /Unsaved address/.test(el ? el.textContent : ''),
                   chips: [...document.querySelectorAll('.tl-rail-chip')]
                     .filter(b => /Save this address/.test(b.textContent || '')).length };
        }, TARGET);
        // No taps. Watching the screen do what it promised is not work the
        // contractor does.
        return 0;
      },
      rule: async () => ({
        ok: !!flip && flip.found && flip.ms <= 2000 && !flip.unsaved && flip.chips === 0,
        got: flip && (flip.found ? ('named after ' + flip.ms + 'ms')
                                 : ('never named, still unsaved after ' + flip.ms + 'ms')) +
             ' · ' + (flip && flip.chips) + ' Save chips left',
      }),
    });

    // ── 8. And it is still true after a reload ─────────────────────────────
    // A name that only lives in this tab's memory is not saved. The fence is
    // real, so the row has to come back named from the server.
    await step(page, {
      label: 'reload, and read the day again', page: 'pg-timelog', role: 'contractor',
      suspect: 'geo_replace_day carry-across · mileage.js _mileFileAddressOn',
      ruleText: 'the name has to survive a reload, because the fence it came from is on file',
      expected: 'the rail still names the customer after a cold load',
      act: async (p) => {
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForTimeout(6000);
        let n = await openTimeLog(p);
        await p.waitForTimeout(1800);
        await p.evaluate(() => _tlDrillTo('day', todayKey()));
        n += 3;
        await p.waitForTimeout(800);
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate((name) => {
          const el = document.getElementById('tl-list');
          const txt = el ? el.textContent : '';
          return { named: txt.includes(name), unsaved: /Unsaved address/.test(txt) };
        }, TARGET);
        return { ok: r.named && !r.unsaved, got: 'named ' + r.named + ' · still unsaved ' + r.unsaved };
      },
    });

    const rep = report(FLOW, BASELINE, page);
    expect(rep.overBudget).toBe(false);
  });

  // ── The negative, and it is the dead-button report ───────────────────────
  // A chip whose first tap does nothing is exactly what js/observability.js
  // reports as a DEAD BUTTON and what §13.1's hotfix lane exists for. The rail
  // used to draw Save on every unsaved stop, including the ones _mileSaveStopAddress
  // could not place, so the fix was to ask before offering. That only holds if
  // something keeps checking that the two agree.
  test('a stop with no coordinate behind it is never offered a button to press', async ({ page }) => {
    const r = await page.evaluate(() => {
      const keep = (typeof mileage !== 'undefined' && Array.isArray(mileage)) ? mileage.slice() : [];
      try {
        // Nothing in the mileage book can place this key, so nothing should
        // offer to save it.
        const row = { id: 'x1', source: 'auto', rawSource: 'unsaved', clientName: 'Unsaved address',
                      minutes: 30, date: todayKey(), personUid: null, clientKey: 'd-j-nothing-claims-this',
                      startTime: new Date(Date.now() - 3600000).toISOString(),
                      endTime: new Date(Date.now() - 1800000).toISOString() };
        const html = _tlDayRailHtml([row]);
        return { placed: !!(typeof _mileStopCoord === 'function' && _mileStopCoord(row.clientKey, row.date)),
                 offers: /Save this address/.test(html) };
      } finally { if (typeof mileage !== 'undefined' && Array.isArray(mileage)) { mileage.length = 0; keep.forEach(x => mileage.push(x)); } }
    });
    expect(r.placed, 'nothing can place this stop').toBe(false);
    expect(r.offers, 'so nothing offers to save it').toBe(false);
  });
});
