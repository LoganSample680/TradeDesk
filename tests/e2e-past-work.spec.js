// @ts-check
/**
 * Past work: the property card's history section (owner-approved layout
 * 2026-08-16, "tap to open"). A finished job's collapsed row states what it
 * was, when it finished, what it cost and whether it's paid, and the warranty
 * status; opening it shows photos, what we used, scope, crew, and Quote this
 * again. The spec-recall data ("what we used") is captured on the job sheet.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const CID = 981100;

test.describe('Past work rows + what-we-used capture', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterEach(() => { assertNoErrors(page, 'past work'); });

  test('warranty math follows the settings period and the completion date', async () => {
    const r = await page.evaluate(() => {
      const iso = d => d.toISOString().slice(0, 10);
      const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
      const out = {};
      S.warrantyPeriod = '1 year';
      out.noDate = getWarrantyStatus('');
      out.active = getWarrantyStatus(daysAgo(30));
      out.expired = getWarrantyStatus('2020-01-15');
      S.warrantyPeriod = '90 days';
      out.d90active = getWarrantyStatus(daysAgo(30));
      out.d90expired = getWarrantyStatus(daysAgo(120));
      S.warrantyPeriod = '6 months';
      out.m6 = getWarrantyStatus(daysAgo(30));
      S.warrantyPeriod = '1 year';
      return out;
    });
    expect(r.noDate).toBe(null);
    expect(r.active.active).toBe(true);
    expect(r.active.label).toMatch(/^Under warranty until /);
    expect(r.expired.active).toBe(false);
    expect(r.expired.label).toMatch(/^Warranty ended /);
    expect(r.d90active.active).toBe(true);
    expect(r.d90expired.active).toBe(false);
    expect(r.m6.active).toBe(true);
  });

  test('a completed won bid moves to Past work and leaves the open list', async () => {
    const r = await page.evaluate((cid) => {
      const c = { id: cid, name: 'Past Co', addr: '1 Done St, Topeka, KS 66604' };
      clients = clients.filter(x => x.id !== cid).concat([c]);
      S.warrantyPeriod = '1 year';
      const iso = d => d.toISOString().slice(0, 10);
      const recent = (() => { const d = new Date(); d.setDate(d.getDate() - 10); return iso(d); })();
      bids = bids.filter(b => b.client_id !== cid).concat([
        { id: 981201, client_id: cid, name: 'Repaint', type: 'Interior repaint', addr: c.addr, amount: 2000, status: 'Closed Won', bid_date: '2026-07-01', completion_date: recent },
        { id: 981202, client_id: cid, name: 'Open work', type: 'Exterior', addr: c.addr, amount: 900, status: 'Closed Won', bid_date: '2026-08-01' },
      ]);
      jobs = jobs.filter(j => j.client_id !== cid);
      payments = payments.filter(p => p.client_id !== cid).concat([
        { id: 981401, client_id: cid, bid_id: 981201, amount: 2000, date: recent },
      ]);
      currentClientId = c.id;
      openClientDetail(c.id);
      const html = document.getElementById('cd-addresses-list')?.innerHTML || '';
      // The open list is everything between the two section headers.
      const openPart = html.split('Past work')[0];
      return {
        hasPastHeader: /Past work/.test(html),
        pastHasRepaint: /Interior repaint/.test(html.split('Past work')[1] || ''),
        openHasRepaint: /Interior repaint/.test(openPart),
        openHasExterior: /Exterior/.test(openPart),
        paidInFull: /Paid in full/.test(html),
        warranty: /Under warranty until /.test(html),
        finished: /Finished /.test(html),
      };
    }, CID);
    expect(r.hasPastHeader).toBe(true);
    expect(r.pastHasRepaint).toBe(true);
    expect(r.openHasRepaint).toBe(false);   // finished work left the open list
    expect(r.openHasExterior).toBe(true);   // unfinished won work stays open
    expect(r.paidInFull).toBe(true);
    expect(r.warranty).toBe(true);
    expect(r.finished).toBe(true);
  });

  test('an unpaid balance reads as still owed, and old work reads warranty ended', async () => {
    const r = await page.evaluate((cid) => {
      const c = { id: cid + 1, name: 'Owe Co', addr: '2 Owe St, Topeka, KS 66604' };
      clients = clients.filter(x => x.id !== cid + 1).concat([c]);
      S.warrantyPeriod = '1 year';
      bids = bids.filter(b => b.client_id !== cid + 1).concat([
        { id: 981210, client_id: c.id, name: 'Deck', type: 'Deck stain', addr: c.addr, amount: 1240, status: 'Closed Won', bid_date: '2024-05-01', completion_date: '2024-06-02' },
      ]);
      jobs = jobs.filter(j => j.client_id !== cid + 1);
      payments = payments.filter(p => p.client_id !== cid + 1).concat([
        { id: 981410, client_id: c.id, bid_id: 981210, amount: 840, date: '2024-06-02' },
      ]);
      currentClientId = c.id;
      openClientDetail(c.id);
      const html = document.getElementById('cd-addresses-list')?.innerHTML || '';
      return {
        owed: /still owed/.test(html),
        owedAmount: /\$400\.00/.test(html),
        ended: /Warranty ended /.test(html),
      };
    }, CID);
    expect(r.owed).toBe(true);
    expect(r.owedAmount).toBe(true);
    expect(r.ended).toBe(true);
  });

  test('tapping open shows what we used, scope, and the two actions', async () => {
    const r = await page.evaluate((cid) => {
      const c = { id: cid + 2, name: 'Spec Co', addr: '3 Spec St, Topeka, KS 66604' };
      clients = clients.filter(x => x.id !== cid + 2).concat([c]);
      bids = bids.filter(b => b.client_id !== cid + 2).concat([
        { id: 981220, client_id: c.id, name: 'Repaint', type: 'Interior repaint', addr: c.addr, amount: 800, status: 'Closed Won', bid_date: '2026-07-01', completion_date: '2026-08-01', desc: 'Walls and trim throughout' },
      ]);
      jobs = jobs.filter(j => j.client_id !== cid + 2).concat([
        { id: 981320, client_id: c.id, bid_id: 981220, name: 'Repaint', addr: c.addr, value: 0, status: 'completed', start: '2026-07-28',
          specUsed: [{ where: 'Walls', item: 'SW 7015 Repose Gray', finish: 'eggshell' }],
          photos: [{ type: 'after', data: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }] },
      ]);
      payments = payments.filter(p => p.client_id !== cid + 2);
      currentClientId = c.id;
      window['_cdpastOpen_981220'] = true;
      openClientDetail(c.id);
      const html = document.getElementById('cd-addresses-list')?.innerHTML || '';
      window['_cdpastOpen_981220'] = false;
      return {
        spec: /SW 7015 Repose Gray/.test(html),
        specWhere: /Walls/.test(html),
        scope: /Walls and trim throughout/.test(html),
        photo: /<img[^>]+data:image\/gif/.test(html),
        quoteBtn: /_cdQuoteAgain\(981220\)/.test(html),
        viewBtn: /viewBidFromTimeline\(981220\)/.test(html),
      };
    }, CID);
    expect(r.spec).toBe(true);
    expect(r.specWhere).toBe(true);
    expect(r.scope).toBe(true);
    expect(r.photo).toBe(true);
    expect(r.quoteBtn).toBe(true);
    expect(r.viewBtn).toBe(true);
  });

  test('Quote this again clones the money and scope, never the signature or completion', async () => {
    const r = await page.evaluate((cid) => {
      const c = { id: cid + 3, name: 'Again Co', addr: '4 Again St, Topeka, KS 66604' };
      clients = clients.filter(x => x.id !== cid + 3).concat([c]);
      bids = bids.filter(b => b.client_id !== cid + 3).concat([
        { id: 981230, client_id: c.id, client_name: c.name, name: 'Repaint', type: 'Interior repaint', addr: c.addr, amount: 3200,
          status: 'Closed Won', bid_date: '2025-05-01', completion_date: '2025-06-01',
          signed: true, signedAt: '2025-05-02', signerName: 'A Client', sigData: 'data:image/png;base64,x',
          signingToken: 'tok', proposalKey: 'pk', desc: 'Two coats everywhere' },
      ]);
      currentClientId = c.id;
      const before = bids.length;
      _cdQuoteAgain(981230);
      const copy = bids.find(b => b.client_id === c.id && b.id !== 981230);
      const orig = bids.find(b => b.id === 981230);
      return {
        added: bids.length === before + 1,
        copy: copy ? {
          amount: copy.amount, status: copy.status, desc: copy.desc, type: copy.type,
          hasCompletion: 'completion_date' in copy, hasSig: 'sigData' in copy || 'signedAt' in copy || 'signed' in copy,
          hasToken: 'signingToken' in copy || 'proposalKey' in copy,
          newId: copy.id !== 981230,
        } : null,
        origUntouched: !!(orig && orig.status === 'Closed Won' && orig.completion_date === '2025-06-01' && orig.signed),
      };
    }, CID);
    expect(r.added).toBe(true);
    expect(r.copy).not.toBe(null);
    expect(r.copy.amount).toBe(3200);
    expect(r.copy.status).toBe('pending');
    expect(r.copy.desc).toBe('Two coats everywhere');
    expect(r.copy.type).toBe('Interior repaint');
    expect(r.copy.hasCompletion).toBe(false);
    expect(r.copy.hasSig).toBe(false);
    expect(r.copy.hasToken).toBe(false);
    expect(r.copy.newId).toBe(true);
    expect(r.origUntouched).toBe(true);
  });

  test('the job sheet captures what we used onto the job record', async () => {
    const r = await page.evaluate((cid) => {
      const c = { id: cid + 4, name: 'Sheet Co', addr: '5 Sheet St, Topeka, KS 66604' };
      clients = clients.filter(x => x.id !== cid + 4).concat([c]);
      bids = bids.filter(b => b.client_id !== cid + 4);
      jobs = jobs.filter(j => j.client_id !== cid + 4).concat([
        { id: 981340, client_id: c.id, name: 'Repaint', addr: c.addr, value: 500, status: 'upcoming', start: '2026-08-20' },
      ]);
      openJobSheet(c.id);
      const whereEl = document.getElementById('_specWhere-981340');
      const itemEl = document.getElementById('_specItem-981340');
      const finEl = document.getElementById('_specFin-981340');
      if (!itemEl) { document.querySelector('.zmodal-overlay')?.remove(); return { noInputs: true }; }
      whereEl.value = 'Trim';
      itemEl.value = 'SW 7006 Extra White';
      finEl.value = 'semi-gloss';
      addJobSpec(981340, c.id);
      const j = jobs.find(x => x.id === 981340);
      const reopened = !!document.querySelector('.zmodal-overlay');
      const shows = /SW 7006 Extra White/.test(document.querySelector('.zmodal-overlay')?.innerHTML || '');
      // Remove it again through the sheet's own control path.
      removeJobSpec(981340, 0, c.id);
      const after = jobs.find(x => x.id === 981340).specUsed.length;
      document.querySelector('.zmodal-overlay')?.remove();
      return { noInputs: false, entry: j.specUsed && j.specUsed[0], reopened, shows, after };
    }, CID);
    expect(r.noInputs).toBe(false);
    expect(r.entry).toEqual({ where: 'Trim', item: 'SW 7006 Extra White', finish: 'semi-gloss' });
    expect(r.reopened).toBe(true);
    expect(r.shows).toBe(true);
    expect(r.after).toBe(0);
  });

  test('empty add is rejected and corrupt specUsed never crashes the card', async () => {
    const r = await page.evaluate((cid) => {
      const c = { id: cid + 5, name: 'Edge Co', addr: '6 Edge St, Topeka, KS 66604' };
      clients = clients.filter(x => x.id !== cid + 5).concat([c]);
      bids = bids.filter(b => b.client_id !== cid + 5).concat([
        { id: 981250, client_id: c.id, name: 'X', type: 'Repair', addr: c.addr, amount: 100, status: 'Closed Won', bid_date: '2026-08-01', completion_date: '2026-08-05' },
      ]);
      jobs = jobs.filter(j => j.client_id !== cid + 5).concat([
        { id: 981350, client_id: c.id, bid_id: 981250, name: 'X', addr: c.addr, value: 0, status: 'completed', start: '2026-08-04', specUsed: 'not-an-array', photos: null },
      ]);
      openJobSheet(c.id);
      const itemEl = document.getElementById('_specItem-981350');
      if (itemEl) { itemEl.value = '   '; addJobSpec(981350, c.id); }
      const stillOverlay = !!document.querySelector('.zmodal-overlay');
      document.querySelector('.zmodal-overlay')?.remove();
      const j = jobs.find(x => x.id === 981350);
      // A string specUsed must not throw when the past row renders open.
      let renderOk = true;
      try {
        currentClientId = c.id;
        window['_cdpastOpen_981250'] = true;
        openClientDetail(c.id);
        window['_cdpastOpen_981250'] = false;
      } catch (e) { renderOk = false; }
      return { rejected: !Array.isArray(j.specUsed) || !j.specUsed.length, stillOverlay, renderOk };
    }, CID);
    expect(r.rejected).toBe(true);   // whitespace-only item never lands
    expect(r.stillOverlay).toBe(true); // sheet stays up when the add is rejected
    expect(r.renderOk).toBe(true);
  });
});
