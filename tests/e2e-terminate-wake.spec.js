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

  test('working hours are read in one place, for the deriver and the wake', () => {
    const d = read('supabase/functions/_shared/derive-day.mjs');
    expect(d).toContain('workHoursFromSettings(cfgRes?.data?.settings)');
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
