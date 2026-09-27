// @ts-check
// ── Earl on setup, team, photos and Tim (audit 2026-09-27) ──────────────────
//
// Earl is a 58-year-old plumber on an iPhone SE (375x667). The owner said
// "unleash Earl on the entire app", and these are the things he tripped on in
// setup, the crew screens, TrueShot and Tim. Every test here pins what he
// should have got, at his screen size, with his thumb (44px or it misses).
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SE = { width: 375, height: 667 };

async function boot(browser) {
  const ctx = await browser.newContext({ viewport: SE, bypassCSP: true });
  const page = await ctx.newPage();
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await waitForAppBoot(page);
  // A reconnect load replaces photos wholesale; none of this is about sync.
  await page.evaluate(() => { window.supaLoadFromCloud = async () => { }; });
  return page;
}
// Every box that has to take a thumb, measured on the real layout.
// Measured after every running animation settles: a sheet's entrance scale
// (and the permissions accordion) shrinks every box a pixel while it runs,
// and WebKit is slow enough in CI to be caught mid-animation (43px, 2026-09-27).
const tooSmall = async (page, sel) => {
  await page.waitForFunction(() => !document.getAnimations || document.getAnimations().every(a => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {});
  return tooSmallNow(page, sel);
};
const tooSmallNow = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)]
  .filter(el => el.offsetParent !== null)
  .map(el => { const r = el.getBoundingClientRect(); return { t: (el.textContent || el.id || el.className || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
  .filter(r => r.w < 44 || r.h < 44), sel);

// ── 1 and 11: TrueShot ───────────────────────────────────────────────────────
test.describe('TrueShot: Done waits for the last shot, and never asks a question it knows', () => {
  let page;
  test.beforeAll(async ({ browser }) => { page = await boot(browser); });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => {
    await page.evaluate(() => {
      try { tdAttachCancel(); tdReviewClose(); } catch (e) {}
      document.querySelectorAll('.zmodal-overlay,#pc-sheet').forEach(x => x.remove());
      clients.length = 0; bids.length = 0; jobs.length = 0; photos.length = 0;
    });
  });

  test('five fast shots then Done: the review holds all five, even with the last still saving', async () => {
    const r = await page.evaluate(async (b64) => {
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = () => new File([arr], 'shot.png', { type: 'image/png' });
      tdCaptureUnfiled();
      for (let i = 0; i < 4; i++) await _pcTrack(_pcCommit(file()));
      // The fifth save is slow, the way a 12MP encode and outbox write are.
      const put = window._pcOutboxPut;
      window._pcOutboxPut = async (row, f) => { await new Promise(res => setTimeout(res, 400)); return put(row, f); };
      _pcTrack(_pcCommit(file()));
      const closing = tdCloseCapture();                 // Done, mid-save
      const sheetGoneAtOnce = !document.getElementById('pc-sheet');
      const reviewBeforeSave = !!document.getElementById('pc-rev');
      await closing;
      window._pcOutboxPut = put;
      return {
        waited: closing instanceof Promise, sheetGoneAtOnce, reviewBeforeSave,
        cells: document.querySelectorAll('#pc-rev .pc-rev-cell').length,
        title: (document.querySelector('#pc-rev .pc-rev-title') || {}).textContent,
        unfiled: tdUnfiledPhotos().length, inflight: _pcInflight.size,
      };
    }, PNG_B64);
    expect(r.waited, 'Done hands back a promise while a shot is in flight').toBe(true);
    expect(r.sheetGoneAtOnce, 'the camera closes the moment Done is tapped').toBe(true);
    expect(r.reviewBeforeSave, 'the review does not open on a short list').toBe(false);
    expect(r.cells).toBe(5);
    expect(r.title).toBe('5 photos');
    expect(r.unfiled).toBe(5);
    expect(r.inflight).toBe(0);
  });

  test('Done with nothing in flight still closes synchronously, exactly as before', async () => {
    const r = await page.evaluate(() => {
      tdCaptureUnfiled();
      const ret = tdCloseCapture();
      return { ret: ret === undefined, sheet: !!document.getElementById('pc-sheet'), ctx: _pcCtx === null };
    });
    expect(r).toEqual({ ret: true, sheet: false, ctx: true });
  });

  test('a failed save in flight never jams Done', async () => {
    const r = await page.evaluate(async () => {
      tdCaptureUnfiled();
      _pcTrack(Promise.reject(new Error('disk full')));
      await tdCloseCapture();
      return { sheet: !!document.getElementById('pc-sheet'), ctx: _pcCtx === null, inflight: _pcInflight.size };
    });
    expect(r).toEqual({ sheet: false, ctx: true, inflight: 0 });
  });

  const seedOne = (lat, lon, accM, addr, pinned) => page.evaluate(([lat, lon, accM, addr, pinned]) => {
    const c = { id: 501, name: 'Dana Whitfield', addr, extraAddresses: [] };
    if (pinned) { c.lat = 37.6889; c.lon = -97.3361; }
    clients.push(c);
    photos.push({ id: 980, type: 'before', url: '', data: 'x', client_id: null, lat, lon, accM, uploadedAt: '2026-09-27T15:00:00.000Z' });
    window._reverseGeocode = async () => ({ street: '1414 Oak Ridge Drive', city: 'Wichita', state: 'KS', zip: '67202', addr: '1414 Oak Ridge Drive, Wichita, KS 67202' });
    window._countyProperty = async () => null;
    tdReviewShots([980]); tdReviewAttach();
    return true;
  }, [lat, lon, accM, addr, pinned]);

  test('one house on file, GPS naming the neighbour: no "Which property?", filed to his house', async () => {
    await seedOne(37.689, -97.336, 30, '1412 Oak Ridge Dr, Wichita, KS 67202', false);
    await page.locator('#pc-att-new-sub').filter({ hasText: '1414' }).waitFor();
    const r = await page.evaluate(() => {
      tdAttachPick(501);
      return { asked: !!document.getElementById('_addrpick-ov'), filed: photos.filter(p => p.client_id === 501).map(p => p.addr) };
    });
    expect(r.asked).toBe(false);
    expect(r.filed).toEqual(['1412 Oak Ridge Dr, Wichita, KS 67202']);
  });

  test('a pinned house and an indoor fix a little past the radius: his stated accuracy is slack, not a question', async () => {
    // ~330m from the pin with a 120m accuracy: outside 250m, inside 250+120.
    await seedOne(37.6919, -97.3361, 120, '1412 Oak Ridge Dr, Wichita, KS 67202', true);
    const r = await page.evaluate(() => {
      tdAttachPick(501);
      return { asked: !!document.getElementById('_addrpick-ov'), filed: photos.filter(p => p.client_id === 501).length };
    });
    expect(r.asked).toBe(false);
    expect(r.filed).toBe(1);
  });

  test('Before, Progress and After are 44px targets on an SE', async () => {
    await page.evaluate(() => tdCaptureUnfiled());
    expect(await tooSmall(page, '#pc-sheet .pc-seg-btn')).toEqual([]);
    await page.evaluate(() => tdCloseCapture());
  });

  test('the camera toggles say what they do, not how', async () => {
    const r = await page.evaluate(() => {
      tdCaptureUnfiled();
      const out = { stamp: document.getElementById('pc-stamp-label').textContent, ghost: document.getElementById('pc-ghost-btn').textContent };
      tdCloseCapture();
      return out;
    });
    expect(r.stamp).toBe('Date on photo');
    expect(r.ghost).toBe('Hide Before');
    expect(`${r.stamp} ${r.ghost}`).not.toMatch(/Stamp|Ghost/);
  });

  assertNoErrors(() => page);
});

// ── 2, 3, 6, 7, 9, 10, 12: the crew ─────────────────────────────────────────
test.describe('Add your crew: the right form, one form, honest status', () => {
  let page;
  test.beforeAll(async ({ browser }) => { page = await boot(browser); });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => {
    await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay,#setup-team-chooser').forEach(x => x.remove());
      S.employees = []; S.subcontractors = []; S.payrollPromptSeen = false;
      _teamJoined = {}; _crewAddFromSetup = false;
      goPg('pg-dash');
    });
  });

  test('the old "Add Team Member" form is gone, with every door to it (7.1)', async () => {
    const r = await page.evaluate(() => ({
      invite: typeof openInviteEmployeeModal, submit: typeof _submitInviteEmployee,
      copy: typeof _copyInviteLink, info: typeof _togglePermInfo,
      route: String(_setupTeamRoute).includes('openInviteEmployeeModal'),
    }));
    expect(r).toEqual({ invite: 'undefined', submit: 'undefined', copy: 'undefined', info: 'undefined', route: false });
    await page.evaluate(() => { _setupTeamRoute('w2'); _setupTeamRoute('1099'); });
    await expect(page.locator('#_emp-invite-ov')).toHaveCount(0);
    await expect(page.locator('#_inv-name')).toHaveCount(0);
  });

  test('1099 sub opens the SUB form, and Cancel leaves him on the dashboard', async () => {
    const spied = await page.evaluate(() => {
      window.__setDetail = [];
      const orig = window._openSetDetail;
      window._openSetDetail = (k) => { window.__setDetail.push(k); };
      _setupTodoGo('team');
      [...document.querySelectorAll('#setup-team-chooser button')].find(b => /1099/.test(b.textContent)).click();
      window._openSetDetail = orig;
      return window.__setDetail;
    });
    expect(spied).toEqual([]);
    await expect(page.locator('#_sub-modal-ov')).toHaveCount(1);
    await expect(page.locator('#emp-modal-overlay')).toHaveCount(0);
    await page.locator('#_sub-modal-ov button', { hasText: 'Cancel' }).click();
    const r = await page.evaluate(() => ({ pg: document.querySelector('.pg.active').id, modals: document.querySelectorAll('.zmodal-overlay').length }));
    expect(r).toEqual({ pg: 'pg-dash', modals: 0 });
  });

  test('W-2 opens the employee form; saving lands on Fleet & Team, on the Team tab, with him in it', async () => {
    await page.evaluate(() => {
      window._showPayrollSetupPrompt = () => { };
      _setupTodoGo('team');
      [...document.querySelectorAll('#setup-team-chooser button')].find(b => /W-2/.test(b.textContent)).click();
    });
    await expect(page.locator('#emp-modal-overlay')).toHaveCount(1);
    await expect(page.locator('#_sub-modal-ov')).toHaveCount(0);
    await page.locator('#emp-name').pressSequentially('Rudy Plumb');
    await page.locator('#emp-modal-overlay button', { hasText: 'Add & Invite' }).click();
    const r = await page.evaluate(() => ({
      pg: document.querySelector('.pg.active').id,
      team: document.getElementById('ft-team').style.display !== 'none',
      fleet: document.getElementById('ft-fleet').style.display !== 'none',
      listed: document.getElementById('team-page-list').textContent.includes('Rudy Plumb'),
    }));
    expect(r).toEqual({ pg: 'pg-team', team: true, fleet: false, listed: true });
  });

  test('an add from anywhere else does not inherit the setup trip', async () => {
    await page.evaluate(() => {
      window._showPayrollSetupPrompt = () => { };
      _setupTeamRoute('w2');
      document.getElementById('emp-modal-overlay').remove();   // walked away
      openAddEmployeeModal();                                  // later, some other door
      document.getElementById('emp-name').value = 'Later Hire';
    });
    await page.evaluate(() => _saveEmployee(null));
    expect(await page.evaluate(() => document.querySelector('.pg.active').id)).toBe('pg-dash');
  });

  test('Fleet & Team opens on Team for a business with crew, on Fleet for a solo shop', async () => {
    const r = await page.evaluate(() => {
      S.employees = []; S.subcontractors = [];
      goPg('pg-team'); const solo = document.getElementById('ft-fleet').style.display !== 'none';
      goPg('pg-dash');
      S.subcontractors = [{ id: 1, name: 'Mike Garcia' }];
      goPg('pg-team');
      const crew = document.getElementById('ft-team').style.display !== 'none';
      const btn = document.getElementById('team-add-btn').style.display !== 'none';
      goPg('pg-dash');
      return { solo, crew, btn };
    });
    expect(r).toEqual({ solo: true, crew: true, btn: true });
  });

  test('the paperwork checklist pops ONCE per business, not once per hire', async () => {
    const r = await page.evaluate(async () => {
      let pops = 0; const toasts = [];
      const origP = window._showPayrollSetupPrompt, origT = window.showToast;
      window._showPayrollSetupPrompt = () => { pops++; };
      window.showToast = (m) => { toasts.push(m); };
      for (const n of ['Hire One', 'Hire Two', 'Hire Three']) {
        openAddEmployeeModal();
        document.getElementById('emp-name').value = n;
        document.getElementById('emp-email').value = n.replace(' ', '.').toLowerCase() + '@x.com';
        await _saveEmployee(null);
      }
      window._showPayrollSetupPrompt = origP; window.showToast = origT;
      return { pops, seen: S.payrollPromptSeen, pointers: toasts.filter(t => /paperwork/i.test(t)).length };
    });
    expect(r.pops).toBe(1);
    expect(r.seen).toBe(true);
    expect(r.pointers).toBe(2);
  });

  test('no email: he is told they cannot log in until he adds one or texts the invite', async () => {
    const toasts = await page.evaluate(async () => {
      const t = []; const orig = window.showToast;
      window.showToast = (m) => { t.push(m); };
      S.payrollPromptSeen = true;
      openAddEmployeeModal();
      document.getElementById('emp-name').value = 'Nomail Ned';
      await _saveEmployee(null);
      window.showToast = orig;
      return t;
    });
    expect(toasts.some(t => t === 'No email: Nomail can\'t log in until you add one or text them the invite')).toBe(true);
  });

  test('the Team list says the truth: joined, invite sent, not sent', async () => {
    const r = await page.evaluate(() => {
      S.employees = [
        { id: 1, name: 'Joined Jo', email: 'jo@x.com', role: 'tech', inviteState: 'sent' },
        { id: 2, name: 'Sent Sam', email: 'sam@x.com', role: 'tech', inviteState: 'sent' },
        { id: 3, name: 'Failed Fay', email: 'fay@x.com', role: 'tech', inviteState: 'failed' },
        { id: 4, name: 'Nomail Ned', email: '', role: 'tech', inviteState: 'none' },
        { id: 5, name: 'Old Otto', email: 'otto@x.com', role: 'tech' },
      ];
      _teamJoined = { 'jo@x.com': true };
      goPg('pg-team'); setFleetTab('team');
      const rows = [...document.querySelectorAll('#team-page-list .td-crew-status')].map(s => s.textContent);
      const texts = document.querySelectorAll('#team-page-list .td-crew-text').length;
      const green = [...document.querySelectorAll('#team-page-list .td-crew-status')].filter(s => s.textContent === 'Invite sent' && /dcfce7/i.test(s.getAttribute('style'))).length;
      return { rows, texts, green };
    });
    expect(r.rows).toEqual(['Joined', 'Invite sent', 'Invite not sent', 'Not sent: no email', 'Not joined yet']);
    expect(r.texts, 'everyone who has not joined gets Text invite').toBe(4);
    expect(r.green, 'an unconfirmed invite is never painted green').toBe(0);
    expect(await tooSmall(page, '#team-page-list .td-crew-text')).toEqual([]);
  });

  test('Text invite opens his Messages with the crew invite link in it', async () => {
    const r = await page.evaluate(() => {
      S.employees = [{ id: 77, name: 'Rudy Plumb', phone: '316-555-0101', email: '', role: 'tech', inviteState: 'none' }];
      goPg('pg-team'); setFleetTab('team');
      let href = '';
      const orig = window._subInviteNavigate;
      window._subInviteNavigate = (h) => { href = h; };
      document.querySelector('#team-page-list .td-crew-text').click();
      window._subInviteNavigate = orig;
      const body = decodeURIComponent(href.split('&body=')[1] || '');
      const inv = JSON.parse(atob(body.split('emp_invite=')[1] || 'e30='));
      return { to: href.split('&')[0], hi: body.startsWith('Hi Rudy'), eid: inv.eid, bad: _crewTextInvite(99) };
    });
    expect(r.to).toBe('sms:3165550101');
    expect(r.hi).toBe(true);
    expect(r.eid).toBe(77);
    expect(r.bad).toBe(false);
  });

  test('a failed send is recorded as failed, never as sent', async () => {
    const r = await page.evaluate(async () => {
      const saved = { supa: window._supa, user: window._supaUser };
      window._showPayrollSetupPrompt = () => { };
      window._supa = { from: () => ({ upsert: async () => ({ error: { message: 'offline' } }) }), auth: { getSession: async () => ({ data: { session: null } }) } };
      window._supaUser = { id: 'u1', email: 'boss@x.com' };
      openAddEmployeeModal();
      document.getElementById('emp-name').value = 'Fail Fred';
      document.getElementById('emp-email').value = 'fred@x.com';
      await _saveEmployee(null);
      window._supa = saved.supa; window._supaUser = saved.user;
      return S.employees.find(e => e.name === 'Fail Fred').inviteState;
    });
    expect(r).toBe('failed');
  });

  test('the employee form: plain labels and 44px targets on an SE', async () => {
    await page.evaluate(() => { openAddEmployeeModal(); _togglePermsAccordion(document.querySelector('#emp-modal-overlay .perms-chev').parentElement); });
    await page.waitForTimeout(250);
    const labels = await page.evaluate(() => [...document.querySelectorAll('#emp-modal-overlay label')].map(l => l.textContent.trim()));
    expect(labels).toContain('What they can see');
    expect(labels).toContain('Skill level');
    expect(labels.join('|')).not.toMatch(/Access role|Classification/);
    expect(await tooSmall(page, '#emp-modal-overlay .perms-acc label, #emp-modal-overlay .td-hit44')).toEqual([]);
    const cancel = await page.locator('#emp-modal-overlay button', { hasText: 'Cancel' }).boundingBox();
    expect(cancel.height).toBeGreaterThanOrEqual(44);
    // Tapping the row, not the box, flips the permission.
    const before = await page.evaluate(() => document.getElementById('_perm-leads').checked);
    await page.locator('#emp-modal-overlay .perms-acc label', { hasText: 'Work leads' }).click({ position: { x: 120, y: 20 } });
    expect(await page.evaluate(() => document.getElementById('_perm-leads').checked)).toBe(!before);
    await page.evaluate(() => document.getElementById('emp-modal-overlay').remove());
  });

  assertNoErrors(() => page);
});

// ── 5, 8, 12: the dashboard on an SE ─────────────────────────────────────────
test.describe('Dashboard on an SE: short checklist, location once, thumb-sized', () => {
  let page;
  test.beforeAll(async ({ browser }) => { page = await boot(browser); });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => {
    await page.evaluate(() => {
      S.setupSkipped = []; S.setupDone = false; _setupTodoAll = false;
      window._geoPermState = () => 'prompt'; window._geoPermDone = () => false; window._geoNatProblem = () => null;
      goPg('pg-dash'); _renderDashSetupTodo();
    });
  });

  test('the checklist shows its next two items and a Show all', async () => {
    const r = await page.evaluate(() => {
      const rows = document.querySelectorAll('#dash-setup-todo .td-setup-row').length;
      const more = document.querySelector('#dash-setup-todo .td-setup-more');
      const left = document.querySelector('#dash-setup-todo').textContent.match(/(\d+) left/);
      more.click();
      const all = document.querySelectorAll('#dash-setup-todo .td-setup-row').length;
      const fewer = document.querySelector('#dash-setup-todo .td-setup-more').textContent;
      return { rows, moreText: more.textContent, left: Number(left && left[1]), all, fewer };
    });
    expect(r.rows).toBe(2);
    expect(r.moreText).toBe('Show all ' + r.left);
    expect(r.all).toBe(r.left);
    expect(r.fewer).toBe('Show fewer');
    expect(await tooSmall(page, '#dash-setup-todo .td-setup-more')).toEqual([]);
  });

  test('two or fewer left shows no Show all at all', async () => {
    const r = await page.evaluate(() => {
      S.setupSkipped = ['vehicle', 'places', 'getpaid', 'venmo', 'logo', 'team', 'motion', 'liveact', 'notify'];
      window._qrHasSourceCached = () => true;
      _renderDashSetupTodo();
      const out = { rows: document.querySelectorAll('#dash-setup-todo .td-setup-row').length, more: document.querySelectorAll('#dash-setup-todo .td-setup-more').length };
      delete window._qrHasSourceCached;
      return out;
    });
    expect(r.rows).toBeLessThanOrEqual(2);
    expect(r.more).toBe(0);
  });

  test('Skip for now is a 44px target that does not touch the blue button above it', async () => {
    expect(await tooSmall(page, '#dash-setup-todo .td-setup-skip')).toEqual([]);
    const clash = await page.evaluate(() => [...document.querySelectorAll('#dash-setup-todo .td-setup-row')].some(row => {
      const a = row.querySelector('.td-setup-skip'), b = row.querySelector('.td-setup-cta');
      if (!a || !b) return false;
      const r1 = a.getBoundingClientRect(), r2 = b.getBoundingClientRect();
      return !(r1.right <= r2.left || r2.right <= r1.left || r1.bottom <= r2.top || r2.bottom <= r1.top);
    }));
    expect(clash).toBe(false);
  });

  test('"Turn on location" is said once: the red card stands down while the checklist row shows', async () => {
    const r = await page.evaluate(async () => {
      _setupTodoAll = true; _renderDashSetupTodo();
      await _geoPermissionBanner();
      const row = !!document.querySelector('#dash-setup-todo [data-setup-id="location"]');
      const banner = document.getElementById('dash-geo-perm').style.display !== 'none';
      _setupTodoAll = false; _renderDashSetupTodo();
      await _geoPermissionBanner();
      const row2 = !!document.querySelector('#dash-setup-todo [data-setup-id="location"]');
      const banner2 = document.getElementById('dash-geo-perm').style.display !== 'none';
      const said = (document.getElementById('pg-dash').innerText.match(/Turn on location/g) || []).length;
      return { row, banner, row2, banner2, said };
    });
    expect(r.row).toBe(true);
    expect(r.banner).toBe(false);
    expect(r.row2, 'folded under Show all').toBe(false);
    expect(r.banner2, 'so the card says it instead').toBe(true);
    expect(r.said).toBeLessThanOrEqual(1);
  });

  test('Month / Quarter / Year / All are 44px, and nothing bleeds sideways on an SE', async () => {
    expect(await tooSmall(page, '#dash-period-seg .seg-btn')).toEqual([]);
    const bleed = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(bleed).toBeLessThanOrEqual(1);
  });

  assertNoErrors(() => page);
});

// ── 4, 10: signup and Tim's words ────────────────────────────────────────────
test.describe('Signup and Tim in plain words', () => {
  let page;
  test.beforeAll(async ({ browser }) => { page = await boot(browser); });
  test.afterAll(async () => { await page.context().close(); });

  test('tapping a service flips it in place: no re-render, no jump to the top', async () => {
    const r = await page.evaluate(() => {
      if (!document.getElementById('onboarding-overlay')) {
        const ov = document.createElement('div'); ov.id = 'onboarding-overlay'; document.body.appendChild(ov);
      }
      S.priceBook = {};
      _ob.step = 2; _ob.svcPick = false; _ob.svcPicked = []; _ob.svcAll = false;
      _ob.tradeLines = ['plumbing']; _ob.businessType = 'plumbing';
      obNext3();
      const btn = document.querySelector('#ob-body .ob-svc[data-svc="5"]');
      const body = document.getElementById('ob-body');
      let reRendered = false;
      const mo = new MutationObserver(m => { if (m.some(x => x.type === 'childList' && x.target === body)) reRendered = true; });
      mo.observe(body, { childList: true });
      obToggleSvc(5); obToggleSvc(7);
      mo.disconnect();
      const same = document.querySelector('#ob-body .ob-svc[data-svc="5"]') === btn;
      const out = {
        same, reRendered, pressed: btn.getAttribute('aria-pressed'),
        go: document.querySelector('#ob-svc-go button').textContent, picked: _ob.svcPicked.slice(),
      };
      obToggleSvc(5);
      out.off = btn.getAttribute('aria-pressed'); out.go2 = document.querySelector('#ob-svc-go button').textContent;
      return out;
    });
    expect(r.same).toBe(true);
    expect(r.reRendered).toBe(false);
    expect(r.pressed).toBe('true');
    expect(r.go).toBe('Add 2 to my price book');
    expect(r.picked).toEqual([5, 7]);
    expect(r.off).toBe('false');
    expect(r.go2).toBe('Add 1 to my price book');
  });

  test('signup fields are 48px with labels a man can read', async () => {
    const r = await page.evaluate(() => {
      const d = document.createElement('div'); d.style.width = '340px';
      d.innerHTML = obInput('zz-ob-test', 'Business name', 'Smith Plumbing', 'text', '');
      document.body.appendChild(d);
      const inp = d.querySelector('input'), lab = d.querySelector('label');
      const cs = getComputedStyle(lab);
      const out = { h: inp.getBoundingClientRect().height, size: parseFloat(cs.fontSize), caps: cs.textTransform, forId: lab.getAttribute('for'), inSize: parseFloat(getComputedStyle(inp).fontSize) };
      d.remove();
      return out;
    });
    expect(r.h).toBeGreaterThanOrEqual(48);
    expect(r.size).toBeGreaterThanOrEqual(14);
    expect(r.caps).toBe('none');
    expect(r.forId).toBe('zz-ob-test');
    expect(r.inSize, '16px stops iOS zooming on focus').toBeGreaterThanOrEqual(16);
  });

  test('Tim\'s hint is plain English and a sentence he really acts on', async () => {
    const r = await page.evaluate(() => ({ hint: _TIM_SAY_HINT, build: timWantsBuild(_TIM_SAY_HINT), style: (timStyle(_TIM_SAY_HINT) || {}).id }));
    expect(r.hint).toBe('Quote Dana by the hour');
    expect(r.hint).not.toMatch(/T and M|T&M/);
    expect(r.build).toBe(true);
    expect(r.style).toBe('tm');
  });

  test('Legal says e-signature consent, not UETA disclosure', async () => {
    const t = await page.evaluate(() => document.getElementById('setd-legal').textContent);
    expect(t).toContain('E-signature consent');
    expect(t).not.toContain('UETA disclosure');
  });

  assertNoErrors(() => page);
});
