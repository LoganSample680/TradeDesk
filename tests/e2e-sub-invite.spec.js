// @ts-check
/**
 * Exhaustive E2E coverage for the sub referral invite flow (js/cloud.js):
 * a contractor who adds a 1099 sub can text them a link to create their OWN
 * TradeDesk account (the growth loop). NOT the employee invite — nothing in
 * this flow grants access to the inviter's account.
 *
 * Functions covered:
 *   _parseSubInvitePayload, _subInviteLink, _inviteSubToTradeDesk,
 *   _claimSubReferralAttribution, supaShowLogin (referral branch),
 *   _saveSub (invite-moment prompt), renderTeam (sub row invite button)
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('sub referral invite — exhaustive coverage', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.close(); });

  test.afterEach(async () => {
    await page.evaluate(() => {
      localStorage.removeItem('_pendingSubInvite');
      localStorage.removeItem('_pendingSubInviteGrant');
      document.getElementById('supa-login-overlay')?.remove();
      document.querySelectorAll('.zmodal-overlay').forEach(el => el.remove());
    });
  });

  test('_parseSubInvitePayload round-trips what _subInviteLink encodes', async () => {
    const result = await page.evaluate(() => {
      S.bname = 'Torres Electric';
      const link = _subInviteLink({ name: 'Dana Lee', trade: 'Drywall' });
      const raw = new URL(link).searchParams.get('sub_invite');
      return _parseSubInvitePayload(raw);
    });
    expect(result).toEqual({ bn: 'Torres Electric', n: 'Dana Lee', t: 'Drywall' });
  });

  test('_parseSubInvitePayload rejects corrupt base64, bad JSON, and empty payloads', async () => {
    const result = await page.evaluate(() => ({
      corrupt: _parseSubInvitePayload('%%%not-base64%%%'),
      badJson: _parseSubInvitePayload(btoa('{nope{{')),
      empty: _parseSubInvitePayload(btoa(JSON.stringify({}))),
      nullRaw: _parseSubInvitePayload(null),
    }));
    expect(result.corrupt).toBe(null);
    expect(result.badJson).toBe(null);
    expect(result.empty).toBe(null);
    expect(result.nullRaw).toBe(null);
  });

  test('_parseSubInvitePayload coerces non-string fields to strings (type-mismatch safety)', async () => {
    const result = await page.evaluate(() => _parseSubInvitePayload(btoa(JSON.stringify({ bn: 123, n: { x: 1 }, t: null }))));
    expect(typeof result.bn).toBe('string');
    expect(typeof result.n).toBe('string');
    expect(result.t).toBe('');
  });

  test('_subInviteLink survives null sub and empty business name', async () => {
    const result = await page.evaluate(() => {
      const saved = S.bname;
      S.bname = '';
      const link = _subInviteLink(null);
      const payload = _parseSubInvitePayload(new URL(link).searchParams.get('sub_invite'));
      S.bname = saved;
      return { hasParam: link.includes('?sub_invite='), payload };
    });
    expect(result.hasParam).toBe(true);
    // bn and n both empty → parse correctly returns null (nothing to pitch with)
    expect(result.payload).toBe(null);
  });

  test('_inviteSubToTradeDesk with a phone: navigates to an sms: link and stamps tdInvitedAt', async () => {
    const result = await page.evaluate(async () => {
      S.bname = 'Torres Electric';
      S.subcontractors = [{ id: 1, name: 'Dana Lee', trade: 'Drywall', phone: '316-555-0100' }];
      let navHref = null;
      const orig = window._subInviteNavigate;
      window._subInviteNavigate = (href) => { navHref = href; };
      await _inviteSubToTradeDesk(0);
      window._subInviteNavigate = orig;
      return { navHref, invitedAt: S.subcontractors[0].tdInvitedAt };
    });
    expect(result.navHref).toContain('sms:3165550100');
    expect(result.navHref).toContain('sub_invite');
    expect(result.navHref).toContain('TradeDesk');
    expect(result.invitedAt).toBeTruthy();
  });

  test('_inviteSubToTradeDesk without a phone: copies the pitch to the clipboard instead', async () => {
    const result = await page.evaluate(async () => {
      S.subcontractors = [{ id: 1, name: 'No Phone Sub', trade: 'Paint' }];
      let copied = null, navCalled = false;
      const origNav = window._subInviteNavigate;
      const origWrite = navigator.clipboard && navigator.clipboard.writeText;
      window._subInviteNavigate = () => { navCalled = true; };
      if (navigator.clipboard) navigator.clipboard.writeText = (t) => { copied = t; return Promise.resolve(); };
      _inviteSubToTradeDesk(0);
      await new Promise(r => setTimeout(r, 50));
      window._subInviteNavigate = origNav;
      if (navigator.clipboard && origWrite) navigator.clipboard.writeText = origWrite;
      return { copied, navCalled };
    });
    expect(result.navCalled).toBe(false);
    expect(result.copied).toContain('sub_invite');
  });

  test('_inviteSubToTradeDesk with an email: fires the email helper behind the scenes, no sms navigation', async () => {
    const result = await page.evaluate(async () => {
      S.bname = 'Torres Electric';
      S.subcontractors = [{ id: 1, name: 'Email Sub', trade: 'Paint', email: 'sub@example.com', phone: '316-555-0100' }];
      let emailedSub = null, emailedLink = null, navCalled = false;
      const origSend = window._sendSubInviteEmail, origNav = window._subInviteNavigate;
      window._sendSubInviteEmail = (sub, link) => { emailedSub = sub; emailedLink = link; return Promise.resolve({ ok: true, id: 'em_1' }); };
      window._subInviteNavigate = () => { navCalled = true; };
      await _inviteSubToTradeDesk(0);
      window._sendSubInviteEmail = origSend; window._subInviteNavigate = origNav;
      return { emailed: emailedSub && emailedSub.email, linkOk: !!emailedLink && emailedLink.includes('sub_invite'), navCalled, invitedAt: S.subcontractors[0].tdInvitedAt };
    });
    // Email wins over phone — one channel per invite, never both.
    expect(result.emailed).toBe('sub@example.com');
    expect(result.linkOk).toBe(true);
    expect(result.navCalled).toBe(false);
    expect(result.invitedAt).toBeTruthy();
  });

  test('_inviteSubToTradeDesk email failure falls back to the person-to-person text composer', async () => {
    const result = await page.evaluate(async () => {
      S.subcontractors = [{ id: 1, name: 'Fallback Sub', email: 'sub@example.com', phone: '316-555-0100' }];
      let navHref = null;
      const origSend = window._sendSubInviteEmail, origNav = window._subInviteNavigate;
      window._sendSubInviteEmail = () => Promise.resolve({ ok: false, reason: 'network' });
      window._subInviteNavigate = (href) => { navHref = href; };
      await _inviteSubToTradeDesk(0);
      window._sendSubInviteEmail = origSend; window._subInviteNavigate = origNav;
      return navHref;
    });
    expect(result).toContain('sms:3165550100');
  });

  test('_inviteSubToTradeDesk suppressed address: no sms fallback (they opted out — respect it)', async () => {
    const result = await page.evaluate(async () => {
      S.subcontractors = [{ id: 1, name: 'Opted Out', email: 'no@example.com', phone: '316-555-0100' }];
      let navCalled = false;
      const origSend = window._sendSubInviteEmail, origNav = window._subInviteNavigate;
      window._sendSubInviteEmail = () => Promise.resolve({ ok: false, reason: 'suppressed' });
      window._subInviteNavigate = () => { navCalled = true; };
      await _inviteSubToTradeDesk(0);
      window._sendSubInviteEmail = origSend; window._subInviteNavigate = origNav;
      return navCalled;
    });
    expect(result).toBe(false);
  });

  test('_sendSubInviteEmail without an email or while signed out returns {ok:false}, never throws', async () => {
    const result = await page.evaluate(async () => {
      const noEmail = await _sendSubInviteEmail({ name: 'X' });
      const nullSub = await _sendSubInviteEmail(null);
      return { noEmail: noEmail.ok, noEmailReason: noEmail.reason, nullSub: nullSub.ok };
    });
    expect(result.noEmail).toBe(false);
    expect(result.noEmailReason).toBe('no-email');
    expect(result.nullSub).toBe(false);
  });

  test('_inviteSubToTradeDesk with an invalid index is a safe no-op', async () => {
    const ok = await page.evaluate(async () => {
      S.subcontractors = [];
      try { await _inviteSubToTradeDesk(0); await _inviteSubToTradeDesk(null); await _inviteSubToTradeDesk(-1); return true; }
      catch (e) { return false; }
    });
    expect(ok).toBe(true);
  });

  test('_subInviteLink with a grant token appends &grant=; without stays clean', async () => {
    const result = await page.evaluate(() => {
      S.bname = 'Torres Electric';
      const withTok = _subInviteLink({ name: 'Dana' }, 'abc123def4567890');
      const withoutTok = _subInviteLink({ name: 'Dana' });
      return { withTok, withoutTok };
    });
    expect(result.withTok).toContain('&grant=abc123def4567890');
    expect(result.withoutTok).not.toContain('grant=');
  });

  test('_subPaymentHistory gathers expense + legacy job.subs payments for ONE sub, deduped and sorted', async () => {
    const result = await page.evaluate(() => {
      const savedE = expenses.slice(), savedJ = jobs.slice();
      S.subcontractors = [{ id: 71, name: 'History Sub', trade: 'Tile' }];
      expenses.length = 0; jobs.length = 0;
      expenses.push(
        { id: 1, cat: 'subs', subId: 71, amount: 500, date: '2026-02-01', job_name: 'Kitchen remodel' },      // by subId
        { id: 2, cat: 'Subcontractors', vendor: 'history sub', amount: 300, date: '2026-01-01' },              // by vendor name (case-insensitive)
        { id: 3, cat: 'subs', subId: 99, amount: 999, date: '2026-03-01' },                                    // different sub — excluded
        { id: 4, cat: 'materials', vendor: 'History Sub', amount: 50, date: '2026-04-01' },                    // not a sub expense — excluded
        { id: 5, cat: 'subs', subId: 71, amount: 200, date: '2026-05-01', subPayKey: '801:0' },                // counted here...
      );
      jobs.push({ id: 801, name: 'Bath job', client_id: null, subs: [
        { subId: 71, paid: true, paidDate: '2026-05-01', amount: 200 },   // ...so this legacy row dedupes out (subPayKey 801:0)
        { subId: 71, paid: true, paidDate: '2025-12-01', amount: 400 },   // legacy row, counts
        { subId: 71, paid: false, amount: 123 },                          // unpaid — excluded
      ]});
      const rows = _subPaymentHistory(S.subcontractors[0]);
      const nullCase = _subPaymentHistory(null);
      expenses.length = 0; savedE.forEach(e => expenses.push(e));
      jobs.length = 0; savedJ.forEach(j => jobs.push(j));
      return { rows, nullLen: nullCase.length };
    });
    expect(result.nullLen).toBe(0);
    expect(result.rows.length).toBe(4); // 500 + 300 + 200(expense) + 400(legacy) — not the 999/50/unpaid/duped rows
    expect(result.rows.reduce((s, r) => s + r.amount, 0)).toBe(1400);
    expect(result.rows[0].date).toBe('2025-12-01'); // sorted oldest-first
    // THE PRIVACY CONTRACT: date + amount + job address. Nothing else ever
    // crosses to the sub — no job names/descriptions (they can carry the
    // GC's client details), no notes, no client info.
    result.rows.forEach(r => expect(Object.keys(r).sort()).toEqual(['addr', 'amount', 'date']));
  });

  test('_seedFromSubInviteGrant golden path: inviter becomes a client, payments become linked income rows', async () => {
    const result = await page.evaluate(() => {
      const savedC = clients.slice(), savedI = income.slice();
      clients.length = 0; income.length = 0;
      const ok = _seedFromSubInviteGrant({
        v: 1,
        business: { name: 'Torres Electric', phone: '316-555-9000', email: 'gc@torres.com', addr: '9 Volt St, Wichita, KS' },
        payments: [
          // 'job' simulates a tampered/legacy payload — the seeder must ignore it
          { date: '2026-03-05', amount: 850, job: 'Panel swap', addr: '12 Main St' },
          { date: '2026-04-10', amount: 1200, addr: '' },
          { date: '2026-05-01', amount: 0 },            // zero — skipped
          { date: '2026-05-02', amount: -50 },          // negative — skipped
          null,                                          // garbage — skipped
        ],
      });
      const out = {
        ok,
        clientCount: clients.length,
        clientName: clients[0] && clients[0].name,
        incomeCount: income.length,
        allLinked: income.every(r => r.client_id === clients[0].id && r.client_name === 'Torres Electric'),
        dateFormat: income[0] && income[0].date,
        total: income.reduce((s, r) => s + r.amount, 0),
        notesHaveSource: income.every(r => (r.notes || '').includes('Imported from Torres Electric')),
        notesHaveAddr: (income[0].notes || '').includes('12 Main St'),
        notesLeakJobName: income.some(r => (r.notes || '').includes('Panel swap')),
      };
      clients.length = 0; savedC.forEach(c => clients.push(c));
      income.length = 0; savedI.forEach(r => income.push(r));
      return out;
    });
    expect(result.ok).toBe(true);
    expect(result.clientCount).toBe(1);
    expect(result.clientName).toBe('Torres Electric');
    expect(result.incomeCount).toBe(2);
    expect(result.allLinked).toBe(true);
    expect(result.dateFormat).toBe('20260305'); // matches the manual-income writer's YYYYMMDD shape
    expect(result.total).toBe(2050);
    expect(result.notesHaveSource).toBe(true);
    expect(result.notesHaveAddr).toBe(true);   // address kept — mileage records
    expect(result.notesLeakJobName).toBe(false); // job names NEVER cross the pipe
  });

  test('_seedFromSubInviteGrant rejects a grant with no business, tolerates non-array payments', async () => {
    const result = await page.evaluate(() => {
      const savedC = clients.slice(), savedI = income.slice();
      clients.length = 0; income.length = 0;
      const noBusiness = _seedFromSubInviteGrant({ payments: [{ date: '2026-01-01', amount: 100 }] });
      const nullGrant = _seedFromSubInviteGrant(null);
      const afterRejects = { clients: clients.length, income: income.length };
      const noPayments = _seedFromSubInviteGrant({ business: { name: 'Lead Only Co' }, payments: 'not-an-array' });
      const out = { noBusiness, nullGrant, afterRejects, noPayments, clientCount: clients.length, incomeCount: income.length };
      clients.length = 0; savedC.forEach(c => clients.push(c));
      income.length = 0; savedI.forEach(r => income.push(r));
      return out;
    });
    expect(result.noBusiness).toBe(false);
    expect(result.nullGrant).toBe(false);
    expect(result.afterRejects).toEqual({ clients: 0, income: 0 });
    expect(result.noPayments).toBe(true); // lead alone is still worth seeding
    expect(result.clientCount).toBe(1);
    expect(result.incomeCount).toBe(0);
  });

  test('_redeemSubInviteGrant with no pending token returns false; a pending token is consumed exactly once', async () => {
    const result = await page.evaluate(async () => {
      localStorage.removeItem('_pendingSubInviteGrant');
      const none = await _redeemSubInviteGrant();
      localStorage.setItem('_pendingSubInviteGrant', 'deadbeefdeadbeefdeadbeefdeadbeef');
      let attempted;
      try { attempted = await _redeemSubInviteGrant(); } catch (e) { attempted = 'threw'; }
      return { none, attempted, stashGone: !localStorage.getItem('_pendingSubInviteGrant') };
    });
    expect(result.none).toBe(false);
    expect(result.attempted).not.toBe('threw');
    expect(result.stashGone).toBe(true); // one attempt only — never re-fires on later boots
  });

  test('_bizLinkForRosterId matches by roster id for MY gc links only, never by name', async () => {
    const result = await page.evaluate(() => {
      // _supaUser is a script-scoped let — assign the binding directly, not window.*
      const origLinks = _bizLinks, origUser = _supaUser;
      if (!_supaUser) _supaUser = { id: 'me-test-uid' };
      const me = String(_supaUser.id);
      _bizLinks = [
        { gc_user_id: me, sub_user_id: 'sub-1', sub_roster_id: '777', sub_business_name: 'Dana Drywall LLC' },
        { gc_user_id: 'someone-else', sub_user_id: 'sub-2', sub_roster_id: '888', sub_business_name: 'Not Mine' },
      ];
      const mine = _bizLinkForRosterId(777);
      const notMine = _bizLinkForRosterId(888);
      const missing = _bizLinkForRosterId(999);
      const nullId = _bizLinkForRosterId(null);
      _bizLinks = origLinks; _supaUser = origUser;
      return { mine: mine && mine.sub_business_name, notMine, missing, nullId };
    });
    expect(result.mine).toBe('Dana Drywall LLC');
    expect(result.notMine).toBe(null);
    expect(result.missing).toBe(null);
    expect(result.nullId).toBe(null);
  });

  test('_paymentOfferToIncome converts an offer to a linked income row (client matched by payer name)', async () => {
    const result = await page.evaluate(() => {
      const savedC = clients.slice();
      clients.length = 0;
      clients.push({ id: 4242, name: 'Torres Electric', phone: '', addr: '' });
      // job_label simulates a tampered offer row — the converter must ignore it
      const row = _paymentOfferToIncome({ id: 9, gc_business_name: 'torres electric', amount: 1200, paid_date: '2026-07-01', job_label: 'Rough-in', job_addr: '5 Amp Way' });
      const noClient = _paymentOfferToIncome({ id: 10, gc_business_name: 'Unknown GC', amount: 300, paid_date: '2026-07-02' });
      const badAmount = _paymentOfferToIncome({ id: 11, gc_business_name: 'X', amount: 0 });
      const nullOffer = _paymentOfferToIncome(null);
      clients.length = 0; savedC.forEach(c => clients.push(c));
      return { row, noClientId: noClient.client_id, noClientName: noClient.client_name, badAmount, nullOffer };
    });
    expect(result.row.client_id).toBe(4242); // case-insensitive payer match
    expect(result.row.client_name).toBe('torres electric');
    expect(result.row.amount).toBe(1200);
    expect(result.row.date).toBe('20260701'); // canonical YYYYMMDD income shape
    expect(result.row.notes).not.toContain('Rough-in'); // job names NEVER cross the pipe
    expect(result.row.notes).toContain('5 Amp Way');    // address kept — mileage records
    expect(result.noClientId).toBe(null);
    expect(result.noClientName).toBe('Unknown GC');
    expect(result.badAmount).toBe(null);
    expect(result.nullOffer).toBe(null);
  });

  test('accept-model inbox UI is fully deleted — auto-land replaced it (no orphaned entry points)', async () => {
    const result = await page.evaluate(() => ({
      offersHtml: typeof window._paymentOffersHTML,
      decide: typeof window._decidePaymentOffer,
      render: typeof window.renderPaymentOffers,
      load: typeof window._loadPaymentOffers,
      mount: document.querySelectorAll('#payment-offers').length,
      ingest: typeof window._ingestPipeInbox,
    }));
    expect(result.offersHtml).toBe('undefined');
    expect(result.decide).toBe('undefined');
    expect(result.render).toBe('undefined');
    expect(result.load).toBe('undefined');
    expect(result.mount).toBe(0);
    expect(result.ingest).toBe('function'); // the replacement exists
  });

  test('_pipePayerClient: one client per GC — case-insensitive match, bare lead when missing, NEVER stores addresses', async () => {
    const result = await page.evaluate(() => {
      const savedC = clients.slice();
      clients.length = 0;
      clients.push({ id: 5001, name: 'Torres Electric', phone: '316', addr: '9 Volt St' });
      const matched = _pipePayerClient('torres electric');
      const before = clients.length;
      const created = _pipePayerClient('BuildRight Homes');
      const again = _pipePayerClient('buildright homes'); // 2nd property → SAME record
      const nullCase = _pipePayerClient('');
      const out = {
        matchedId: matched && matched.id, before, after: clients.length,
        createdAddr: created && created.addr,
        createdExtra: created && (created.extraAddresses || []).length,
        sameId: !!(created && again && created.id === again.id),
        nullCase,
      };
      clients.length = 0; savedC.forEach(c => clients.push(c));
      return out;
    });
    expect(result.matchedId).toBe(5001);
    expect(result.before).toBe(1);
    expect(result.after).toBe(2); // exactly one new record for the builder
    // THE MULTI-PROPERTY RULE: addresses live on each job/income row, never
    // on the client — a builder with 300 lots stays ONE clean client card.
    expect(result.createdAddr).toBe('');
    expect(result.createdExtra).toBe(0);
    expect(result.sameId).toBe(true);
    expect(result.nullCase).toBe(null);
  });

  test('_pipePayerClient identity is the GC ACCOUNT id: rename-proof, and two same-name GCs never merge', async () => {
    const result = await page.evaluate(() => {
      const savedC = clients.slice();
      clients.length = 0;
      const first = _pipePayerClient('Torres Electric', 'gc-uid-1');
      const renamed = _pipePayerClient('Torres Electric LLC', 'gc-uid-1'); // same GC, new name
      const imposter = _pipePayerClient('Torres Electric', 'gc-uid-2');   // DIFFERENT GC, same name
      const out = {
        count: clients.length,
        sameCard: !!(first && renamed && first.id === renamed.id),
        imposterSeparate: !!(imposter && first && imposter.id !== first.id),
        distinctIds: new Set(clients.map(c => c.id)).size === clients.length, // same-ms creates collide-proof
        firstStamp: first && first.gcLinkId,
        imposterStamp: imposter && imposter.gcLinkId,
      };
      clients.length = 0; savedC.forEach(c => clients.push(c));
      return out;
    });
    expect(result.sameCard).toBe(true);        // rename → SAME card (identity is the account, not the name)
    expect(result.imposterSeparate).toBe(true); // same name, different GC → separate card, never merged
    expect(result.count).toBe(2);
    expect(result.distinctIds).toBe(true);
    expect(result.firstStamp).toBe('gc-uid-1');
    expect(result.imposterStamp).toBe('gc-uid-2');
  });

  test('_pipePayerClient adopts the referral-seeded lead by name and stamps it — but never a card stamped for another GC', async () => {
    const result = await page.evaluate(() => {
      const savedC = clients.slice();
      clients.length = 0;
      clients.push({ id: 8001, name: 'BuildRight Homes', addr: '', gcLinkId: '' }); // pre-stamp-era seed
      const adopted = _pipePayerClient('buildright homes', 'gc-uid-9');
      const out = { adoptedId: adopted && adopted.id, stamp: clients[0].gcLinkId, count: clients.length };
      clients.length = 0; savedC.forEach(c => clients.push(c));
      return out;
    });
    expect(result.adoptedId).toBe(8001);   // adopted, not duplicated
    expect(result.stamp).toBe('gc-uid-9'); // stamped on first contact
    expect(result.count).toBe(1);
  });

  test('_seedFromSubInviteGrant stamps the payer card with the inviter account id from the RPC payload', async () => {
    const result = await page.evaluate(() => {
      const savedC = clients.slice(), savedI = income.slice();
      clients.length = 0; income.length = 0;
      _seedFromSubInviteGrant({ business: { name: 'Stamped GC' }, payments: [], gcUserId: 'gc-uuid-42' });
      const stamped = clients[0] && clients[0].gcLinkId;
      clients.length = 0; income.length = 0;
      _seedFromSubInviteGrant({ business: { name: 'Legacy GC' }, payments: [] }); // no gcUserId in payload
      const legacy = clients[0] && clients[0].gcLinkId;
      clients.length = 0; savedC.forEach(c => clients.push(c));
      income.length = 0; savedI.forEach(r => income.push(r));
      return { stamped, legacy };
    });
    expect(result.stamped).toBe('gc-uuid-42');
    expect(result.legacy).toBe(''); // tolerates a payload without the stamp
  });

  test('_referralRewardCardHTML: empty until a referral converts, then shows free-months earned; escapes names', async () => {
    const result = await page.evaluate(() => ({
      none: _referralRewardCardHTML([]),
      nullCase: _referralRewardCardHTML(null),
      one: _referralRewardCardHTML([
        { referred_business_name: 'Torres Electric', reward_type: 'free_month', reward_value: 1, status: 'pending' },
      ]),
      three: _referralRewardCardHTML([
        { referred_business_name: 'A Co', reward_type: 'free_month', reward_value: 1, status: 'pending' },
        { referred_business_name: 'B Co', reward_type: 'free_month', reward_value: 1, status: 'pending' },
        { referred_business_name: '<img src=x onerror=alert(1)>', reward_type: 'free_month', reward_value: 1, status: 'applied' },
      ]),
    }));
    expect(result.none).toBe('');       // invisible until someone converts
    expect(result.nullCase).toBe('');
    // 2-for-1: one signup isn't a free month yet — it shows progress toward it.
    expect(result.one).toContain('1 referral — 1 more to a free month');
    expect(result.one).toContain('Torres Electric');
    // three signups → floor(3/2) = 1 free month earned, 1 sitting toward the next.
    expect(result.three).toContain('1 free month earned');
    expect(result.three).toContain('1 more paid referral earns another free month');
    expect(result.three).not.toContain('<img src=x'); // name escaped
    expect(result.three).toContain('&lt;img');
  });

  test('_paymentOfferToIncome: explicit forceClientId beats the name-match fallback', async () => {
    const result = await page.evaluate(() => {
      const savedC = clients.slice();
      clients.length = 0;
      clients.push({ id: 4242, name: 'Torres Electric' }); // name-match decoy
      const forced = _paymentOfferToIncome({ gc_business_name: 'Torres Electric', amount: 100, paid_date: '2026-07-01' }, 9999);
      const fallback = _paymentOfferToIncome({ gc_business_name: 'Torres Electric', amount: 100, paid_date: '2026-07-01' });
      clients.length = 0; savedC.forEach(c => clients.push(c));
      return { forcedId: forced.client_id, fallbackId: fallback.client_id };
    });
    expect(result.forcedId).toBe(9999);   // ingest's account-id resolution wins
    expect(result.fallbackId).toBe(4242); // bare call still name-matches
  });

  test('hostile GC strings land ESCAPED: toast shows the payload as text, no element injection (showToast uses innerHTML)', async () => {
    const result = await page.evaluate(async () => {
      const savedJ = jobs.slice(), savedC = clients.slice();
      const savedFrom = _supa.from, savedEnabled = window.supaEnabled, savedUser = _supaUser;
      jobs.length = 0; clients.length = 0;
      document.querySelectorAll('.toast').forEach(t => t.remove());
      window.supaEnabled = () => true;
      _supaUser = { id: 'sub-test-uid' };
      _pipeIngestLast = 0; // clear the 60s debounce from earlier tests
      const HOSTILE = '<img src=x onerror="window.__pipeXss=1">';
      function stubTable(result) {
        const chain = { eq: () => chain, select: () => Promise.resolve(result) };
        return { update: () => chain };
      }
      _supa.from = (table) => {
        if (table === 'job_assignments') return stubTable({
          data: [{ id: 601, gc_user_id: 'gc-evil', sub_user_id: 'sub-test-uid',
            job_addr: HOSTILE, start_date: '2026-08-01', gc_business_name: HOSTILE, status: 'received' }],
          error: null,
        });
        if (table === 'payment_offers') return stubTable({
          data: [{ id: 602, gc_user_id: 'gc-evil', sub_user_id: 'sub-test-uid',
            amount: 500, paid_date: '2026-08-01', job_addr: '', gc_business_name: HOSTILE, status: 'accepted' }],
          error: null,
        });
        return savedFrom(table);
      };
      await _ingestPipeInbox(true);
      await new Promise(r => setTimeout(r, 50));
      const toasts = Array.from(document.querySelectorAll('.toast'));
      const out = {
        toastCount: toasts.length,
        injectedImgs: toasts.reduce((n, t) => n + t.querySelectorAll('img').length, 0),
        xssFired: window.__pipeXss === 1,
        textShowsPayload: toasts.some(t => (t.textContent || '').includes('<img src=x')),
        clientStamped: (clients.find(c => c.gcLinkId === 'gc-evil') || {}).gcLinkId,
        jobLanded: jobs.length,
        incomeLanded: income.filter(r => r.client_name === HOSTILE).length,
      };
      document.querySelectorAll('.toast').forEach(t => t.remove());
      delete window.__pipeXss;
      const cleanIncome = income.filter(r => r.client_name !== HOSTILE);
      income.length = 0; cleanIncome.forEach(r => income.push(r));
      _supa.from = savedFrom; window.supaEnabled = savedEnabled; _supaUser = savedUser;
      jobs.length = 0; savedJ.forEach(j => jobs.push(j));
      clients.length = 0; savedC.forEach(c => clients.push(c));
      return out;
    });
    expect(result.toastCount).toBeGreaterThanOrEqual(2); // payment + assignment toasts both fired
    expect(result.injectedImgs).toBe(0);                 // no element made it into the DOM
    expect(result.xssFired).toBe(false);                 // the onerror never executed
    expect(result.textShowsPayload).toBe(true);          // payload visible as inert TEXT
    expect(result.clientStamped).toBe('gc-evil');        // one card for the GC, account-id identity
    expect(result.jobLanded).toBe(1);
    expect(result.incomeLanded).toBe(1);
  });

  test('_importPipeHistory: adds offered payments tied to the linked card, collision-proof ids, escaped toast', async () => {
    const result = await page.evaluate(() => {
      const savedI = income.slice();
      income.length = 0;
      document.querySelectorAll('.toast').forEach(t => t.remove());
      income.push({ id: 777, client_id: 9, client_name: 'x', amount: 1, date: '20260101', type: 'Job payment' });
      // Two of the four collide with an existing id / each other's base — ids must stay unique.
      _importPipeHistory('<b>Torres</b> Electric', 42, [
        { date: '2026-06-14', amount: 1200, addr: '44 Lot Way' },
        { date: '2026-06-28', amount: 950, addr: '17 Lot Way' },
        { amount: 0, addr: 'skip me' },      // zero → skipped
        { amount: 500 },                      // no date/addr still imports
      ]);
      const mine = income.filter(r => r.client_id === 42);
      const ids = mine.map(r => r.id);
      const toasts = Array.from(document.querySelectorAll('.toast'));
      const out = {
        added: mine.length,
        allTiedToCard: mine.every(r => r.client_id === 42),
        uniqueIds: new Set(ids).size === ids.length && !ids.includes(777),
        firstAddrInNotes: (mine.find(r => r.amount === 1200) || {}).notes,
        dateFormatted: (mine.find(r => r.amount === 1200) || {}).date,
        noJobNameLeak: mine.every(r => !/kitchen|remodel/i.test(r.notes || '')),
        injectedTags: toasts.reduce((n, t) => n + t.querySelectorAll('b').length, 0),
        toastText: toasts.map(t => t.textContent || '').join(' '),
      };
      document.querySelectorAll('.toast').forEach(t => t.remove());
      income.length = 0; savedI.forEach(r => income.push(r));
      return out;
    });
    expect(result.added).toBe(3);                       // the $0 row is skipped
    expect(result.allTiedToCard).toBe(true);
    expect(result.uniqueIds).toBe(true);                // never collides with id 777 or each other
    expect(result.firstAddrInNotes).toContain('44 Lot Way');
    expect(result.dateFormatted).toBe('20260614');      // YYYYMMDD, dashes stripped
    expect(result.noJobNameLeak).toBe(true);            // scope: amount+date+addr only
    expect(result.injectedTags).toBe(0);                // business name escaped in the toast
    expect(result.toastText).toContain('<b>Torres</b> Electric');
  });

  test('_redeemSubInviteGrantForExisting: forges the card + OFFERS history (never force-seeds), consumes the token', async () => {
    const result = await page.evaluate(async () => {
      const savedRpc = _supa.rpc, savedEnabled = window.supaEnabled, savedUser = _supaUser;
      const savedC = clients.slice(), savedI = income.slice();
      const savedZ = window.zConfirm;
      clients.length = 0; income.length = 0;
      window.supaEnabled = () => true;
      _supaUser = { id: 'existing-sub-uid' };
      localStorage.setItem('_pendingSubInviteGrant', 'a'.repeat(32));
      let zConfirmCalled = false, zTitle = '';
      window.zConfirm = (msg, onYes, opts) => { zConfirmCalled = true; zTitle = (opts && opts.title) || ''; }; // capture, don't auto-yes
      _supa.rpc = () => Promise.resolve({ data: {
        gcUserId: 'gc-existing', business: { name: 'Torres Electric', phone: '316-555-9000', email: 'gc@t.com', addr: '9 Volt St' },
        payments: [{ date: '2026-06-14', amount: 1200, addr: '44 Lot Way' }, { date: '2026-07-05', amount: 900, addr: '9 Parade Cir' }],
      }, error: null });
      const ok = await _redeemSubInviteGrantForExisting();
      const card = clients.find(c => c.gcLinkId === 'gc-existing');
      const out = {
        ok,
        cardMade: !!card,
        cardName: card && card.name,
        cardPhone: card && card.phone,               // enriched from payload
        tokenCleared: localStorage.getItem('_pendingSubInviteGrant') === null,
        forceSeededIncome: income.length,            // MUST be 0 — history is offered, not forced
        offered: zConfirmCalled,
        offerTitle: zTitle,
      };
      _supa.rpc = savedRpc; window.supaEnabled = savedEnabled; _supaUser = savedUser; window.zConfirm = savedZ;
      clients.length = 0; savedC.forEach(c => clients.push(c));
      income.length = 0; savedI.forEach(r => income.push(r));
      localStorage.removeItem('_pendingSubInviteGrant');
      return out;
    });
    expect(result.ok).toBe(true);
    expect(result.cardMade).toBe(true);
    expect(result.cardName).toBe('Torres Electric');
    expect(result.cardPhone).toBe('316-555-9000');   // bare card enriched from the payload
    expect(result.tokenCleared).toBe(true);          // single-use, never re-fires
    expect(result.forceSeededIncome).toBe(0);        // the key difference from a new account
    expect(result.offered).toBe(true);               // history import is OFFERED
    expect(result.offerTitle).toContain('Torres Electric');
  });

  test('END-TO-END "I already use TradeDesk": sign-in links the two, imports financial history, THEN a job + a payment flow onto the SAME linked card', async () => {
    const result = await page.evaluate(async () => {
      const savedRpc = _supa.rpc, savedFrom = _supa.from, savedEnabled = window.supaEnabled, savedUser = _supaUser, savedZ = window.zConfirm;
      const savedC = clients.slice(), savedI = income.slice(), savedJ = jobs.slice();
      clients.length = 0; income.length = 0; jobs.length = 0;
      window.supaEnabled = () => true;
      _supaUser = { id: 'existing-sub-uid' };
      // Existing user taps "Add ... to my books" — auto-accept the offer so the
      // financial history actually imports (not just gets offered).
      window.zConfirm = (msg, onYes) => { if (typeof onYes === 'function') onYes(); };

      // ── 1. Sign-in redemption forges the link + card, imports history ───────
      localStorage.setItem('_pendingSubInviteGrant', 'e'.repeat(32));
      _supa.rpc = () => Promise.resolve({ data: {
        gcUserId: 'gc-existing',
        business: { name: 'Torres Electric', phone: '316-555-9000', email: 'gc@t.com', addr: '9 Volt St' },
        payments: [{ date: '2026-06-14', amount: 1200, addr: '44 Lot Way' }],  // HISTORY
      }, error: null });
      await _redeemSubInviteGrantForExisting();

      // ── 2. The live pipe then delivers a NEW job + a NEW payment ────────────
      function stubTable(rows) {
        const chain = { eq: () => chain, select: () => Promise.resolve({ data: rows, error: null }) };
        return { update: () => chain };
      }
      _supa.from = (table) => {
        if (table === 'job_assignments') return stubTable([{ id: 9101, gc_user_id: 'gc-existing', sub_user_id: 'existing-sub-uid',
          job_addr: '9 Newpipe Way', start_date: '2026-08-02', gc_business_name: 'Torres Electric', status: 'received' }]);
        if (table === 'payment_offers') return stubTable([{ id: 9102, gc_user_id: 'gc-existing', sub_user_id: 'existing-sub-uid',
          amount: 777, paid_date: '2026-08-02', job_addr: '9 Newpipe Way', gc_business_name: 'Torres Electric', status: 'accepted' }]);
        return savedFrom(table);
      };
      // Clear the ingest guard + debounce a prior test in this shared-state block
      // may have left dirty, so force:true actually runs.
      _pipeIngestRunning = false; _pipeIngestLast = 0;
      await _ingestPipeInbox(true);
      await new Promise(r => setTimeout(r, 50));

      const card = clients.find(c => c.gcLinkId === 'gc-existing');
      const cid = card && card.id;
      const out = {
        cardCount: clients.filter(c => c.gcLinkId === 'gc-existing').length,     // exactly ONE card = one link
        historyOnCard: income.some(r => r.client_id === cid && r.amount === 1200), // financial history imported
        pipePaymentOnCard: income.some(r => r.client_id === cid && r.amount === 777), // NEW payment flowed in
        jobOnCard: jobs.some(j => j.client_id === cid && j.addr === '9 Newpipe Way'), // NEW job landed
        jobIsGeneric: jobs.every(j => !/44 Lot Way|Volt St|kitchen|remodel/i.test(j.name || '')), // no PII/desc in job name
        allIncomeTiedToCard: income.filter(r => r.amount === 1200 || r.amount === 777).every(r => r.client_id === cid),
      };
      document.querySelectorAll('.toast').forEach(t => t.remove());
      _supa.rpc = savedRpc; _supa.from = savedFrom; window.supaEnabled = savedEnabled; _supaUser = savedUser; window.zConfirm = savedZ;
      clients.length = 0; savedC.forEach(c => clients.push(c));
      income.length = 0; savedI.forEach(r => income.push(r));
      jobs.length = 0; savedJ.forEach(j => jobs.push(j));
      localStorage.removeItem('_pendingSubInviteGrant');
      return out;
    });
    expect(result.cardCount).toBe(1);              // one link, one clean card (multi-property safe)
    expect(result.historyOnCard).toBe(true);       // financial history imported on link
    expect(result.pipePaymentOnCard).toBe(true);   // a later payment lands on the SAME card
    expect(result.jobOnCard).toBe(true);           // a later job assignment lands on the SAME card
    expect(result.jobIsGeneric).toBe(true);        // job name leaks no address/description
    expect(result.allIncomeTiedToCard).toBe(true); // every financial detail ties to the one card
  });

  // ── Sub→GC bid flow (the reverse pipe: sub prices, GC signs) ───────────────
  test('_sendBidToGC: sends amount+scope+address to a LINKED GC only; no link → no-op; scope only', async () => {
    const result = await page.evaluate(async () => {
      const savedFrom = _supa.from, savedEnabled = window.supaEnabled, savedUser = _supaUser, savedLinks = _bizLinks;
      window.supaEnabled = () => true;
      _supaUser = { id: 'sub-uid' };
      let inserted = null;
      _supa.from = (t) => t === 'sub_bids'
        ? { insert: (row) => { inserted = row; return Promise.resolve({ error: null }); } }
        : savedFrom(t);
      // Linked to gc-1, NOT to gc-nope.
      _bizLinks = [{ gc_user_id: 'gc-1', sub_user_id: 'sub-uid', gc_business_name: 'BuildRight', sub_business_name: 'Dana Drywall' }];
      window._bizLinksKicked = true;
      const okLinked = await _sendBidToGC({ gcUid: 'gc-1', addr: '44 Lot Way', amount: 3200, scope: 'Hang + finish 3 bd', lineCount: 4 });
      const rowLinked = inserted; inserted = null;
      const okNoLink = await _sendBidToGC({ gcUid: 'gc-nope', addr: '9 X St', amount: 100, scope: 'x' });
      _supa.from = savedFrom; window.supaEnabled = savedEnabled; _supaUser = savedUser; _bizLinks = savedLinks;
      return { okLinked, okNoLink, rowLinked, insertedAfterNoLink: inserted };
    });
    expect(result.okLinked).toBe(true);
    expect(result.rowLinked.sub_user_id).toBe('sub-uid');
    expect(result.rowLinked.gc_user_id).toBe('gc-1');
    expect(result.rowLinked.amount).toBe(3200);
    expect(result.rowLinked.job_addr).toBe('44 Lot Way');
    expect(result.rowLinked.scope).toBe('Hang + finish 3 bd');
    expect(result.rowLinked.status).toBeUndefined();     // DB defaults status='pending'
    expect(Object.keys(result.rowLinked)).not.toContain('materials'); // no cost/margin leak
    expect(result.okNoLink).toBe(false);                 // unlinked GC → no-op
    expect(result.insertedAfterNoLink).toBe(null);       // nothing sent
  });

  test('_signSubBid: GC signature approves the bid, records signer + stamps the agreed amount on the job; empty name rejected', async () => {
    const result = await page.evaluate(async () => {
      const savedFrom = _supa.from, savedEnabled = window.supaEnabled, savedUser = _supaUser, savedBids = _subBids, savedJ = jobs.slice();
      window.supaEnabled = () => true;
      _supaUser = { id: 'gc-uid' };
      let upd = null;
      _supa.from = (t) => t === 'sub_bids'
        ? { update: (row) => { upd = row; const chain = { eq: () => chain, then: (r) => r({ error: null }) }; return chain; } }
        : savedFrom(t);
      _subBids = [{ id: 55, gc_user_id: 'gc-uid', sub_user_id: 's', job_addr: '44 Lot Way', amount: 3200, scope: 'drywall', sub_business_name: 'Dana Drywall', status: 'pending' }];
      jobs.length = 0; jobs.push({ id: 900, addr: '44 Lot Way', name: 'Job — BuildRight' });
      const bad = await _signSubBid(55, '   ');           // empty → rejected, no write
      const updAfterBad = upd;
      const ok = await _signSubBid(55, 'Mike GC');
      const b = _subBids.find(x => x.id === 55);
      const job = jobs.find(j => j.id === 900);
      const out = { bad, updAfterBad, ok, status: b.status, signed: b.signed_name, updSigned: upd && upd.signed_name, jobAmt: job.subBidAmount, jobBy: job.subBidBy };
      _supa.from = savedFrom; window.supaEnabled = savedEnabled; _supaUser = savedUser; _subBids = savedBids;
      jobs.length = 0; savedJ.forEach(j => jobs.push(j));
      return out;
    });
    expect(result.bad).toBe(false);                 // no signature → not signed
    expect(result.updAfterBad).toBe(null);          // and no DB write attempted
    expect(result.ok).toBe(true);
    expect(result.status).toBe('approved');         // signed = approved
    expect(result.signed).toBe('Mike GC');          // signer recorded locally
    expect(result.updSigned).toBe('Mike GC');       // and written to the DB
    expect(result.jobAmt).toBe(3200);               // agreed price stamped on the job
    expect(result.jobBy).toBe('Dana Drywall');
  });

  test('_subBidInboxHTML: empty until a pending bid; renders Review & sign; escapes the sub name; hides decided bids', async () => {
    const result = await page.evaluate(() => ({
      none: _subBidInboxHTML([]),
      nullCase: _subBidInboxHTML(null),
      decidedOnly: _subBidInboxHTML([{ id: 1, status: 'approved', amount: 100, sub_business_name: 'X' }]),
      pending: _subBidInboxHTML([{ id: 7, status: 'pending', amount: 3200, job_addr: '44 Lot Way', scope: 'drywall', sub_business_name: '<img src=x onerror=alert(1)>' }]),
    }));
    expect(result.none).toBe('');
    expect(result.nullCase).toBe('');
    expect(result.decidedOnly).toBe('');                     // only PENDING bids show
    expect(result.pending).toContain('Review &amp; sign');   // signature entry, not one-tap approve
    expect(result.pending).toContain('_openBidReview(7)');
    expect(result.pending).not.toContain('<img src=x');      // sub name escaped
    expect(result.pending).toContain('&lt;img');
  });

  test('_openBidBuilder: opens the REAL estimator (not a quick composer), stamps GC-bid context from the payer card + address', async () => {
    const result = await page.evaluate(() => {
      const savedC = clients.slice(), savedJ = jobs.slice(), savedOpen = window._doOpenEstimate, savedCtx = window._gcBidCtx, savedCid = (typeof currentClientId !== 'undefined') ? currentClientId : undefined;
      clients.length = 0; jobs.length = 0; window._gcBidCtx = null;
      let openedWith = null;
      window._doOpenEstimate = (c, addr) => { openedWith = { cid: c && c.id, addr }; }; // stub the estimator open
      clients.push({ id: 320, name: 'BuildRight Homes', gcLinkId: 'gc-77' });
      jobs.push({ id: 410, client_id: 320, addr: '9 Parade Cir', name: 'Job — BuildRight', pipeSourced: true });
      _openBidBuilder(410);
      const ctx = window._gcBidCtx;
      // No gcLinkId → refuses (no bid without a real link)
      clients.push({ id: 999, name: 'Random', gcLinkId: '' });
      jobs.push({ id: 411, client_id: 999, addr: 'x', pipeSourced: true });
      window._gcBidCtx = null;
      _openBidBuilder(411);
      const ctxNoLink = window._gcBidCtx;
      window._doOpenEstimate = savedOpen; window._gcBidCtx = savedCtx;
      if (typeof currentClientId !== 'undefined') currentClientId = savedCid;
      clients.length = 0; savedC.forEach(c => clients.push(c));
      jobs.length = 0; savedJ.forEach(j => jobs.push(j));
      return { openedWith, ctx, ctxNoLink };
    });
    expect(result.openedWith.cid).toBe(320);          // estimator opened for the GC card
    expect(result.openedWith.addr).toBe('9 Parade Cir'); // address carried over from the pipe
    expect(result.ctx.gcUid).toBe('gc-77');           // GC-bid context stamped
    expect(result.ctx.addr).toBe('9 Parade Cir');
    expect(result.ctx.jobId).toBe(410);
    expect(result.ctxNoLink).toBe(null);              // unlinked job → no bid context, no open
  });

  test('_maybeRouteGcBid: sends the finished estimate to the GC as a bid, marks the job, clears the context', async () => {
    const result = await page.evaluate(async () => {
      const savedSend = window._sendBidToGC, savedCtx = window._gcBidCtx, savedJ = jobs.slice();
      let sent = null;
      window._sendBidToGC = (info) => { sent = info; return Promise.resolve(true); };
      jobs.length = 0; jobs.push({ id: 410, addr: '9 Parade Cir', name: 'Job — BuildRight' });
      window._gcBidCtx = { gcUid: 'gc-77', addr: '9 Parade Cir', jobId: 410, gcName: 'BuildRight' };
      const ok = await _maybeRouteGcBid(3200, 'Hang + finish drywall', 5);
      const job = jobs.find(j => j.id === 410);
      const out = { ok, sent, ctxAfter: window._gcBidCtx, jobBidSent: !!job.bidSentAt, jobBidAmt: job.bidAmount };
      // No context → returns false, sends nothing
      window._gcBidCtx = null;
      const noCtx = await _maybeRouteGcBid(100, 'x', 1);
      window._sendBidToGC = savedSend; window._gcBidCtx = savedCtx;
      jobs.length = 0; savedJ.forEach(j => jobs.push(j));
      return { ...out, noCtx, sentNoCtx: sent };
    });
    expect(result.ok).toBe(true);
    expect(result.sent.gcUid).toBe('gc-77');       // routed to the linked GC
    expect(result.sent.amount).toBe(3200);         // the estimate total
    expect(result.sent.scope).toBe('Hang + finish drywall');
    expect(result.sent.lineCount).toBe(5);         // itemized — real estimate, not a lump sum
    expect(result.ctxAfter).toBe(null);            // context cleared after send
    expect(result.jobBidSent).toBe(true);          // job flips to "Bid sent"
    expect(result.jobBidAmt).toBe(3200);
    expect(result.noCtx).toBe(false);              // no context → no-op
  });

  test('_assignmentToJob converts a claimed assignment to a calendar job carrying its OWN address', async () => {
    const result = await page.evaluate(() => ({
      golden: _assignmentToJob({ job_addr: '44 Lot Way', start_date: '2026-08-01', gc_business_name: 'BuildRight Homes' }, 5001),
      noAddr: _assignmentToJob({ job_addr: '   ', start_date: '2026-08-01', gc_business_name: 'X' }, null),
      nullCase: _assignmentToJob(null, null),
      badDate: _assignmentToJob({ job_addr: '1 Elm St', start_date: '99-badness-99', gc_business_name: 'X' }, null),
      today: todayKey(),
    }));
    expect(result.golden.addr).toBe('44 Lot Way');
    expect(result.golden.start).toBe('2026-08-01');
    expect(result.golden.client_id).toBe(5001);
    expect(result.golden.bid_id).toBe(null);   // real job row, no bid required
    expect(result.golden.value).toBe(0);       // money arrives via the payment side
    expect(result.golden.status).toBe('upcoming');
    expect(result.golden.eventType).toBe('job');
    expect(result.golden.notes).toContain('BuildRight Homes');
    expect(result.golden.pipeSourced).toBe(true); // gates the dashboard mileage shortcut
    expect(result.noAddr).toBe(null); // an assignment without an address is useless — skipped
    expect(result.nullCase).toBe(null);
    // Malformed date → today, never an Invalid Date in calendar loops
    expect(result.badDate.start).toBe(result.today);
  });

  test('_dashLogPipeMileage opens the trip modal prefilled with the job\'s own address; silent no-op if the job is gone', async () => {
    const result = await page.evaluate(() => {
      const savedJ = jobs.slice(), savedC = clients.slice();
      jobs.length = 0; clients.length = 0;
      clients.push({ id: 6001, name: 'BuildRight Homes', addr: '' });
      jobs.push({ id: 66701, client_id: 6001, addr: '44 Lot Way', pipeSourced: true });
      let opened = null, capture = null;
      const orig = window.openLogTripModal;
      window.openLogTripModal = (opts) => { capture = opts; };
      _dashLogPipeMileage(66701);
      opened = capture;               // golden-path capture, snapshotted immediately
      capture = null;
      _dashLogPipeMileage(999999);    // job missing — capture must stay null
      const missing = capture;
      window.openLogTripModal = orig;
      jobs.length = 0; savedJ.forEach(j => jobs.push(j));
      clients.length = 0; savedC.forEach(c => clients.push(c));
      return { opened, missing };
    });
    expect(result.opened.toAddress).toBe('44 Lot Way');
    expect(result.opened.clientId).toBe(6001);
    expect(result.opened.clientName).toBe('BuildRight Homes');
    expect(result.opened.purpose).toBe('Job site');
    expect(result.missing).toBe(null); // no matching job — nothing opens, no throw
  });

  test('renderDashToday shows the Log mileage shortcut ONLY on pipe-sourced jobs that have an address', async () => {
    const result = await page.evaluate(() => {
      const savedJ = jobs.slice(), savedIsEmp = _isEmployee;
      _isEmployee = false; // script-scoped let — assign the binding directly
      const today = todayKey();
      jobs.length = 0;
      jobs.push(
        { id: 77101, client_id: null, name: 'Pipe job — BuildRight Homes', addr: '44 Lot Way', start: today, days: 1, eventType: 'job', pipeSourced: true, status: 'upcoming' },
        { id: 77102, client_id: null, name: 'Hand-entered job', addr: '9 Main St', start: today, days: 1, eventType: 'job', status: 'upcoming' },
        { id: 77103, client_id: null, name: 'Pipe job, no address', addr: '', start: today, days: 1, eventType: 'job', pipeSourced: true, status: 'upcoming' },
      );
      renderDashToday();
      const html = document.getElementById('dash-today')?.innerHTML || '';
      _isEmployee = savedIsEmp;
      jobs.length = 0; savedJ.forEach(j => jobs.push(j));
      renderDashToday();
      return {
        html,
        mileageCount: (html.match(/Log mileage/g) || []).length,
        hasPipeJobBtn: html.includes('_dashLogPipeMileage(77101)'),
        hasHandJobBtn: html.includes('_dashLogPipeMileage(77102)'),
        hasNoAddrJobBtn: html.includes('_dashLogPipeMileage(77103)'),
      };
    });
    expect(result.mileageCount).toBe(1);          // pipe job WITH an address only
    expect(result.hasPipeJobBtn).toBe(true);
    expect(result.hasHandJobBtn).toBe(false);      // hand-entered job — no shortcut
    expect(result.hasNoAddrJobBtn).toBe(false);    // nothing to drive to — no shortcut
  });

  test('_offerJobToLinkedSub is a silent no-op with no address, no link, or offline', async () => {
    const result = await page.evaluate(async () => {
      const origLinks = _bizLinks;
      _bizLinks = []; // loaded, none
      const noAddr = await _offerJobToLinkedSub(901, { addr: '  ', date: '2026-08-01' });
      const noLink = await _offerJobToLinkedSub(901, { addr: '44 Lot Way', date: '2026-08-01' });
      const nullInfo = await _offerJobToLinkedSub(901, null);
      _bizLinks = origLinks;
      return { noAddr, noLink, nullInfo };
    });
    expect(result.noAddr).toBe(false);
    expect(result.noLink).toBe(false);
    expect(result.nullInfo).toBe(false);
  });

  test('_ingestPipeInbox is a silent no-op offline and while another ingest is running', async () => {
    const result = await page.evaluate(async () => {
      const offline = await _ingestPipeInbox(true);
      _pipeIngestRunning = true; // script-scoped let — assign the binding directly
      const reentrant = await _ingestPipeInbox(true);
      _pipeIngestRunning = false;
      return { offline, reentrant };
    });
    expect(result.offline).toBe(false);
    expect(result.reentrant).toBe(false);
  });

  test('a job that lands via the pipe while the sub is sitting on the dashboard appears on Today WITHOUT navigating away', async () => {
    // Regression: pg-dash is the FIRST page shown at boot, and the ingest
    // deliberately fires 1.8s after boot so it never competes with the boot
    // render — so Today paints BEFORE a same-morning assignment lands. The
    // toast fired, but the widget stayed stale until the sub left and came
    // back. Fix: the ingest re-renders pg-dash when it's the active page.
    const result = await page.evaluate(async () => {
      const savedJ = jobs.slice(), savedC = clients.slice();
      const savedFrom = _supa.from, savedEnabled = window.supaEnabled, savedUser = _supaUser;
      jobs.length = 0; clients.length = 0;
      const today = todayKey();
      window.supaEnabled = () => true;
      _supaUser = { id: 'sub-test-uid' };
      // Stub only the two tables _ingestPipeInbox touches; job_assignments
      // returns ONE claimed row, payment_offers stays empty (isolates the
      // assertion to the job-landing path). A tiny chainable stub — matches
      // the real call shape: .update(...).eq(...).eq(...).select().
      function stubTable(result) {
        const chain = { eq: () => chain, select: () => Promise.resolve(result) };
        return { update: () => chain };
      }
      _supa.from = (table) => {
        if (table === 'job_assignments') {
          return stubTable({
            data: [{ id: 501, gc_user_id: 'gc-uid', sub_user_id: 'sub-test-uid',
              job_addr: '44 Lot Way', start_date: today, gc_business_name: 'BuildRight Homes', status: 'received' }],
            error: null,
          });
        }
        if (table === 'payment_offers') return stubTable({ data: [], error: null });
        return savedFrom(table);
      };
      if (typeof goPg === 'function') goPg('pg-dash');
      const beforeHtml = document.getElementById('dash-today')?.innerHTML || '';
      const touched = await _ingestPipeInbox(true);
      const afterHtml = document.getElementById('dash-today')?.innerHTML || '';
      _supa.from = savedFrom; window.supaEnabled = savedEnabled; _supaUser = savedUser;
      const out = {
        touched, activePage: document.querySelector('.pg.active')?.id,
        hadItBefore: beforeHtml.includes('44 Lot Way'),
        hasItAfter: afterHtml.includes('44 Lot Way'),
        jobCount: jobs.length,
      };
      jobs.length = 0; savedJ.forEach(j => jobs.push(j));
      clients.length = 0; savedC.forEach(c => clients.push(c));
      return out;
    });
    expect(result.activePage).toBe('pg-dash');
    expect(result.touched).toBe(true);
    expect(result.jobCount).toBe(1);
    expect(result.hadItBefore).toBe(false);  // wasn't there when Today first painted
    expect(result.hasItAfter).toBe(true);    // ingest re-rendered Today in place
  });

  test('_saveSubAssignment shares ONLY the job address + start date with a linked sub — never desc or amount', async () => {
    const result = await page.evaluate(() => {
      const savedJ = jobs.slice(), savedSubs = S.subcontractors;
      S.subcontractors = [{ id: 901, name: 'Pipe Sub', trade: 'Drywall' }];
      jobs.length = 0;
      jobs.push({ id: 77001, name: 'Secret Client Kitchen', addr: '44 Lot Way', start: '2026-08-01', bid_id: null, client_id: null });
      let offered = null;
      const origOffer = window._offerJobToLinkedSub, origSheet = window.openJobSheet;
      window._offerJobToLinkedSub = (rosterId, info) => { offered = { rosterId, info }; return Promise.resolve(true); };
      window.openJobSheet = () => {};
      openAssignSubModal(77001, null);
      document.getElementById('asub-pick').value = '0';
      document.getElementById('asub-desc').value = 'Hang + finish — Secret Client';
      document.getElementById('asub-amount').value = '2500';
      _saveSubAssignment(77001, null);
      window._offerJobToLinkedSub = origOffer; window.openJobSheet = origSheet;
      document.getElementById('_asub-ov')?.remove();
      jobs.length = 0; savedJ.forEach(j => jobs.push(j));
      S.subcontractors = savedSubs;
      return offered;
    });
    expect(result).toBeTruthy();
    expect(String(result.rosterId)).toBe('901');
    // THE PRIVACY CONTRACT at assignment: address + start date. The work
    // description and the amount owed must never be in the payload.
    expect(Object.keys(result.info).sort()).toEqual(['addr', 'date']);
    expect(result.info.addr).toBe('44 Lot Way');
    expect(result.info.date).toBe('2026-08-01');
  });

  test('_offerPaymentToLinkedSub is a silent no-op with no link, bad amount, or offline', async () => {
    const result = await page.evaluate(async () => {
      const origLinks = _bizLinks;
      _bizLinks = []; // loaded, none
      const noLink = await _offerPaymentToLinkedSub(777, { amount: 100, date: '2026-07-01' });
      const badAmount = await _offerPaymentToLinkedSub(777, { amount: 0 });
      const nullPay = await _offerPaymentToLinkedSub(777, null);
      _bizLinks = origLinks;
      return { noLink, badAmount, nullPay };
    });
    expect(result.noLink).toBe(false);
    expect(result.badAmount).toBe(false);
    expect(result.nullPay).toBe(false);
  });

  test('markSubPaid on a linked sub fires the payment offer with amount + date + address ONLY', async () => {
    const result = await page.evaluate(async () => {
      const savedJ = jobs.slice(), savedE = expenses.slice();
      let offered = null;
      const orig = window._offerPaymentToLinkedSub;
      window._offerPaymentToLinkedSub = (rosterId, pay) => { offered = { rosterId, pay }; return Promise.resolve(true); };
      const origSheet = window.openJobSheet;
      window.openJobSheet = () => {};
      // Job carries its OWN address and has NO bid — the exact shape a live
      // flow run caught losing the address (markSubPaid used to read the
      // address only from the job's bid, never j.addr).
      jobs.push({ id: 66601, name: 'Pipe Test Job', bid_id: null, client_id: null, addr: '44 Lot Way', subs: [{ subId: 777, subName: 'Dana Lee', amount: 950, desc: 'Drywall hang' }] });
      markSubPaid(66601, 0, null);
      window._offerPaymentToLinkedSub = orig; window.openJobSheet = origSheet;
      jobs.length = 0; savedJ.forEach(j => jobs.push(j));
      expenses.length = 0; savedE.forEach(e => expenses.push(e));
      return offered;
    });
    expect(result).toBeTruthy();
    expect(String(result.rosterId)).toBe('777');
    expect(result.pay.amount).toBe(950);
    // The job's OWN address must cross (mileage records) even with no bid.
    expect(result.pay.addr).toBe('44 Lot Way');
    // THE PRIVACY CONTRACT: amount + date + job address. The job description
    // ('Drywall hang') must never be in the payload.
    expect(Object.keys(result.pay).sort()).toEqual(['addr', 'amount', 'date']);
  });

  test('referral landing shows the pre-loaded-books banner only when a grant token is pending', async () => {
    const result = await page.evaluate(() => {
      localStorage.setItem('_pendingSubInvite', JSON.stringify({ bn: 'Torres Electric', n: 'Dana', t: '' }));
      localStorage.setItem('_pendingSubInviteGrant', 'deadbeefdeadbeefdeadbeefdeadbeef');
      supaShowLogin({ force: true });
      const withGrant = document.getElementById('supa-login-overlay')?.innerHTML || '';
      document.getElementById('supa-login-overlay')?.remove();
      localStorage.removeItem('_pendingSubInviteGrant');
      supaShowLogin({ force: true });
      const withoutGrant = document.getElementById('supa-login-overlay')?.innerHTML || '';
      document.getElementById('supa-login-overlay')?.remove();
      return {
        bannerWith: withGrant.includes('already on your books'),
        bannerWithout: withoutGrant.includes('already on your books'),
      };
    });
    expect(result.bannerWith).toBe(true);
    expect(result.bannerWithout).toBe(false);
  });

  test('_claimSubReferralAttribution writes S.referredBy and clears the stash exactly once', async () => {
    const result = await page.evaluate(() => {
      delete S.referredBy;
      localStorage.setItem('_pendingSubInvite', JSON.stringify({ bn: 'Torres Electric', n: 'Dana', t: 'Drywall' }));
      const first = _claimSubReferralAttribution();
      const referred = S.referredBy && S.referredBy.bname;
      const via = S.referredBy && S.referredBy.via;
      const second = _claimSubReferralAttribution(); // stash cleared — must not double-claim
      return { first, referred, via, second, stashGone: !localStorage.getItem('_pendingSubInvite') };
    });
    expect(result.first).toBe(true);
    expect(result.referred).toBe('Torres Electric');
    expect(result.via).toBe('sub_invite');
    expect(result.second).toBe(false);
    expect(result.stashGone).toBe(true);
  });

  test('_claimSubReferralAttribution with no stash or corrupt stash returns false without throwing', async () => {
    const result = await page.evaluate(() => {
      localStorage.removeItem('_pendingSubInvite');
      const none = _claimSubReferralAttribution();
      localStorage.setItem('_pendingSubInvite', '{corrupt{{');
      const corrupt = _claimSubReferralAttribution();
      localStorage.removeItem('_pendingSubInvite');
      return { none, corrupt };
    });
    expect(result.none).toBe(false);
    expect(result.corrupt).toBe(false);
  });

  test('supaShowLogin shows the referral pitch when a sub invite is pending', async () => {
    const result = await page.evaluate(() => {
      localStorage.removeItem('_pendingEmpInvite');
      localStorage.setItem('_pendingSubInvite', JSON.stringify({ bn: 'Torres Electric', n: 'Dana Lee', t: 'Drywall' }));
      supaShowLogin({ force: true });
      const ov = document.getElementById('supa-login-overlay');
      const html = ov ? ov.innerHTML : '';
      const out = {
        found: !!ov,
        hasInviter: html.includes('Torres Electric'),
        hasFirstName: html.includes('Dana'),
        hasTrade: html.includes('drywall pros'),
        hasSignup: html.includes('Claim my free account'),
        hasSeparation: html.includes('private to you'),
      };
      ov?.remove();
      return out;
    });
    expect(result.found).toBe(true);
    expect(result.hasInviter).toBe(true);
    expect(result.hasFirstName).toBe(true);
    expect(result.hasTrade).toBe(true);
    expect(result.hasSignup).toBe(true);
    expect(result.hasSeparation).toBe(true);
  });

  test('supaShowLogin referral pitch escapes HTML in the payload (XSS safety)', async () => {
    const result = await page.evaluate(() => {
      localStorage.setItem('_pendingSubInvite', JSON.stringify({ bn: '<img src=x onerror=alert(1)>', n: 'X', t: '' }));
      supaShowLogin({ force: true });
      const html = document.getElementById('supa-login-overlay')?.innerHTML || '';
      document.getElementById('supa-login-overlay')?.remove();
      return { hasRaw: html.includes('<img src=x'), hasEscaped: html.includes('&lt;img') };
    });
    expect(result.hasRaw).toBe(false);
    expect(result.hasEscaped).toBe(true);
  });

  test('supaShowLogin({plain:true}) skips the pitch and keeps the stash for attribution', async () => {
    const result = await page.evaluate(() => {
      localStorage.setItem('_pendingSubInvite', JSON.stringify({ bn: 'Torres Electric', n: 'Dana', t: '' }));
      supaShowLogin({ force: true, plain: true });
      const html = document.getElementById('supa-login-overlay')?.innerHTML || '';
      document.getElementById('supa-login-overlay')?.remove();
      return {
        // Plain login is defined by its email/password form (present in every
        // copy revision), not by any one headline string — the redesigned login
        // dropped the old "Sign in to sync your data" subtitle.
        plainLogin: html.includes('id="supa-email"') && html.includes('id="supa-pass"'),
        noPitch: !html.includes('Claim my free account'),
        stashKept: !!localStorage.getItem('_pendingSubInvite'),
      };
    });
    expect(result.plainLogin).toBe(true);
    expect(result.noPitch).toBe(true);
    expect(result.stashKept).toBe(true);
  });

  test('employee invite outranks sub referral when both are pending', async () => {
    const result = await page.evaluate(() => {
      localStorage.setItem('_pendingEmpInvite', JSON.stringify({ cid: 'c1', eid: 1, bname: 'Boss Co', ename: 'Worker', email: 'w@x.com' }));
      localStorage.setItem('_pendingSubInvite', JSON.stringify({ bn: 'Torres Electric', n: 'Dana', t: '' }));
      supaShowLogin({ force: true });
      const html = document.getElementById('supa-login-overlay')?.innerHTML || '';
      document.getElementById('supa-login-overlay')?.remove();
      localStorage.removeItem('_pendingEmpInvite');
      return { empWins: html.includes('added you to their crew'), noSubPitch: !html.includes('Claim my free account') };
    });
    expect(result.empWins).toBe(true);
    expect(result.noSubPitch).toBe(true);
  });

  test('sub roster rows render an "Invite to TradeDesk" button, flipping to "Re-invite" after use', async () => {
    const result = await page.evaluate(() => {
      if (typeof goPg === 'function') goPg('pg-team');
      if (typeof setFleetTab === 'function') setFleetTab('team');
      S.subcontractors = [
        { id: 1, name: 'Fresh Sub', trade: 'Paint', phone: '316-555-0100' },
        { id: 2, name: 'Invited Sub', trade: 'Tile', tdInvitedAt: '2026-07-01T00:00:00Z' },
      ];
      renderTeam();
      const html = document.getElementById('team-page-subs')?.innerHTML || '';
      return {
        hasInvite: html.includes('Invite to TradeDesk'),
        hasReinvite: html.includes('Re-invite'),
      };
    });
    expect(result.hasInvite).toBe(true);
    expect(result.hasReinvite).toBe(true);
  });

  test('_saveSub on a NEW sub with a phone offers the invite; edits and phoneless subs do not', async () => {
    const result = await page.evaluate(() => {
      const asked = [];
      const origConfirm = window.zConfirm;
      window.zConfirm = (msg, onYes, opts) => { asked.push(opts && opts.title); };
      // New sub WITH phone → prompt
      S.subcontractors = [];
      openAddSubModal();
      document.getElementById('sub-name').value = 'Prompt Sub';
      document.getElementById('sub-phone').value = '316-555-0100';
      _saveSub(null);
      // New sub WITHOUT phone → no prompt
      openAddSubModal();
      document.getElementById('sub-name').value = 'Silent Sub';
      _saveSub(null);
      // EDIT of an existing sub → no prompt
      openEditSubModal(0);
      _saveSub(0);
      window.zConfirm = origConfirm;
      return asked;
    });
    expect(result.length).toBe(1);
    expect(result[0]).toContain('Set Prompt up on TradeDesk');
  });

  test('_saveSub prompt offers "Email the invite" when the new sub has an email on file', async () => {
    const result = await page.evaluate(() => {
      let captured = null;
      const origConfirm = window.zConfirm;
      window.zConfirm = (msg, onYes, opts) => { captured = { msg, yes: opts && opts.yes }; };
      S.subcontractors = [];
      openAddSubModal();
      document.getElementById('sub-name').value = 'Email Prompt Sub';
      document.getElementById('sub-email').value = 'sub@example.com';
      _saveSub(null);
      window.zConfirm = origConfirm;
      return captured;
    });
    // Channel now lives in the button label ("Email <first> the invite"); the
    // body is the warm pitch, not the channel.
    expect(result.yes).toContain('Email');
    expect(result.yes).toContain('the invite');
    expect(result.msg).toContain('set them up with the same tools');
  });

  assertNoErrors(() => page);
});
