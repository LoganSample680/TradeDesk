// @ts-check
// ── The sleep detector (owner 2026-09-28, "add it") ──────────────────────────
//
// After the 15 second motion re-read ships, the late flips left are ones where
// the phone went quiet, and from the server a phone iOS put to sleep looks the
// same as one that was awake while the motion chip said nothing. The re-read's
// own timer tells them apart: a timer does not run in a suspended process, so
// a tick that lands far later than it was due is the sleep, measured. The
// phone writes one `asleep` row per sleep (TdGeoPlugin.motionPollTick) and
// ingest-geo keeps its three numbers. A day with no sleep adds no rows.
const { test, expect } = require('./helpers');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// sleepDetail exactly as ingest-geo ships it, with its TypeScript annotations
// stripped so node can run the real function rather than a copy.
function loadSleepDetail() {
  const src = read('supabase/functions/ingest-geo/index.ts');
  const start = src.indexOf('function sleepDetail(');
  const end = src.indexOf('\n}\n', start) + 2;
  const body = src.slice(start, end)
    .replace('(e: any): Record<string, unknown> | null', '(e)')
    .replace('const out: Record<string, unknown> = {}', 'const out = {}');
  // eslint-disable-next-line no-new-func
  return new Function(body + '\nreturn sleepDetail;')();
}

test.describe('sleep detector: what the server keeps', () => {
  test('when it went quiet, how long, and whether iOS ended the app', () => {
    const sleepDetail = loadSleepDetail();
    expect(sleepDetail({ type: 'asleep', fromMs: 1790604454376.4, gapSec: 419.6, relaunched: true }))
      .toEqual({ fromMs: 1790604454376, gapSec: 420, relaunched: true });
    expect(sleepDetail({ type: 'asleep', fromMs: 1790604454376, gapSec: 90, relaunched: false }))
      .toEqual({ fromMs: 1790604454376, gapSec: 90 });
  });

  test('junk is dropped, never stored as a number it is not', () => {
    const sleepDetail = loadSleepDetail();
    expect(sleepDetail({})).toBeNull();
    expect(sleepDetail({ fromMs: 'x', gapSec: NaN, relaunched: 'yes' })).toBeNull();
    expect(sleepDetail({ fromMs: -1, gapSec: -5 })).toBeNull();
    expect(sleepDetail({ fromMs: Infinity, gapSec: Infinity })).toBeNull();
  });

  test('ingest-geo routes an asleep row to it', () => {
    const src = read('supabase/functions/ingest-geo/index.ts');
    expect(src).toMatch(/e\.type === "asleep"\s*\n\s*\? sleepDetail\(e\)/);
  });

  test('an asleep row never re-derives a day: it changes no shape', () => {
    const src = read('supabase/functions/_shared/derive-day.mjs');
    const set = src.slice(src.indexOf('const TRIGGER_TYPES'), src.indexOf(']);', src.indexOf('const TRIGGER_TYPES')));
    expect(set).not.toContain('"asleep"');
  });
});

test.describe('sleep detector: the phone side, read off the source', () => {
  const swift = () => read('native/td-geo/ios/Plugin/TdGeoPlugin.swift');

  test('the re-read timer is what measures the sleep', () => {
    const s = swift();
    expect(s).toContain('self?.motionPollTick()');
    expect(s).toMatch(/record\(\["type": "asleep"/);
  });

  test('four missed ticks and never under a minute; over a day is not a measurement', () => {
    expect(swift()).toContain('guard gap > max(4 * intervalMs, 60_000), gap < 24 * 3600_000 else { return nil }');
  });

  test('turning the re-read off forgets the mark, so an evening at home is never a sleep', () => {
    expect(swift()).toContain('guard ms > 0 else { UserDefaults.standard.removeObject(forKey: motionPollTickKey); return }');
  });
});
