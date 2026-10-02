// @ts-check
// ── A close earns one wake (owner 2026-09-28: "do the swipe fix") ────────────
//
// Jack's phone closed nine times in a workday and stayed dark until the
// half-hour ping or a fence exit woke it, 18 minutes at worst. The phone now
// sends its close as it dies (TdGeoPlugin.appTerminate) and ingest-geo sends
// one silent push to bring the app back. The rules are pure and live in
// supabase/functions/_shared/terminate-wake.mjs; this drives them directly.
const { test, expect } = require('./helpers');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const MOD = 'file://' + path.join(ROOT, 'supabase/functions/_shared/terminate-wake.mjs');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// Monday 2026-09-28 in Central daylight time is UTC-5.
const ct = (h, m, day = 28) => Date.UTC(2026, 8, day, h + 5, m);

test.describe('terminate wake: the rules', () => {
  test('working hours come from settings, with the deriver\'s defaults', async () => {
    const { workHoursFromSettings } = await import(MOD);
    const def = { start: '06:00', end: '20:00', days: [1, 2, 3, 4, 5, 6] };
    expect(workHoursFromSettings(null)).toEqual(def);
    expect(workHoursFromSettings(undefined)).toEqual(def);
    expect(workHoursFromSettings('{bad json')).toEqual(def);
    expect(workHoursFromSettings({})).toEqual(def);
    expect(workHoursFromSettings({ workHours: { start: '7:30', end: '17:00', days: [1, 2, 3] } }))
      .toEqual({ start: '7:30', end: '17:00', days: [1, 2, 3] });
    expect(workHoursFromSettings(JSON.stringify({ workHours: { start: 'nope', end: 5, days: [] } })))
      .toEqual(def);
  });

  test('inside the working day, in Central time, start inclusive and end exclusive', async () => {
    const { inWorkHours } = await import(MOD);
    const wh = { start: '06:00', end: '20:00', days: [1, 2, 3, 4, 5, 6] };
    expect(inWorkHours(ct(5, 59), wh)).toBe(false);
    expect(inWorkHours(ct(6, 0), wh)).toBe(true);
    expect(inWorkHours(ct(12, 2), wh)).toBe(true);
    expect(inWorkHours(ct(19, 59), wh)).toBe(true);
    expect(inWorkHours(ct(20, 0), wh)).toBe(false);
    expect(inWorkHours(ct(12, 0, 27), wh), 'Sunday is not a working day').toBe(false);
    expect(inWorkHours(NaN, wh)).toBe(false);
    expect(inWorkHours(ct(12, 0), null), 'no hours given means the defaults').toBe(true);
  });

  test('Jack at 12:02: a fresh close in the working day earns a wake', async () => {
    const { terminateWakeDue } = await import(MOD);
    const close = ct(12, 2);
    const evs = [{ type: 'app-background', ts: close - 1 }, { type: 'app-terminate', ts: close }];
    expect(terminateWakeDue(evs, close + 3000, null, NaN)).toBe(true);
  });

  test('a close that arrives late is history, not news', async () => {
    const { terminateWakeDue, WAKE_FRESH_MS } = await import(MOD);
    const close = ct(8, 12);
    const evs = [{ type: 'app-terminate', ts: close }];
    expect(terminateWakeDue(evs, close + WAKE_FRESH_MS, null, NaN)).toBe(true);
    expect(terminateWakeDue(evs, close + WAKE_FRESH_MS + 1, null, NaN),
      'the 8:12 close reached the server 18 minutes later; waking then is pointless').toBe(false);
  });

  test('one wake per ten minutes, however often it closes', async () => {
    const { terminateWakeDue, WAKE_GAP_MS } = await import(MOD);
    const close = ct(12, 36);
    const evs = [{ type: 'app-terminate', ts: close }];
    expect(terminateWakeDue(evs, close + 1000, null, close - 3 * 60000),
      'woken three minutes ago at 12:33: not again').toBe(false);
    expect(terminateWakeDue(evs, close + 1000, null, close + 1000 - WAKE_GAP_MS)).toBe(true);
  });

  test('outside the working day, nothing is woken', async () => {
    const { terminateWakeDue } = await import(MOD);
    const night = ct(22, 30);
    expect(terminateWakeDue([{ type: 'app-terminate', ts: night }], night + 1000, null, NaN)).toBe(false);
    const late = ct(18, 30);
    expect(terminateWakeDue([{ type: 'app-terminate', ts: late }], late + 1000,
      { start: '07:00', end: '17:00', days: [1, 2, 3, 4, 5] }, NaN), 'his own hours win').toBe(false);
  });

  test('no close, or junk, never wakes and never throws', async () => {
    const { terminateWakeDue } = await import(MOD);
    const t = ct(10, 0);
    expect(terminateWakeDue([{ type: 'app-background', ts: t }], t + 1000, null, NaN)).toBe(false);
    expect(terminateWakeDue([], t, null, NaN)).toBe(false);
    expect(terminateWakeDue(null, t, null, NaN)).toBe(false);
    expect(terminateWakeDue([null, { type: 'app-terminate' }, { type: 'app-terminate', ts: 'x' }], t, null, NaN)).toBe(false);
    expect(terminateWakeDue([{ type: 'app-terminate', ts: t }], NaN, null, NaN)).toBe(false);
    expect(terminateWakeDue([{ type: 'app-terminate', ts: t + 10 * 60000 }], t, null, NaN),
      'a close from the future is a clock problem, not a close').toBe(false);
  });
});

test.describe('quiet wake: a phone whose last word was "backgrounded"', () => {
  const bg = (ms) => ({ type: 'app-background', created_at: new Date(ms).toISOString() });

  test('Jack at 8:12: backgrounded, then nothing for three minutes, earns a wake', async () => {
    const { quietWakeDue, QUIET_MIN_MS } = await import(MOD);
    const heard = ct(8, 12);
    expect(quietWakeDue(bg(heard), heard + QUIET_MIN_MS - 1000, null, NaN), 'two minutes is not quiet yet').toBe(false);
    expect(quietWakeDue(bg(heard), heard + QUIET_MIN_MS, null, NaN)).toBe(true);
    expect(quietWakeDue({ type: 'app-background', created_at: heard + QUIET_MIN_MS * 2 - QUIET_MIN_MS }, heard + QUIET_MIN_MS * 2, null, NaN),
      'a numeric arrival time reads the same as a string').toBe(true);
  });

  test('anything after the background means it is alive: no wake', async () => {
    const { quietWakeDue } = await import(MOD);
    const heard = ct(10, 0);
    for (const type of ['push-ping', 'motion', 'fix', 'app-active', 'app-terminate', 'heartbeat']) {
      expect(quietWakeDue({ type, created_at: new Date(heard).toISOString() }, heard + 5 * 60000, null, NaN), type).toBe(false);
    }
  });

  test('past twenty minutes the half-hour ping is the nearer wake', async () => {
    const { quietWakeDue, QUIET_MAX_MS } = await import(MOD);
    const heard = ct(11, 0);
    expect(quietWakeDue(bg(heard), heard + QUIET_MAX_MS, null, NaN)).toBe(true);
    expect(quietWakeDue(bg(heard), heard + QUIET_MAX_MS + 1, null, NaN)).toBe(false);
  });

  test('one wake per ten minutes, shared with the close wake, and only in working hours', async () => {
    const { quietWakeDue } = await import(MOD);
    const heard = ct(12, 30);
    const now = heard + 4 * 60000;
    expect(quietWakeDue(bg(heard), now, null, now - 5 * 60000), 'woken five minutes ago').toBe(false);
    const night = ct(21, 0);
    expect(quietWakeDue(bg(night), night + 4 * 60000, null, NaN), 'after hours').toBe(false);
  });

  test('junk never wakes and never throws', async () => {
    const { quietWakeDue } = await import(MOD);
    const t = ct(9, 0);
    expect(quietWakeDue(null, t, null, NaN)).toBe(false);
    expect(quietWakeDue({}, t, null, NaN)).toBe(false);
    expect(quietWakeDue({ type: 'app-background', created_at: 'nope' }, t, null, NaN)).toBe(false);
    expect(quietWakeDue(bg(t), NaN, null, NaN)).toBe(false);
    expect(quietWakeDue(bg(t + 10 * 60000), t, null, NaN), 'heard in the future').toBe(false);
  });
});

test.describe('terminate wake: the wiring, read off the source', () => {
  test('ingest-geo keeps why the app closed', () => {
    const src = read('supabase/functions/ingest-geo/index.ts');
    expect(src).toContain('function lifecycleDetail(');
    expect(src).toMatch(/e\.type === "app-terminate" \|\| e\.type === "memory-warning"\s*\n\s*\? lifecycleDetail\(e\)/);
  });

  test('ingest-geo wakes through the pure rules and the one silent sender, rate-gated', () => {
    const src = read('supabase/functions/ingest-geo/index.ts');
    expect(src).toContain('terminateWakeDue(evs, Date.now(), workHoursFromSettings(');
    expect(src).toContain('sendSilentWake(svc,');
    expect(src).toContain('"wake:" + uid');
    expect(src, 'only a batch holding a close pays for the lookup').toContain('evs.some((e) => e.type === "app-terminate")');
    const ping = read('supabase/functions/push-geo-ping/index.ts');
    expect(ping).toContain('sendSilentWake(');
  });

  // A UAT roll wakes every phone once the new build is served (owner
  // 2026-10-01), on its own gate so it never touches the half-hourly tick.
  test('a roll wakes every phone once, on its own 3-minute gate', () => {
    const ping = read('supabase/functions/push-geo-ping/index.ts');
    // AMENDED 2026-10-01: the retry is a deploy wake on its own watermark.
    expect(ping).toContain('const deploy = reason === "deploy" || retry;');
    expect(ping).toContain('const mark = retry ? "geo-ping-retry" : deploy ? "geo-ping-deploy" : "geo-ping";');
    expect(ping).toContain('const gateMs = deploy ? 3 * 60000 : 20 * 60000;');
    expect(ping, 'the tick reads and writes its own watermark, unchanged').toContain('.eq("name", mark)');
    const wf = read('.github/workflows/uat-wake.yml');
    expect(wf).toMatch(/push:\s*\n\s*branches: \[uat\]/);
    expect(wf, 'waits until UAT serves the rolled version').toContain('uat.tradedesk-cyp.pages.dev/version.json');
    expect(wf).toContain('"reason":"deploy"');
  });

  // Two minutes after a roll's wake, once more for the phones still behind
  // (owner 2026-10-01), judged by each phone's own boot report.
  test('the retry wakes only phones whose last report is on another version', () => {
    const ping = read('supabase/functions/push-geo-ping/index.ts');
    expect(ping).toContain('reason === "deploy-retry"');
    expect(ping, 'a version that is not one wakes nobody').toContain('/^\\d{2}\\.\\d{2}\\.\\d{2}\\.\\d{1,3}$/.test(want)');
    expect(ping).toContain('"geo-ping-retry"');
    expect(ping, 'judged by the boot report').toContain('.from("device_status")');
    expect(ping, 'no report, no retry').toContain('return !!n && n.v !== want;');
    const wf = read('.github/workflows/uat-wake.yml');
    expect(wf).toContain('sleep 120');
    expect(wf).toContain('deploy-retry');
  });

  // The phone's own stats ride the wakes and survive ingest, field by field.
  test('ingest keeps the device stats and the native reload, typed and bounded', () => {
    const src = read('supabase/functions/ingest-geo/index.ts');
    expect(src).toContain('function statsDetail(e: any)');
    expect(src).toContain('function reloadDetail(e: any)');
    expect(src).toContain('e.type === "native-reload"');
    expect(src).toContain('...(statsDetail(e) ? { stats: statsDetail(e) } : {})');
    for (const k of ['out.lp', 'out.bgr', 'out.th', 'out.batt', 'out.chg', 'out.cpu', 'out.mem']) expect(src).toContain(k + ' =');
  });

  // Everything else Apple allows (owner 2026-10-01): the server's own filters,
  // lifted out of ingest-geo and run, so the test is the code that ships.
  const lift = (src, from, to) => {
    const i = src.indexOf(from), j = src.indexOf(to, i);
    return src.slice(i, j)
      .replace(/\(e: any\): Record<string, unknown> \| null/g, '(e)')
      .replace(/const out: Record<string, (unknown|number)> = /g, 'const out = ')
      .replace(/\(out\.(\w+) as number\)/g, '(out.$1)')
      .replace(/\(v: unknown\)/g, '(v)');
  };
  const ingestFns = () => {
    const src = read('supabase/functions/ingest-geo/index.ts');
    const code = lift(src, 'const THERMAL = new Set', '// The wake reloaded a stale web app');
    return new Function(code + '; return { statsDetail, metricDetail, diagDetail };')();
  };

  test('ingest keeps every new phone field, typed, and drops junk', () => {
    const { statsDetail } = ingestFns();
    const good = statsDetail({ stats: { lp: false, th: 'fair', full: true, app: 'background', locked: true,
      loc: 'always', acc: 'full', net: 'cell', exp: true, lowData: false, radio: '5g', up: 42.4 } });
    expect(good).toEqual({ lp: false, th: 'fair', full: true, app: 'background', locked: true, loc: 'always',
      acc: 'full', net: 'cell', exp: true, lowData: false, radio: '5g', up: 42 });
    const junk = statsDetail({ stats: { app: 'zombie', locked: 'yes', loc: 'sometimes', acc: 'meh', net: 'carrier pigeon',
      exp: 1, lowData: 'no', radio: '6g', up: -3, full: 'true', temp: 40, health: 88 } });
    expect(junk, 'nothing invented, no temperature or health').toBe(null);
  });

  test('ingest keeps Apple\'s daily report and its crash counts, bounded', () => {
    const { metricDetail, diagDetail } = ingestFns();
    const m = metricDetail({ type: 'metrickit', ts: 2000, from: 1000,
      mx: { cpu_s: 61.26, bg_loc_s: 3600, bgx_watchdog: 2, loc_nav_s: 0, made_up: 5, bad: -1, worse: 'x', huge: 1e20, bars: NaN } });
    expect(m).toEqual({ from: 1000, mx: { cpu_s: 61.3, bg_loc_s: 3600, bgx_watchdog: 2, loc_nav_s: 0 } });
    expect(metricDetail({ ts: 5, from: 9, mx: { cpu_s: 1 } }).from, 'a window that ends before it starts has no start').toBe(null);
    expect(metricDetail({ ts: 5, mx: { nope: 1 } })).toBe(null);
    expect(metricDetail({ ts: 5 })).toBe(null);
    const d = diagDetail({ ts: 2000, from: 1000, crashes: 1, hangs: 2.4, cpuEx: -1, diskEx: 'x', why: 'w'.repeat(300) });
    expect(d).toEqual({ crashes: 1, hangs: 2, cpuEx: 0, diskEx: 0, why: 'w'.repeat(120), from: 1000 });
    expect(diagDetail({ ts: 1, crashes: 0, hangs: 0 })).toBe(null);
    const src = read('supabase/functions/ingest-geo/index.ts');
    expect(src).toMatch(/e\.type === "metrickit"\s*\n\s*\? metricDetail\(e\)\s*\n\s*: e\.type === "mx-diag"\s*\n\s*\? diagDetail\(e\)/);
  });

  test('the plugin subscribes to Apple\'s report on every launch and copies it only while tracking is on', () => {
    const sw = read('native/td-geo/ios/Plugin/TdGeoPlugin.swift');
    expect(sw).toContain('import MetricKit');
    expect(sw).toContain('extension TdGeoPlugin: MXMetricManagerSubscriber');
    expect(sw).toContain('MXMetricManager.shared.add(self)');
    expect(sw, 'before the armed guard, like the other launch work').toMatch(/subscribeMetrics\(\)\n\s*let d = UserDefaults\.standard\n\s*guard let armed/);
    expect(sw).toContain('guard trackingArmed(), !rows.isEmpty else { return }');
    expect(sw, 'reading a permission never starts a location session').toContain('let m = locationManager ?? CLLocationManager()');
    const tests = read('native/tests/TdGeoPluginTests.swift');
    for (const t of ['testMetricRow_keepsOnlyFiniteNonNegativeNumbers', 'testDiagRow_onlyWhenSomethingHappened_andTheReasonIsBounded',
      'testMetricRows_recordOnlyWhileTrackingIsArmed', 'testRadioWord_namesOnlyRealRadios', 'testDeviceStats_permissionReadNeverStartsALocationSession']) {
      expect(tests).toContain('func ' + t + '(');
    }
  });

  test('the page tells the native layer its version, so a wake can update it while the page sleeps', () => {
    const src = read('js/geo-track.js');
    expect(src).toContain("typeof Td.setUpdateProbe==='function'");
    expect(src).toContain("Td.setUpdateProbe({url:location.origin+'/version.json',version:String(APP_VERSION)})");
    const sw = read('native/td-geo/ios/Plugin/TdGeoPlugin.swift');
    expect(sw).toContain('CAPPluginMethod(name: "setUpdateProbe"');
    expect(sw, 'never in his face').toContain('UIApplication.shared.applicationState != .active');
    expect(sw, 'at most once every two minutes').toContain('static let updateProbeGapSec: Double = 120');
    const tests = read('native/tests/TdGeoPluginTests.swift');
    expect(tests).toContain('func testShouldReload_onlyWhenTheServedVersionDiffers');
  });

  test('wake-quiet runs every two minutes through the same rules and sender', () => {
    const fn = read('supabase/functions/wake-quiet/index.ts');
    expect(fn).toContain('quietWakeDue(last, now, workHoursFromSettings(');
    expect(fn).toContain('sendSilentWake(svc, tokens, "geo-wake"');
    expect(fn, 'rate-gated like the half-hour ping').toContain('"wake-quiet"');
    expect(fn, 'shares the per-person wake gap with the close wake').toContain('"wake:" + uid');
    const mig = read('supabase/migrations/20261052_wake_quiet_cron.sql');
    expect(mig).toContain("'*/2 * * * *'");
    expect(mig).toContain('/functions/v1/wake-quiet');
    expect(mig).toContain('on public.geo_events (employee_user_id, created_at desc)');
    expect(mig, 'no create extension, so the lint runner skips the schedule').not.toMatch(/^\s*create extension/im);
  });

  test('working hours are read in one place, for the deriver and the wake', () => {
    const d = read('supabase/functions/_shared/derive-day.mjs');
    expect(d).toContain('workHoursFromSettings(cfgRes)');
    expect(d, 'the hand-written copy is gone').not.toContain('let workHours = { start: "06:00"');
  });

  test('the phone sends the close as it dies, and waits a bounded time for it', () => {
    const sw = read('native/td-geo/ios/Plugin/TdGeoPlugin.swift');
    expect(sw).toContain('holdForFlush(maxSec: TdGeoPlugin.terminateHoldSec)');
    expect(sw).toMatch(/static let terminateHoldSec: Double = [0-3](\.\d+)?/);
    expect(sw).toContain('UIApplication.didReceiveMemoryWarningNotification');
    const tests = read('native/tests/TdGeoPluginTests.swift');
    expect(tests).toContain('testHoldGivesUpAtTheCapWhenNothingAcks');
    expect(tests).toContain('testTerminateRecordsTheCloseOnlyWhenArmedAndHoldsNoLongerThanTheCap');
  });
});
