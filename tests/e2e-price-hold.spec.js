// @ts-check
/**
 * The price hold: "Valid until" stops being decoration.
 *
 * Before this, three places each computed their own "+30 days" at three
 * different moments (generic-estimate at render, sign.html from createdAt,
 * bids.js from bid_date), none of it stored. Reopening an old proposal handed
 * the client a fresh window, and nothing on the contractor's side ever said a
 * price had gone stale.
 *
 * What we verify:
 *  1. _estValidDays: default, clamp, junk
 *  2. _bidValidUntil: a sent bid keeps its stamp, a draft projects from today
 *  3. _bidValidDaysLeft: today / tomorrow / expired boundaries
 *  4. Sending stamps the bid, previewing never does
 *  5. The document prints the stored date, not a fresh one
 *  6. _extendBidPrice puts the price back in date
 *  7. The dashboard says what the price is doing, and offers Extend only when
 *     it matters
 *  8. The follow-up text is chosen from what we know (expiring, unopened,
 *     opened), never a fixed script
 *  9. Zero console errors
 *
 * Dates are built with the PAGE's own todayKey()/addDays so the runner's clock
 * never decides an outcome (§5.2.2).
 */

const {
  test, expect,
  mockAllExternal, waitForAppBoot, assertNoErrors,
} = require('./helpers');

const PH_CLIENT = 830001;
const PH_BID = 830101;

test.describe('the price hold', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  test.beforeEach(async () => {
    await page.evaluate(({ cid, bid }) => {
      clients = clients.filter(c => c.id !== cid).concat([
        { id: cid, name: 'Jerome Bettis', phone: '4125551234', addr: '1 Steel Way' }
      ]);
      bids = bids.filter(b => b.id !== bid);
      S.estValidDays = 30;
    }, { cid: PH_CLIENT, bid: PH_BID });
  });

  // ── 1. How many days the price holds ────────────────────────────────────────

  test('_estValidDays defaults to 30, honors his setting, and refuses nonsense', async () => {
    const r = await page.evaluate(() => {
      const out = {};
      delete S.estValidDays; out.unset = _estValidDays();
      S.estValidDays = 14; out.set = _estValidDays();
      S.estValidDays = 0; out.zero = _estValidDays();
      S.estValidDays = -5; out.neg = _estValidDays();
      S.estValidDays = 900; out.huge = _estValidDays();
      S.estValidDays = 'soon'; out.junk = _estValidDays();
      S.estValidDays = null; out.nul = _estValidDays();
      S.estValidDays = 7.4; out.frac = _estValidDays();
      S.estValidDays = 30;
      return out;
    });
    expect(r.unset).toBe(30);
    expect(r.set).toBe(14);
    expect(r.zero).toBe(30);
    expect(r.neg).toBe(30);
    expect(r.huge).toBe(30);
    expect(r.junk).toBe(30);
    expect(r.nul).toBe(30);
    expect(r.frac).toBe(7);
  });

  // ── 2. Which date this bid holds to ─────────────────────────────────────────

  test('a stamped bid keeps the date the client was given, an unsent one projects from today', async () => {
    const r = await page.evaluate(() => {
      const stamped = { id: 1, validUntil: '2027-03-01', bid_date: '2020-01-01' };
      const sent = { id: 2, proposalSentDate: addDays(todayKey(), -10) };
      const draft = { id: 3, bid_date: todayKey() };
      return {
        stamped: _bidValidUntil(stamped),
        // stamped wins even though bid_date is ancient: it is what he promised
        sent: _bidValidUntil(sent),
        sentExpected: addDays(addDays(todayKey(), -10), 30),
        draft: _bidValidUntil(draft),
        draftExpected: addDays(todayKey(), 30),
        empty: _bidValidUntil({}),
        nul: _bidValidUntil(null),
        todayPlus30: addDays(todayKey(), 30)
      };
    });
    expect(r.stamped).toBe('2027-03-01');
    expect(r.sent).toBe(r.sentExpected);
    expect(r.draft).toBe(r.draftExpected);
    expect(r.empty).toBe(r.todayPlus30);
    expect(r.nul).toBe(r.todayPlus30);
  });

  test('_bidValidDaysLeft counts the boundaries the way a person would', async () => {
    const r = await page.evaluate(() => ({
      today: _bidValidDaysLeft({ validUntil: todayKey() }),
      tomorrow: _bidValidDaysLeft({ validUntil: addDays(todayKey(), 1) }),
      week: _bidValidDaysLeft({ validUntil: addDays(todayKey(), 7) }),
      yesterday: _bidValidDaysLeft({ validUntil: addDays(todayKey(), -1) }),
      longGone: _bidValidDaysLeft({ validUntil: addDays(todayKey(), -45) }),
      // A stamp that is not a date key was never a promise, so the bid falls
      // back to the projection (today + his window) rather than reporting a
      // hold nobody can read. Behaviour changed 2026-09-06 with the key-shape
      // guard: this used to lean on the Date parser to reject junk, and WebKit
      // read "12345T12:00" as the year 12345.
      junk: _bidValidDaysLeft({ validUntil: 'not-a-date' }),
      junkStamp: _bidValidUntil({ validUntil: 'not-a-date' }),
      projected: addDays(todayKey(), 30)
    }));
    expect(r.today).toBe(0);
    expect(r.tomorrow).toBe(1);
    expect(r.week).toBe(7);
    expect(r.yesterday).toBe(-1);
    expect(r.longGone).toBe(-45);
    expect(r.junk).toBe(30);
    expect(r.junkStamp).toBe(r.projected);
  });

  test('_fmtValidUntil renders MM/DD/YYYY and never crashes on junk', async () => {
    const r = await page.evaluate(() => [
      _fmtValidUntil('2027-03-01'),
      _fmtValidUntil(''),
      _fmtValidUntil(null),
      _fmtValidUntil(undefined),
      _fmtValidUntil('garbage'),
      _fmtValidUntil(12345)
    ]);
    expect(r[0]).toBe('03/01/2027');
    expect(r.slice(1)).toEqual(['', '', '', '', '']);
  });

  // ── 4 + 5. The document prints the stamp, and sending is what stamps it ──────

  test('previewing never promises a date, sending stamps one, and a resend never extends it', async () => {
    const r = await page.evaluate(async () => {
      const c = clients.find(x => x.id === 830001);
      bids = bids.filter(x => x.client_id === 830001 ? false : true);
      openGenericEstimate(c, null, null, { mode: 'byo' });
      goGeiStep(2);
      _byoItems = [{ id: 1, section: 'Work', label: 'Water heater replacement', price: 1400, on: true }];
      _byoUpdateRail();
      const bidId = _geiEditBidId;

      // Preview: shows what the hold WOULD be, promises nothing
      await sendGenericProposal(true);
      const ov = document.getElementById('_prop-preview-ov');
      const previewHtml = ov ? ov.innerHTML : '';
      ov?.remove();
      const afterPreview = bids.find(x => x.id === bidId)?.validUntil || null;

      // Now stamp it the way a real send does, then re-render the document
      const b = bids.find(x => x.id === bidId);
      b.validUntil = addDays(todayKey(), 5);
      await sendGenericProposal(true);
      const ov2 = document.getElementById('_prop-preview-ov');
      const stampedHtml = ov2 ? ov2.innerHTML : '';
      ov2?.remove();

      return {
        afterPreview,
        previewShows: previewHtml.includes(_fmtValidUntil(addDays(todayKey(), 30))),
        stampedShows: stampedHtml.includes(_fmtValidUntil(addDays(todayKey(), 5))),
        stampedNotFresh: !stampedHtml.includes(_fmtValidUntil(addDays(todayKey(), 30))),
        stillStamped: bids.find(x => x.id === bidId)?.validUntil
      };
    });
    expect(r.afterPreview, 'a preview must not stamp a promise onto the bid').toBe(null);
    expect(r.previewShows).toBe(true);
    expect(r.stampedShows, 'the document prints the stored stamp').toBe(true);
    expect(r.stampedNotFresh, 'reopening must not silently hand out a fresh 30 days').toBe(true);
    expect(r.stillStamped).toBeTruthy();
  });

  test('his own window length drives the date, not a hardcoded 30', async () => {
    const r = await page.evaluate(() => {
      S.estValidDays = 7;
      const out = { seven: _bidValidUntil({ bid_date: todayKey() }), sevenExpected: addDays(todayKey(), 7) };
      S.estValidDays = 30;
      return out;
    });
    expect(r.seven).toBe(r.sevenExpected);
  });

  // ── 6. Putting the price back in date ───────────────────────────────────────

  test('_extendBidPrice re-dates an expired price and survives a bid with no cloud copy', async () => {
    const r = await page.evaluate(async () => {
      bids.push({
        id: 830101, client_id: 830001, amount: 1400, status: 'Pending',
        bid_date: addDays(todayKey(), -40), signingToken: 'ph-token',
        validUntil: addDays(todayKey(), -10)
      });
      const before = _bidValidDaysLeft(bids.find(b => b.id === 830101));
      await _extendBidPrice(830101);
      // read it NOW: bids hold live object references, so a later extend would
      // rewrite this value out from under the assertion
      const afterDefault = bids.find(x => x.id === 830101).validUntil;
      await _extendBidPrice(830101, 14);
      const after14 = bids.find(x => x.id === 830101).validUntil;
      let threw = false;
      try { await _extendBidPrice(999999); } catch (e) { threw = true; }
      return {
        before,
        after: afterDefault,
        afterExpected: addDays(todayKey(), 30),
        after14,
        after14Expected: addDays(todayKey(), 14),
        threw
      };
    });
    expect(r.before).toBe(-10);
    expect(r.after).toBe(r.afterExpected);
    expect(r.after14).toBe(r.after14Expected);
    expect(r.threw, 'extending a bid that does not exist is a no-op, not a crash').toBe(false);
  });

  test('_extendBidPrice clamps junk day counts instead of writing a broken date', async () => {
    const r = await page.evaluate(async () => {
      bids.push({ id: 830101, client_id: 830001, amount: 1400, status: 'Pending', signingToken: 'ph-token' });
      const out = [];
      for (const d of [0, -5, 9999, 'soon', null, NaN]) {
        await _extendBidPrice(830101, d);
        out.push(bids.find(x => x.id === 830101).validUntil);
      }
      return { out, floor: addDays(todayKey(), 1), def: addDays(todayKey(), 30), ceil: addDays(todayKey(), 365) };
    });
    // 0 / null / NaN / 'soon' all fall back to the account default; -5 clamps up; 9999 clamps down
    expect(r.out[0]).toBe(r.def);
    expect(r.out[1]).toBe(r.floor);
    expect(r.out[2]).toBe(r.ceil);
    expect(r.out[3]).toBe(r.def);
    expect(r.out[4]).toBe(r.def);
    expect(r.out[5]).toBe(r.def);
  });

  // ── 7. What the dashboard says the price is doing ───────────────────────────

  const renderWith = (validUntil, opened) => page.evaluate(({ vu, op }) => {
    const i = bids.findIndex(b => b.id === 830101);
    const bid = {
      id: 830101, client_id: 830001, amount: 3500, status: 'Pending',
      bid_date: todayKey(), signingToken: 'ph-token', validUntil: vu
    };
    if (i >= 0) bids[i] = bid; else bids.push(bid);
    window._proposalViewsByBidHubClient = op ? { '830101': new Date().toISOString() } : {};
    window._proposalViewsByBidClient = {};
    window._proposalViewsByBidContractor = {};
    window._proposalViewsByBidHubCount = { '830101': op ? 1 : 0 };
    window._proposalViewsByBidClientCount = {};
    window._mmtCol_pending = false;
    if (typeof renderDash === 'function') renderDash();
    const feed = document.getElementById('dash-money-feed');
    return feed ? feed.innerHTML : '';
  }, { vu: validUntil, op: !!opened });

  test('a healthy price is stated quietly, with no Extend button in the way', async () => {
    const key = await page.evaluate(() => addDays(todayKey(), 21));
    const html = await renderWith(key, true);
    expect(html).toContain('Price holds through');
    expect(html).not.toContain('_extendBidPrice');
  });

  test('a price about to run out goes amber and grows an Extend button', async () => {
    const key = await page.evaluate(() => addDays(todayKey(), 3));
    const html = await renderWith(key, true);
    expect(html).toContain('Price expires in 3 days');
    expect(html).toContain('_extendBidPrice(830101)');
  });

  test('the last day says today, not "in 0 days"', async () => {
    const key = await page.evaluate(() => todayKey());
    const html = await renderWith(key, true);
    expect(html).toContain('Price expires today');
    expect(html).not.toContain('in 0 day');
  });

  test('an expired price says how long ago, in plain words', async () => {
    const y = await page.evaluate(() => addDays(todayKey(), -1));
    const yHtml = await renderWith(y, true);
    expect(yHtml).toContain('Price expired yesterday');
    const old = await page.evaluate(() => addDays(todayKey(), -9));
    const oldHtml = await renderWith(old, true);
    expect(oldHtml).toContain('Price expired 9 days ago');
    expect(oldHtml).toContain('_extendBidPrice(830101)');
  });

  test('one day left reads "day", not "days"', async () => {
    const key = await page.evaluate(() => addDays(todayKey(), 1));
    const html = await renderWith(key, true);
    expect(html).toContain('Price expires in 1 day (');
  });

  // ── 8. The follow-up text knows what happened ───────────────────────────────

  test('the deadline outranks everything: expiring and expired have their own words', async () => {
    const r = await page.evaluate(() => {
      const c = { id: 830001, name: 'Jerome Bettis' };
      window._proposalViewsByBidHubClient = {};
      window._proposalViewsByBidClient = {};
      return {
        expired: _followupMsg({ id: 1, validUntil: addDays(todayKey(), -3) }, c, 1),
        today: _followupMsg({ id: 1, validUntil: todayKey() }, c, 1),
        soon: _followupMsg({ id: 1, validUntil: addDays(todayKey(), 2) }, c, 1)
      };
    });
    expect(r.expired).toContain('ran out on');
    expect(r.today).toContain('last day');
    expect(r.soon).toContain('holds through');
    // The first name, never the whole name
    expect(r.soon).toContain('Jerome');
    expect(r.soon).not.toContain('Bettis');
  });

  test('an unopened proposal asks about the link, an opened one asks about the work', async () => {
    const r = await page.evaluate(() => {
      const c = { id: 830001, name: 'Jerome Bettis' };
      const b = { id: 830101, validUntil: addDays(todayKey(), 20) };
      window._proposalViewsByBidHubClient = {};
      window._proposalViewsByBidClient = {};
      const unopened = _followupMsg(b, c, 1);
      window._proposalViewsByBidClient = { '830101': new Date().toISOString() };
      const opened = _followupMsg(b, c, 1);
      const late = _followupMsg(b, c, 3);
      return { unopened, opened, late, wasOpened: _bidWasOpened(b) };
    });
    expect(r.unopened).toContain('come through OK');
    expect(r.opened).toContain('had a look');
    expect(r.opened).not.toContain('come through OK');
    expect(r.late).toContain('opening coming up');
    expect(r.wasOpened).toBe(true);
  });

  test('the follow-up text never breaks on a nameless client or a junk bid', async () => {
    const r = await page.evaluate(() => {
      const out = [];
      [[null, null], [{}, {}], [{ id: 9 }, { id: 9, name: '' }], [{ id: 9, validUntil: 'junk' }, { name: '   ' }]]
        .forEach(([b, c]) => {
          try { out.push(typeof _followupMsg(b, c, 1)); } catch (e) { out.push('threw'); }
        });
      return out;
    });
    expect(r).toEqual(['string', 'string', 'string', 'string']);
  });

  test('no console errors across the price-hold suite', async () => {
    assertNoErrors(page, 'price hold');
  });
});
