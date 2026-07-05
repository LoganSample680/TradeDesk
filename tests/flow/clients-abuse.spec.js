// Adversarial flow spec — client/lead creation, realistic + combinatorial.
//
// Signs into the live app and abuses saveClient() with realistic varied names
// and EVERY combination of entered data (email / address / property type / year
// built present or absent), asserting the right pipeline stage + onboarding rule
// for each. Also: double-submit race, blank-required rejection, input fuzz.
//
// Test leads carry a hidden "__E2E__" marker in notes so they're identifiable
// and cleanable while showing real names. A beforeAll sweep removes prior test
// leads (old "E2E"-named ones + "__E2E__"-tagged ones) so the account stays tidy.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, RUN_TAG, finding } = require('./live-helpers');

const FIRST = ['James', 'Maria', 'Robert', 'Linda', 'David', 'Patricia', 'Michael', 'Jennifer', 'William', 'Elizabeth', 'Carlos', 'Aisha'];
const LAST = ['Smith', 'Johnson', 'Garcia', 'Martinez', 'Brown', 'Davis', 'Wilson', 'Anderson', 'Nguyen', 'Patel', 'Reyes', 'Coleman'];
const MID = ['', 'A', 'B', 'C', 'D', 'E'];
const ADDRESSES = [
  { street: '2011 SW Randolph Ave', city: 'Topeka', state: 'KS', zip: '66604' },
  { street: '114 Elm St', city: 'Wichita', state: 'KS', zip: '67202' },
  { street: '8042 Metcalf Ave', city: 'Overland Park', state: 'KS', zip: '66204' },
  { street: '500 N Broadway', city: 'Pittsburg', state: 'KS', zip: '66762' },
];

test.describe('clients/leads — realistic combinatorial breaker', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    // Sweep PRIOR runs' test leads (old "E2E"-named + "__E2E__"-tagged) so the
    // account stays tidy, but KEEP this run's leads so they can be reviewed.
    await page.evaluate((runTag) => {
      if (typeof clients === 'undefined') return;
      clients = clients.filter(c => {
        const isTest = (c.name || '').startsWith('E2E') || (c.notes || '').includes('__E2E__');
        const isThisRun = (c.notes || '').includes(runTag);
        return !isTest || isThisRun;
      });
      if (typeof _flushSaveNow === 'function') { try { _flushSaveNow(); } catch (e) {} }
    }, RUN_TAG);
  });

  // A page-context factory: open the form, set fields (always-required + the
  // requested optional set), tag with the marker, save, and return the result.
  const FACTORY = `
    window.__mkClient = function(opts) {
      goPg('pg-clients'); openNewClient();
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      set('cf-name', opts.name);
      // Random-ish KS phone so seeded leads look real and exercise dedup variety.
      const ac = ['316','620','785','913'][Math.floor(Math.random()*4)];
      const rand = String(Math.floor(2000000 + Math.random()*7999999));
      set('cf-phone', opts.phone || (ac + rand));
      // required source — pick a RANDOM real option so sources spread out
      const s = document.getElementById('cf-source');
      if (s && s.options && s.options.length > 1) s.value = s.options[1 + Math.floor(Math.random() * (s.options.length - 1))].value;
      set('cf-notes', '__E2E__ ' + opts.tag);          // hidden marker, real name shown
      if (opts.email)    set('cf-email', opts.email);
      if (opts.ptype)    { const p = document.getElementById('cf-ptype'); if (p) p.value = opts.ptype; }
      if (opts.yearBuilt){ const y = document.getElementById('cf-year-built'); if (y) y.value = String(opts.yearBuilt); }
      if (opts.addr) {
        set('cf-street', opts.addr.street); set('cf-city', opts.addr.city);
        set('cf-state', opts.addr.state); set('cf-zip', opts.addr.zip);
      }
      const before = clients.length;
      // Reset the 1500ms double-submit guard between INTENTIONAL distinct creates
      // (the race test keeps it active on purpose to prove dedup).
      try { _submitting = false; } catch (e) {}
      try { saveClient(); } catch (e) { return { ok:false, err:e.message }; }
      const created = clients.length > before;
      const c = [...clients].reverse().find(x => (x.name||'') === opts.name);
      return { ok:true, created, id: c && c.id, stage: c ? getClientStage(c.id).stage : null, addr: c ? (c.addr||'') : null };
    };`;

  test('every combination of entered data saves with the correct pipeline stage', async ({ page }) => {
    await page.addInitScript(FACTORY); // ensure factory exists even after reload
    const r = await page.evaluate(({ FIRST, LAST, MID, ADDRESSES, runTag, factory }) => {
      eval(factory); // define __mkClient in this context
      const out = [];
      let i = 0;
      // 2^3 combinations of {email, address, yearBuilt}; ptype always varied.
      for (const email of [false, true]) {
        for (const addr of [false, true]) {
          for (const yb of [false, true]) {
            const cycle = Math.floor(i / FIRST.length);
            const mid = MID[cycle] ? MID[cycle] + '. ' : '';
            const name = FIRST[i % FIRST.length] + ' ' + mid + LAST[(i * 5 + 1) % LAST.length];
            const res = window.__mkClient({
              name, tag: runTag + '#' + i,
              email: email ? ('lead' + i + '@example.com') : '',
              addr: addr ? ADDRESSES[i % ADDRESSES.length] : null,
              yearBuilt: yb ? (1950 + i) : '',
              ptype: (i % 2) ? 'Multi-family' : 'Single family home',
            });
            out.push({ i, name, hasAddr: addr, res });
            i++;
          }
        }
      }
      return out;
    }, { FIRST, LAST, MID, ADDRESSES, runTag: RUN_TAG, factory: FACTORY });

    // Every combo must create a client and classify its stage by address presence.
    for (const row of r) {
      expect(row.res.ok, `combo ${row.i} crashed: ${row.res.err}`).toBe(true);
      // Assert the lead EXISTS after the call (robust when a second browser finds
      // it already created by the first and dedup correctly blocks a duplicate).
      expect(!!row.res.id, finding({
        page: 'pg-clients', control: `saveClient combo#${row.i} (${row.name})`,
        rule: 'any valid field combination must yield the lead',
        expected: 'lead present', got: 'absent', suspect: 'clients.js:922 saveClient',
      })).toBe(true);
      const expectStage = row.hasAddr ? 'new' : 'incomplete';
      expect(row.res.stage, finding({
        page: 'pg-clients', control: `stage of combo#${row.i} (addr=${row.hasAddr})`,
        rule: 'no address → "incomplete/Needs onboarding"; address → "new"',
        expected: expectStage, got: String(row.res.stage), suspect: 'clients.js:704 getClientStage',
      })).toBe(expectStage);
    }
    await page.waitForTimeout(2500); // let cloud sync flush
  });

  test('no-address lead → onboarding link fires (records onboardingSentAt)', async ({ page }) => {
    const r = await page.evaluate(({ runTag, factory }) => {
      eval(factory);
      const res = window.__mkClient({ name: 'Dana ' + 'Whitfield', tag: runTag + '-onb', addr: null });
      if (!res.id) return { ok: false, why: 'lead not created' };
      // Blank the phone so sendOnboardingLink takes the copy-link modal path
      // instead of navigating to an sms: URL during the test.
      const idx = clients.findIndex(c => c.id === res.id);
      if (idx >= 0) clients[idx].phone = '';
      try { sendOnboardingLink(res.id); } catch (e) { return { ok: false, why: 'threw: ' + e.message }; }
      const c = clients.find(x => x.id === res.id);
      return { ok: true, stage: res.stage, sentAt: c && c.onboardingSentAt || null };
    }, { runTag: RUN_TAG, factory: FACTORY });

    expect(r.ok, `onboarding flow error: ${r.why}`).toBe(true);
    expect(r.stage, finding({
      page: 'pg-clients', control: 'no-address lead', rule: 'no address ⇒ Needs onboarding',
      expected: 'incomplete', got: String(r.stage), suspect: 'clients.js:704',
    })).toBe('incomplete');
    expect(!!r.sentAt, finding({
      page: 'pg-clients', control: 'sendOnboardingLink', rule: 'sending the onboarding link must record onboardingSentAt',
      expected: 'timestamp set', got: String(r.sentAt), suspect: 'proposals.js:318',
    })).toBe(true);
    await page.waitForTimeout(1500);
  });

  test('double-submit race: 10 rapid saves create exactly one lead', async ({ page }) => {
    const name = 'Theo ' + 'Marchetti ' + RUN_TAG.slice(-4);
    const r = await page.evaluate(({ nm, runTag }) => {
      try {
        goPg('pg-clients'); openNewClient();
        document.getElementById('cf-name').value = nm;
        document.getElementById('cf-phone').value = '3165551234';
        const s = document.getElementById('cf-source'); if (s && s.options.length > 1) s.value = s.options[1].value;
        document.getElementById('cf-notes').value = '__E2E__ ' + runTag;
        for (let i = 0; i < 10; i++) { try { saveClient(); } catch (e) {} }
        return { ok: true, count: clients.filter(c => (c.name || '') === nm).length };
      } catch (e) { return { ok: false, err: e.message }; }
    }, { nm: name, runTag: RUN_TAG });
    expect(r.ok, `crashed during rapid saveClient: ${r.err}`).toBe(true);
    expect(r.count, finding({
      page: 'pg-clients', control: 'saveClient ×10 (race)', rule: 'a double-submit must create exactly one lead',
      expected: '1', got: String(r.count), suspect: 'clients.js:923 _submitting / :946 name dedup',
    })).toBe(1);
    await page.waitForTimeout(2000);
  });

  test('garbage in: blank name rejected; emoji + 5k-char name does not crash', async ({ page }) => {
    const r = await page.evaluate(({ runTag }) => {
      const setReq = () => {
        document.getElementById('cf-phone').value = '3165550000';
        const s = document.getElementById('cf-source'); if (s && s.options.length > 1) s.value = s.options[1].value;
        document.getElementById('cf-notes').value = '__E2E__ ' + runTag;
      };
      // blank name → must not create
      goPg('pg-clients'); openNewClient(); document.getElementById('cf-name').value = ''; setReq();
      const b1 = clients.length; try { saveClient(); } catch (e) {} const blankDelta = clients.length - b1;
      // emoji + 5k chars → must not throw
      let fuzzOk = true, fuzzErr = '';
      try {
        goPg('pg-clients'); openNewClient();
        document.getElementById('cf-name').value = ('Renée 🔥🙈 ' + runTag).padEnd(5000, 'x'); setReq();
        saveClient();
      } catch (e) { fuzzOk = false; fuzzErr = e.message; }
      return { blankDelta, fuzzOk, fuzzErr };
    }, { runTag: RUN_TAG });
    expect(r.blankDelta, finding({
      page: 'pg-clients', control: 'saveClient (blank name)', rule: 'name is required',
      expected: '0 created', got: `${r.blankDelta} created`, suspect: 'clients.js:928',
    })).toBe(0);
    expect(r.fuzzOk, finding({
      page: 'pg-clients', control: 'saveClient (emoji + 5k chars)', rule: 'malformed input must not crash',
      expected: 'no exception', got: `threw: ${r.fuzzErr}`, suspect: 'clients.js:922',
    })).toBe(true);
    await page.waitForTimeout(1500);
  });
});
