// @ts-check
/**
 * Time and materials, and the law of the state the house is in.
 *
 * Owner, 2026-09-23: "it all needs to be [impossible] for them to get wrong in
 * compliance with their state laws and so easy my 3 year old could build the
 * estimate."
 *
 * Before that day the law was on the SCREEN and nowhere else. California's
 * warning sat above a Send button that sent. A ceiling state locked the ceiling
 * switch on and let him send with the box empty. Pennsylvania's estimate was a
 * comment. And underneath all three, the state itself was read wrong: the first
 * two-letter word shaped like a state, which is usually in the street
 * ("300 Ca Ave, Phoenix, AZ" was California).
 *
 * These hold the other side of every one of those: every state and DC is run
 * through the same Send button, and the ones the law names cannot get past it
 * until the contract is what that law requires.
 *
 * What each state requires is js/legal.js's reading (STATE_PRICE_RULE and its
 * notes), not an independent reading of fifty statutes. These tests prove the
 * app ENFORCES that table on every path out; whether the table is right is a
 * legal question, and the table cites its statute on every row for that reason.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const ALL = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI',
  'SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
const CEILING = ['AZ','HI','NV','IL','MA','IN','VA','ME'];   // a ceiling, in dollars
const ESTIMATE_TOO = ['PA'];                                    // the estimate as well, ceiling fixed at +10%
const BLOCKED = ['CA'];                                         // no T&M on a home at all

test.describe('the state the house is in', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // A residential T&M for one customer at one address, on the page.
  //
  // Opened at a neutral address and THEN moved to the one under test, because
  // since 2026-09-23 a California home cannot be opened as a T&M at all (the
  // "every door" group below holds that). These tests are the second line: a
  // California T&M that exists anyway, a draft written before the doors were
  // shut, still cannot be sent, signed or shown.
  const open = (addr, extra) => page.evaluate(([a, x]) => {
    document.getElementById('_style-pick-ov')?.remove();
    document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
    clients.length = 0; bids.length = 0;
    clients.push(Object.assign({ id: 66001, name: 'Pat Doyle', addr: '1 Neutral Rd, Topeka, KS 66603', phone: '5555550100' }, x || {}));
    currentClientId = 66001;
    openTMEstimate(getClientById(66001));
    clients[0].addr = a;
    const f = document.getElementById('gei-addr'); if (f) f.value = a;
    _geiIsTM = true; _tmShowPage();
    _geiScopeChips = ['Pull the old water heater', 'Set a tankless'];
    _tmInputChange();
  }, [addr, extra || null]);

  // Press Send and report what stopped it. Offline is the gate AFTER every
  // content and legal check, so reaching it is how a test proves the proposal
  // was accepted without actually minting a signing link.
  const pressSend = () => page.evaluate(async () => {
    const seen = [];
    const pa = window.zAlert, pc = window.zConfirm;
    window.zAlert = (m, o) => { seen.push({ kind: 'alert', title: (o && o.title) || '', m: String(m) }); };
    window.zConfirm = (m, yes, o) => { seen.push({ kind: 'stop', title: (o && o.title) || '', m: String(m), yes: (o && o.yes) || '' }); };
    const on = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
    try { await sendGenericProposal(false); } catch (e) { seen.push({ kind: 'threw', m: e.message }); }
    Object.defineProperty(navigator, 'onLine', { get: () => on, configurable: true });
    window.zAlert = pa; window.zConfirm = pc;
    const s = seen[0] || { kind: 'none' };
    return { stopped: s.kind === 'stop', passed: s.kind === 'alert' && /internet/i.test(s.title), first: s };
  });

  const setCap = v => page.evaluate(n => {
    const b = document.getElementById('tm-i-nte'); b.readOnly = false; b.value = n ? String(n) : '';
    _tmInputChange();
  }, v);

  // ── Reading the state ─────────────────────────────────────────────────────

  test('the state is read from the end of the address, not the first word shaped like one', async () => {
    const r = await page.evaluate(() => [
      ['300 Ca Ave, Phoenix, AZ 85001', 'AZ'],        // was California: T&M blocked in Arizona
      ['1234 Co Rd 12, Canton, OH 44702', 'OH'],      // was Colorado: every rural county road
      ['1 Pa Rd, Ocean City, NJ 08226', 'NJ'],        // was Pennsylvania: its ceiling forced on NJ
      ['100 La Salle St, Chicago, IL 60601', 'IL'],   // was Louisiana
      ['8 Ma Ln, Austin, TX 78701', 'TX'],            // was Massachusetts
      ['1600 Pennsylvania Ave NW, Washington, DC 20500', 'DC'],
      ['123 Virginia St, Reno, Nevada', 'NV'],
      ['1 Main St, Charleston, West Virginia', 'WV'],
      ['412 Bell St Topeka KS', 'KS'],
      ['412 Bell St, Topeka, KS 66603, USA', 'KS'],
      ['1 Main St, Springfield, ma 01103', 'MA'],
      ['Topeka', null], ['', null],
    ].filter(([a, want]) => stateFromAddr(a) !== want).map(([a, want]) => a + ' => ' + stateFromAddr(a) + ', wanted ' + want));
    expect(r).toEqual([]);
  });

  // One reader, not five. Every copy that used to run its own regex (the
  // deposit cap, the hub's right-to-cancel, the county lookup) now asks the
  // same function, so the deposit and the T&M rule can never be read off two
  // different states for one address.
  test('the old reader agrees with the new one, because it is the new one', async () => {
    const r = await page.evaluate(() => detectStateFromAddr('300 Ca Ave, Phoenix, AZ 85001'));
    expect(r).toBe('AZ');
  });

  // ── Every state, one Send button ──────────────────────────────────────────

  test('a rate and a scope sends in every state the law does not name', async () => {
    const free = ALL.filter(s => !CEILING.includes(s) && !ESTIMATE_TOO.includes(s) && !BLOCKED.includes(s));
    const stuck = [];
    for (const st of free) {
      await open('10 Oak St, Somewhere, ' + st + ' 00000');
      await setCap(0);
      const r = await pressSend();
      if (!r.passed) stuck.push(st + ': ' + JSON.stringify(r.first));
    }
    expect(stuck, 'a state the law does not name must not be stopped').toEqual([]);
  });

  test('every ceiling state stops Send until the most it can cost has a number in it', async () => {
    const wrong = [];
    for (const st of CEILING) {
      await open('10 Oak St, Somewhere, ' + st + ' 00000');
      await setCap(0);
      const empty = await pressSend();
      if (!empty.stopped || !/most this can cost/.test(empty.first.m)) wrong.push(st + ' sent with no ceiling: ' + JSON.stringify(empty.first));
      await setCap(9000);
      const filled = await pressSend();
      if (!filled.passed) wrong.push(st + ' refused WITH a ceiling: ' + JSON.stringify(filled.first));
    }
    expect(wrong).toEqual([]);
  });

  // The stop is not a dead end: one button, and it lands him in the box.
  test('the stop says which state and why, and its one button lands him in the box', async () => {
    await open('10 Oak St, Chicago, IL 60601');
    await setCap(0);
    const r = await pressSend();
    expect(r.first.title).toBe('One thing first');
    expect(r.first.m).toContain('Illinois');
    expect(r.first.m).toContain('815 ILCS 513/15');
    expect(r.first.yes).toBe('Put in the most it can cost');
    const focus = await page.evaluate(() => { _tmStepAct('cap'); return document.activeElement && document.activeElement.id; });
    expect(focus).toBe('tm-i-nte');
  });

  test('Pennsylvania needs the estimate, and then sets the ceiling itself at ten percent over it', async () => {
    await open('12 Main St, Lancaster, PA 17601');
    const before = await pressSend();
    expect(before.stopped, 'Pennsylvania sent with no estimate').toBe(true);
    expect(before.first.m).toContain('estimate');
    const r = await page.evaluate(() => {
      _tmStepAct('est');
      const d = document.getElementById('tm-i-days'); d.value = '3';
      _tmInputChange();
      const box = document.getElementById('tm-i-nte');
      return { total: calcGeiTotal().total, cap: _tmCapVal(), readOnly: box.readOnly, locked: [..._tmLockedLayers()].sort() };
    });
    expect(r.locked).toEqual(['cap', 'est', 'rate']);
    expect(r.cap, 'the ceiling is the estimate plus ten percent, rounded up').toBe(Math.ceil(r.total * 1.1));
    expect(r.readOnly, 'a figure the statute fixes is not his to type').toBe(true);
    const after = await pressSend();
    expect(after.passed, JSON.stringify(after.first)).toBe(true);
  });

  test('California stops Send, Sign it here and Show them on this phone, and offers the fixed price', async () => {
    await open('300 Main St, Fresno, CA 93721');
    const send = await pressSend();
    expect(send.stopped).toBe(true);
    expect(send.first.title).toBe('Not allowed in California');
    expect(send.first.yes).toBe('Make it a fixed price');
    const other = await page.evaluate(async () => {
      const seen = []; const pc = window.zConfirm;
      window.zConfirm = (m, y, o) => { seen.push((o && o.title) || ''); };
      _geiSignInPerson();
      await _geiPresent();
      window.zConfirm = pc;
      return { seen, signSheet: !!document.getElementById('_gei-ip-ov'), present: !!document.getElementById('_present-ov') };
    });
    expect(other.seen).toEqual(['Not allowed in California', 'Not allowed in California']);
    expect(other.signSheet, 'the signing sheet opened on an illegal contract').toBe(false);
  });

  test('a California job becomes a fixed price with the scope he already said', async () => {
    await open('300 Main St, Fresno, CA 93721');
    const r = await page.evaluate(() => new Promise(res => {
      // Restored after: a stub left behind answered the next test's stop for it.
      const prev = window.zConfirm;
      window.zConfirm = (m, y) => { if (typeof y === 'function') y(); };
      _tmToFixedPrice();
      setTimeout(() => { window.zConfirm = prev; res({ tm: _geiIsTM, byo: _geiIsFreeForm, lines: (_byoItems || []).map(i => i.label) }); }, 600);
    }));
    expect(r.tm).toBe(false);
    expect(r.byo).toBe(true);
    expect(r.lines).toEqual(expect.arrayContaining(['Pull the old water heater', 'Set a tankless']));
  });

  // Every one of these is a HOME improvement statute. Blocking a warehouse job
  // in California would stop a man doing legal work.
  test('a business job is outside the home improvement statutes', async () => {
    await open('300 Main St, Fresno, CA 93721', { ptype: 'Commercial' });
    const ca = await pressSend();
    expect(ca.passed, JSON.stringify(ca.first)).toBe(true);
    await open('10 Oak St, Chicago, IL 60601', { ptype: 'Commercial' });
    await setCap(0);
    const il = await pressSend();
    expect(il.passed, JSON.stringify(il.first)).toBe(true);
  });

  test('the proposal picker says California before he builds anything', async () => {
    const r = await page.evaluate(() => {
      document.getElementById('_style-pick-ov')?.remove();
      clients.length = 0;
      clients.push({ id: 66002, name: 'Dana Ruiz', addr: '300 Main St, Fresno, CA 93721' });
      currentClientId = 66002; openEstimateForClient();
      const card = document.querySelector('#_style-pick-ov [data-type="tm"]');
      const out = { locked: card && card.getAttribute('data-locked'), text: card && card.textContent.replace(/\s+/g, ' ') };
      document.getElementById('_style-pick-ov')?.remove();
      return out;
    });
    expect(r.locked).toBe('1');
    expect(r.text).toContain('Not allowed in California');
  });

  test('Sign it here stops a ceiling state with no ceiling, the same as Send', async () => {
    await open('10 Oak St, Boston, MA 02108');
    await setCap(0);
    const r = await page.evaluate(() => {
      const seen = []; const pc = window.zConfirm;
      window.zConfirm = (m, y, o) => { seen.push(String(m)); };
      document.getElementById('_gei-ip-ov')?.remove();
      _geiSignInPerson();
      window.zConfirm = pc;
      return { seen, sheet: !!document.getElementById('_gei-ip-ov') };
    });
    expect(r.seen.join('|')).toContain('Massachusetts');
    expect(r.sheet).toBe(false);
  });

  // ── The contract is this customer's, and only this customer's ─────────────

  // Found by eye on 2026-09-23: a Kansas customer's $4,500 ceiling turned up
  // on the next customer's Pennsylvania contract, because the box was only
  // ever written when the bid had a ceiling of its own.
  test('the last customer ceiling never reaches the next customer contract', async () => {
    await open('412 Bell St, Topeka, KS 66603');
    await setCap(4500);
    await open('10 Elm St, Wichita, KS 67202');
    const r = await page.evaluate(async () => {
      let doc = '';
      const prev = window._showProposalPreviewOverlay;
      window._showProposalPreviewOverlay = h => { doc = h; };
      try { await sendGenericProposal(true); } catch (e) {}
      window._showProposalPreviewOverlay = prev;
      document.getElementById('_prop-preview-ov')?.remove();
      return {
        box: document.getElementById('tm-i-nte').value,
        mirror: document.getElementById('tm-nte-cap').value,
        onDoc: /4,500/.test(doc) || /MOST THIS CAN COST/i.test(doc),
      };
    });
    expect(r.box).toBe('');
    expect(r.mirror).toBe('');
    expect(r.onDoc, 'the previous customer ceiling printed on this one').toBe(false);
  });

  test('a ceiling he types is the one the customer reads', async () => {
    await open('10 Oak St, Chicago, IL 60601');
    await setCap(9000);
    const doc = await page.evaluate(async () => {
      let d = '';
      const prev = window._showProposalPreviewOverlay;
      window._showProposalPreviewOverlay = h => { d = h; };
      try { await sendGenericProposal(true); } catch (e) {}
      window._showProposalPreviewOverlay = prev;
      document.getElementById('_prop-preview-ov')?.remove();
      return d || (document.getElementById('_prop-preview-ov') || {}).innerHTML || '';
    });
    expect(doc).toContain('9,000');
  });

  // ── Every door into a California home T&M is shut ──────────────────────
  //
  // Owner, 2026-09-23: "California bans T&M for residential so they shouldn't
  // even be able to proceed [past the first page] if it's for a residential
  // address." The picker's card was one door of five.
  const CA = '300 Main St, Fresno, CA 93721';
  const where = () => page.evaluate(() => {
    const tm = document.getElementById('gei-tm-page');
    const t = document.querySelector('.zmodal-overlay .zmodal-title');
    const out = {
      onTmPage: !!tm && tm.style.display !== 'none' && document.querySelector('.pg.active')?.id === 'pg-est-generic',
      stop: t ? t.textContent : '',
      tmDrafts: bids.filter(b => b.isTM).length,
    };
    document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
    return out;
  });
  const reset = (list) => page.evaluate((cs) => {
    document.getElementById('_style-pick-ov')?.remove();
    document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
    const tm = document.getElementById('gei-tm-page'); if (tm) tm.style.display = 'none';
    if (typeof goPg === 'function') goPg('pg-dash');
    clients.length = 0; bids.length = 0; cs.forEach(c => clients.push(c));
    currentClientId = cs[0].id;
  }, list);

  test('door 1, the trade picker shortcut and any direct open: stopped before the builder', async () => {
    await reset([{ id: 67001, name: 'Dana Ruiz', addr: CA }]);
    await page.evaluate(() => openTMEstimate(getClientById(67001)));
    await page.waitForTimeout(300);
    const r = await where();
    expect(r.stop).toBe('Not allowed in California');
    expect(r.onTmPage).toBe(false);
    expect(r.tmDrafts, 'not even a draft was written').toBe(0);
  });

  test('door 2, a spoken "T and M for" a California customer: stopped', async () => {
    await reset([{ id: 67002, name: 'Dana Ruiz', addr: CA }]);
    await page.evaluate(() => { if (typeof tdSpeakEstimate === 'function') tdSpeakEstimate('T and M for Dana Ruiz, three days'); });
    await page.waitForTimeout(400);
    const r = await where();
    expect(r.onTmPage).toBe(false);
    expect(r.tmDrafts).toBe(0);
  });

  test('door 3, resuming a California T&M draft: lands on step 1, stopped, never the T&M page', async () => {
    await reset([{ id: 67003, name: 'Dana Ruiz', addr: CA }]);
    await page.evaluate(() => {
      bids.push({ id: 7700301, client_id: 67003, addr: '300 Main St, Fresno, CA 93721', isTM: true, status: 'Draft', draft: true,
        tmRatePerMan: 95, scopeChips: ['Pull the old water heater'], geiLines: [] });
      openGenericEstimate(getClientById(67003), 7700301);
    });
    await page.waitForTimeout(400);
    const r = await where();
    expect(r.stop).toBe('Not allowed in California');
    expect(r.onTmPage).toBe(false);
  });

  test('door 4, Change on step 1 to a California home: Next will not go through', async () => {
    await reset([{ id: 67004, name: 'Pat Doyle', addr: '412 Bell St, Topeka, KS 66603' }]);
    await page.evaluate(() => { openTMEstimate(getClientById(67004)); });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      goGeiStep(1);
      document.getElementById('gei-addr').value = '300 Main St, Fresno, CA 93721';
      goGeiStep(2);
      const tm = document.getElementById('gei-tm-page');
      const t = document.querySelector('.zmodal-overlay .zmodal-title');
      const out = { onTm: tm.style.display !== 'none', stop: t ? t.textContent : '', step: _geiStep };
      document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove());
      return out;
    });
    expect(r.stop).toBe('Not allowed in California');
    expect(r.onTm).toBe(false);
    expect(r.step).toBe(1);
  });

  test('door 5, a customer with several properties: stopped at the California one, not the Arizona one', async () => {
    await reset([{ id: 67005, name: 'Sam Lee', addr: CA, extraAddresses: [{ label: 'Rental', addr: '9 Desert Rd, Phoenix, AZ 85001' }] }]);
    const card = await page.evaluate(() => {
      openEstimateForClient();
      const el = document.querySelector('#_style-pick-ov [data-type="tm"]');
      const locked = el && el.getAttribute('data-locked');
      document.getElementById('_style-pick-ov')?.remove();
      return locked || 'open';
    });
    expect(card, 'the Arizona rental must not be refused because the primary is in California').toBe('open');
    await page.evaluate(() => _geiOpenModeAt(getClientById(67005), 'tm', '300 Main St, Fresno, CA 93721'));
    await page.waitForTimeout(300);
    const ca = await where();
    expect(ca.stop).toBe('Not allowed in California');
    expect(ca.onTmPage).toBe(false);
    await page.evaluate(() => _geiOpenModeAt(getClientById(67005), 'tm', '9 Desert Rd, Phoenix, AZ 85001'));
    await page.waitForTimeout(500);
    const az = await where();
    expect(az.stop).toBe('');
    expect(az.onTmPage).toBe(true);
  });

  test('the stop offers the fixed price, for the same customer at the same address', async () => {
    await reset([{ id: 67006, name: 'Dana Ruiz', addr: CA }]);
    const r = await page.evaluate(() => new Promise(res => {
      openTMEstimate(getClientById(67006));
      document.getElementById('zmodal-yes').click();
      setTimeout(() => res({ tm: _geiIsTM, byo: _geiIsFreeForm, client: _geiClientId, addr: _geiSiteAddr() }), 600);
    }));
    expect(r.tm).toBe(false);
    expect(r.byo).toBe(true);
    expect(r.client).toBe(67006);
    expect(r.addr).toContain('Fresno');
  });

  test('a business in California opens as a T&M, through the same doors', async () => {
    await reset([{ id: 67007, name: 'Fresno Cold Storage', addr: CA, ptype: 'Commercial' }]);
    await page.evaluate(() => openTMEstimate(getClientById(67007)));
    await page.waitForTimeout(500);
    const r = await where();
    expect(r.stop).toBe('');
    expect(r.onTmPage).toBe(true);
  });

  test('no console errors across the state-law paths', async () => {
    assertNoErrors(page, 'T&M state law');
  });
});
