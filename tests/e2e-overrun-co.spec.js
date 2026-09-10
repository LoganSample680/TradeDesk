// @ts-check
/**
 * No surprises on the final price.
 *
 * Owner 2026-09-07: "Change order that's signed could mean additional things,
 * increased crew, all the variables?" A job going long used to surface as a
 * bigger number at invoice time with nothing behind it. Now the estimate
 * stamps its promise (bid.estHours, bid.estCrew), the clock records the truth,
 * and the difference is three facts the client can read on the signed document:
 * hours beyond the estimate, people beyond the crew he priced, days beyond the
 * ones booked.
 *
 * What we verify:
 *  1. _jobOverrun: the arithmetic, and what it refuses to call "over"
 *  2. Open timers never count (a running job would flicker in and out of over)
 *  3. _overrunText names only the facts that actually moved
 *  4. openOverrunCO pre-fills the change order and needs no typing
 *  5. The signed CO record carries the three facts and the job it came from
 *  6. _coOverrunHTML prints the moved rows and nothing else
 *  7. The job sheet offers it once, and stops once a CO covers it
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const OR_CLIENT = 86001;
const OR_BID = 86101;
const OR_JOB = 86201;

test.describe('a job running long becomes a change order', () => {
  let page;

  // 8 estimated hours, a crew of two, one booked day.
  const seed = (opts = {}) => page.evaluate(({ cid, bid, jid, o }) => {
    clients = clients.filter(c => c.id !== cid).concat([
      { id: cid, name: 'Overrun Client', addr: '9 Long Rd', phone: '3165559001' }
    ]);
    bids = bids.filter(b => b.id !== bid).concat([{
      id: bid, client_id: cid, client_name: 'Overrun Client', amount: 2000,
      status: 'Closed Won', draft: false, bid_date: '2026-06-01',
      estHours: o.estHours != null ? o.estHours : 8,
      estCrew: o.estCrew != null ? o.estCrew : ['a@x.com', 'b@x.com'],
      changeOrders: []
    }]);
    jobs = jobs.filter(j => j.id !== jid).concat([{
      id: jid, bid_id: bid, client_id: cid, name: 'Overrun Client',
      start: '2026-06-05', days: o.days != null ? o.days : 1, status: 'upcoming'
    }]);
    timeEntries = (timeEntries || []).filter(e => e.job_id !== jid)
      .concat((o.entries || []).map((e, i) => ({
        id: 870000 + i, job_id: jid, date: e.date || '2026-06-05',
        minutes: e.minutes, logged_by_uid: e.by || 'u1', logged_by_name: e.by || 'u1',
        scope_id: null, open: !!e.open
      })));
    S.laborRate = 60;
  }, { cid: OR_CLIENT, bid: OR_BID, jid: OR_JOB, o: opts });

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });

  test.afterAll(async () => { await page.context().close(); });
  test.afterEach(async () => {
    await page.evaluate(() => document.querySelectorAll('.zmodal-overlay,[style*="z-index:9999"]').forEach(o => o.remove()));
  });

  // ── 1. The arithmetic ──────────────────────────────────────────────────────

  test('hours past the estimate, at his billing rate', async () => {
    await seed({ entries: [{ minutes: 360 }, { minutes: 360 }] }); // 12 hrs vs 8
    const o = await page.evaluate(j => _jobOverrun(j), OR_JOB);
    expect(o.estHrs).toBe(8);
    expect(o.actualHrs).toBe(12);
    expect(o.overHrs).toBe(4);
    expect(o.overPct).toBe(50);
    expect(o.rate).toBe(60);
    expect(o.suggested).toBe(240);
    expect(o.isOver).toBe(true);
  });

  test('more people on site than he priced', async () => {
    await seed({ entries: [{ minutes: 300, by: 'u1' }, { minutes: 300, by: 'u2' }, { minutes: 300, by: 'u3' }] });
    const o = await page.evaluate(j => _jobOverrun(j), OR_JOB);
    expect(o.estCrew).toBe(2);
    expect(o.actualCrew).toBe(3);
    expect(o.extraCrew).toBe(1);
  });

  test('more days on site than were booked', async () => {
    await seed({ days: 1, entries: [
      { minutes: 300, date: '2026-06-05' },
      { minutes: 300, date: '2026-06-06' },
      { minutes: 60, date: '2026-06-07' }
    ] });
    const o = await page.evaluate(j => _jobOverrun(j), OR_JOB);
    expect(o.estDays).toBe(1);
    expect(o.actualDays).toBe(3);
    expect(o.extraDays).toBe(2);
  });

  test('under the estimate is not over', async () => {
    await seed({ entries: [{ minutes: 240 }] }); // 4 hrs vs 8
    const o = await page.evaluate(j => _jobOverrun(j), OR_JOB);
    expect(o.overHrs).toBe(0);
    expect(o.isOver).toBe(false);
    expect(o.suggested).toBe(0);
  });

  test('a bid that never promised hours can never be over', async () => {
    await seed({ estHours: 0, entries: [{ minutes: 900 }] });
    const o = await page.evaluate(j => _jobOverrun(j), OR_JOB);
    expect(o.estHrs).toBe(0);
    expect(o.isOver, 'guessing a promise would put a number in front of a client no estimate supported').toBe(false);
  });

  test('T&M prices its own crew, and the payroll picker does not outrank it', async () => {
    await seed({ entries: [{ minutes: 60 }] });
    const o = await page.evaluate(({ bid, jid }) => {
      const b = bids.find(x => x.id === bid);
      // One name assigned in the picker, three men priced into the T&M rate.
      b.isTM = true; b.tmEstHours = 8; b.tmCrewCount = 3; b.tmRatePerMan = 80;
      b.estCrew = ['solo@x.com']; b.estHours = 8;
      return _jobOverrun(jid);
    }, { bid: OR_BID, jid: OR_JOB });
    expect(o.estCrew, 'the client agreed to pay for three, not for whoever was assigned').toBe(3);
    expect(o.rate).toBe(80);
  });

  // The clock sums everybody's minutes, so the promise has to be in man-hours
  // too. T&M's tmEstHours is DURATION (days x 8; labor = crew x rate x hours),
  // so it needs the crew multiply. Comparing 10 against a 2-man crew's 20
  // man-hours reported ten hours of overrun on a job that finished exactly on
  // plan, and billed the client for it.
  test('T&M hours are duration and get multiplied by the priced crew', async () => {
    await page.evaluate(({ bid, jid }) => {
      const b = bids.find(x => x.id === bid);
      delete b.estHours; delete b.estCrew;
      b.isTM = true; b.tmEstHours = 10; b.tmCrewCount = 2; b.tmRatePerMan = 95;
      // Two people, ten hours each: exactly what was sold.
      timeEntries = timeEntries.filter(e => e.job_id !== jid).concat([
        { id: 871000, job_id: jid, date: '2026-06-05', minutes: 600, logged_by_uid: 'u1', open: false },
        { id: 871001, job_id: jid, date: '2026-06-05', minutes: 600, logged_by_uid: 'u2', open: false }
      ]);
    }, { bid: OR_BID, jid: OR_JOB });
    const o = await page.evaluate(j => _jobOverrun(j), OR_JOB);
    expect(o.estHrs, '10 hours with a crew of two is 20 man-hours').toBe(20);
    expect(o.estCrew).toBe(2);
    expect(o.rate).toBe(95);
    expect(o.actualHrs).toBe(20);
    expect(o.overHrs, 'a job that finished exactly on plan is not over').toBe(0);
    expect(o.isOver).toBe(false);
    expect(o.suggested).toBe(0);
  });

  test('a T&M job that really does run over still trips, at the right number', async () => {
    await page.evaluate(({ bid, jid }) => {
      const b = bids.find(x => x.id === bid);
      delete b.estHours; delete b.estCrew;
      b.isTM = true; b.tmEstHours = 10; b.tmCrewCount = 2; b.tmRatePerMan = 95;
      timeEntries = timeEntries.filter(e => e.job_id !== jid).concat([
        { id: 871100, job_id: jid, date: '2026-06-05', minutes: 780, logged_by_uid: 'u1', open: false },
        { id: 871101, job_id: jid, date: '2026-06-05', minutes: 780, logged_by_uid: 'u2', open: false }
      ]);
    }, { bid: OR_BID, jid: OR_JOB });
    const o = await page.evaluate(j => _jobOverrun(j), OR_JOB);
    expect(o.actualHrs).toBe(26);
    expect(o.overHrs, '26 man-hours against 20 promised').toBe(6);
    expect(o.suggested).toBe(570);
  });

  test('a fixed-price bid already promises in man-hours and is not multiplied', async () => {
    await seed({ estHours: 8, estCrew: ['a@x.com', 'b@x.com'], entries: [
      { minutes: 360, by: 'u1' }, { minutes: 360, by: 'u2' }
    ] });
    const o = await page.evaluate(j => _jobOverrun(j), OR_JOB);
    expect(o.estHrs, 'estHours is summed from clock-learned history, so it is already man-hours').toBe(8);
    expect(o.estCrew).toBe(2);
    expect(o.actualHrs).toBe(12);
    expect(o.overHrs).toBe(4);
  });

  // ── 2. What it refuses to count ────────────────────────────────────────────

  test('an open timer never counts', async () => {
    await seed({ entries: [{ minutes: 300 }, { minutes: 600, open: true }] });
    const o = await page.evaluate(j => _jobOverrun(j), OR_JOB);
    expect(o.actualHrs, 'a running clock would flip the job in and out of over').toBe(5);
    expect(o.isOver).toBe(false);
  });

  test('junk in never throws', async () => {
    const r = await page.evaluate(() => {
      const out = [];
      [null, undefined, 0, -1, 'x', 99999999, NaN].forEach(v => {
        try { out.push(_jobOverrun(v) === null ? 'null' : 'obj'); } catch (e) { out.push('THREW:' + e.message); }
      });
      return out;
    });
    expect(r.every(x => !String(x).startsWith('THREW'))).toBe(true);
  });

  test('a job with no bid at all is not over', async () => {
    const o = await page.evaluate(() => {
      jobs = jobs.filter(j => j.id !== 86999).concat([{ id: 86999, client_id: 86001, bid_id: null, name: 'Loose', start: '2026-06-05', days: 1 }]);
      timeEntries = (timeEntries || []).concat([{ id: 872000, job_id: 86999, date: '2026-06-05', minutes: 600, logged_by_uid: 'u1', open: false }]);
      return _jobOverrun(86999);
    });
    expect(o.isOver).toBe(false);
    expect(o.estHrs).toBe(0);
  });

  // ── 3. The sentence ────────────────────────────────────────────────────────

  test('_overrunText(o,true) drops the hours a headline already said', async () => {
    await seed({ days: 1, entries: [
      { minutes: 720, by: 'u1', date: '2026-06-05' },
      { minutes: 720, by: 'u2', date: '2026-06-05' },
      { minutes: 120, by: 'u3', date: '2026-06-06' }
    ] });
    const r = await page.evaluate(j => {
      const o = _jobOverrun(j);
      return { full: _overrunText(o), trimmed: _overrunText(o, true) };
    }, OR_JOB);
    expect(r.full).toContain('beyond the 8 hrs estimated');
    expect(r.trimmed, 'the card headline already says the hours').not.toContain('estimated');
    expect(r.trimmed).toContain('1 more person on site than priced');
    expect(r.trimmed).toContain('1 extra day on site');
  });

  test('_overrunText names only what actually moved', async () => {
    await seed({ days: 1, entries: [
      { minutes: 360, by: 'u1', date: '2026-06-05' },
      { minutes: 360, by: 'u2', date: '2026-06-05' }
    ] });
    const t = await page.evaluate(j => _overrunText(_jobOverrun(j)), OR_JOB);
    expect(t).toContain('4 hrs beyond the 8 hrs estimated');
    expect(t, 'the crew matched the estimate, saying so is noise').not.toContain('more people');
    expect(t, 'one day booked, one day worked').not.toContain('extra day');
  });

  test('_overrunText and _fmtHrsShort survive nothing', async () => {
    const r = await page.evaluate(() => ({
      nul: _overrunText(null), und: _overrunText(undefined),
      one: _fmtHrsShort(1), half: _fmtHrsShort(2.5), junk: _fmtHrsShort('x')
    }));
    expect(r.nul).toBe('');
    expect(r.und).toBe('');
    expect(r.one).toBe('1 hr');
    expect(r.half).toBe('2.5 hrs');
    expect(r.junk).toBe('0 hrs');
  });

  // ── 4. The change order writes itself ──────────────────────────────────────

  test('openOverrunCO pre-fills the description, the direction and the amount', async () => {
    await seed({ days: 1, entries: [
      { minutes: 360, by: 'u1', date: '2026-06-05' },
      { minutes: 360, by: 'u2', date: '2026-06-05' },
      { minutes: 240, by: 'u3', date: '2026-06-06' }
    ] });
    const r = await page.evaluate(({ jid, cid }) => {
      openOverrunCO(jid, cid);
      return {
        opened: !!document.getElementById('co-desc'),
        desc: document.getElementById('co-desc')?.value || '',
        amount: _moneyVal('co-amount'),
        amountShown: document.getElementById('co-amount')?.value || '',
        preview: document.getElementById('co-preview')?.textContent || ''
      };
    }, { jid: OR_JOB, cid: OR_CLIENT });
    expect(r.opened).toBe(true);
    expect(r.desc, 'the document prints the numbers, prose repeating them is padding').toBe('Work beyond the original estimate.');
    expect(r.amount, '8 hrs over at $60 = $480, typed by nobody').toBe(480);
    expect(r.amountShown).toBe('480.00');
    expect(r.preview).toContain('2,480');
  });

  test('a job that is not over opens nothing', async () => {
    await seed({ entries: [{ minutes: 60 }] });
    const opened = await page.evaluate(({ jid, cid }) => {
      openOverrunCO(jid, cid);
      return !!document.getElementById('co-desc');
    }, { jid: OR_JOB, cid: OR_CLIENT });
    expect(opened).toBe(false);
  });

  // ── 5. The three facts land on the signed record ───────────────────────────

  test('the signed change order carries the hours, the crew, the days and its job', async () => {
    await seed({ days: 1, entries: [
      { minutes: 360, by: 'u1', date: '2026-06-05' },
      { minutes: 360, by: 'u2', date: '2026-06-05' },
      { minutes: 240, by: 'u3', date: '2026-06-06' }
    ] });
    const co = await page.evaluate(({ jid, cid, bid }) => {
      openOverrunCO(jid, cid);
      _reviewCO(bid, cid);
      document.getElementById('co-sign-name').value = 'Dana Homeowner';
      // The pad requires a drawn signature; the typed preview satisfies it the
      // same way every other in-person signing test does.
      const c = document.getElementById('co-sign-canvas');
      const cx = c.getContext('2d');
      cx.beginPath(); cx.moveTo(5, 5); cx.lineTo(60, 40); cx.stroke();
      c.dispatchEvent(new Event('_esign-drawn', { bubbles: true }));
      _submitCOSign(bid, cid);
      const b = bids.find(x => x.id === bid);
      return (b.changeOrders || [])[0] || null;
    }, { jid: OR_JOB, cid: OR_CLIENT, bid: OR_BID });
    expect(co, 'the CO must actually save').toBeTruthy();
    expect(co.type).toBe('add');
    expect(co.overrun.addedHours).toBe(8);
    expect(co.overrun.addedCrew).toBe(1);
    expect(co.overrun.addedDays).toBe(1);
    expect(co.overrun.estHours).toBe(8);
    expect(co.overrun.actualHours).toBe(16);
    expect(co.overrun.jobId, 'the CO has to know which job it covers').toBe(OR_JOB);
  });

  test('a change order written by hand carries no overrun', async () => {
    await seed({ entries: [{ minutes: 60 }] });
    const co = await page.evaluate(({ cid, bid }) => {
      showChangeOrderModal(bid, cid);
      document.getElementById('co-desc').value = 'Client added an outlet in the hallway';
      setCOType('add', bid);
      document.getElementById('co-amount').value = '125';
      _reviewCO(bid, cid);
      const ov = document.getElementById('co-sign-canvas')?.closest('[style*=fixed]');
      return JSON.parse(ov.dataset.coData);
    }, { cid: OR_CLIENT, bid: OR_BID });
    expect(co.overrun, 'no clock behind it, nothing to claim').toBe(null);
    expect(co.amount).toBe(125);
  });

  // ── 6. The document ────────────────────────────────────────────────────────

  test('the document prints the rows that moved and skips the ones that did not', async () => {
    const h = await page.evaluate(() => _coOverrunHTML({
      addedHours: 4, addedCrew: 0, addedDays: 0,
      estHours: 8, actualHours: 12, estCrew: 2, actualCrew: 2, estDays: 1, actualDays: 1, rate: 60
    }));
    expect(h).toContain('What changed on site');
    expect(h).toContain('Labor on site');
    expect(h).toContain('8 hrs');
    expect(h).toContain('12 hrs');
    expect(h).toContain('$60/hr');
    expect(h).not.toContain('Crew');
    expect(h).not.toContain('Days on site');
  });

  test('nothing moved, or nothing given, prints nothing', async () => {
    const r = await page.evaluate(() => ({
      nul: _coOverrunHTML(null),
      empty: _coOverrunHTML({ addedHours: 0, addedCrew: 0, addedDays: 0 })
    }));
    expect(r.nul).toBe('');
    expect(r.empty).toBe('');
  });

  // ── 7. The job sheet ───────────────────────────────────────────────────────

  test('the job sheet offers the change order, once', async () => {
    await seed({ entries: [{ minutes: 360 }, { minutes: 360 }] });
    const before = await page.evaluate(cid => {
      openJobSheet(cid);
      const t = document.body.textContent || '';
      const has = /Running long/.test(t) && /past the estimate/.test(t);
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      return has;
    }, OR_CLIENT);
    expect(before).toBe(true);

    const after = await page.evaluate(({ cid, bid, jid }) => {
      const b = bids.find(x => x.id === bid);
      b.changeOrders = [{ id: 1, coNum: 1, desc: 'covered', type: 'add', amount: 240, delta: 240,
        originalAmount: 2000, newAmount: 2240, overrun: { jobId: jid, addedHours: 4 }, signedAt: new Date().toISOString() }];
      openJobSheet(cid);
      const has = /Running long/.test(document.body.textContent || '');
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      return has;
    }, { cid: OR_CLIENT, bid: OR_BID, jid: OR_JOB });
    expect(after, 'nagging him after the conversation happened is how a useful card becomes noise').toBe(false);
  });

  test('every save path stamps the promise, not just the autosave', async () => {
    const r = await page.evaluate(() => {
      const auto = String(_byoAutosave || '');
      const save = String(saveGenericEstimate || '');
      const has = s => /estHours\s*[:=]/.test(s) && /estCrewSize\s*[:=]/.test(s);
      // saveGenericEstimate has two branches: editing the pre-created draft
      // stub, and creating a bid outright. Both have to carry it.
      return { auto: has(auto), save: has(save), saveBranches: (save.match(/estHours\s*[:=]/g) || []).length };
    });
    expect(r.auto, 'without a stamped promise the comparison drifts as the price book learns').toBe(true);
    expect(r.save, 'relying on an autosave having happened first is how a bid reaches a job with nothing to measure it against').toBe(true);
    expect(r.saveBranches).toBe(2);
  });

  test('no console errors across the overrun loop', async () => {
    await assertNoErrors(page);
  });
});
