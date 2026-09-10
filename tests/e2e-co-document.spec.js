// @ts-check
/**
 * The change order, as a document a homeowner will actually sign.
 *
 * Owner 2026-09-07: "we need a damn good way to do a change order, right now
 * it's buried." It was: the only entry point sat at the very bottom of the job
 * sheet under nine other sections, and what it produced was a sentence and a
 * lump sum. Research the same day (Digital Change Orders, Buildertrend,
 * ConstructConnect) says the two things that draw homeowner pushback are a
 * vague scope line and a single number with no breakdown, and that the contract
 * total silently changing is what makes them fight it.
 *
 * What we verify:
 *  1. Contract history: what he signed, every CO since, where it stands
 *  2. Line breakdown, and lines owning the number once they carry one
 *  3. Photos he already took, and the days the change adds
 *  4. All of it reaching coData, the saved record, and the client's document
 *  5. A signed CO that adds days actually moves the schedule
 *  6. The entry point is a header action, not the bottom of the sheet
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const CD_CLIENT = 88001;
const CD_BID = 88101;
const CD_JOB = 88201;

test.describe('the change order document', () => {
  let page;

  const seed = (opts = {}) => page.evaluate(({ cid, bid, jid, o }) => {
    S.bname = 'Doc Test Plumbing';
    clients = clients.filter(c => c.id !== cid).concat([{ id: cid, name: 'Doc Client', addr: '5 Doc St', phone: '3165550001' }]);
    bids = bids.filter(b => b.id !== bid).concat([{
      id: bid, client_id: cid, client_name: 'Doc Client', amount: o.amount != null ? o.amount : 3200,
      status: 'Closed Won', draft: false, bid_date: '2026-08-28',
      changeOrders: o.cos || []
    }]);
    jobs = jobs.filter(j => j.id !== jid).concat([{
      id: jid, bid_id: bid, client_id: cid, name: 'Doc Client', start: '2026-09-04',
      days: o.days != null ? o.days : 1, status: 'active'
    }]);
    photos = (photos || []).filter(p => p.client_id !== cid).concat([
      { id: 'ph1', client_id: cid, job_id: jid, url: 'u1.jpg', thumbUrl: 't1.jpg', uploadedAt: '2026-09-05T12:00:00Z' },
      { id: 'ph2', client_id: cid, job_id: jid, url: 'u2.jpg', thumbUrl: '', uploadedAt: '2026-09-05T12:01:00Z' }
    ]);
    document.querySelectorAll('.zmodal-overlay,[id^=_shot]').forEach(x => x.remove());
  }, { cid: CD_CLIENT, bid: CD_BID, jid: CD_JOB, o: opts });

  const SIGNED_CO_1 = {
    id: 5, coNum: 1, desc: 'Added a shutoff at the meter', type: 'add',
    amount: 750, delta: 750, originalAmount: 2450, newAmount: 3200,
    signedAt: '2026-09-02T15:00:00.000Z', signerName: 'Doc Client'
  };

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });
  // The signing document's overlay is built with cssText, so the browser
  // normalizes it to "z-index: 9999" (with a space) and an attribute selector
  // written the other way silently matches nothing. Left behind, a stale
  // document is the one getElementById('co-sign-canvas') finds next.
  test.afterEach(async () => {
    await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      [...document.body.children].forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' && Number(cs.zIndex) >= 9999) el.remove();
      });
    });
  });

  // ── 1. Contract history ────────────────────────────────────────────────────

  test('the original number survives every change order', async () => {
    await seed({ amount: 3200, cos: [SIGNED_CO_1] });
    const r = await page.evaluate(bid => {
      const b = bids.find(x => x.id === bid);
      return { h: _coContractHistory(b), line: _coHistoryLine(b) };
    }, CD_BID);
    expect(r.h.original, 'b.amount already rolled forward; only the first CO remembers what he signed').toBe(2450);
    expect(r.h.current).toBe(3200);
    expect(r.h.cos).toEqual([{ coNum: 1, delta: 750 }]);
    expect(r.line).toBe('Original $2,450.00 · CO #1 +$750.00');
  });

  test('a first change order shows no history of itself', async () => {
    await seed({ amount: 2450, cos: [] });
    const r = await page.evaluate(bid => {
      const b = bids.find(x => x.id === bid);
      return { line: _coHistoryLine(b), html: _coHistoryHTML(_coContractHistory(b)), orig: _coContractHistory(b).original };
    }, CD_BID);
    expect(r.line).toBe('');
    expect(r.html).toBe('');
    expect(r.orig).toBe(2450);
  });

  test('an unsigned change order is not history yet', async () => {
    await seed({ amount: 2450, cos: [{ coNum: 1, desc: 'pending', type: 'add', amount: 300, delta: 300, originalAmount: 2450, newAmount: 2750, status: 'pending_client' }] });
    const line = await page.evaluate(bid => _coHistoryLine(bids.find(x => x.id === bid)), CD_BID);
    expect(line, 'nothing was agreed, so nothing changed the contract').toBe('');
  });

  test('a removal reads as money coming off the chain', async () => {
    await seed({ amount: 2150, cos: [{ ...SIGNED_CO_1, coNum: 1, type: 'sub', amount: 300, delta: -300, originalAmount: 2450, newAmount: 2150 }] });
    const line = await page.evaluate(bid => _coHistoryLine(bids.find(x => x.id === bid)), CD_BID);
    expect(line).toBe('Original $2,450.00 · CO #1 -$300.00');
  });

  test('history helpers never throw on junk', async () => {
    const ok = await page.evaluate(() => {
      try {
        [null, undefined, {}, { changeOrders: null }, { changeOrders: [null, {}] }].forEach(b => { _coContractHistory(b); _coHistoryLine(b); });
        _coHistoryHTML(null); _coHistoryHTML({}); _coHistoryHTML({ cos: [] });
        return true;
      } catch (e) { return String(e); }
    });
    expect(ok).toBe(true);
  });

  // ── 2. Lines ───────────────────────────────────────────────────────────────

  test('lines own the dollar amount once any of them carries one', async () => {
    await seed({ amount: 3200, cos: [SIGNED_CO_1] });
    const r = await page.evaluate(bid => {
      showChangeOrderModal(bid, 88001);
      setCOType('add', bid);
      const a = document.getElementById('co-amount');
      a.value = '99'; _previewCO(bid);
      const beforeReadOnly = a.readOnly;
      _coLines = [{ desc: 'Stack', amt: 780 }, { desc: 'Re-tie', amt: 240 }];
      _coRenderLines(bid); _coSyncLines(bid);
      return { beforeReadOnly, after: a.value, readOnly: a.readOnly, val: _moneyVal('co-amount'), rows: document.querySelectorAll('#co-lines input').length };
    }, CD_BID);
    expect(r.beforeReadOnly).toBe(false);
    expect(r.after, 'the two can never disagree on the document the client signs').toBe('1,020.00');
    expect(r.readOnly).toBe(true);
    expect(r.val).toBe(1020);
    expect(r.rows).toBe(4); // 2 rows x (description + amount)
  });

  test('emptying every line hands the amount back', async () => {
    await seed({ amount: 3200 });
    const r = await page.evaluate(bid => {
      showChangeOrderModal(bid, 88001);
      setCOType('add', bid);
      _coLines = [{ desc: 'x', amt: 100 }]; _coSyncLines(bid);
      const locked = document.getElementById('co-amount').readOnly;
      _coLines = [{ desc: 'x', amt: 0 }]; _coSyncLines(bid);
      return { locked, unlocked: !document.getElementById('co-amount').readOnly };
    }, CD_BID);
    expect(r.locked).toBe(true);
    expect(r.unlocked).toBe(true);
  });

  test('add and remove a line', async () => {
    await seed({ amount: 3200 });
    const r = await page.evaluate(bid => {
      showChangeOrderModal(bid, 88001);
      setCOType('add', bid);
      _coAddLine(bid); _coAddLine(bid); _coAddLine(bid);
      const three = _coLines.length;
      _coRmLine(1, bid);
      return { three, two: _coLines.length };
    }, CD_BID);
    expect(r.three).toBe(3);
    expect(r.two).toBe(2);
  });

  test('the document itemizes, and a lump sum still prints one Adjustment', async () => {
    const r = await page.evaluate(() => ({
      lines: _coLinesHTML([{ desc: 'Stack', amt: 780 }, { desc: 'Re-tie', amt: 240 }], 'blue', 'add'),
      sub: _coLinesHTML([{ desc: 'Dropped the tile', amt: 400 }], 'red', 'sub'),
      none: _coLinesHTML([], 'blue', 'add'),
      nul: _coLinesHTML(null, 'blue', 'add')
    }));
    expect(r.lines).toContain('Stack');
    expect(r.lines).toContain('+$780.00');
    expect(r.lines).toContain('+$1,020.00');
    expect(r.sub, 'a removal is money coming off, not a second charge').toContain('-$400.00');
    expect(r.none).toBe('');
    expect(r.nul).toBe('');
  });

  // ── 3. Photos and days ─────────────────────────────────────────────────────

  test('the photo strip is what he already shot on this job', async () => {
    await seed({ amount: 3200 });
    const r = await page.evaluate(bid => {
      const b = bids.find(x => x.id === bid);
      const list = _coJobPhotos(b);
      showChangeOrderModal(bid, 88001);
      setCOType('add', bid);
      const imgs = document.querySelectorAll('#co-amount-wrap img');
      _coTogglePhoto('ph1', imgs[0]);
      const on = _coPhotoIds.slice();
      _coTogglePhoto('ph1', imgs[0]);
      return { count: list.length, newestFirst: list[0].id, shown: imgs.length, on, off: _coPhotoIds.slice() };
    }, CD_BID);
    expect(r.count).toBe(2);
    expect(r.newestFirst).toBe('ph2');
    expect(r.shown).toBe(2);
    expect(r.on).toEqual(['ph1']);
    expect(r.off).toEqual([]);
  });

  test('a photo with no thumbnail still falls back to the full image', async () => {
    await seed({ amount: 3200 });
    const urls = await page.evaluate(bid => {
      showChangeOrderModal(bid, 88001);
      setCOType('add', bid);
      document.getElementById('co-desc').value = 'Found the stack corroded through';
      document.getElementById('co-amount').value = '500';
      _coPhotoIds = ['ph1', 'ph2'];
      _reviewCO(bid, 88001);
      const ov = document.getElementById('co-sign-canvas').closest('[style*=fixed]');
      return JSON.parse(ov.dataset.coData).photos;
    }, CD_BID);
    expect(urls).toEqual(['t1.jpg', 'u2.jpg']);
  });

  test('the days chip is a contract term on the document', async () => {
    const r = await page.evaluate(() => ({ one: _coDaysHTML(1), three: _coDaysHTML(3), none: _coDaysHTML(0), junk: _coDaysHTML('x') }));
    expect(r.one).toContain('1 working day');
    expect(r.three).toContain('3 working days');
    expect(r.none).toBe('');
    expect(r.junk).toBe('');
  });

  test('photo block prints nothing when nothing was picked', async () => {
    const r = await page.evaluate(() => ({ none: _coPhotosHTML([]), nul: _coPhotosHTML(null), two: _coPhotosHTML(['a.jpg', 'b.jpg']) }));
    expect(r.none).toBe('');
    expect(r.nul).toBe('');
    expect(r.two).toContain('What We Found');
  });

  // ── 4. It all reaches the document and the record ──────────────────────────

  test('the whole change order reaches coData and the signed record', async () => {
    await seed({ amount: 3200, cos: [SIGNED_CO_1] });
    const r = await page.evaluate(bid => {
      showChangeOrderModal(bid, 88001);
      document.getElementById('co-desc').value = 'Opened the wall and found the cast iron stack corroded through';
      setCOType('add', bid);
      _coLines = [{ desc: 'Stack replacement', amt: 780 }, { desc: 'Re-tie', amt: 240 }, { desc: '', amt: 150 }];
      _coRenderLines(bid); _coSyncLines(bid);
      _coSetDays(2, bid);
      _coPhotoIds = ['ph1'];
      _reviewCO(bid, 88001);
      const ov = document.getElementById('co-sign-canvas').closest('[style*=fixed]');
      const data = JSON.parse(ov.dataset.coData);
      const docText = ov.textContent;
      document.getElementById('co-sign-name').value = 'Doc Client';
      const c = document.getElementById('co-sign-canvas'), cx = c.getContext('2d');
      cx.beginPath(); cx.moveTo(4, 4); cx.lineTo(50, 40); cx.stroke();
      c.dispatchEvent(new Event('_esign-drawn', { bubbles: true }));
      _submitCOSign(bid, 88001);
      const b = bids.find(x => x.id === bid);
      return { data, docText, saved: (b.changeOrders || []).find(co => co.coNum === 2), amount: b.amount, jobDays: jobs.find(j => j.id === 88201).days };
    }, CD_BID);

    expect(r.data.amount, 'the three lines are the number').toBe(1170);
    expect(r.data.addedDays).toBe(2);
    expect(r.data.photos).toEqual(['t1.jpg']);
    expect(r.data.lines.map(l => l.desc), 'a line with an amount and no words still has to say something').toEqual(['Stack replacement', 'Re-tie', 'Additional work']);
    expect(r.data.history.original).toBe(2450);

    expect(r.docText).toContain('Contract To Date');
    expect(r.docText).toContain('Signed $2,450.00 · CO #1 +$750.00');
    expect(r.docText).toContain('Stack replacement');
    expect(r.docText).toContain('What We Found');
    expect(r.docText).toContain('2 working days');
    expect(r.docText).toContain('$4,370.00');

    expect(r.saved.lines.length).toBe(3);
    expect(r.saved.addedDays).toBe(2);
    expect(r.saved.photos).toEqual(['t1.jpg']);
    expect(r.amount).toBe(4370);
    expect(r.jobDays, 'a signed change order that adds days moves the schedule').toBe(3);
  });

  test('a change order with no days never touches the calendar', async () => {
    await seed({ amount: 3200, days: 2 });
    const days = await page.evaluate(bid => {
      showChangeOrderModal(bid, 88001);
      document.getElementById('co-desc').value = 'Swapped the fixture for the one they picked';
      setCOType('add', bid);
      document.getElementById('co-amount').value = '200';
      _reviewCO(bid, 88001);
      document.getElementById('co-sign-name').value = 'Doc Client';
      const c = document.getElementById('co-sign-canvas'), cx = c.getContext('2d');
      cx.beginPath(); cx.moveTo(4, 4); cx.lineTo(50, 40); cx.stroke();
      c.dispatchEvent(new Event('_esign-drawn', { bubbles: true }));
      _submitCOSign(bid, 88001);
      return jobs.find(j => j.id === 88201).days;
    }, CD_BID);
    expect(days).toBe(2);
  });

  test('_coApplyDays survives a bid with no job and junk input', async () => {
    const ok = await page.evaluate(() => {
      try {
        _coApplyDays(null, 3); _coApplyDays({ id: 999999 }, 3);
        _coApplyDays({ id: 88101 }, 0); _coApplyDays({ id: 88101 }, -2); _coApplyDays({ id: 88101 }, 'x');
        return true;
      } catch (e) { return String(e); }
    });
    expect(ok).toBe(true);
  });

  test('opening the modal fresh clears the last one', async () => {
    await seed({ amount: 3200 });
    const r = await page.evaluate(bid => {
      showChangeOrderModal(bid, 88001);
      setCOType('add', bid);
      _coLines = [{ desc: 'x', amt: 5 }]; _coDays = 3; _coPhotoIds = ['ph1'];
      showChangeOrderModal(bid, 88001);
      return { lines: _coLines.length, days: _coDays, photos: _coPhotoIds.length, type: _coType };
    }, CD_BID);
    expect(r).toEqual({ lines: 0, days: 0, photos: 0, type: null });
  });

  // ── 5. Where he finds it ───────────────────────────────────────────────────

  test('the change order is a header action on the job sheet, not buried in Actions', async () => {
    await seed({ amount: 3200, cos: [SIGNED_CO_1] });
    const r = await page.evaluate(cid => {
      // Assert on the sheet THIS call rendered. Reading querySelector's first
      // match makes the test depend on the DOM being clean, and an overlay
      // surviving from an earlier test then answers for this one (webkit
      // shard 1, 2026-09-07: the no-bid sheet reported a Change order button
      // that belonged to the previous test's client).
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      openJobSheet(cid);
      const all = document.querySelectorAll('.zmodal-overlay');
      const ov = all[all.length - 1];
      const hdr = ov.querySelector('div');
      const btns = [...ov.querySelectorAll('button')].filter(b => /Change order/i.test(b.textContent || ''));
      const first = btns[0];
      const top = first ? first.getBoundingClientRect().top : 1e9;
      const sheetTop = ov.getBoundingClientRect().top;
      const text = ov.textContent || '';
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      return { sheets: all.length, count: btns.length, offsetFromTop: top - sheetTop, hasHistory: /Original \$2,450\.00 · CO #1 \+\$750\.00/.test(text), hdrExists: !!hdr };
    }, CD_CLIENT);
    expect(r.sheets, 'one openJobSheet call, one sheet').toBe(1);
    expect(r.count, 'exactly one way in, so there is no second stale entry point').toBe(1);
    expect(r.offsetFromTop, 'it used to sit below nine other sections').toBeLessThan(300);
    expect(r.hasHistory, 'the payment block has to say how the contract got to this number').toBe(true);
  });

  test('a client with no won bid gets no change order button', async () => {
    const count = await page.evaluate(() => {
      const cid = 88777;
      clients = clients.filter(c => c.id !== cid).concat([{ id: cid, name: 'No Bid', addr: '1 Nowhere' }]);
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      openJobSheet(cid);
      const all = document.querySelectorAll('.zmodal-overlay');
      const ov = all[all.length - 1];
      const n = ov ? [...ov.querySelectorAll('button')].filter(b => /Change order/i.test(b.textContent || '')).length : -1;
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      return n;
    });
    expect(count).toBe(0);
  });

  test('a declined change order says so, in their words', async () => {
    await seed({ amount: 3200, cos: [{ coNum: 1, desc: 'Add a second shutoff', type: 'add', amount: 400, delta: 400, originalAmount: 3200, newAmount: 3600, sentAt: '2026-09-05T10:00:00Z', declinedAt: '2026-09-05T18:00:00Z', declineNote: 'Want to wait until spring on that one' }] });
    const text = await page.evaluate(cid => {
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      openJobSheet(cid);
      const all = document.querySelectorAll('.zmodal-overlay');
      const t = all[all.length - 1].textContent || '';
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      return t;
    }, CD_CLIENT);
    expect(text).toContain('Declined');
    expect(text, 'why they said no is the only part he can act on').toContain('Want to wait until spring');
  });

  test('no console errors across the change order flow', async () => {
    await assertNoErrors(page);
  });
});
