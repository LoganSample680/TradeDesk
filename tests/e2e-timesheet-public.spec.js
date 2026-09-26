// @ts-check
/**
 * The public timesheet page (owner 2026-09-05, timesheet.html +
 * js/timesheet-public.js). The link in a submitted timesheet text opens it:
 * anon, no app, no login. It draws the same week bars and day rail as the app
 * (js/timelog.js, loaded as is) from one RPC, read only, with Reject in soft
 * grey and Approve as the one dark button.
 *
 * The Supabase SDK is replaced by a tiny shim served in place of the CDN
 * script, so the RPC answers with what the test seeds on window.__tsp.
 */
const { test, expect, mockAllExternal, assertNoErrors } = require('./helpers');

const WEEK = '2026-08-23';
const DATA = {
  business_name: 'Sample Plumbing', person_name: 'Jack Sample', week_start: WEEK, biz_tz: 'America/Chicago',
  status: 'submitted', version: 1, total_min: 1000, submitted_at: '2026-09-05T23:42:00Z',
  approved_at: null, approved_name: null, rejected_at: null, reject_note: null,
  time: [
    { id: 'a1', job_id: 'j1', arrived_at: '2026-08-25T13:00:00Z', departed_at: '2026-08-25T17:00:00Z', minutes: 240, source: 'geofence', client_key: 'd-1', dest_place: null, job_name: 'Smith kitchen', client_name: 'John Doe', addr: '1 Main St' },
    { id: 'a2', job_id: null, arrived_at: '2026-08-25T12:40:00Z', departed_at: '2026-08-25T13:00:00Z', minutes: 20, source: 'drive', client_key: 'd-2', dest_place: null },
    { id: 'a3', job_id: 'j1', arrived_at: '2026-08-27T13:00:00Z', departed_at: '2026-08-27T21:00:00Z', minutes: 480, source: 'geofence', client_key: 'd-5', dest_place: null, job_name: 'Smith kitchen', client_name: 'John Doe', addr: '1 Main St' },
  ],
  shop: [{ id: 's1', arrived_at: '2026-08-25T12:00:00Z', departed_at: '2026-08-25T12:40:00Z', minutes: 40, client_key: 'd-4' }],
  manual: [{ id: 'm1', date: '2026-08-28', start_time: '2026-08-28T12:00:00Z', end_time: '2026-08-28T20:00:00Z', minutes: 480, logged_by_uid: 'jack', logged_by_name: 'Jack Sample', open: false }],
};

async function openPage(page, data, opts) {
  await mockAllExternal(page);
  await page.addInitScript(({ data, decideFail, noStorage }) => {
    window.__tsp = { data, calls: [], decideFail };
    // A browser that refuses storage (private mode, a locked-down profile).
    // Installed HERE rather than in the test body because _tspDeviceId runs
    // at boot, which is long before a test gets a look in (10.5).
    if (noStorage) {
      const bang = () => { throw new Error('storage is off'); };
      try { Object.defineProperty(window, 'localStorage', { get: bang, configurable: true }); } catch (_e) {}
    }
  }, { data, decideFail: !!(opts && opts.decideFail), noStorage: !!(opts && opts.noStorage) });
  // Registered AFTER mockAllExternal so it wins: the SDK becomes a shim whose
  // rpc answers from window.__tsp.
  await page.route('**/supabase-js@2*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: `
    window.supabase = { createClient: function(){ return { rpc: async function(fn, args){
      window.__tsp.calls.push([fn, args]);
      if (fn === 'timesheet_public') return { data: window.__tsp.data, error: null };
      if (fn === 'timesheet_decide') {
        if (window.__tsp.decideFail) return { data: null, error: { message: 'nope' } };
        var st = args.p_decision === 'approve' ? 'approved' : 'rejected';
        return { data: { status: st, version: 1, approved_at: st === 'approved' ? '2026-09-06T01:10:00Z' : null, rejected_at: st === 'rejected' ? '2026-09-06T01:10:00Z' : null, reject_note: args.p_note }, error: null };
      }
      return { data: null, error: { message: 'unknown rpc ' + fn } };
    } }; } };` }));
  await page.goto('/timesheet.html?t=' + (opts && opts.token !== undefined ? opts.token : 'tok_abc_1234567890'), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('tsp-page') && !document.getElementById('tsp-page').hidden || (document.getElementById('tsp-state') && !document.getElementById('tsp-state').hidden), null, { timeout: 15000 });
}

test.describe('The public timesheet page', () => {
  test.afterEach(async ({ page }) => { await assertNoErrors(page, 'timesheet public'); });

  test('the header: business, Timesheet, the person, the week, the submitted stamp', async ({ page }) => {
    await openPage(page, DATA);
    const r = await page.evaluate(() => ({
      biz: document.querySelector('.tsp-biz').textContent.trim(), eyebrow: document.querySelector('.tsp-eyebrow').textContent.trim(),
      name: document.querySelector('.tsp-name').textContent.trim(), range: document.querySelector('.tsp-range').textContent.trim(),
      chip: document.querySelector('.tsp-chip').textContent.trim(), title: document.title,
      rpc: window.__tsp.calls[0],
    }));
    expect(r.biz).toBe('Sample Plumbing');
    expect(r.eyebrow).toBe('Timesheet');
    expect(r.name).toBe('Jack Sample');
    expect(r.range).toBe('Aug 23 to 29');
    expect(r.chip).toMatch(/^Submitted Sep 5,/);
    expect(r.title).toContain('Jack Sample');
    // p_device joined it 2026-09-19: the link binds to the first device that
    // opens it, and this side's whole job is naming which device is asking.
    expect(r.rpc[0]).toBe('timesheet_public');
    expect(r.rpc[1].p_token).toBe('tok_abc_1234567890');
    expect(r.rpc[1].p_device).toMatch(/^dev_/);
  });

  test('the same week bars the app draws: seven columns, hours on the worked days, a chevron to open them, no Send button, no arrows out of the week', async ({ page }) => {
    await openPage(page, DATA);
    const r = await page.evaluate(() => {
      const wrap = document.querySelector('#tsp-body .tl-wbar-wrap');
      return {
        wrap: !!wrap, cols: document.querySelectorAll('#tsp-body .tl-wbar-col').length,
        hours: [...document.querySelectorAll('#tsp-body .tl-wbar-col')].map(c => c.textContent.replace(/\s+/g, ' ').trim()),
        send: !!document.querySelector('#tsp-body .tl-wbar-share'),
        title: document.querySelector('#tsp-body .tl-monav-lbl').textContent.trim(),
        total: document.querySelector('#tsp-body .tl-monav-tot').textContent.trim(),
        arrowsHidden: [...document.querySelectorAll('#tsp-body .tl-monav-btn')].every(b => getComputedStyle(b).visibility === 'hidden'),
        back: document.querySelector('#tsp-body .tl-drill-back'),
        backHidden: !document.querySelector('#tsp-body .tl-drill-back') || getComputedStyle(document.querySelector('#tsp-body .tl-drill-back')).visibility === 'hidden',
        key: document.querySelector('#tsp-body .tl-rail-legend') && document.querySelector('#tsp-body .tl-rail-legend').textContent,
        under: document.querySelectorAll('#tsp-body .tl-wbar-key').length,
      };
    });
    expect(r.wrap).toBe(true);
    expect(r.cols).toBe(7);
    expect(r.send, 'nothing to send from the boss side').toBe(false);
    expect(r.title).toBe('Week of Aug 23 – 29');
    // 4h + 20m + 40m on Tue, 8h Thu, 8h Fri.
    expect(r.total).toBe('21h');
    expect(r.hours.join(' | ')).toMatch(/5h/);
    expect(r.arrowsHidden).toBe(true);
    expect(r.backHidden).toBe(true);
    // The breakdown the boss opens on. It used to be a colour-only key under
    // the chart; it is now the split bar's legend above it, with the hours on
    // it, which is what the owner asked the shared link for (2026-09-19).
    expect(r.key).toContain('Job site');
    expect(r.key, 'and how long each bucket took, not just its colour').toMatch(/\dh|\dm/);
    expect(r.under, 'one legend, not two').toBe(0);
  });

  test('tap a day: the rail, read only (no Edit), back to the week', async ({ page }) => {
    await openPage(page, DATA);
    await page.evaluate(() => _tlDrillTo('day', '2026-08-25'));
    await page.waitForFunction(() => !!document.querySelector('#tsp-body .tl-rail'));
    const r = await page.evaluate(() => ({
      level: _tlDrill.level,
      title: document.querySelector('#tsp-body .tl-monav-lbl').textContent.trim(),
      rows: [...document.querySelectorAll('#tsp-body .tl-rail li, #tsp-body .tl-rail .tl-rail-row')].length,
      names: document.querySelector('#tsp-body .tl-rail').textContent,
      edit: document.querySelectorAll('#tsp-body .tl-rail-edit').length,
      back: document.querySelector('#tsp-body .tl-drill-back') && document.querySelector('#tsp-body .tl-drill-back').textContent.trim(),
      backVisible: getComputedStyle(document.querySelector('#tsp-body .tl-drill-back')).visibility !== 'hidden',
    }));
    expect(r.level).toBe('day');
    expect(r.title).toBe('Tue, Aug 25');
    expect(r.rows).toBeGreaterThanOrEqual(3);
    expect(r.names).toContain('John Doe');
    expect(r.names).toContain('Sample Plumbing');
    expect(r.edit, 'nothing on the boss side is editable').toBe(0);
    expect(r.back).toBe('‹ Week of Aug 23 – 29');
    expect(r.backVisible).toBe(true);
    await page.evaluate(() => _tlDrillUp());
    await page.waitForFunction(() => !!document.querySelector('#tsp-body .tl-wbar-wrap'));
    expect(await page.evaluate(() => _tlDrill.level)).toBe('week');
  });

  test('the footer: Reject soft grey, Approve dark, Approve at the bottom, and Approve saves through the RPC', async ({ page }) => {
    await openPage(page, DATA);
    const r = await page.evaluate(() => {
      const rj = document.getElementById('tsp-reject'), ap = document.getElementById('tsp-approve');
      const order = rj.compareDocumentPosition(ap) & Node.DOCUMENT_POSITION_FOLLOWING;
      const bg = (el) => getComputedStyle(el).backgroundColor;
      return { rejectText: rj.textContent.trim(), approveText: ap.textContent.trim(), approveBelow: !!order, rejectBg: bg(rj), approveBg: bg(ap),
        fine: document.getElementById('tsp-foot').textContent };
    });
    expect(r.rejectText).toBe('Reject');
    expect(r.approveText).toBe('Approve');
    expect(r.approveBelow).toBe(true);
    expect(r.rejectBg).toBe('rgb(233, 235, 239)');
    expect(r.approveBg).toBe('rgb(27, 22, 18)');
    // No explainer under the buttons (owner: cut it).
    expect(r.fine.replace(/Reject|Approve|What is wrong\?|Cancel|Send back/g, '').trim()).toBe('');
    await page.click('#tsp-approve');
    await page.waitForFunction(() => !!document.querySelector('.tsp-done.ok'));
    const after = await page.evaluate(() => ({ call: window.__tsp.calls.find(c => c[0] === 'timesheet_decide'), done: document.querySelector('.tsp-done.ok').textContent.trim(), chip: document.querySelector('.tsp-chip').textContent.trim(), btns: document.querySelectorAll('#tsp-foot button').length }));
    expect(after.call[1]).toMatchObject({ p_token: 'tok_abc_1234567890', p_decision: 'approve' });
    expect(after.done).toMatch(/^Approved Sep 5,|^Approved Sep 6,/);
    expect(after.chip).toMatch(/^Approved/);
    expect(after.btns).toBe(0);
  });

  test('Reject asks for one line, needs it, and sends it back', async ({ page }) => {
    await openPage(page, DATA);
    await page.click('#tsp-reject');
    const r = await page.evaluate(() => ({ box: !document.getElementById('tsp-reject-box').hidden, hiddenBtns: document.getElementById('tsp-reject').hidden && document.getElementById('tsp-approve').hidden,
      label: document.querySelector('.tsp-label').textContent.trim() }));
    expect(r.box).toBe(true);
    expect(r.hiddenBtns).toBe(true);
    expect(r.label).toBe('What is wrong?');
    // Empty note: nothing sent.
    await page.click('#tsp-reject-go');
    expect(await page.evaluate(() => window.__tsp.calls.filter(c => c[0] === 'timesheet_decide').length)).toBe(0);
    await page.fill('#tsp-note', 'Thursday should be 8, you left at 4');
    await page.click('#tsp-reject-go');
    await page.waitForFunction(() => !!document.querySelector('.tsp-done.back'));
    const after = await page.evaluate(() => ({ call: window.__tsp.calls.find(c => c[0] === 'timesheet_decide'), done: document.querySelector('.tsp-done.back').textContent, chip: document.querySelector('.tsp-chip').textContent.trim() }));
    expect(after.call[1]).toMatchObject({ p_decision: 'reject', p_note: 'Thursday should be 8, you left at 4' });
    expect(after.done).toContain('Sent back');
    expect(after.done).toContain('Thursday should be 8, you left at 4');
    expect(after.chip).toContain('Sent back');
  });

  test('Cancel on the reject box brings the two buttons back', async ({ page }) => {
    await openPage(page, DATA);
    await page.click('#tsp-reject');
    await page.click('#tsp-reject-box .tsp-btn.grey');
    const r = await page.evaluate(() => ({ box: document.getElementById('tsp-reject-box').hidden, rj: document.getElementById('tsp-reject').hidden, ap: document.getElementById('tsp-approve').hidden }));
    expect(r).toEqual({ box: true, rj: false, ap: false });
  });

  test('a decision that fails to save says so and leaves the buttons live', async ({ page }) => {
    await openPage(page, DATA, { decideFail: true });
    await page.click('#tsp-approve');
    await page.waitForFunction(() => !document.getElementById('tsp-err').hidden);
    const r = await page.evaluate(() => ({ err: document.getElementById('tsp-err').textContent, on: !document.getElementById('tsp-approve').disabled, chip: document.querySelector('.tsp-chip').textContent.trim() }));
    expect(r.err).toBe('That did not save, try again');
    expect(r.on).toBe(true);
    expect(r.chip).toMatch(/^Submitted/);
  });

  test('already approved or sent back: the state, no buttons', async ({ page }) => {
    await openPage(page, Object.assign({}, DATA, { status: 'approved', approved_at: '2026-09-06T01:10:00Z' }));
    let r = await page.evaluate(() => ({ btns: document.querySelectorAll('#tsp-foot button').length, done: document.querySelector('.tsp-done').textContent.trim() }));
    expect(r.btns).toBe(0);
    expect(r.done).toMatch(/^Approved/);
    await openPage(page, Object.assign({}, DATA, { status: 'rejected', rejected_at: '2026-09-06T01:10:00Z', reject_note: 'Thursday should be 8' }));
    r = await page.evaluate(() => ({ btns: document.querySelectorAll('#tsp-foot button').length, done: document.querySelector('.tsp-done').textContent, fine: document.querySelector('.tsp-fine').textContent }));
    expect(r.btns).toBe(0);
    expect(r.done).toContain('Thursday should be 8');
    expect(r.fine).toBe('A corrected timesheet will show up at this same link.');
  });

  test('a corrected version says so', async ({ page }) => {
    await openPage(page, Object.assign({}, DATA, { version: 2 }));
    expect(await page.evaluate(() => document.querySelector('.tsp-chip').textContent)).toContain('corrected');
  });

  test('no token, or a token nobody has: a plain state, no page, nothing thrown', async ({ page }) => {
    await openPage(page, null, { token: '' });
    let r = await page.evaluate(() => ({ state: document.getElementById('tsp-state').textContent, page: document.getElementById('tsp-page').hidden, calls: window.__tsp.calls.length }));
    expect(r.state).toContain('This link is not complete');
    expect(r.page).toBe(true);
    expect(r.calls).toBe(0);
    await openPage(page, null, { token: 'tok_gone_1234567890' });
    r = await page.evaluate(() => ({ state: document.getElementById('tsp-state').textContent, page: document.getElementById('tsp-page').hidden }));
    expect(r.state).toContain('This timesheet is not here');
    expect(r.page).toBe(true);
  });

  // ── Read only, and it is a PROPERTY of the page, not a list of stubs ─────
  // Owner 2026-09-05: "the person with the link can update logs." The page was
  // read-only by stubbing the two edit gates, and the gap chips are gated by a
  // different question that answers "mine" for a row carrying no person, which
  // is exactly how an owner's own manual clocks arrive. A day of those offered
  // three live buttons and one tap moved the week from 4h to 7h on screen.
  // THIS week, not the book's. Every other test here is about the chrome and
  // the buttons, so a fixed week is fine for them. This one needs the rail to
  // still be ASKING about the hole, and a hole stops being asked after a week
  // (js/timelog.js, owner 2026-09-05), so a fixture in August would prove the
  // opposite of what it says by the time anyone read it.
  const NOW = new Date();
  const SUN = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - NOW.getDay());
  const D2 = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const THIS_WEEK = D2(SUN);
  const MID = D2(new Date(SUN.getFullYear(), SUN.getMonth(), SUN.getDate() + 2));   // Tuesday
  const CLOCKS_ONLY = Object.assign({}, DATA, {
    week_start: THIS_WEEK, time: [], shop: [],
    manual: [
      { id: 'm1', date: MID, start_time: MID + 'T12:00:00Z', end_time: MID + 'T14:00:00Z', minutes: 120, logged_by_uid: null, logged_by_name: 'Jack Sample', open: false },
      { id: 'm2', date: MID, start_time: MID + 'T17:00:00Z', end_time: MID + 'T19:00:00Z', minutes: 120, logged_by_uid: null, logged_by_name: 'Jack Sample', open: false },
    ],
  });

  test('a day of the owner\'s own clocks offers NO answer buttons, and the hole is still stated', async ({ page }) => {
    await openPage(page, CLOCKS_ONLY);
    await page.evaluate((d) => _tlDrillTo('day', d), MID);
    await page.waitForFunction(() => !!document.querySelector('#tsp-body .tl-rail'));
    const r = await page.evaluate(() => ({
      chips: document.querySelectorAll('#tsp-body .tl-rail-chip').length,
      readOnly: _tlReadOnly(),
      mine: _tlRowIsMine({ personUid: null }),
      asks: document.querySelector('#tsp-body .tl-rail').textContent.includes('What was this time?'),
      says: document.querySelector('#tsp-body .tl-rail-sub') && document.querySelector('#tsp-body .tl-rail-sub').textContent.trim(),
      total: document.querySelector('#tsp-body .tl-monav-tot').textContent.trim(),
    }));
    expect(r.readOnly).toBe(true);
    expect(r.mine, 'a row with nobody on it is not the viewer\'s').toBe(false);
    expect(r.chips, 'nothing on a shared timesheet is answerable').toBe(0);
    expect(r.asks, 'the hole is still shown: it is what the approver needs to see').toBe(true);
    expect(r.says).toBe('Jack has not answered this yet');
    expect(r.total).toBe('4h');
  });

  test('the writer itself refuses on the link page: the total cannot be moved', async ({ page }) => {
    await openPage(page, CLOCKS_ONLY);
    await page.evaluate((d) => _tlDrillTo('day', d), MID);
    await page.waitForFunction(() => !!document.querySelector('#tsp-body .tl-rail'));
    const r = await page.evaluate(async () => {
      const before = { entries: timeEntries.length, total: document.querySelector('#tsp-body .tl-monav-tot').textContent.trim() };
      // Called directly, as any viewer could from a console.
      _tlAddUnaccounted('2026-08-25T14:00:00Z', '2026-08-25T17:00:00Z', 'work');
      _tlAddUnaccounted('2026-08-25T14:00:00Z', '2026-08-25T17:00:00Z', 'personal');
      await _tspRender();
      return { before, entries: timeEntries.length, total: document.querySelector('#tsp-body .tl-monav-tot').textContent.trim() };
    });
    expect(r.entries, 'no row is written').toBe(r.before.entries);
    expect(r.total, 'and the hours on screen do not move').toBe(r.before.total);
  });

  test('every gate answers no, and the only handlers on the page navigate', async ({ page }) => {
    await openPage(page, DATA);
    await page.evaluate(() => _tlDrillTo('day', '2026-08-25'));
    await page.waitForFunction(() => !!document.querySelector('#tsp-body .tl-rail'));
    const r = await page.evaluate(() => ({
      canEdit: _tlCanEdit({ source: 'manual', personUid: null }),
      canFix: _tlCanFixAuto({ source: 'auto', rawId: 1, rawSource: 'geofence', unpaid: false }),
      mine: _tlRowIsMine({ personUid: null }),
      junk: [_tlCanEdit(null), _tlCanFixAuto(null), _tlRowIsMine(null)],
      handlers: [...document.querySelectorAll('#tsp-body [onclick]')].map(e => e.getAttribute('onclick')),
    }));
    expect(r.canEdit).toBe(false);
    expect(r.canFix).toBe(false);
    expect(r.mine).toBe(false);
    expect(r.junk).toEqual([false, false, false]);
    // Navigation only: nothing on the shared page calls a writer.
    r.handlers.forEach((h) => expect(h, h).toMatch(/^_tlDrill(To|Up|Step)\(/));
  });

  // ── The link belongs to the first device that opens it ─────────────────
  //
  // Owner 2026-09-19: "the link that is shared I need some security on it,
  // only the person who receives it can open it, if it's resent again that
  // person can't see it." He picked trust-on-first-use out of three shapes.
  //
  // The DECIDING is the server's (timesheet_claim, migration 20261027, proven
  // in SQL). What is proven here is the only part this file owns: that the
  // page names its device, names the SAME one every time, names it on the
  // approve too, and has something true to say when the answer is no.
  test.describe('one device per link', () => {
    test('every call says which device is asking, and it is one device', async ({ page }) => {
      await openPage(page, DATA);
      await page.evaluate(() => _tspDecide('approve'));
      const r = await page.evaluate(() => ({
        calls: window.__tsp.calls.map(c => [c[0], c[1].p_device]),
        stored: localStorage.getItem('zp3_device_id'),
      }));
      expect(r.calls.length).toBe(2);
      expect(r.calls[0][0]).toBe('timesheet_public');
      expect(r.calls[1][0]).toBe('timesheet_decide');
      // Approving is the part that costs money, so it carries the claim too.
      expect(r.calls[1][1], 'the approve names the device as well').toBe(r.calls[0][1]);
      expect(r.calls[0][1]).toBe(r.stored);
    });

    // The same key js/cloud.js writes (_initDeviceId), on purpose: a boss who
    // also runs TradeDesk on this phone must be ONE device here, not two.
    test('the same phone comes back as the same device, not a new one', async ({ page }) => {
      await openPage(page, DATA);
      const first = await page.evaluate(() => window.__tsp.calls[0][1].p_device);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__tsp && window.__tsp.calls.length > 0);
      const second = await page.evaluate(() => window.__tsp.calls[0][1].p_device);
      expect(second).toBe(first);
    });

    test('refused: the page says what happened and shows nothing of the week', async ({ page }) => {
      await openPage(page, { refused: 'bound' });
      const r = await page.evaluate(() => ({
        title: document.querySelector('.tsp-state-t').textContent.trim(),
        msg: document.querySelector('.tsp-state-m').textContent.trim(),
        pageHidden: document.getElementById('tsp-page').hidden,
        body: (document.getElementById('tsp-body') || {}).innerHTML || '',
      }));
      expect(r.title).toMatch(/already open somewhere else/i);
      // Not "could not load": that is what a bad signal says, and it would
      // send somebody checking their bars over a link working as intended.
      expect(r.title).not.toMatch(/could not load/i);
      expect(r.msg, 'and what to do about it').toMatch(/sent again/i);
      expect(r.pageHidden, 'no hours leak past the refusal').toBe(true);
      expect(r.body).not.toContain('tl-wbar');
    });

    // Private mode, a locked-down profile. The page sends no device, the
    // server serves it only while the sheet is unclaimed, and nobody is
    // locked out of their own timesheet over a browser setting.
    test('a browser with no storage still opens the link', async ({ page }) => {
      await openPage(page, DATA, { noStorage: true });
      const r = await page.evaluate(() => ({
        device: window.__tsp.calls[0][1].p_device,
        shown: !document.getElementById('tsp-page').hidden,
      }));
      expect(r.device).toBe('');
      expect(r.shown).toBe(true);
    });
  });

  // ── The link draws what the app draws, off what the SERVER sends ───────
  //
  // Both of these shipped broken and neither had a failing test, for the same
  // reason: the fixture above used to invent an `employee_user_id` on every
  // row, a field timesheet_public has never returned. The field is gone from
  // it now, so these two run against the shape the server actually sends.
  //
  // Found 2026-09-19 by pointing the real page at real rows in a real
  // Postgres: a week with 13h 30m on it drew 12h 50m of "On site", no
  // Driving, no Shop.
  test.describe('the numbers are the app\'s numbers', () => {
    test('a drive is Driving, not time on site', async ({ page }) => {
      await openPage(page, DATA);
      const r = await page.evaluate(() => ({
        // The four predicates js/timelog.js guards on. All four were absent
        // here, so every guard answered false and every drive fell through to
        // the on-site bucket. js/geo-sources.js owns them now.
        fns: ['_geoIsDriveSource', '_geoIsPlaceSource', '_geoIsHeldSource', '_geoIsOffJobSource']
               .map(n => typeof window[n]),
        legend: (document.querySelector('#tsp-body .tl-rail-legend') || {}).textContent || '',
      }));
      expect(r.fns, 'all four resolve on the shared page').toEqual(['function', 'function', 'function', 'function']);
      expect(r.legend).toContain('Driving');
      expect(r.legend).toMatch(/Driving\s*20m/);
    });

    test('shop time is on the sheet, not dropped on the floor', async ({ page }) => {
      await openPage(page, DATA);
      const r = await page.evaluate(() => ({
        legend: (document.querySelector('#tsp-body .tl-rail-legend') || {}).textContent || '',
        total: document.querySelector('#tsp-body .tl-monav-tot').textContent.trim(),
      }));
      // js/timelog.js drops any shop row with no employee on it, and the RPC
      // sends none. 40m of shop time left the sheet without a word.
      expect(r.legend).toMatch(/Shop\s*40m/);
      // 240 + 20 + 480 derived, 40 in the shop, 480 manual: 21h exactly, the
      // same number this file has asserted since the page shipped. Without
      // the shop row it is 20h 20m, and nothing on the page would say why.
      expect(r.total).toBe('21h');
    });
  });

  // ── A FULL DAY, EVERY BUCKET (owner 2026-09-19) ────────────────────────
  //
  // "It needs to show all the breakdowns, on site, drive times particularly
  // supply house, all that." A load at the yard, out to the job, over to the
  // supply house, back, and home: the shape of an actual day rather than the
  // two rows the fixture above carries.
  const FULL = Object.assign({}, DATA, {
    time: [
      { job_id: null, arrived_at: '2026-08-25T12:10:00Z', departed_at: '2026-08-25T12:35:00Z', minutes: 25, source: 'place-load',   client_key: 'p1', origin_place: null,               dest_place: 'TradeDesk yard' },
      { job_id: null, arrived_at: '2026-08-25T12:35:00Z', departed_at: '2026-08-25T13:02:00Z', minutes: 27, source: 'drive',        client_key: 'p2', origin_place: 'TradeDesk yard',    dest_place: 'John Doe' },
      { job_id: 'j1', arrived_at: '2026-08-25T13:02:00Z', departed_at: '2026-08-25T16:30:00Z', minutes: 208, source: 'geofence',    client_key: 'p3', origin_place: null,               dest_place: null, job_name: 'Smith kitchen', client_name: 'John Doe', addr: '1 Main St' },
      { job_id: null, arrived_at: '2026-08-25T16:30:00Z', departed_at: '2026-08-25T16:48:00Z', minutes: 18, source: 'drive',        client_key: 'p4', origin_place: 'John Doe',          dest_place: 'Ferguson Plumbing Supply' },
      { job_id: null, arrived_at: '2026-08-25T16:48:00Z', departed_at: '2026-08-25T17:14:00Z', minutes: 26, source: 'place-supply', client_key: 'p5', origin_place: null,               dest_place: 'Ferguson Plumbing Supply' },
      { job_id: null, arrived_at: '2026-08-25T17:14:00Z', departed_at: '2026-08-25T17:35:00Z', minutes: 21, source: 'drive',        client_key: 'p6', origin_place: 'Ferguson Plumbing Supply', dest_place: 'John Doe' },
    ],
    shop: [{ arrived_at: '2026-08-27T13:00:00Z', departed_at: '2026-08-27T14:35:00Z', minutes: 95, client_key: 's1' }],
    manual: [{ id: 'm1', date: '2026-08-27', start_time: '2026-08-27T14:35:00Z', end_time: '2026-08-27T20:05:00Z', minutes: 330, open: false }],
  });

  // ── THE CLOCK IS THE BRACKET HERE TOO (owner 2026-09-21) ───────────────
  //
  // "On the link Jack sent his dad it looks like manual time double counted,
  // why? It didn't on Jack's record."
  //
  // His week of 13-19 September, measured on both screens: the app said
  // 42h 27m with 1m of Manual time, the link said 80h 10m with 37h 37m. The
  // automatic buckets agreed almost to the minute, so the whole 37-hour gap
  // was one clock counted twice.
  //
  // _tlBlendManual buckets by `personUid||acting uid` and returns early from
  // a bucket with no clock in it. The derived rows are stamped _TSP_UID
  // because the RPC sends no employee_user_id; the clocks were pushed raw,
  // carrying the real logged_by_uid the server DOES send. Two buckets, no
  // blend.
  //
  // WHY EVERY FIXTURE ABOVE MISSED IT, which is the more useful half: not one
  // of them puts a clock and a derived row on the SAME DAY. DATA clocks
  // 08-28 and derives 08-25 and 08-27; FULL clocks 08-27 14:35 and puts the
  // shop row before it, touching but never overlapping. A blend with nothing
  // to absorb cannot tell you whether it ran. These two days overlap on
  // purpose.
  const BLEND = Object.assign({}, DATA, {
    time: [
      // Inside the clock below: 8:00 to 8:20 and 8:20 to 12:20 Central.
      { id: 'b1', job_id: null, arrived_at: '2026-08-26T13:00:00Z', departed_at: '2026-08-26T13:20:00Z', minutes: 20, source: 'drive', client_key: 'b-1', origin_place: 'TradeDesk yard', dest_place: 'John Doe' },
      { id: 'b2', job_id: 'j1', arrived_at: '2026-08-26T13:20:00Z', departed_at: '2026-08-26T17:20:00Z', minutes: 240, source: 'geofence', client_key: 'b-2', dest_place: null, job_name: 'Smith kitchen', client_name: 'John Doe', addr: '1 Main St' },
    ],
    shop: [],
    // 8:00 to 4:00 Central, 480 minutes, holding all 260 above. The uid is the
    // REAL one the server sends for a crew member, which is the whole point:
    // a fixture that stamps _TSP_UID itself would agree with the code instead
    // of testing it, exactly like the shop fixture that invented
    // employee_user_id and hid the missing shop time for a week.
    manual: [{ id: 'mb', date: '2026-08-26', start_time: '2026-08-26T13:00:00Z', end_time: '2026-08-26T21:00:00Z', minutes: 480, logged_by_uid: 'jack-real-uuid', logged_by_name: 'Jack Sample', open: false }],
  });

  test.describe('a clock over a derived day is not counted twice', () => {
    test('the boss sees the same day the crew member does', async ({ page }) => {
      await openPage(page, BLEND);
      const r = await page.evaluate(() => ({
        legend: [...document.querySelectorAll('#tsp-body .tl-rail-legend .tl-rail-leg')]
                  .map(e => e.textContent.replace(/\s+/g, ' ').trim()),
        total: document.querySelector('#tsp-body .tl-monav-tot').textContent.trim(),
      }));
      const leg = r.legend.join(' | ');
      // 480 clocked minutes holding 260 derived ones is EIGHT HOURS, not
      // twelve hours twenty. Twelve twenty is the bug, and it is the shape
      // the owner was looking at.
      expect(r.total, 'the clock is the bracket, not an extra shift: ' + leg).toBe('8h');
      // And the day is still broken down, not flattened into one block: the
      // drive keeps its own colour and the site time keeps its own.
      expect(leg).toMatch(/Driving\s*20m/);
      expect(leg).toMatch(/Job site\s*4h/);
      // The 220 minutes the clock covers and nothing tracked stay GREY. They
      // become a row reading "Clocked in, nothing tracked" (_tlBlendManual),
      // which _tlRailKind has always called Manual time because it has no
      // address and never had one. The week aggregator had no arm for it and
      // was billing it as on-site job labour, so the rail drew it grey and
      // the bar above drew the same minutes blue: fixed alongside this.
      expect(leg).toMatch(/Manual time\s*3h\s*40m/);
    });

    test("an owner's own sheet blends too, though the server sends no uid", async ({ page }) => {
      // The same bug wearing the other hat. An owner's clocks come back with
      // logged_by_uid null, which falls through to the acting uid, and this
      // page has no session at all so that is the string 'owner'. Two buckets
      // again, and nothing on the page to hint at it.
      const OWN = Object.assign({}, BLEND, {
        manual: [Object.assign({}, BLEND.manual[0], { logged_by_uid: null, logged_by_name: null })],
      });
      await openPage(page, OWN);
      const total = await page.evaluate(() =>
        document.querySelector('#tsp-body .tl-monav-tot').textContent.trim());
      expect(total).toBe('8h');
    });
  });

  test.describe('a full day, every breakdown', () => {
    test('the week names every bucket the day spent time in', async ({ page }) => {
      await openPage(page, FULL);
      const r = await page.evaluate(() => ({
        legend: [...document.querySelectorAll('#tsp-body .tl-rail-legend .tl-rail-leg')]
                  .map(e => e.textContent.replace(/\s+/g, ' ').trim()),
      }));
      // Not a list of strings this file made up: the app's own bucket table,
      // so a renamed or added bucket comes through here without an edit.
      const want = ['Job site', 'Shop', 'Driving', 'Loading', 'Supply', 'Manual time'];
      want.forEach((w) => expect(r.legend.some(l => l.startsWith(w)), w + ' is on the week').toBe(true));
      expect(r.legend.find(l => l.startsWith('Supply'))).toMatch(/26m/);
      expect(r.legend.find(l => l.startsWith('Loading'))).toMatch(/25m/);
    });

    test('a drive says where it started and where it ended', async ({ page }) => {
      await openPage(page, FULL);
      await page.evaluate(() => _tlDrillTo('day', '2026-08-25'));
      await page.waitForFunction(() => !!document.querySelector('#tsp-body .tl-rail'));
      const rows = await page.evaluate(() => [...document.querySelectorAll('#tsp-body .tl-rail-row')]
        .map(r => r.textContent.replace(/\s+/g, ' ').trim()));
      const txt = rows.join(' | ');
      // timesheet_public sent dest_place and never origin_place, so every
      // drive on a shared sheet could only name the far end (migration
      // 20261027). The app has titled them with both since 2026-09-15.
      expect(txt).toContain('TradeDesk yard \u2192 John Doe');
      expect(txt).toContain('John Doe \u2192 Ferguson Plumbing Supply');
      expect(txt).toContain('Ferguson Plumbing Supply \u2192 John Doe');
      expect(txt, 'and the supply stop is named as a supply stop').toMatch(/SUPPLY HOUSE/i);
      expect(txt, 'never the not-saved fallback when both ends are known')
        .not.toContain('Destination not saved');
    });
  });

  test('layout (§15.3): no bleed, no overlapping controls at 320px and 390px', async ({ page }) => {
    for (const w of [320, 390]) {
      await page.setViewportSize({ width: w, height: 800 });
      await openPage(page, DATA);
      const r = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => b.getBoundingClientRect());
        let overlap = false;
        for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
          const a = btns[i], b = btns[j];
          if (a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap = true;
        }
        return { bleed: document.documentElement.scrollWidth > window.innerWidth + 1, overlap };
      });
      expect(r.bleed, w + 'px bleeds').toBe(false);
      expect(r.overlap, w + 'px overlaps').toBe(false);
    }
  });

  // Owner 2026-09-26: a crew member's dad, on a small phone, could not read it
  // and never guessed the bars opened. The hint says it in words, the rail
  // says Job site, and the week title keeps its end date at 320px.
  test('small phone: the tap hint is there in words, Job site, the week title is whole', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openPage(page, DATA);
    await page.waitForFunction(() => !!document.querySelector('#tsp-body .tl-wbar-wrap'));
    const r = await page.evaluate(() => {
      const tip = document.querySelector('#tsp-body .tl-wbar-tip');
      const lbl = document.querySelector('#tsp-body .tl-monav-lbl');
      const tr = tip && tip.getBoundingClientRect();
      return {
        tip: tip && tip.textContent.trim(),
        tipFont: tip && parseFloat(getComputedStyle(tip).fontSize),
        tipIn: !!tr && tr.left >= 0 && tr.right <= innerWidth,
        clipped: lbl.scrollWidth > lbl.clientWidth + 1,
        lbl: lbl.textContent.trim(),
        key: document.querySelector('#tsp-body').textContent,
        bleed: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    expect(r.tip).toBe('Tap a day to see every stop');
    expect(r.tipFont, 'an instruction, readable at arm\'s length').toBeGreaterThanOrEqual(13);
    expect(r.tipIn).toBe(true);
    expect(r.lbl).toBe('Week of Aug 23 – 29');
    expect(r.clipped, 'the week title wraps, never cut to an ellipsis').toBe(false);
    expect(r.key).toContain('Job site');
    expect(r.key).not.toContain('On site');
    expect(r.bleed).toBe(false);
    // On the day there is nothing left to tap into, so no hint promising one.
    await page.evaluate(() => _tlDrillTo('day', '2026-08-25'));
    await page.waitForFunction(() => !!document.querySelector('#tsp-body .tl-rail'));
    const d = await page.evaluate(() => ({
      tip: document.querySelectorAll('#tsp-body .tl-wbar-tip').length,
      rail: document.querySelector('#tsp-body .tl-rail').textContent,
    }));
    expect(d.tip).toBe(0);
    // Big enough to read at arm's length (owner 2026-09-26: "he can't read it").
    const f = await page.evaluate(() => {
      const px = (sel) => parseFloat(getComputedStyle(document.querySelector('#tsp-body ' + sel)).fontSize);
      return { time: px('.tl-rail-time'), ttl: px('.tl-rail-ttl'), sub: px('.tl-rail-sub'), dur: px('.tl-rail-dur'), leg: px('.tl-rail-leg'),
        range: parseFloat(getComputedStyle(document.querySelector('.tsp-range')).fontSize),
        chipBelow: document.querySelector('.tsp-chip').getBoundingClientRect().top >= document.querySelector('.tsp-range').getBoundingClientRect().bottom - 1 };
    });
    expect(f.time).toBeGreaterThanOrEqual(14);
    expect(f.sub).toBeGreaterThanOrEqual(14);
    expect(f.leg).toBeGreaterThanOrEqual(14);
    expect(f.range).toBeGreaterThanOrEqual(15);
    expect(f.ttl).toBeGreaterThanOrEqual(16);
    expect(f.dur).toBeGreaterThanOrEqual(16);
    expect(f.chipBelow, 'at 320px the stamp drops under the dates instead of squeezing them').toBe(true);
    expect(d.rail).toContain('Job site');
    expect(d.rail).not.toContain('On site');
  });

  test('no hint when no column opens, so it never promises a tap that does nothing', async ({ page }) => {
    await openPage(page, DATA);
    const r = await page.evaluate(() => {
      const d = document.createElement('div');
      const rows = [{ date: '2026-08-25', minutes: 60, source: 'geofence' }];
      d.innerHTML = _tlBarsHtml([{ key: 'a', label: 'T', rows }], { level: 'week', tip: 'Tap a day to see every stop', key: false });
      const e = document.createElement('div');
      e.innerHTML = _tlBarsHtml([{ key: 'a', label: 'T', rows, onclick: 'void 0' }], { level: 'week', tip: 'Tap a day to see every stop', key: false });
      return { noClick: d.querySelectorAll('.tl-wbar-tip').length, withClick: e.querySelectorAll('.tl-wbar-tip').length };
    });
    expect(r.noClick).toBe(0);
    expect(r.withClick).toBe(1);
  });
});
