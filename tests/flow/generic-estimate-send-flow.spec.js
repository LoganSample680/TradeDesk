// REAL flow — the GENERIC estimator end-to-end SEND (task #29). estimate-build
// covers the paint estimator all the way to an uploaded artifact; estimate-scale
// drives T&M/BYO but stops at pricing. This closes the gap: build a Time &
// Materials proposal AND a Build-Your-Own proposal through the real generic
// estimator and actually SEND each — generic-estimate.js sendGenericProposal()
// assembles the bid, uploads the proposal JSON to the 'proposals' storage bucket,
// and stamps bid.proposalKey/signingToken. We poll storage until the artifact
// lands and assert the bid also round-tripped into the cloud (td_bids).
//
// Seed data is left in the dev account per CLAUDE.md §13.7.
const { test, expect } = require('@playwright/test');
const { needsLiveCreds, signIn, step, report, resetLedger, cloudRows } = require('./live-helpers');
const BASELINE = require('./perf-baseline.json');

// After sendGenericProposal(false): poll for the bid's proposalKey, then poll the
// storage bucket until the uploaded artifact actually downloads (the upload races
// the key assignment, exactly like estimate-build). Returns the end-state.
async function awaitSentArtifact(page) {
  await page.evaluate(async () => {
    const ready = () => {
      const id = (typeof _geiEditBidId !== 'undefined') ? _geiEditBidId : null;
      if (!id || typeof bids === 'undefined') return false;
      const b = bids.find(x => x.id === id);
      return !!(b && b.proposalKey);
    };
    const wait = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 30 && !ready(); i++) await wait(500); // up to 15s
  });
  return await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const id = (typeof _geiEditBidId !== 'undefined') ? _geiEditBidId : null;
    const bid = (typeof bids !== 'undefined' && id) ? bids.find(b => b.id === id) : null;
    const key = bid ? bid.proposalKey : null;
    let artifact = false, err = '';
    if (key && typeof _supa !== 'undefined') {
      for (let i = 0; i < 50; i++) { // ~25s bound; normally 1-3s
        try {
          const { data, error } = await _supa.storage.from('proposals').download(key);
          if (data && !error) { artifact = true; err = ''; break; }
          err = error ? (error.message || JSON.stringify(error)) : 'no data';
        } catch (e) { err = e.message; }
        await wait(500);
      }
    }
    return { bidId: id, hasBid: !!bid, amount: bid ? bid.amount : null, key, artifact, err };
  });
}

test.describe('generic estimator send → artifact (UI-driven)', () => {
  test.skip(!needsLiveCreds(), 'live Supabase creds not configured (E2E_DEV_* secrets)');

  test.beforeEach(async ({ page }) => { resetLedger(); await signIn(page); });

  // ── TIME & MATERIALS ────────────────────────────────────────────────────────
  test('T&M proposal builds, sends, and uploads its artifact', async ({ page }) => {
    const FLOW = 'generic-send/tm';
    const client = { id: Date.now() * 1000 + (process.pid % 1000), name: `E2E TM Send ${process.pid}`, addr: '11 Hourly Way, Wichita, KS 67202', phone: '3165550031' };

    let sent = {};
    await step(page, {
      label: 'open T&M, set crew/rate/hours + a material line, send', page: 'gei-tm', role: 'contractor',
      suspect: 'generic-estimate.js sendGenericProposal (validation + storage upload + proposalKey)',
      ruleText: 'a T&M proposal must send: bid created, artifact uploaded to the proposals bucket, and the bid in the cloud',
      expected: 'hasBid + proposalKey + artifact downloads + td_bids row',
      act: async (p) => {
        await p.evaluate(async (c) => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          openTMEstimate(c, null);
          await wait(300);
          // gei-client/gei-addr feed the proposal header.
          const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
          set('gei-client', c.name); set('gei-addr', c.addr);
          // T&M labor: _tmRecalc reads #tm-crew-display / #tm-rate / #tm-hours.
          const cc = document.getElementById('tm-crew-display'); if (cc) cc.textContent = '2';
          set('tm-rate', '65'); set('tm-hours', '40');
          try { _tmRecalc(); } catch (e) {}
          await wait(120);
          // sendGenericProposal requires at least one non-labor MATERIAL line.
          addGeiLine();
          const last = _geiLines[_geiLines.length - 1];
          if (last) { last.desc = 'Paint & materials'; last.rate = 300; last.qty = 1; last.total = 300; }
          try { renderGeiLines(); calcGeiTotal(); } catch (e) {}
          await wait(120);
        }, client);
        // Fire the real send and wait for the artifact.
        await p.evaluate(async () => { try { await sendGenericProposal(false); } catch (e) {} });
        sent = await awaitSentArtifact(p);
        // honest count: open(1)+crew(1)+rate"65"(2)+hours"40"(2)+addLine(1)+desc(16)+price"300"(3)+send(1)=27
        return 27;
      },
      rule: async (p) => {
        const cloud = await cloudRows(p, 'td_bids');
        const inCloud = cloud.some(b => String(b.id) === String(sent.bidId));
        const ok = sent.hasBid && !!sent.key && sent.artifact && inCloud;
        return { ok, got: `bid=${sent.hasBid} key=${sent.key} artifact=${sent.artifact} inCloud=${inCloud} err=${sent.err}` };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });

  // ── BUILD-YOUR-OWN (custom line items) ────────────────────────────────────────
  test('BYO proposal builds, sends, and uploads its artifact', async ({ page }) => {
    const FLOW = 'generic-send/byo';
    const client = { id: Date.now() * 1000 + (process.pid % 1000) + 3, name: `E2E BYO Send ${process.pid}`, addr: '13 Custom Row, Wichita, KS 67202', phone: '3165550041' };

    let sent = {};
    await step(page, {
      label: 'open BYO, add Materials + Interior items, send', page: 'gei-byo', role: 'contractor',
      suspect: 'generic-estimate.js openFreeFormEstimate / _byaConfirm / sendGenericProposal',
      ruleText: 'a BYO proposal with a Materials item + an Interior item must send and upload its artifact',
      expected: 'hasBid + proposalKey + artifact downloads + td_bids row',
      act: async (p) => {
        await p.evaluate(async (c) => {
          const wait = ms => new Promise(r => setTimeout(r, ms));
          openFreeFormEstimate(c, null);
          await wait(300);
          const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
          set('gei-client', c.name); set('gei-addr', c.addr);
          // sendGenericProposal (BYO) requires a Materials item AND an Interior/Exterior item.
          const addItem = async (sec, label, price, notes) => {
            _byoAddItem(sec); await wait(80);
            set('_bya-label', label); set('_bya-price', String(price)); set('_bya-notes', notes);
            _byaConfirm(sec); await wait(80);
          };
          await addItem('Materials', 'Sherwin-Williams Duration + sundries', 420, '5 gal + rollers');
          await addItem('Interior', 'Repaint living room + hall, two coats', 1600, 'walls + ceiling');
          try { _byoUpdateRail(); calcGeiTotal(); } catch (e) {}
          await wait(120);
        }, client);
        await p.evaluate(async () => { try { await sendGenericProposal(false); } catch (e) {} });
        sent = await awaitSentArtifact(p);
        // open(1) + 2 items × [add(1)+label+price+notes+confirm(1)] + send(1)
        return 1 + (1 + 36 + 3 + 11 + 1) + (1 + 38 + 4 + 16 + 1) + 1;
      },
      rule: async (p) => {
        const cloud = await cloudRows(p, 'td_bids');
        const inCloud = cloud.some(b => String(b.id) === String(sent.bidId));
        const ok = sent.hasBid && !!sent.key && sent.artifact && inCloud;
        return { ok, got: `bid=${sent.hasBid} key=${sent.key} artifact=${sent.artifact} inCloud=${inCloud} err=${sent.err}` };
      },
    });

    const rep = report(FLOW, BASELINE);
    expect(rep.totalClicks).toBeGreaterThan(0);
  });
});
