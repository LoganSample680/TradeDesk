// REAL flow: crew location consent is recorded because someone tapped, never
// because the app assumed.
//
// The defect this locks down, driven against real Postgres and real RLS:
// _geoTrackInit wrote `location_consent = true` onto the employee's
// team_members row at sign-in without ever telling them their location was being
// logged. That column's own migration comment reads "employee's explicit
// opt-in". A field asserting an agreement nobody made is worse in a dispute than
// no field at all, because it reads as a manufactured record rather than a
// missing one.
//
// Why an offline shard cannot close this: the whole claim is about what is
// PERSISTED to team_members under RLS for a real employee identity. A mocked
// _supa.update() proves the call shape and nothing about the row.
//
// Chain covered:
//   an un-acknowledged employee signs in
//     -> NOTHING is tracked, and location_consent is not fabricated
//     -> the notice states what is captured
//     -> their tap writes location_ack_at + the notice version to team_members
//     -> the owner's roster reads that back as a real status
//
// Seed data is left in the account per CLAUDE.md §12.7 — nothing here tears down.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'crew/location-consent-is-real';

test.describe('Crew location consent: recorded by a tap, never fabricated', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('an employee is never auto-consented, and their tap is what lands in team_members', async ({ page }) => {
    test.setTimeout(180000);

    // The ack columns ship with this PR; migrations only reach Dev on merge.
    const colsReady = await page.evaluate(async () => {
      try {
        const { error } = await _supa.from('team_members').select('location_ack_at').limit(1);
        return !error;
      } catch (e) { return false; }
    });
    test.skip(!colsReady, 'team_members location_ack_* not migrated to Dev yet (merges with this PR)');

    // Drive the employee branch against this account's own team_members row.
    // Using the signed-in identity keeps RLS real: the update must pass the
    // owner policy for THIS uid, which is exactly what would break if the
    // policy casting were wrong.
    const uid = await page.evaluate(() => (_supaUser && _supaUser.id) || null);
    expect(uid, 'signed-in uid').toBeTruthy();

    // ── 1. An un-acknowledged employee is not tracked, and not auto-consented ──
    await step(page, {
      label: 'un-acknowledged employee signs in', page: 'pg-dash', role: 'employee',
      suspect: 'geo-track.js _geoTrackInit (it used to write location_consent=true here)',
      ruleText: 'nothing may be tracked, and no agreement may be recorded, before the person is told',
      expected: 'startGeoTracking not called, and no location_consent write attempted',
      act: async (p) => {
        await p.evaluate(() => {
          window.__writes = [];
          window.__started = 0;
          window.__realStart = startGeoTracking;
          startGeoTracking = () => { window.__started++; };
          // Intercept only the team_members writes, so everything else on the
          // page keeps talking to the real backend.
          window.__realFrom = _supa.from.bind(_supa);
          _supa.from = (tbl) => {
            const q = window.__realFrom(tbl);
            if (tbl !== 'team_members') return q;
            const realUpdate = q.update.bind(q);
            q.update = (patch) => { window.__writes.push(patch); return realUpdate(patch); };
            return q;
          };
          _isEmployee = true;
          _employeeRecord = { id: 'e2e-consent', location_ack_at: null };
          S.teamTracking = true;
          try { _geoTrackInit(); } catch (e) {}
          startGeoTracking = window.__realStart;
        });
        await page.waitForTimeout(900); // let the deferred notice sheet appear
        return 1;
      },
      rule: async (p) => {
        const out = await p.evaluate(() => ({
          started: window.__started,
          consentWrites: (window.__writes || []).filter(w => 'location_consent' in (w || {})).length,
          localFlag: _employeeRecord && _employeeRecord.location_consent,
          noticeShown: !!document.getElementById('_geo-notice-ov'),
          needsAck: typeof _geoNeedsAck === 'function' ? _geoNeedsAck() : null,
        }));
        const ok = out.started === 0 && out.consentWrites === 0
                   && out.localFlag === undefined && out.needsAck === true;
        return { ok, got: JSON.stringify(out) };
      },
    });

    // ── 2. The notice says what is captured ────────────────────────────────
    await step(page, {
      label: 'the notice states what is logged', page: 'pg-dash', role: 'employee',
      suspect: 'geo-track.js _geoNoticeSheet copy',
      ruleText: 'the person must be told what is captured before anything is recorded about them',
      expected: 'the sheet names mileage and hours, and warns the phone will ask next',
      act: async (p) => {
        await p.evaluate(() => {
          if (!document.getElementById('_geo-notice-ov')) _geoNoticeSheet();
        });
        return 0; // reading a sheet that is already open costs nothing
      },
      rule: async (p) => {
        const txt = await p.evaluate(() => {
          const ov = document.getElementById('_geo-notice-ov');
          return ov ? ov.textContent : '';
        });
        const ok = /mileage/i.test(txt) && /hours/i.test(txt) && /permission/i.test(txt);
        return { ok, got: txt.slice(0, 160) };
      },
    });

    // ── 3. The tap is what writes the record ───────────────────────────────
    await step(page, {
      label: 'employee taps Got it, continue', page: 'pg-dash', role: 'employee',
      suspect: 'geo-track.js _geoRecordAck writing to team_members',
      ruleText: 'the acknowledgment must be a REAL row change, timestamped and versioned, caused by the tap',
      expected: 'location_ack_at + location_ack_version land on the team_members row in Postgres',
      act: async (p) => {
        await p.evaluate(async ({ uid }) => {
          // Point the ack at this account's own row so the write is exercised
          // against real RLS rather than a fabricated employee id.
          _supaUser.id = uid;
          _employeeRecord = { id: 'e2e-consent', location_ack_at: null };
          // Ensure a row exists to update (idempotent, leaves seed data).
          try {
            await _supa.from('team_members').upsert({
              contractor_user_id: uid, email: 'e2e-consent@tradedesk.test',
              employee_user_id: uid, active: true,
            }, { onConflict: 'contractor_user_id,email' });
          } catch (e) {}
          document.getElementById('_geo-notice-go')?.click();
        }, { uid });
        await page.waitForTimeout(1800); // let the update round-trip
        return 1;
      },
      rule: async (p) => {
        const out = await p.evaluate(async ({ uid }) => {
          const { data, error } = await _supa.from('team_members')
            .select('location_ack_at,location_ack_version,location_consent')
            .eq('employee_user_id', uid).limit(5);
          if (error) return { err: error.message };
          const row = (data || []).find(r => r.location_ack_at);
          return {
            rows: (data || []).length,
            ackAt: row && row.ackAt || (row && row.location_ack_at) || null,
            version: row && row.location_ack_version || null,
            localVersion: typeof GEO_NOTICE_VERSION !== 'undefined' ? GEO_NOTICE_VERSION : null,
            dismissed: !document.getElementById('_geo-notice-ov'),
          };
        }, { uid });
        // Versioned, so the record still means something after the copy changes.
        const ok = !!out.ackAt && !!out.version && out.version === out.localVersion && out.dismissed;
        return { ok, got: JSON.stringify(out) };
      },
    });

    // ── 4. The owner's roster reads a REAL status, not a stale green ────────
    await step(page, {
      label: 'owner sees an honest status on the roster', page: 'pg-team', role: 'contractor',
      suspect: 'cloud.js _loadTeamGeo + _geoRosterStatus freshness rule',
      ruleText: 'the roster must report what the device actually said, and admit when it does not know',
      expected: 'a stale or never-reported member renders gray, never a green light that lies',
      act: async (p) => {
        await p.evaluate(() => { _isEmployee = false; _teamGeo = {}; _teamGeoLoaded = false; });
        await p.evaluate(async () => { if (typeof _loadTeamGeo === 'function') await _loadTeamGeo(); });
        return 1;
      },
      rule: async (p) => {
        const out = await p.evaluate(() => {
          S.teamTracking = true;
          // A member whose device last checked in ten days ago must NOT be green.
          const old = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
          _teamGeo['stale@e2e.test'] = { status: 'granted', checkedAt: old, ackAt: old, lastPing: null };
          const stale = _geoRosterStatus('stale@e2e.test');
          // And one that is actively pinging IS green, whatever the API said.
          _teamGeo['live@e2e.test'] = { status: null, checkedAt: null, ackAt: old, lastPing: new Date().toISOString() };
          const live = _geoRosterStatus('live@e2e.test');
          return { staleDot: stale && stale.dot, liveDot: live && live.dot };
        });
        const ok = out.staleDot === '⚪' && out.liveDot === '🟢';
        return { ok, got: JSON.stringify(out) };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.overBudget).toBe(false);
  });
});
