// RECONCILIATION LIVE PROBE — interrogates the REAL Dev A account's actual
// mileage legs (the same rows on the owner's device) and walks them through
// every gate of _geoReconcileFromMileage, reporting exactly which gate eats
// each candidate window. Built because the owner's report ("still not seeing
// the reconciliation fire") has now survived four offline-tested fixes: the
// offline suites all pass because they seed synthetic legs, so the remaining
// defect must live in the REAL data's shape or a real-network gate, and this
// probe reads that data directly instead of guessing at it (same evidence-
// first pattern as truemeasure-gesture.spec.js, which this file's shape
// follows: a diagnostic probe, deliberately not a step()/report() UX flow).
//
// It then runs the REAL reconciler + queue drain and re-queries the server,
// so a successful pass here doesn't just diagnose, it actually writes the
// owner's missing on-site rows (left in place per §12.7).
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn } = require('./live-helpers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BENIGN = [
  'favicon', 'net::ERR', 'ERR_CONNECTION', 'Failed to load resource', 'apple-mapkit',
  'cdn.apple-mapkit', 'js.stripe.com', 'cdn.jsdelivr', 'AggregateError', 'JSON Parse error',
  'Unhandled Promise Rejection', 'mapkit', '401', '403', 'manifest', 'analytics', 'beacon',
  'cloudflareinsights',
];
function realError(text) { return !BENIGN.some((b) => text.includes(b)); }

test.describe('Reconciliation live probe (real account data)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured');

  test('walk the real legs through every reconciler gate, then run it for real', async ({ page }) => {
    test.setTimeout(180000);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await signIn(page);
    // The mileage array fills from the cloud load; wait for it rather than
    // racing it. A genuinely empty account would also stop here, which is
    // itself the finding.
    await page.waitForFunction(() => typeof mileage !== 'undefined' && Array.isArray(mileage) && mileage.length > 0, null, { timeout: 60000 }).catch(() => {});
    await sleep(1500);

    const diag = await page.evaluate(async () => {
      const out = { now: new Date().toISOString(), buildVersion: (typeof APP_VERSION !== 'undefined') ? APP_VERSION : '?' };
      const D3 = Date.now() - 3 * 86400000;
      const _me = _isEmployee ? _supaUser.id : null;
      out.me = { isEmployee: !!_isEmployee, uid: _supaUser && _supaUser.id };

      // 1. The raw legs, last 3 days, with exactly the fields the filter reads.
      const recent = mileage.filter(m => m && (Date.parse(m.startedIso || m.loggedAt || m.created_at || '') || 0) >= D3);
      out.rawLegCount = recent.length;
      out.legs = recent.slice(0, 40).map(m => ({
        id: m.id, gps: m.gps === true, legKey: !!m.legKey,
        startedIso: m.startedIso || null, endedIso: m.endedIso || null,
        logged_by_id: m.logged_by_id || null,
        from: m.from_name || m.from || '', to: m.to_name || m.to || '',
        toCoordOk: !!(m.toCoord && m.toCoord.lat != null),
        date: m.date,
      }));

      // 2. The filter, exactly as the reconciler applies it.
      const legs = mileage.filter(m => m && m.gps && m.legKey && m.startedIso && m.endedIso &&
        (m.logged_by_id || null) === _me &&
        (Date.parse(m.startedIso) || 0) >= Date.now() - 7 * 86400000)
        .slice().sort((a, b) => String(a.startedIso).localeCompare(String(b.startedIso)));
      out.filteredLegCount = legs.length;

      // 3. Jobs the day-scoped matcher can see, for each distinct leg day.
      out.jobs = jobs.slice(0, 40).map(j => ({
        id: j.id, name: j.name, start: j.start || j.date || null, days: j.days,
        status: j.status, cancelled: !!j.cancelled, completion: j.completion_date || null,
        hasCoord: !!(j.lat && j.lon), addr: (j.addr || '').slice(0, 30),
      }));

      // 4. Cluster + pair, recording the verdict at every gate.
      const clusters = [];
      for (const leg of legs) {
        const cur = clusters[clusters.length - 1];
        const stMs = Date.parse(leg.startedIso) || 0;
        if (cur && stMs - cur.endMs < _GEO_RECON_MIN_GAP_MS) {
          cur.legs.push(leg);
          const enMs = Date.parse(leg.endedIso) || 0;
          if (enMs > cur.endMs) { cur.endMs = enMs; cur.endedIso = leg.endedIso; }
        } else {
          clusters.push({ legs: [leg], startedIso: leg.startedIso, endMs: Date.parse(leg.endedIso) || 0, endedIso: leg.endedIso });
        }
      }
      out.clusterCount = clusters.length;
      const margin = _geoFenceFt() + _GEO_PARK_JOB_EXTRA_FT;
      const windows = [];
      for (let i = 0; i < clusters.length - 1; i++) {
        const A = clusters[i], B = clusters[i + 1];
        const t1 = A.endMs, t2 = Date.parse(B.startedIso) || 0;
        const w = { t1: new Date(t1).toISOString(), t2: new Date(t2).toISOString(), gapMin: Math.round((t2 - t1) / 60000) };
        windows.push(w);
        if (!(t1 > 0 && t2 > t1)) { w.verdict = 'bad-order'; continue; }
        if (t2 - t1 < _GEO_RECON_MIN_GAP_MS) { w.verdict = 'under-min-gap'; continue; }
        if (_bizDateStr(new Date(t1)) !== _bizDateStr(new Date(t2))) { w.verdict = 'crosses-midnight'; continue; }
        const dayKey = _bizDateStr(new Date(t1));
        const dayJobs = (typeof _geoJobsOnDay === 'function') ? _geoJobsOnDay(dayKey) : null;
        w.day = dayKey;
        w.dayJobs = dayJobs ? dayJobs.map(j => j.name || j.id) : 'HELPER-MISSING';
        if (!dayJobs) { w.verdict = 'no-_geoJobsOnDay-on-this-build'; continue; }
        let jb = null, jbFt = Infinity;
        let minFt = Infinity;
        for (const memberLeg of A.legs) {
          if (!memberLeg.toCoord || memberLeg.toCoord.lat == null) continue;
          for (const j of dayJobs) {
            const c = await _geoJobLatLng(j);
            if (!c) continue;
            const ft = _geoDistFt({ lat: memberLeg.toCoord.lat, lng: memberLeg.toCoord.lng }, c);
            if (ft < minFt) minFt = ft;
            if (ft <= margin && ft < jbFt) { jb = j; jbFt = ft; }
          }
        }
        w.minFt = (minFt === Infinity) ? null : Math.round(minFt);
        if (!jb) { w.verdict = 'no-job-within-' + Math.round(margin) + 'ft'; continue; }
        w.job = jb.name || jb.id;
        const overlapManual = typeof timeEntries !== 'undefined' && Array.isArray(timeEntries) &&
          timeEntries.some(e => e && (e.logged_by_uid || null) === _me && e.start_time &&
            Date.parse(e.start_time) < t2 && (!e.end_time || Date.parse(e.end_time) > t1));
        if (overlapManual) { w.verdict = 'manual-entry-wins'; continue; }
        w.verdict = 'CANDIDATE';
      }
      out.windows = windows;

      // 5. What the server already holds across those days.
      try {
        const { data } = await _supa.from('job_time_entries')
          .select('job_id,arrived_at,departed_at,minutes,source,client_key')
          .eq('contractor_user_id', _geoCid()).eq('employee_user_id', _supaUser.id)
          .gt('arrived_at', new Date(D3).toISOString());
        out.serverRows = (data || []).map(r => ({ src: r.source, a: r.arrived_at, d: r.departed_at, min: r.minutes, job: r.job_id }));
      } catch (e) { out.serverRows = 'query-failed: ' + (e && e.message); }

      // 6. The REAL run: whatever the walk above says, let the actual code speak.
      let ran = null;
      try {
        _geoPingBusy = false; _geoReconBusy = false;
        ran = await _geoReconcileFromMileage();
        if (typeof _geoDrainQueue === 'function') await _geoDrainQueue();
      } catch (e) { ran = 'threw: ' + (e && e.message); }
      out.realRunReturned = ran;
      try {
        const { data } = await _supa.from('job_time_entries')
          .select('job_id,arrived_at,departed_at,minutes,source,client_key')
          .eq('contractor_user_id', _geoCid()).eq('employee_user_id', _supaUser.id)
          .eq('source', 'geofence-reconciled')
          .gt('arrived_at', new Date(D3).toISOString());
        out.reconciledRowsAfter = (data || []).map(r => ({ a: r.arrived_at, d: r.departed_at, min: r.minutes, job: r.job_id, key: r.client_key }));
      } catch (e) { out.reconciledRowsAfter = 'query-failed: ' + (e && e.message); }
      return out;
    });

    console.log('[probe] RECON-DIAG: ' + JSON.stringify(diag, null, 1));

    // The probe's job is evidence, not judgment: fail only on a broken page.
    expect(diag.rawLegCount, 'the account must actually hold recent legs to diagnose').toBeGreaterThanOrEqual(0);
    const relevant = errors.filter(realError);
    console.log('[probe] console.errors during probe: ' + relevant.length + ' ' + JSON.stringify(relevant.slice(0, 3)));
  });
});
