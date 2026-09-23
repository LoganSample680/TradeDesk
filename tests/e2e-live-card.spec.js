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
// TWO IMPLEMENTATIONS NOW DRAW ONE CARD: _liveActRailFace (js/live-activity.js,
// in the browser) and railCardFor (the server module). This spec is what stops
// them drifting: the same rail state goes into both and the same words have to
// come out. That is the same posture js/geo-derive.js has toward its generated
// server copy, for the same reason.
//
// 2026-09-21: there is ONE card now, not two. 'onsite' and 'drive' are gone and
// 'rail' replaced them, because the two could not both be right. The drive card
// was phone-driven (only the phone can compute road miles) and so said nothing
// for the whole of every drive the app slept through, which is most of every
// drive. The rail card takes its WORDS from the server on every motion flip and
// its MILES from the phone when the phone is awake, and `value` is kept out of
// liveCardSig so the two never fight over the same card.
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

test.describe('railCardFor: what the server draws', () => {
  test('an open client dwell is an ON SITE card timing from the arrival', () => {
    const c = mod.railCardFor({ open: dwell() }, {});
    expect(c.channel).toBe('rail');
    expect(c.event).toBe('update');
    expect(c.state.kind).toBe('ON SITE');
    expect(c.state.title).toBe('John Doe');
    expect(c.state.detail, 'the address when it adds something').toBe('2950 SW McClure Rd, Topeka, KS 66614');
    expect(c.state.timer).toBe(true);
    expect(c.state.startedAt, 'seconds, and the arrival instant, not now').toBe(Math.floor(SINCE / 1000));
  });

  test('the yard says so in its own words', () => {
    const c = mod.railCardFor({ open: dwell({ kind: 'shop', name: 'JS Solutions shop', fence: null }) }, {});
    expect(c.state.kind).toBe('AT THE SHOP');
    expect(c.state.title).toBe('JS Solutions shop');
    expect(c.state.detail, 'no address, so the arrival time is the useful thing').toMatch(/^Arrived \d{1,2}:\d{2}/);
  });

  test('an unnamed stop still gets words rather than a blank card', () => {
    expect(mod.railCardFor({ open: dwell({ name: '', kind: 'client' }) }, {}).state.title).toBe('On site');
    expect(mod.railCardFor({ open: dwell({ name: '', kind: 'shop', fence: null }) }, {}).state.title).toBe('The shop');
  });

  test('the detail never repeats the title', () => {
    const c = mod.railCardFor({ open: dwell({ name: '2950 SW McClure Rd, Topeka, KS 66614' }) }, {});
    expect(c.state.detail).not.toBe(c.state.title);
    expect(c.state.detail).toMatch(/^Arrived /);
  });

  // HOME IS NOT A CARD (owner 2026-09-03: "I need it to go away or be very
  // small, right now it's wasted space running when I'm home and done
  // working"). It is also the longest dwell of the day, so it is exactly the
  // card that would sit there all evening earning nothing.
  test('home ends the card, whatever the fence is called', () => {
    for (const over of [{ atHome: true }, { atHome: true, kind: 'shop', name: 'JS Solutions shop' }]) {
      expect(mod.railCardFor({ open: dwell(over) }, {}).event, JSON.stringify(over)).toBe('end');
    }
  });

  test('no dwell, no arrival instant, or a clock card already up: end', () => {
    expect(mod.railCardFor({ open: null }, {}).event, 'he drove off').toBe('end');
    expect(mod.railCardFor({ open: undefined }, {}).event).toBe('end');
    expect(mod.railCardFor({ open: dwell({ sinceTs: 0 }) }, {}).event).toBe('end');
    expect(mod.railCardFor({ open: dwell({ sinceTs: 'nope' }) }, {}).event).toBe('end');
    expect(mod.railCardFor({ open: dwell() }, { clockCardUp: true }).event,
      'the island shows two cards and the clock card already carries this site').toBe('end');
  });

  test('an end is always a complete, pushable card and never null', () => {
    const c = mod.railCardFor({ open: null }, {});
    expect(c.channel).toBe('rail');
    expect(c.state).toEqual({});
  });

  test('junk never throws', () => {
    for (const j of [0, '', 'nope', [], { fence: 'not an object' }, { sinceTs: {} }]) {
      expect(() => mod.railCardFor({ open: j }, {}), JSON.stringify(j)).not.toThrow();
    }
  });
});

// ── THE DRIVING FACE, WHICH IS WHY THERE IS ONE CARD ──────────────────────
//
// The old drive card was phone-driven, so the lock screen said nothing at all
// for the whole of every drive the app slept through. The deriver's pending
// chain is the server's own view of that drive, and it lands within a second
// of the motion flip, so the words can come from there and be right with the
// app shut.
test.describe('railCardFor: driving', () => {
  const DROVE = SINCE - 11 * 60000;
  const pending = (over) => Object.assign({ startTs: DROVE, origin: { name: 'TradeDesk shop' } }, over || {});

  test('a pending chain with nowhere to stand is a DRIVING card from the flip', () => {
    const c = mod.railCardFor({ open: null, pending: pending() }, {});
    expect(c.channel).toBe('rail');
    expect(c.event).toBe('update');
    expect(c.state.kind).toBe('DRIVING');
    expect(c.state.title).toBe('On the road');
    // The engine tracks an origin, never a destination: promising one would
    // be inventing it, and the card and the app would disagree the moment the
    // guess was wrong.
    expect(c.state.detail).toBe('From TradeDesk shop');
    expect(c.state.timer).toBe(true);
    expect(c.state.startedAt).toBe(Math.floor(DROVE / 1000));
    expect(c.state.tint).toBe(mod.LIVE_TINT.drive);
  });

  test('an origin nobody can name still says the mileage is running', () => {
    for (const p of [pending({ origin: null }), pending({ origin: {} }), pending({ origin: { name: '' } })]) {
      expect(mod.railCardFor({ open: null, pending: p }, {}).state.detail).toBe('Mileage is logging');
    }
  });

  test('standing somewhere beats driving: the dwell is the newer fact', () => {
    // Both arrive together at an arrival, for the instant before the chain
    // closes. The place he is standing is what the rail draws, so it is what
    // the card draws.
    const c = mod.railCardFor({ open: dwell(), pending: pending() }, {});
    expect(c.state.kind).toBe('ON SITE');
    expect(c.state.title).toBe('John Doe');
  });

  test('a clock card up does NOT silence the drive', () => {
    // The ON SITE face yields to the clock card because both say the same
    // thing about the same spot. "Clocked in" and "on the road" are two
    // different facts and neither says the other.
    expect(mod.railCardFor({ open: dwell(), pending: null }, { clockCardUp: true }).event).toBe('end');
    expect(mod.railCardFor({ open: null, pending: pending() }, { clockCardUp: true }).state.kind).toBe('DRIVING');
  });

  test('home ends the card even mid-chain', () => {
    // Pulling onto his own drive is the end of the card, not a handover to a
    // DRIVING face for the chain that is still technically open.
    expect(mod.railCardFor({ open: dwell({ atHome: true }), pending: pending() }, {}).event).toBe('end');
  });

  test('no chain, no start instant, junk: end, never a throw', () => {
    for (const p of [null, undefined, {}, { startTs: 0 }, { startTs: 'nope' }, 'nope', 7, []]) {
      const c = mod.railCardFor({ open: null, pending: p }, {});
      expect(c.event, JSON.stringify(p)).toBe('end');
      expect(c.channel).toBe('rail');
    }
    for (const r of [null, undefined, 0, '', 'nope', [], { open: 'x', pending: 'y' }]) {
      expect(() => mod.railCardFor(r, {}), JSON.stringify(r)).not.toThrow();
    }
  });

  test('the miles ride in value, and value is NOT in the signature', () => {
    // The phone overlays the tally; the server ships the words with no number.
    // If value counted, every server push would look like a change and would
    // re-blank the number the phone had just written.
    const withMiles = mod.railCardFor({ open: null, pending: pending() }, { value: '3.2 mi' });
    const without = mod.railCardFor({ open: null, pending: pending() }, {});
    expect(withMiles.state.value).toBe('3.2 mi');
    expect(without.state.value).toBe('');
    expect(mod.liveCardSig(withMiles)).toBe(mod.liveCardSig(without));
  });

  test('a different origin or a different start instant DO change it', () => {
    const base = mod.liveCardSig(mod.railCardFor({ open: null, pending: pending() }, {}));
    expect(mod.liveCardSig(mod.railCardFor({ open: null, pending: pending({ origin: { name: 'John Doe' } }) }, {}))).not.toBe(base);
    expect(mod.liveCardSig(mod.railCardFor({ open: null, pending: pending({ startTs: DROVE + 60000 }) }, {}))).not.toBe(base);
    expect(mod.liveCardSig(mod.railCardFor({ open: dwell(), pending: null }, {})), 'arriving changes it').not.toBe(base);
  });
});

test.describe('liveCardSig: unchanged must cost nothing', () => {
  test('the same dwell twice is the same signature', () => {
    expect(mod.liveCardSig(mod.railCardFor({ open: dwell() }, {})))
      .toBe(mod.liveCardSig(mod.railCardFor({ open: dwell() }, {})));
  });

  test('a different place, a different arrival or an end all differ', () => {
    const base = mod.liveCardSig(mod.railCardFor({ open: dwell() }, {}));
    expect(mod.liveCardSig(mod.railCardFor({ open: dwell({ name: 'Bill Lorson' }) }, {}))).not.toBe(base);
    expect(mod.liveCardSig(mod.railCardFor({ open: dwell({ sinceTs: SINCE + 60000 }) }, {}))).not.toBe(base);
    expect(mod.liveCardSig(mod.railCardFor({ open: null }, {}))).not.toBe(base);
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

  // _liveActRail ends at _liveActSet, which needs a Capacitor plugin that does
  // not exist offline. Stubbing _liveActSet captures exactly the state it would
  // have sent, which is the thing under comparison.
  //
  // The priming call clears whatever the previous case left in _railState, so
  // each measurement here is the face for exactly the state it passes in.
  const browserCard = (d, pending) => page.evaluate(([dw, pend]) => {
    const saved = { set: window._liveActSet, end: window._liveActEndIfLive, last: window._liveLast };
    let got = null, ended = false;
    try {
      window._liveLast = { clock: null };
      window._liveActSet = (ch, st) => { got = { ch, st }; return true; };
      window._liveActEndIfLive = () => { ended = true; };
      _liveActRail(null, null);
      got = null; ended = false;
      _liveActRail(dw, pend || null);
      return JSON.parse(JSON.stringify({ got, ended }));
    } finally {
      window._liveActSet = saved.set; window._liveActEndIfLive = saved.end;
      window._liveLast = saved.last;
    }
  }, [d, pending || null]);

  test('a client visit: same kind, same title, same detail, same start', async () => {
    const b = await browserCard(dwell());
    const s = mod.railCardFor({ open: dwell() }, {});
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
    const s = mod.railCardFor({ open: d }, {});
    expect(b.got.st.kind).toBe(s.state.kind);
    expect(b.got.st.title).toBe(s.state.title);
    expect(b.got.st.startedAt).toBe(s.state.startedAt);
  });

  test('driving: same words, same start, same tint, both sides', async () => {
    const pend = { startTs: SINCE - 11 * 60000, origin: { name: 'TradeDesk shop' } };
    const b = await browserCard(null, pend);
    const s = mod.railCardFor({ open: null, pending: pend }, {});
    expect(b.got, 'the browser drew a card').not.toBe(null);
    expect(b.got.ch).toBe(s.channel);
    expect(b.got.st.kind).toBe(s.state.kind);
    expect(b.got.st.title).toBe(s.state.title);
    expect(b.got.st.detail).toBe(s.state.detail);
    expect(b.got.st.startedAt).toBe(s.state.startedAt);
    expect(b.got.st.tint).toBe(s.state.tint);
  });

  test('driving under a dwell: both sides pick the dwell', async () => {
    const pend = { startTs: SINCE - 11 * 60000, origin: { name: 'TradeDesk shop' } };
    const b = await browserCard(dwell(), pend);
    const s = mod.railCardFor({ open: dwell(), pending: pend }, {});
    expect(b.got.st.kind).toBe(s.state.kind);
    expect(b.got.st.title).toBe(s.state.title);
    expect(b.got.st.startedAt).toBe(s.state.startedAt);
  });

  test('and they agree on when there is no card at all', async () => {
    for (const d of [null, dwell({ atHome: true }), dwell({ sinceTs: 0 })]) {
      const b = await browserCard(d);
      expect(b.ended, JSON.stringify(d)).toBe(true);
      expect(b.got, 'nothing was set').toBe(null);
      expect(mod.railCardFor({ open: d }, {}).event).toBe('end');
    }
  });

  test('no console errors', () => { assertNoErrors(page, 'live-card'); });
});

test.describe('the wiring, read off the source', () => {
  const fs = require('fs');
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  test('the rail card asks for a push token, so the server can reach it', () => {
    const src = read('js/live-activity.js');
    const m = /const _LIVE_PUSH_CHANNELS=\{([^}]*)\}/.exec(src);
    expect(m, '_LIVE_PUSH_CHANNELS still exists').not.toBe(null);
    expect(m[1]).toContain('rail:true');
    expect(m[1], 'the clock card keeps its token').toContain('clock:true');
    // The two channels the rail card replaced. A card that still asked for a
    // token would be a second card competing for the same island slot.
    expect(m[1], 'onsite is retired').not.toContain('onsite:true');
    expect(m[1], 'drive is retired').not.toContain('drive:true');
  });

  test('the two retired channels are ended, not just stopped being written', () => {
    // A phone that has not reloaded since the change can still be carrying an
    // 'onsite' or 'drive' card, and an orphan on the lock screen is the exact
    // bug this change exists to stop.
    const src = read('js/live-activity.js');
    const m = /function _railEndLegacy\(\)\{[\s\S]*?\n\}/.exec(src);
    expect(m, '_railEndLegacy exists').not.toBe(null);
    expect(m[0]).toContain("'onsite'");
    expect(m[0]).toContain("'drive'");
    // And it is reached from the foreground pass, which is already where a
    // card from a previous session is reconciled. Not from the paint: that
    // runs on every ping and would put an end call in the middle of every
    // other card's call sequence for no reason.
    const fg = /async function _liveActForeground\(\)\{[\s\S]*?\n\}/.exec(src);
    expect(fg, '_liveActForeground exists').not.toBe(null);
    expect(fg[0]).toContain('_railEndLegacy()');
  });

  test('a card is ended BEFORE its token is forgotten', () => {
    // Owner 2026-09-21: his lock screen still said John Doe forty minutes into
    // a drive, and live_activity_tokens was empty for him. The token was
    // dropped before ActivityKit was asked for anything, so every path where
    // the plugin is missing or end() throws deleted the one thing that could
    // reach that card and left the card up. The server then answers "no live
    // card" on every flush, forever.
    const src = read('js/live-activity.js');
    for (const fn of ['_liveActEnd', '_liveActEndAll']) {
      const m = new RegExp('async function ' + fn + '\\(([^)]*)\\)\\{[\\s\\S]*?\\n\\}').exec(src);
      expect(m, fn + ' exists').not.toBe(null);
      const body = m[0];
      const endCall = Math.max(body.indexOf('P.end({channel})'), body.indexOf('P.endAll()'));
      const drop = body.indexOf('_liveActDropToken(');
      expect(endCall, fn + ': it ends the card').toBeGreaterThan(-1);
      expect(drop, fn + ': it drops the token').toBeGreaterThan(-1);
      expect(drop, fn + ': the card goes first').toBeGreaterThan(endCall);
    }
  });

  test('ingest-geo pushes the card after it derives, for today only', () => {
    const src = read('supabase/functions/ingest-geo/index.ts');
    expect(src).toContain('pushLiveCard');
    expect(src).toContain('railCardFor');
    expect(src, 'today, not a backfill of last Tuesday').toContain('centralDayKey(Date.now())');
    // "we do not know" must never be read as "no card": a derive that returned
    // before running carries no open key at all.
    expect(src).toContain('"open" in x');
    // The CALL, not the import at the top of the file: the derive has to have
    // run before there is anything to say.
    expect(src.lastIndexOf('pushLiveCard('), 'after the derive loop, not before')
      .toBeGreaterThan(src.indexOf('deriveDayServer(svc'));
  });

  test('the deriver hands BOTH halves of the rail out of every path that reached a verdict', () => {
    // The dwell he is standing in and the chain he is still driving. Half the
    // rail is how the lock screen went silent for a whole drive.
    const src = read('supabase/functions/_shared/derive-day.mjs');
    const after = src.slice(src.indexOf('const openCard'));
    const returns = [...after.matchAll(/return \{ day,[^\n]*\n?/g)].map(m => m[0]);
    expect(returns.length, 'the returns after the derive were found').toBeGreaterThan(2);
    for (const r of returns) {
      expect(r, r.trim()).toContain('open');
      expect(r, r.trim()).toContain('driving');
    }
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
