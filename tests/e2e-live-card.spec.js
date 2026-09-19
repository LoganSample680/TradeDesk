// @ts-check
// ── ONE CARD, TWO RUNTIMES, ONE ANSWER ──────────────────────────────────────
//
// Owner 2026-09-16: "live activities, if I'm in the ops portal it doesn't
// update live when I go to drive, how can we make live activities
// bulletproof?"
//
// It froze because the card is published at the end of a derive and a derive
// is refused while a support view is open, so nothing on the phone ever got as
// far as saying anything. The server now pushes it from its own derive
// (supabase/functions/ingest-geo, live-card.mjs, live-push.ts), which is the
// only version of "bulletproof" iOS actually allows.
//
// TWO IMPLEMENTATIONS NOW DRAW ONE CARD: _liveActOnSite (js/live-activity.js,
// in the browser) and liveCardFor (the server module). This spec is what stops
// them drifting: the same open dwell goes into both and the same words have to
// come out. That is the same posture js/geo-derive.js has toward its generated
// server copy, for the same reason.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const path = require('path');

const SHARED = path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'live-card.mjs');
let mod;
test.beforeAll(async () => { mod = await import('file://' + SHARED); });

// 1:43pm Central on a September weekday, which is the arrival the owner was
// looking at when he reported this.
const SINCE = Date.parse('2026-09-16T18:43:37.000Z');
const dwell = (over) => Object.assign({
  name: 'John Doe', kind: 'client', sinceTs: SINCE, atHome: false,
  fence: { addr: '2950 SW McClure Rd, Topeka, KS 66614' },
}, over || {});

test.describe('liveCardFor: what the server draws', () => {
  test('an open client dwell is an ON SITE card timing from the arrival', () => {
    const c = mod.liveCardFor(dwell(), {});
    expect(c.channel).toBe('onsite');
    expect(c.event).toBe('update');
    expect(c.state.kind).toBe('ON SITE');
    expect(c.state.title).toBe('John Doe');
    expect(c.state.detail, 'the address when it adds something').toBe('2950 SW McClure Rd, Topeka, KS 66614');
    expect(c.state.timer).toBe(true);
    expect(c.state.startedAt, 'seconds, and the arrival instant, not now').toBe(Math.floor(SINCE / 1000));
  });

  test('the yard says so in its own words', () => {
    const c = mod.liveCardFor(dwell({ kind: 'shop', name: 'JS Solutions shop', fence: null }), {});
    expect(c.state.kind).toBe('AT THE SHOP');
    expect(c.state.title).toBe('JS Solutions shop');
    expect(c.state.detail, 'no address, so the arrival time is the useful thing').toMatch(/^Arrived \d{1,2}:\d{2}/);
  });

  test('an unnamed stop still gets words rather than a blank card', () => {
    expect(mod.liveCardFor(dwell({ name: '', kind: 'client' }), {}).state.title).toBe('On site');
    expect(mod.liveCardFor(dwell({ name: '', kind: 'shop', fence: null }), {}).state.title).toBe('The shop');
  });

  test('the detail never repeats the title', () => {
    const c = mod.liveCardFor(dwell({ name: '2950 SW McClure Rd, Topeka, KS 66614' }), {});
    expect(c.state.detail).not.toBe(c.state.title);
    expect(c.state.detail).toMatch(/^Arrived /);
  });

  // HOME IS NOT A CARD (owner 2026-09-03: "I need it to go away or be very
  // small, right now it's wasted space running when I'm home and done
  // working"). It is also the longest dwell of the day, so it is exactly the
  // card that would sit there all evening earning nothing.
  test('home ends the card, whatever the fence is called', () => {
    for (const over of [{ atHome: true }, { atHome: true, kind: 'shop', name: 'JS Solutions shop' }]) {
      expect(mod.liveCardFor(dwell(over), {}).event, JSON.stringify(over)).toBe('end');
    }
  });

  test('no dwell, no arrival instant, or a clock card already up: end', () => {
    expect(mod.liveCardFor(null, {}).event, 'he drove off').toBe('end');
    expect(mod.liveCardFor(undefined, {}).event).toBe('end');
    expect(mod.liveCardFor(dwell({ sinceTs: 0 }), {}).event).toBe('end');
    expect(mod.liveCardFor(dwell({ sinceTs: 'nope' }), {}).event).toBe('end');
    expect(mod.liveCardFor(dwell(), { clockCardUp: true }).event,
      'the island shows two cards and the clock card already carries this site').toBe('end');
  });

  test('an end is always a complete, pushable card and never null', () => {
    const c = mod.liveCardFor(null, {});
    expect(c.channel).toBe('onsite');
    expect(c.state).toEqual({});
  });

  test('junk never throws', () => {
    for (const j of [0, '', 'nope', [], { fence: 'not an object' }, { sinceTs: {} }]) {
      expect(() => mod.liveCardFor(j, {}), JSON.stringify(j)).not.toThrow();
    }
  });
});

test.describe('liveCardSig: unchanged must cost nothing', () => {
  test('the same dwell twice is the same signature', () => {
    expect(mod.liveCardSig(mod.liveCardFor(dwell(), {})))
      .toBe(mod.liveCardSig(mod.liveCardFor(dwell(), {})));
  });

  test('a different place, a different arrival or an end all differ', () => {
    const base = mod.liveCardSig(mod.liveCardFor(dwell(), {}));
    expect(mod.liveCardSig(mod.liveCardFor(dwell({ name: 'Bill Lorson' }), {}))).not.toBe(base);
    expect(mod.liveCardSig(mod.liveCardFor(dwell({ sinceTs: SINCE + 60000 }), {}))).not.toBe(base);
    expect(mod.liveCardSig(mod.liveCardFor(null, {}))).not.toBe(base);
  });

  test('junk signs without throwing', () => {
    for (const j of [null, undefined, {}, { state: null }]) {
      expect(() => mod.liveCardSig(j)).not.toThrow();
    }
  });
});

test.describe('liveContentState: every field, every push', () => {
  // ActivityKit's Codable decode fails SILENTLY on a missing key and the push
  // is dropped with no error anywhere. The Swift struct is the list; this is
  // the one copy of it that every sender uses.
  const KEYS = ['kind', 'title', 'detail', 'value', 'timer', 'startedAt', 'siteStartedAt',
    'dualTimer', 'tint', 'jobId', 'contractorUserId', 'loggedByUid', 'currentScopeId',
    'nextScopeId', 'nextScopeLabel', 'isLastScope', 'scopeQueue', 'supaBaseUrl'];

  test('an empty state still ships every key the Swift struct declares', () => {
    const cs = mod.liveContentState({});
    expect(Object.keys(cs).sort()).toEqual(KEYS.slice().sort());
    for (const k of KEYS) expect(cs[k], k).not.toBe(undefined);
  });

  test('junk ships the same shape rather than a hole', () => {
    for (const j of [null, undefined, 'nope', 7, []]) {
      expect(Object.keys(mod.liveContentState(j)).sort(), JSON.stringify(j)).toEqual(KEYS.slice().sort());
    }
  });

  test('the list matches the Swift ContentState, field for field', () => {
    const fs = require('fs');
    const swift = fs.readFileSync(path.join(__dirname, '..', 'native', 'td-live', 'ios',
      'Plugin', 'TdLiveAttributes.swift'), 'utf8');
    // Bounded to the INNER struct: TdLiveAttributes itself declares `channel`
    // after it closes, and a slice to end-of-file swept that in and failed on
    // a field no content-state has ever carried.
    const from = swift.indexOf('struct ContentState');
    const body = swift.slice(from, from + swift.slice(from).indexOf('\n    }'));
    const declared = [...body.matchAll(/^\s*(?:public\s+)?var\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)]
      .map(m => m[1]);
    expect(declared.length, 'the Swift struct was found and parsed').toBeGreaterThan(5);
    const missing = declared.filter(k => !KEYS.includes(k));
    expect(missing, 'a field on the Swift side that no sender fills drops every push silently').toEqual([]);
  });
});

test.describe('the browser card and the server card say the same thing', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { try { await page.context().close(); } catch (_e) { } });

  // _liveActOnSite ends at _liveActSet, which needs a Capacitor plugin that
  // does not exist offline. Stubbing _liveActSet captures exactly the state it
  // would have sent, which is the thing under comparison.
  const browserCard = (d) => page.evaluate((dw) => {
    const saved = { set: window._liveActSet, end: window._liveActEndIfLive, last: window._liveLast };
    let got = null, ended = false;
    try {
      window._liveLast = { clock: null };
      window._liveActSet = (ch, st) => { got = { ch, st }; return true; };
      window._liveActEndIfLive = () => { ended = true; };
      _liveActOnSite(dw);
      return JSON.parse(JSON.stringify({ got, ended }));
    } finally {
      window._liveActSet = saved.set; window._liveActEndIfLive = saved.end;
      window._liveLast = saved.last;
    }
  }, d);

  test('a client visit: same kind, same title, same detail, same start', async () => {
    const b = await browserCard(dwell());
    const s = mod.liveCardFor(dwell(), {});
    expect(b.got.ch).toBe(s.channel);
    expect(b.got.st.kind).toBe(s.state.kind);
    expect(b.got.st.title).toBe(s.state.title);
    expect(b.got.st.detail).toBe(s.state.detail);
    expect(b.got.st.startedAt).toBe(s.state.startedAt);
    expect(b.got.st.timer).toBe(s.state.timer);
    expect(b.got.st.tint).toBe(s.state.tint);
  });

  test('the shop: same again', async () => {
    const d = dwell({ kind: 'shop', name: 'JS Solutions shop', fence: null });
    const b = await browserCard(d);
    const s = mod.liveCardFor(d, {});
    expect(b.got.st.kind).toBe(s.state.kind);
    expect(b.got.st.title).toBe(s.state.title);
    expect(b.got.st.startedAt).toBe(s.state.startedAt);
  });

  test('and they agree on when there is no card at all', async () => {
    for (const d of [null, dwell({ atHome: true }), dwell({ sinceTs: 0 })]) {
      const b = await browserCard(d);
      expect(b.ended, JSON.stringify(d)).toBe(true);
      expect(b.got, 'nothing was set').toBe(null);
      expect(mod.liveCardFor(d, {}).event).toBe('end');
    }
  });

  test('no console errors', () => { assertNoErrors(page, 'live-card'); });
});

test.describe('the wiring, read off the source', () => {
  const fs = require('fs');
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  test('the on-site card asks for a push token, so the server can reach it', () => {
    const src = read('js/live-activity.js');
    const m = /const _LIVE_PUSH_CHANNELS=\{([^}]*)\}/.exec(src);
    expect(m, '_LIVE_PUSH_CHANNELS still exists').not.toBe(null);
    expect(m[1]).toContain('onsite:true');
    expect(m[1], 'the clock card keeps its token').toContain('clock:true');
    // The drive card's value is the running mileage tally, which only the
    // phone has. A server push could only tell it something it knows better.
    expect(m[1], 'drive is deliberately phone-only').not.toContain('drive:true');
  });

  test('ingest-geo pushes the card after it derives, for today only', () => {
    const src = read('supabase/functions/ingest-geo/index.ts');
    expect(src).toContain('pushLiveCard');
    expect(src).toContain('liveCardFor');
    expect(src, 'today, not a backfill of last Tuesday').toContain('centralDayKey(Date.now())');
    // "we do not know" must never be read as "no card": a derive that returned
    // before running carries no open key at all.
    expect(src).toContain('"open" in x');
    // The CALL, not the import at the top of the file: the derive has to have
    // run before there is anything to say.
    expect(src.lastIndexOf('pushLiveCard('), 'after the derive loop, not before')
      .toBeGreaterThan(src.indexOf('deriveDayServer(svc'));
  });

  test('the deriver hands the open dwell out of every path that reached a verdict', () => {
    const src = read('supabase/functions/_shared/derive-day.mjs');
    const after = src.slice(src.indexOf('const openCard'));
    const returns = [...after.matchAll(/return \{ day,[^\n]*\n?/g)].map(m => m[0]);
    expect(returns.length, 'the returns after the derive were found').toBeGreaterThan(2);
    for (const r of returns) expect(r, r.trim()).toContain('open');
  });

  test('one field list, and update-live-activity uses it too', () => {
    const src = read('supabase/functions/update-live-activity/index.ts');
    expect(src).toContain('liveContentState');
    expect(src, 'the hand-written copy is gone, not just unused')
      .not.toContain('siteStartedAt: Number(st.siteStartedAt)');
  });

  test('the signature is stored only after APNs accepted the push', () => {
    const src = read('supabase/functions/_shared/live-push.ts');
    const send = src.indexOf('await fetch(');
    const store = src.indexOf('last_sig: sig');
    expect(send, 'both were found').toBeGreaterThan(0);
    expect(store, 'a failed push must be retried, not remembered as done').toBeGreaterThan(send);
  });
});
