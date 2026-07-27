// THE MULTI-PROPERTY LIFECYCLE, one client, several job sites, different
// ownership types, driven end to end on the REAL backend.
//
// Two ownership dimensions exist in the app and they are NOT the same thing:
//
//   ACCOUNT-level  (clients.js #cf-partytype → client.partyType)
//     homeowner / GC / builder / property manager / business. accountOwnsSites()
//     says a GC, builder, or PM is a PAYER who does not own the site under them,
//     which is what propIsThirdPartyOwned() and propOwnerName() key off when a
//     lien/notice has to name the real owner of record (dashboard.js:1278).
//     It also renames the client-detail section: "Properties" for an owner,
//     "Job sites" for a PM.
//
//   PROPERTY-level (clients.js #_aa-ptype → properties[addrKey].propertyType)
//     Single family / Townhouse-condo / Rental / Commercial / New construction,
//     stored per ADDRESS in a keyed map (data.js setPropertyData/_PROP_FIELDS),
//     with isRental derived from it.
//
// This flow runs a PROPERTY MANAGER (owns none of its sites) with three job
// sites of three different property types through the whole business, and adds
// a FOURTH site from inside the Drive flow, the second, easily-forgotten entry
// point into the same extraAddresses[] array:
//
//   1. create the lead as a Property manager   → real Add Client form
//   2. the section reads "Job sites", not "Properties" (ownership shows up in UI)
//   3. add job site #2, Rental property         → real Add-property modal
//   4. add job site #3, Commercial              → three sites, three types, no bleed
//   5. estimate + send against site #3 ONLY     → the right address rides the proposal
//   6. client signs                             → real sign.html, anonymous browser
//   7. schedule from the realtime popup         → the job carries site #3's address
//   8. Drive: the picker offers all three, and "+ New address for this client"
//      adds site #4 inline and uses it as the destination
//   9. reload from the cloud                    → all four sites AND their per-address
//      property types survive a real Supabase round-trip
//
//   suspect chain: clients.js saveClient/openAddAddressModal/saveAddClientAddress/
//   pickClientAddress → data.js setPropertyData/getProperty/clientAddresses/
//   propIsThirdPartyOwned → mileage.js _selectTripClient/_addrPickSaveNew →
//   cloud.js supaSaveToCloud/supaLoadFromCloud.
//
// The per-address keyed map is the real risk here: one property's type bleeding
// into another's, or surviving locally but not through the cloud. Steps 4 and 9
// exist specifically to catch that.
//
// Seed data is left in the dev account per CLAUDE.md §12.7: no cleanup.
const { test, expect } = require('./flow-test');
const { needsLiveCreds, signIn, step, report, resetLedger, tap, type, pick } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

const FLOW = 'lifecycle/multi-property';

test.describe('multi-property client, mixed ownership types (UI-driven, real backend)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  test('a property manager with four job sites keeps every address and type straight, end to end', async ({ page, browser }) => {
    // Fixed-width uniq so the typed-keystroke count is identical every run (the
    // ratchet gates on it), and so this run's seed data never collides (§12.7).
    const uniq = String(Date.now() % 100000).padStart(5, '0') + String(process.pid % 100).padStart(2, '0');
    const clientName = `MultiProp PM ${uniq}`;
    const clientPhone = '3165553' + String(uniq).slice(-3);

    const SITE1 = { street: '100 Primary Way', city: 'Wichita', type: 'Single family home' };
    const SITE2 = { label: 'Rental duplex', addr: '200 Rental Rd, Wichita KS 67206', type: 'Rental property' };
    const SITE3 = { label: 'Strip center', addr: '300 Commerce Blvd, Wichita KS 67207', type: 'Commercial' };
    const SITE4 = { addr: '400 Driveby Dr, Wichita KS 67208' }; // added from the Drive flow

    const ctx = { clientId: null, bidId: null, sent: {}, jobId: null };

    // ── 1. CREATE THE LEAD AS A PROPERTY MANAGER ──────────────────────────────
    await step(page, {
      label: '1. create the lead as a Property manager', page: 'pg-clients', role: 'contractor',
      suspect: 'clients.js saveClient (#cf-partytype) → data.js accountOwnsSites',
      ruleText: 'the party type must persist and mark the account as NOT owning its sites',
      expected: "partyType='pm' and accountOwnsSites() false",
      act: async (p) => {
        // Park the schedule-alert queue for the whole build phase: this dev account
        // accumulates signed-but-unscheduled seed bids (§12.7), and the app
        // correctly pops a full-screen "New signature!" modal for them right after
        // boot, which would swallow our taps. Step 5 releases it before OUR client signs.
        await p.evaluate(() => {
          window._showingScheduleAlert = true;
          localStorage.setItem('zp3_schedule_alerts', '[]');
          document.getElementById('_sched-alert-overlay')?.remove();
        });
        let n = 0;
        const leadsNav = await p.evaluate(() =>
          (document.getElementById('mtb-leads')?.offsetWidth > 0) ? '#mtb-leads' : '#nb-leads');
        n += await tap(p, leadsNav);
        await p.waitForSelector('#pg-leads.active', { state: 'attached', timeout: 8000 });
        n += await tap(p, '#pg-leads .tbar-r .btn-p');       // "+ New lead"
        await p.waitForSelector('#cf-name', { state: 'visible', timeout: 8000 });
        n += await type(p, '#cf-name', clientName);
        n += await type(p, '#cf-phone', clientPhone);
        n += await type(p, '#cf-street', SITE1.street);
        n += await type(p, '#cf-city', SITE1.city);
        // The ownership pick under test: a property manager does NOT own the sites
        // it sends us to, which changes the lien/notice owner and the UI wording.
        n += await pick(p, '#cf-partytype', 'Property manager');
        n += await pick(p, '#cf-ptype', SITE1.type);
        n += await pick(p, '#cf-source', 'Referral');
        await p.evaluate(() => saveClient());
        await p.waitForTimeout(500);
        return n + 1; // save tap
      },
      rule: async (p) => {
        const r = await p.evaluate((nm) => {
          const c = clients.find(x => x.name === nm);
          if (!c) return { found: false };
          return {
            found: true, id: c.id, partyType: c.partyType,
            owns: (typeof accountOwnsSites === 'function') ? accountOwnsSites(c) : null,
            thirdParty: (typeof propIsThirdPartyOwned === 'function') ? propIsThirdPartyOwned(c, c.addr) : null,
          };
        }, clientName);
        ctx.clientId = r.id || null;
        return { ok: r.found && r.partyType === 'pm' && r.owns === false && r.thirdParty === true, got: JSON.stringify(r) };
      },
    });

    // ── 2. OWNERSHIP TYPE CHANGES WHAT THE SCREEN CALLS THE ADDRESSES ─────────
    await step(page, {
      label: '2. client detail calls them "Job sites", not "Properties"', page: 'pg-client-detail', role: 'contractor',
      suspect: 'clients.js renderCDAddresses (accountOwnsSites → title/noun)',
      ruleText: 'an account that does not own its sites must not have them labelled "Properties"',
      expected: 'section reads "Job sites" and the add button reads "Add job site"',
      act: async (p) => {
        await p.evaluate((cid) => { window._cdPropsOpen = true; openClientDetail(cid, 'clients'); }, ctx.clientId);
        await p.waitForSelector('#cd-addresses-list', { state: 'visible', timeout: 8000 });
        await p.waitForTimeout(300);
        return 1; // tapping into the client
      },
      rule: async (p) => {
        const r = await p.evaluate(() => {
          const el = document.getElementById('cd-addresses-list');
          const t = el ? el.textContent : '';
          return { hasJobSites: /Job sites/.test(t), hasProperties: /Properties/.test(t), addBtn: /Add job site/.test(t) };
        });
        return { ok: r.hasJobSites && !r.hasProperties && r.addBtn, got: JSON.stringify(r) };
      },
    });

    // ── 3. ADD JOB SITE #2, A RENTAL ─────────────────────────────────────────
    await step(page, {
      label: '3. add job site #2 (Rental property)', page: 'pg-client-detail', role: 'contractor',
      suspect: 'clients.js openAddAddressModal/saveAddClientAddress → data.js setPropertyData',
      ruleText: 'a second site must persist with its own property type and derive isRental',
      expected: "extraAddresses has it, propertyType='Rental property', isRental true",
      act: async (p) => {
        // Precise selector on purpose: the property CARDS carry their own buttons
        // (Map / Remove / Look up property), so a bare `#cd-addresses-list button`
        // taps the wrong control.
        let n = await tap(p, 'button[onclick="openAddAddressModal()"]');
        await p.waitForSelector('#_aa-addr', { state: 'visible', timeout: 8000 });
        n += await type(p, '#_aa-label', SITE2.label);
        n += await type(p, '#_aa-addr', SITE2.addr);
        n += await pick(p, '#_aa-ptype', SITE2.type);
        n += await tap(p, 'button[onclick="saveAddClientAddress()"]');
        await p.waitForTimeout(500);
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate(({ cid, addr }) => {
          const c = getClientById(cid);
          const prop = getProperty(c, addr);
          return {
            count: (typeof clientAddresses === 'function') ? clientAddresses(c).length : -1,
            type: prop.propertyType || null, rental: prop.isRental === true,
            thirdParty: propIsThirdPartyOwned(c, addr),
          };
        }, { cid: ctx.clientId, addr: SITE2.addr });
        return {
          ok: r.count === 2 && r.type === SITE2.type && r.rental && r.thirdParty === true,
          got: JSON.stringify(r),
        };
      },
    });

    // ── 4. ADD JOB SITE #3, COMMERCIAL, AND PROVE NO TYPE BLEED ──────────────
    await step(page, {
      label: '4. add job site #3 (Commercial), types stay per-address', page: 'pg-client-detail', role: 'contractor',
      suspect: 'data.js setPropertyData/_addrKey (per-address keyed map)',
      ruleText: 'each address must keep its OWN property type: adding a third must not overwrite the second, and neither may leak onto the primary',
      expected: 'rental + commercial each hold their own type, primary untouched, only the rental flagged isRental',
      act: async (p) => {
        let n = await tap(p, 'button[onclick="openAddAddressModal()"]');
        await p.waitForSelector('#_aa-addr', { state: 'visible', timeout: 8000 });
        n += await type(p, '#_aa-label', SITE3.label);
        n += await type(p, '#_aa-addr', SITE3.addr);
        n += await pick(p, '#_aa-ptype', SITE3.type);
        n += await tap(p, 'button[onclick="saveAddClientAddress()"]');
        await p.waitForTimeout(500);
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate(({ cid, a2, a3 }) => {
          const c = getClientById(cid);
          const list = clientAddresses(c);
          const t = a => { const q = getProperty(c, a); return { type: q.propertyType || null, rental: q.isRental === true }; };
          // NOTE: the lead form's "Property type" (#cf-ptype) writes the flat legacy
          // client.ptype, NOT properties[key].propertyType, which only the
          // Add-property modal populates. So the primary's map entry is expected to
          // stay EMPTY here, and that is exactly the leak assertion: a keying bug in
          // setPropertyData/_addrKey would dump site 2's or 3's type onto it.
          return {
            count: list.length,
            primaryMap: t(c.addr), primaryFlat: c.ptype || null,
            rental: t(a2), commercial: t(a3),
          };
        }, { cid: ctx.clientId, a2: SITE2.addr, a3: SITE3.addr });
        return {
          ok: r.count === 3 &&
              r.primaryMap.type === null && r.primaryMap.rental === false &&
              r.primaryFlat === SITE1.type &&
              r.rental.type === SITE2.type && r.rental.rental === true &&
              r.commercial.type === SITE3.type && r.commercial.rental === false,
          got: JSON.stringify(r),
        };
      },
    });

    // ── 5. ESTIMATE + SEND AGAINST JOB SITE #3 ONLY ──────────────────────────
    await step(page, {
      label: '5. build + send an estimate for job site #3', page: 'pg-est-generic', role: 'contractor',
      suspect: 'generic-estimate.js openFreeFormEstimate(addr) → sendGenericProposal',
      ruleText: 'the proposal must carry the SITE #3 address, not the client\'s primary',
      expected: 'bid.addr = the commercial site, artifact uploaded, signing token stamped',
      act: async (p) => {
        const built = await p.evaluate(async ({ cid, addr }) => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
          const c = getClientById(cid);
          openFreeFormEstimate(c, null); await wait(400);
          set('gei-client', c.name);
          set('gei-addr', addr);                 // the site this job is actually at
          const addItem = async (sec, label, price, notes) => {
            _byoAddItem(sec); await wait(90);
            set('_bya-label', label); set('_bya-price', String(price)); set('_bya-notes', notes);
            _byaConfirm(sec); await wait(90);
          };
          await addItem('Materials', 'Job materials + sundries', 420, 'per scope');
          await addItem('Interior', 'Common area repaint, two coats', 2400, 'halls + stairwell');
          try { _byoUpdateRail(); calcGeiTotal(); } catch (e) {}
          await wait(150);
          // open + (add + label + price + notes + confirm) × 2
          return 1 + (1 + 25 + 3 + 9 + 1) + (1 + 30 + 4 + 17 + 1);
        }, { cid: ctx.clientId, addr: SITE3.addr });

        await p.evaluate(async () => { try { await sendGenericProposal(false); } catch (e) {} });
        ctx.sent = await p.evaluate(async () => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          const id = () => (typeof _geiEditBidId !== 'undefined') ? _geiEditBidId : null;
          for (let i = 0; i < 30; i++) {
            const b = id() ? bids.find(x => x.id === id()) : null;
            if (b && b.signingToken && b.proposalKey) break;
            await wait(500);
          }
          const bid = bids.find(x => x.id === id());
          let artifact = false;
          if (bid && bid.proposalKey) {
            for (let i = 0; i < 40; i++) {
              try {
                const { data, error } = await _supa.storage.from('proposals').download(bid.proposalKey);
                if (data && !error) { artifact = true; break; }
              } catch (e) {}
              await wait(500);
            }
          }
          // Release the alert door: from here the only signature that can pop is ours.
          localStorage.setItem('zp3_schedule_alerts', '[]');
          document.getElementById('_sched-alert-overlay')?.remove();
          window._showingScheduleAlert = false;
          const t0 = Date.now();
          while (typeof _sigFeedReady !== 'undefined' && !_sigFeedReady && Date.now() - t0 < 15000) await wait(200);
          return {
            bidId: bid ? bid.id : null, addr: bid ? (bid.addr || null) : null,
            token: bid ? bid.signingToken : null, amount: bid ? bid.amount : 0,
            uid: _supaUser ? _supaUser.id : null, artifact,
            sigFeedReady: typeof _sigFeedReady === 'undefined' ? true : _sigFeedReady,
          };
        });
        ctx.bidId = ctx.sent.bidId;
        return built + 1; // + the Send tap
      },
      rule: async () => ({
        ok: !!ctx.sent.token && ctx.sent.artifact && (ctx.sent.amount || 0) > 0 &&
            ctx.sent.addr === SITE3.addr && ctx.sent.sigFeedReady,
        got: `addr=${ctx.sent.addr} token=${!!ctx.sent.token} artifact=${ctx.sent.artifact} amount=${ctx.sent.amount} sigFeed=${ctx.sent.sigFeedReady}`,
      }),
    });

    // ── 6. THE CLIENT SIGNS (anonymous second browser, the real link) ────────
    const clientCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const cp = await clientCtx.newPage();
    await step(page, {
      label: '6. client opens the link and signs (cash)', page: 'sign.html', role: 'client',
      suspect: 'sign.html approveAndSign → goToPayment → _paySign(cash) → submitCash',
      ruleText: 'an anonymous client must reach pg-done through the real signing UI',
      expected: 'pg-done visible in the client browser',
      act: async () => {
        const base = process.env.E2E_BASE_URL || 'http://localhost:8788';
        await cp.goto(`${base}/sign.html?t=${ctx.sent.token}&u=${ctx.sent.uid}&b=${ctx.bidId}`, { waitUntil: 'domcontentloaded' });
        await cp.waitForSelector('#approve-btn', { state: 'visible', timeout: 20000 });
        let n = await tap(cp, '#approve-btn');
        await cp.waitForSelector('#sig-name', { state: 'visible', timeout: 10000 });
        n += await type(cp, '#sig-name', clientName);
        await cp.waitForTimeout(300);
        n += await tap(cp, '#sign-btn');
        await cp.waitForSelector('#sign-pay-btns button', { state: 'visible', timeout: 10000 });
        n += await tap(cp, '#sign-pay-btns button:has-text("Cash")');
        await cp.waitForSelector('#sec-cash-confirm-btn', { state: 'visible', timeout: 8000 });
        n += await tap(cp, '#sec-cash-confirm-btn');
        await cp.waitForSelector('#pg-done', { state: 'visible', timeout: 25000 });
        return n;
      },
      rule: async () => {
        const done = await cp.evaluate(() => {
          const el = document.getElementById('pg-done');
          return !!el && el.style.display !== 'none';
        });
        return { ok: done, got: `pg-done visible=${done}` };
      },
    });
    await clientCtx.close(); // resource cleanup (not data, §12.7)

    // ── 7. SCHEDULE FROM THE REALTIME POPUP, THE JOB KEEPS SITE #3 ───────────
    await step(page, {
      label: '7. schedule from the popup, job carries site #3', page: 'pg-dash', role: 'contractor',
      suspect: 'cloud.js showScheduleSuggestion → quickScheduleJob (address carry-through)',
      ruleText: 'scheduling must book the job against the SITE #3 address the proposal was for',
      expected: 'upcoming job for this bid, addr = the commercial site',
      act: async (p) => {
        await p.waitForSelector('#_sched-alert-overlay', { state: 'attached', timeout: 25000 });
        let n = await tap(p, '#_sched-alert-yes');
        await p.waitForSelector('#sched-lock-btn', { state: 'visible', timeout: 8000 });
        n += await tap(p, '#sched-lock-btn');
        await p.waitForTimeout(800);
        await p.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); });
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate((bidId) => {
          const j = jobs.find(x => String(x.bid_id) === String(bidId) && x.eventType === 'job');
          const b = bids.find(x => String(x.id) === String(bidId));
          return j ? { id: j.id, status: j.status, start: j.start, addr: j.addr || (b && b.addr) || null } : null;
        }, ctx.bidId);
        if (r) ctx.jobId = r.id;
        return { ok: !!r && r.status === 'upcoming' && !!r.start && r.addr === SITE3.addr, got: JSON.stringify(r) };
      },
    });

    // ── 8. DRIVE: PICK AMONG THE SITES, AND ADD A FOURTH INLINE ─────────────
    // The other entry point into extraAddresses[], easy to forget and easy to break.
    await step(page, {
      label: '8. Drive → address picker → add a 4th site inline', page: 'pg-mileage', role: 'contractor',
      suspect: 'mileage.js _selectTripClient → clients.js pickClientAddress/_addrPickAddNew/_addrPickSaveNew',
      ruleText: 'a client with several sites must get the picker, and "New address" must both fill the destination AND persist onto the client',
      expected: 'picker listed 3 sites, destination = the new 4th, client now has 4',
      act: async (p) => {
        await p.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove()); openLogTripModal({}); });
        await p.waitForSelector('#lm-to', { state: 'visible', timeout: 8000 });
        // Type the client's name and pick them out of the destination suggestions,
        // exactly how a contractor starts a trip.
        let n = await type(p, '#lm-to', clientName);
        await p.waitForSelector('#lm-to-sugg div[onclick^="_selectTripClient"]', { state: 'visible', timeout: 8000 });
        n += await tap(p, '#lm-to-sugg div[onclick^="_selectTripClient"]');
        // 3 sites → the shared picker opens instead of filling straight through.
        await p.waitForSelector('#_addrpick-ov', { state: 'visible', timeout: 8000 });
        ctx.pickerRows = await p.evaluate(() =>
          document.querySelectorAll('#_addrpick-ov div[onclick^="_addrPickChoose"]').length);
        n += await tap(p, '#_addrpick-ov div[onclick="_addrPickAddNew()"]');
        await p.waitForSelector('#_addrpick-new', { state: 'visible', timeout: 8000 });
        n += await type(p, '#_addrpick-new', SITE4.addr);
        n += await tap(p, 'button[onclick="_addrPickSaveNew()"]');
        await p.waitForTimeout(700);
        return n;
      },
      rule: async (p) => {
        const r = await p.evaluate(({ cid, addr }) => {
          const c = getClientById(cid);
          return {
            dest: (document.getElementById('lm-to') || {}).value || null,
            count: clientAddresses(c).length,
            has4: (c.extraAddresses || []).some(a => a.addr === addr),
          };
        }, { cid: ctx.clientId, addr: SITE4.addr });
        return {
          ok: ctx.pickerRows === 3 && r.dest === SITE4.addr && r.count === 4 && r.has4,
          got: JSON.stringify(r) + ` pickerRows=${ctx.pickerRows}`,
        };
      },
    });

    // ── 9. EVERY SITE AND TYPE SURVIVES A REAL CLOUD ROUND-TRIP ──────────────
    await step(page, {
      label: '9. reload from the cloud, all four sites intact', page: 'cloud', role: 'contractor',
      suspect: 'cloud.js supaSaveToCloud/supaLoadFromCloud (extraAddresses + properties map)',
      ruleText: 'all four sites AND their per-address property types must come back from Supabase, not just live in memory',
      expected: '4 addresses after a fresh load, rental + commercial types intact, party type still pm',
      act: async (p) => {
        await p.evaluate(async () => {
          document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
          if (typeof _flushSaveNow === 'function') await _flushSaveNow();
          else if (typeof supaSaveToCloud === 'function') await supaSaveToCloud();
        });
        await p.waitForTimeout(1500);
        // Drop the local copy and pull the account back down, the real proof the
        // keyed property map round-tripped instead of only existing in memory.
        await p.evaluate(async () => {
          if (typeof clients !== 'undefined') clients.length = 0;
          if (typeof supaLoadFromCloud === 'function') await supaLoadFromCloud();
        });
        await p.waitForTimeout(1500);
        return 0; // no user interaction, this is the backend proving itself
      },
      rule: async (p) => {
        const r = await p.evaluate(({ nm, a2, a3, a4 }) => {
          const c = (typeof clients !== 'undefined' ? clients : []).find(x => x.name === nm);
          if (!c) return { found: false };
          const t = a => { const q = getProperty(c, a); return q.propertyType || null; };
          const list = clientAddresses(c).map(a => a.addr);
          return {
            found: true, count: list.length,
            primaryFlat: c.ptype || null, rental: t(a2), commercial: t(a3),
            has4: list.includes(a4),
            partyType: c.partyType,
          };
        }, { nm: clientName, a2: SITE2.addr, a3: SITE3.addr, a4: SITE4.addr });
        return {
          ok: r.found && r.count === 4 && r.has4 && r.partyType === 'pm' &&
              r.primaryFlat === SITE1.type &&
              r.rental === SITE2.type && r.commercial === SITE3.type,
          got: JSON.stringify(r),
        };
      },
    });

    const rep = report(FLOW, BASELINE, page);
    expect(rep.overBudget).toBe(false);
  });
});
