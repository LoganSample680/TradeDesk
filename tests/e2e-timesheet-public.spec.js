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
    { id: 'a1', employee_user_id: 'jack', job_id: 'j1', arrived_at: '2026-08-25T13:00:00Z', departed_at: '2026-08-25T17:00:00Z', minutes: 240, source: 'geofence', client_key: 'd-1', dest_place: null, job_name: 'Smith kitchen', client_name: 'John Doe', addr: '1 Main St' },
    { id: 'a2', employee_user_id: 'jack', job_id: null, arrived_at: '2026-08-25T12:40:00Z', departed_at: '2026-08-25T13:00:00Z', minutes: 20, source: 'drive', client_key: 'd-2', dest_place: null },
    { id: 'a3', employee_user_id: 'jack', job_id: 'j1', arrived_at: '2026-08-27T13:00:00Z', departed_at: '2026-08-27T21:00:00Z', minutes: 480, source: 'geofence', client_key: 'd-5', dest_place: null, job_name: 'Smith kitchen', client_name: 'John Doe', addr: '1 Main St' },
  ],
  shop: [{ id: 's1', employee_user_id: 'jack', arrived_at: '2026-08-25T12:00:00Z', departed_at: '2026-08-25T12:40:00Z', minutes: 40, client_key: 'd-4' }],
  manual: [{ id: 'm1', date: '2026-08-28', start_time: '2026-08-28T12:00:00Z', end_time: '2026-08-28T20:00:00Z', minutes: 480, logged_by_uid: 'jack', logged_by_name: 'Jack Sample', open: false }],
};

async function openPage(page, data, opts) {
  await mockAllExternal(page);
  await page.addInitScript(({ data, decideFail }) => {
    window.__tsp = { data, calls: [], decideFail };
  }, { data, decideFail: !!(opts && opts.decideFail) });
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
    expect(r.rpc).toEqual(['timesheet_public', { p_token: 'tok_abc_1234567890' }]);
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
        key: document.querySelector('#tsp-body .tl-wbar-key') && document.querySelector('#tsp-body .tl-wbar-key').textContent,
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
    expect(r.key).toContain('On site');
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
});
