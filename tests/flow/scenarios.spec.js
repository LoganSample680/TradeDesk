// Adversarial flow spec — the full bid / payment / lien matrix ("every Doctor
// Strange scenario"). Seeds realistic clients (real names, random phones, mixed
// addresses) each tied to a bid in a distinct state, then asserts the app's rule
// engine classifies every one correctly: payStatus, getBidPaid, lien eligibility.
//
// Seeded rows are tagged "__E2E__<run>" (clients via notes) so a beforeEach sweep
// clears PRIOR runs while keeping the current run's data for in-app review.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, RUN_TAG, finding } = require('./live-helpers');

const FIRST = ['Marcus', 'Sofia', 'Derek', 'Hannah', 'Andre', 'Olivia', 'Tyler', 'Grace', 'Nathan', 'Priya', 'Wesley', 'Imani'];
const LAST = ['Holloway', 'Castillo', 'Brennan', 'Okafor', 'Whitman', 'Delgado', 'Foster', 'Ramsey', 'Vaughn', 'Sandoval', 'Pierce', 'Mbeki'];
const ADDR = [
  '4120 Gage Blvd, Topeka, KS 66604', '900 N Main St, Wichita, KS 67203',
  '15 Mission Rd, Fairway, KS 66205', '720 Commercial St, Emporia, KS 66801', '',
];

test.describe('bids/payments/liens — full scenario matrix', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.evaluate((runTag) => {
      // FULL RESET of scenario data (marker __E2E_SCN__) — removes ALL prior
      // scenario rows including the other browser's copy from this same run, so
      // the account ends with exactly ONE clean set (no Chromium+WebKit dupes, no
      // accumulation across runs). The last browser to run leaves the live set.
      if (typeof clients === 'undefined') return;
      // Remove scenario rows (__E2E_SCN__) AND legacy test rows from earlier runs
      // (old __E2E__ marker or "E2E"-prefixed names) so accumulated duplicate test
      // bids — which were inflating the outstanding-balance total — get cleared.
      const stale = clients.filter(c =>
        (c.notes || '').includes('__E2E_SCN__') ||
        (c.notes || '').includes('__E2E__') ||
        (c.name || '').startsWith('E2E'));
      const ids = new Set(stale.map(c => c.id));
      if (ids.size) {
        clients = clients.filter(c => !ids.has(c.id));
        if (typeof bids !== 'undefined') bids = bids.filter(b => !ids.has(b.client_id));
        if (typeof jobs !== 'undefined') jobs = jobs.filter(j => !ids.has(j.client_id));
        if (typeof payments !== 'undefined') payments = payments.filter(p => !ids.has(p.client_id));
        if (typeof liens !== 'undefined') liens = liens.filter(l => !ids.has(l.client_id));
        if (typeof mileage !== 'undefined') mileage = mileage.filter(m => !ids.has(m.client_id));
        if (typeof expenses !== 'undefined') expenses = expenses.filter(e => !ids.has(e.client_id));
        if (typeof _flushSaveNow === 'function') { try { _flushSaveNow(); } catch (e) {} }
      }
    }, RUN_TAG);
  });

  test('seed and verify every bid / payment / lien state', async ({ page }) => {
    const result = await page.evaluate(({ FIRST, LAST, ADDR, runTag }) => {
      const phone = () => ['316', '620', '785', '913'][Math.floor(Math.random() * 4)] + String(Math.floor(2000000 + Math.random() * 7999999));
      const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
      let seq = Date.now();
      const nextId = () => ++seq;
      // Spread lead sources randomly across the real options (no more "Unknown").
      const SOURCES = ['Door to door', 'Referral', 'Google / online', 'Facebook'];
      const pickSource = () => SOURCES[Math.floor(Math.random() * SOURCES.length)];
      const mkToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
      // Real surfaces/line items per estimate type so signed bids show true content,
      // not "No line items or surfaces stored". Room spec strings drive paint lines.
      const mkSurfaces = (type) => {
        if (type.startsWith('Interior')) return [
          { id: 1, type: 'walls', qty: 1240, wallSqft: 1240, room: 'Living Room — SW 7008 Alabaster Eg-Shel' },
          { id: 2, type: 'ceiling', qty: 470, room: 'Living Room — SW ProMar Ceiling Flat White' },
          { id: 3, type: 'trim', qty: 190, room: 'Living Room — SW ProClassic Semi-Gloss White' },
        ];
        if (type.startsWith('Exterior')) return [
          { id: 1, type: 'ext_walls', qty: 1880, wallSqft: 1880, room: 'Body — SW Duration Satin SW 7015 Repose Gray' },
          { id: 2, type: 'ext_trim', qty: 260, room: 'Trim — SW Duration Gloss Extra White' },
          { id: 3, type: 'deck', qty: 340, room: 'Back Deck — SW SuperDeck Semi-Trans' },
        ];
        if (type.startsWith('Time')) return [
          { id: 1, type: 'walls', qty: 820, wallSqft: 820, room: 'Interior repaint — SW Cashmere Eg-Shel' },
        ];
        return []; // BYO / generic uses geiLines instead
      };

      // Scenario table: each makes a client + bid (+ payments/job/lien) and an
      // expectation for the app's classifier.
      const SCENARIOS = [
        { key: 'draft',        status: 'Draft',      draft: true,  amount: 3200, pay: 'none', completedDaysAgo: null, expectPay: null },
        { key: 'pending',      status: 'Pending',    draft: false, amount: 4800, pay: 'none', completedDaysAgo: null, expectPay: null, token: true },
        { key: 'won_unpaid',   status: 'Closed Won', draft: false, amount: 5200, pay: 'none', completedDaysAgo: 3,    expectPay: 'Unpaid' },
        { key: 'won_deposit',  status: 'Closed Won', draft: false, amount: 6000, pay: 'deposit', deposit: 1500, completedDaysAgo: 2, expectPay: 'Deposit paid' },
        { key: 'won_paidfull', status: 'Closed Won', draft: false, amount: 4500, pay: 'full', completedDaysAgo: 10, expectPay: 'Paid in full' },
        { key: 'lien_unpaid',  status: 'Closed Won', draft: false, amount: 7800, pay: 'none', completedDaysAgo: 32, expectPay: 'Unpaid', lienEligible: true },
        { key: 'lien_partial', status: 'Closed Won', draft: false, amount: 9000, pay: 'deposit', deposit: 2000, completedDaysAgo: 28, expectPay: 'Deposit paid', lienEligible: true },
        { key: 'lien_filed',   status: 'Closed Won', draft: false, amount: 6400, pay: 'none', completedDaysAgo: 45, expectPay: 'Unpaid', fileLien: true },
      ];

      // Spread estimate types across the matrix: interior, exterior, T&M, BYO/generic.
      const ESTYPES = ['Interior Painting', 'Exterior Painting', 'Time & Materials', 'BYO / Generic Estimate'];
      const seededCids = [];
      const out = [];
      SCENARIOS.forEach((s, i) => {
        const cid = nextId();
        const name = FIRST[i % FIRST.length] + ' ' + LAST[(i * 5 + 2) % LAST.length];
        const addr = ADDR[i % ADDR.length];
        seededCids.push({ cid, addr, name });
        clients.push({
          id: cid, name, phone: phone(), email: '', addr,
          source: pickSource(), notes: '__E2E_SCN__ ' + runTag + ' ' + s.key,
          created: daysAgo(60), clientToken: mkToken(), extraAddresses: [],
        });
        const bidId = nextId();
        const estType = ESTYPES[i % ESTYPES.length];
        const isBYO = estType.startsWith('BYO');
        const isTM = estType.startsWith('Time');
        const bid = {
          id: bidId, client_id: cid, client_name: name, amount: s.amount,
          status: s.status, draft: !!s.draft, type: estType,
          bid_date: daysAgo(50), surfaces: mkSurfaces(estType),
          completion_date: s.completedDaysAgo != null ? daysAgo(s.completedDaysAgo) : '',
          signingToken: s.token ? ('tok_' + bidId) : undefined,
          deposit: s.deposit || 0,
          signedAt: s.status === 'Closed Won' ? daysAgo((s.completedDaysAgo || 5) + 5) : undefined,
          // Type-specific shape so each estimate kind is exercised:
          geiLines: isBYO ? [
            { desc: 'Cabinet refinishing — 18 doors / 6 drawers', qty: 1, rate: Math.round(s.amount * 0.55), total: Math.round(s.amount * 0.55) },
            { desc: 'Wall & trim repaint — main level', qty: 1, rate: Math.round(s.amount * 0.45), total: Math.round(s.amount * 0.45) },
          ] : undefined,
          trade_type: isBYO ? 'general' : undefined,
          tmRate: isTM ? 85 : undefined, tmHours: isTM ? Math.round(s.amount / 85) : undefined,
          // A stored proposal so "Client view" isn't empty on signed bids.
          proposalHtml: (s.status === 'Closed Won' || s.status === 'Pending')
            ? '<div style="font-family:system-ui;padding:16px"><h2>' + estType + ' Proposal</h2><p>' + name + '</p><p>Total: $' + s.amount + '</p><p>Scope: full surface prep, prime, and ' + (isTM ? 'time &amp; materials billing at $85/hr' : 'two finish coats') + '.</p></div>'
            : undefined,
        };
        bids.push(bid);
        // Payments
        if (s.pay === 'deposit') payments.push({ id: nextId(), bid_id: bidId, client_id: cid, amount: s.deposit, type: 'deposit', method: 'Check', date: daysAgo((s.completedDaysAgo || 5) + 2) });
        if (s.pay === 'full') payments.push({ id: nextId(), bid_id: bidId, client_id: cid, amount: s.amount, type: 'final', method: 'Card', date: daysAgo(s.completedDaysAgo || 5) });
        // Job for won bids
        if (s.status === 'Closed Won') jobs.push({ id: nextId(), client_id: cid, bid_id: bidId, name: name + ' — job', status: 'complete', start: daysAgo((s.completedDaysAgo || 5) + 7), eventType: 'job' });
        // Filed lien
        if (s.fileLien && typeof liens !== 'undefined') liens.push({ id: nextId(), bid_id: bidId, client_id: cid, amount: s.amount, filedAt: daysAgo(5) });

        // Assert the classifier
        let gotPay = null, paid = null, lien = null;
        try { gotPay = (typeof payStatus === 'function') ? payStatus(bid).label : null; } catch (e) { gotPay = 'ERR:' + e.message; }
        try { paid = (typeof getBidPaid === 'function') ? getBidPaid(bidId) : null; } catch (e) {}
        try { lien = (typeof getBidLien === 'function') ? getBidLien(bidId) : null; } catch (e) {}
        out.push({
          key: s.key, bidId, expectPay: s.expectPay, gotPay,
          paid, amount: s.amount, balance: s.amount - (paid || 0),
          completedDaysAgo: s.completedDaysAgo, lienEligible: !!s.lienEligible,
          fileLien: !!s.fileLien, hasLien: !!lien,
        });
      });

      // Mileage logs — drives between job sites, tied to seeded clients so the
      // sweep cleans them. Visible in the mileage tracker.
      if (typeof mileage !== 'undefined') {
        seededCids.forEach((c, k) => {
          mileage.push({
            id: nextId(), date: daysAgo(10 + k), vehicle: 'Work Truck',
            from: 'Shop', from_name: 'Shop', to: c.addr || 'Job site', to_name: c.name,
            start: 0, end: 0, miles: 8 + (k * 3.5), purpose: 'Job site visit',
            client_id: c.cid, client_name: c.name, notes: '__E2E__ ' + runTag,
            created_at: new Date(0).toISOString(), calc_method: 'manual',
          });
        });
      }
      // Expenses — materials / fuel / tools, tied to seeded clients.
      if (typeof expenses !== 'undefined') {
        const cats = [['materials', 'Materials', 'Sherwin-Williams'], ['fuel', 'Fuel', 'QuikTrip'], ['tools', 'Tools', 'Home Depot']];
        seededCids.forEach((c, k) => {
          const [cat, catLabel, vendor] = cats[k % cats.length];
          expenses.push({
            id: nextId(), date: daysAgo(12 + k), cat, catLabel, vendor,
            amount: 120 + (k * 45), notes: '__E2E__ ' + runTag,
            created_at: new Date(0).toISOString(), client_id: c.cid,
            job_name: c.name, receipt: 'No receipt photo', deductible: true,
          });
        });
      }

      // Generate the client hub for each seeded client so the hub link works.
      if (typeof _uploadClientHub === 'function') {
        seededCids.forEach(c => { try { _uploadClientHub(c.cid); } catch (e) {} });
      }
      try { if (typeof saveAll === 'function') saveAll(); } catch (e) {}
      return out;
    }, { FIRST, LAST, ADDR, runTag: RUN_TAG });

    // Verify every scenario's classification.
    for (const s of result) {
      if (s.expectPay) {
        expect(s.gotPay, finding({
          page: 'pg-clients', control: `payStatus(${s.key})`,
          rule: 'payment status must match the seeded payment state',
          expected: s.expectPay, got: String(s.gotPay), suspect: 'bids.js payStatus',
        })).toBe(s.expectPay);
      }
      if (s.expectPay === 'Paid in full') {
        expect(s.balance, finding({
          page: 'pg-clients', control: `balance(${s.key})`, rule: 'paid-in-full ⇒ zero balance',
          expected: '0', got: String(s.balance), suspect: 'bids.js getBidPaid',
        })).toBeLessThanOrEqual(0);
      }
      if (s.lienEligible) {
        // Completed > 21 days ago with a positive balance = intent-to-lien stage.
        expect(s.balance, finding({
          page: 'pg-clients', control: `lien balance(${s.key})`,
          rule: 'lien-eligible job must carry a positive unpaid balance',
          expected: '> 0', got: String(s.balance), suspect: 'clients.js collections (balance/days)',
        })).toBeGreaterThan(0);
        expect(s.completedDaysAgo, finding({
          page: 'pg-clients', control: `lien age(${s.key})`,
          rule: 'intent-to-lien requires completion ≥ 21 days ago',
          expected: '≥ 21', got: String(s.completedDaysAgo), suspect: 'clients.js:1662',
        })).toBeGreaterThanOrEqual(21);
      }
      if (s.fileLien) {
        expect(s.hasLien, finding({
          page: 'pg-clients', control: `getBidLien(${s.key})`, rule: 'a filed lien must be retrievable for its bid',
          expected: 'lien found', got: 'none', suspect: 'finance.js getBidLien',
        })).toBe(true);
      }
    }
    await page.waitForTimeout(3000); // let the full dataset flush to Supabase
  });
});
