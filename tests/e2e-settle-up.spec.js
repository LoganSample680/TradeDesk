// @ts-check
/**
 * Settle up (owner 2026-10-01): "they mark a job done ... it pulls whatever
 * they paid and it settled up. Awesome, you're good to go ... I'll text you a
 * paid invoice." Mark done shows the price, what is already paid and what is
 * left; finishing the job ends on the same block with the one tap that closes
 * it out; the invoice screen's banner opens it too, including for a signed
 * proposal that is not on the calendar yet. A card payment made on the
 * customer's page is fetched fresh, so it is never billed twice.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const fs = require('fs');
const path = require('path');

async function boot(page) {
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppBoot(page);
  await page.evaluate(() => {
    clients.splice(0, clients.length, { id: 901, name: 'John Doe', addr: '1418 Maple Ave, Springfield, IL', phone: '5555550101', status: 'Client' });
    bids.push({ id: 7101, client_id: 901, client_name: 'John Doe', type: 'Build Your Own Estimate', isFreeForm: true, status: 'Closed Won', amount: 3000, deposit: 750,
      geiDesc: 'Repipe the house in PEX\nNew shutoffs at every fixture' });
    jobs.push({ id: 'j7101', client_id: 901, bid_id: 7101, name: 'John Doe repipe', start: todayKey(), days: 1 });
    payments.push({ id: 'p1', bid_id: 7101, client_id: 901, amount: 750, date: '2026-09-20', type: 'deposit', method: 'Card' });
  });
}

test.describe('Settle up', () => {
  test.afterEach(async ({ page }) => { await assertNoErrors(page, 'settle up'); });

  test('Mark done shows the price, what is already paid and what is left', async ({ page }) => {
    await boot(page);
    const t = await page.evaluate(() => {
      markJobDone('j7101');
      return document.querySelector('.zmodal .settle-sum').textContent;
    });
    expect(t).toMatch(/Job price\s*\$3,000\.00/);
    expect(t).toMatch(/Already paid\s*−\$750\.00/);
    expect(t).toMatch(/Balance\s*\$2,250\.00/);
  });

  test('a card payment made on their page is pulled in before he settles, once', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const saved = { supa: _supa, user: _supaUser, en: window.supaEnabled };
      const row = { id: '555', data: { id: 555, bid_id: 7101, amount: 2250, type: 'payment', method: 'card', ref: 'pi_123', date: '2026-10-01' } };
      const q = { select() { return q; }, eq() { return q; }, is() { return Promise.resolve({ data: [row], error: null }); } };
      try {
        window.supaEnabled = () => true;
        _supaUser = { id: 'u-john' };
        _supa = Object.assign({}, _supa || {}, { from: () => q });
        const bid = bids.find(b => b.id === 7101);
        const a = await _settleFetch(bid);
        const b = await _settleFetch(bid);       // twice: no second copy
        return { a, b, paid: getBidPaid(7101), bal: getBidBalance(bid), sum: _settleSumHtml(bid) };
      } finally { _supa = saved.supa; _supaUser = saved.user; window.supaEnabled = saved.en; }
    });
    expect(r.a).toBe(true);
    expect(r.b).toBe(false);
    expect(r.paid).toBe(3000);
    expect(r.bal).toBe(0);
    expect(r.sum).toContain('Paid in full');
  });

  test('finishing the job ends on settle up: paying now, send the bill, or later', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      showJobScorecard('j7101', 7101);
      const box = [...document.querySelectorAll('.zmodal')].pop();
      const acts = [...box.querySelectorAll('[data-settle]')].map(b => b.dataset.settle + ':' + b.textContent.trim());
      let opened = null;
      const orig = window.openPayPanel;
      window.openPayPanel = (id, t) => { opened = [id, t]; };
      box.querySelector('[data-settle="pay"]').click();
      window.openPayPanel = orig;
      return { acts, opened, left: document.querySelectorAll('.zmodal .settle-acts').length };
    });
    expect(r.acts).toEqual(['pay:They\'re paying now · $2,250.00', 'later:Later', 'bill:Send the bill']);
    expect(r.opened).toEqual([7101, 'final']);
    expect(r.left).toBe(0);
  });

  test('paid in full: Done or text their receipt, nothing to collect', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      payments.push({ id: 'p2', bid_id: 7101, amount: 2250, date: '2026-10-01', type: 'final', method: 'Cash' });
      showJobScorecard('j7101', 7101);
      const box = [...document.querySelectorAll('.zmodal')].pop();
      let sent = null;
      const orig = window._sendPaidInvoice;
      window._sendPaidInvoice = (id) => { sent = id; };
      const acts = [...box.querySelectorAll('.settle-acts button')].map(b => b.textContent.trim());
      box.querySelector('[data-settle="receipt"]').click();
      window._sendPaidInvoice = orig;
      return { acts, sent, collect: box.textContent.includes('paying now') };
    });
    expect(r.acts).toEqual(['Done', 'Text their receipt']);
    expect(r.sent).toBe(7101);
    expect(r.collect).toBe(false);
  });

  test('the invoice banner catches a signed proposal with no day on the calendar, and settles it up', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      jobs.splice(jobs.findIndex(j => j.id === 'j7101'), 1);         // signed, never scheduled
      bids.find(b => b.id === 7101).completion_date = '2026-09-30';
      openQuickInvoice(901);
      const note = [...document.querySelectorAll('#qi-page .qi-note')].map(b => b.textContent).join(' ');
      document.querySelector('#qi-page .qi-note').click();
      const sheet = document.querySelector('.settle-overlay');
      return { note, lines: sheet && [...sheet.querySelectorAll('.settle-lines li')].map(l => l.textContent), bal: sheet && sheet.querySelector('.settle-bal').textContent };
    });
    expect(r.note).toContain('John has a');
    expect(r.note).toContain('$3,000, $750 paid, $2,250 left');
    expect(r.note).toContain('Settle it up');
    expect(r.lines).toEqual(['Repipe the house in PEX', 'New shutoffs at every fixture']);
    expect(r.bal).toBe('$2,250.00');
  });

  test('a job not marked done goes through Mark done first', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      openQuickInvoice(901);
      document.querySelector('#qi-page .qi-note').click();
      const top = [...document.querySelectorAll('.zmodal')].pop();
      return { title: top.textContent.slice(0, 40), settle: !!document.querySelector('.settle-overlay') };
    });
    expect(r.title).toContain('Job complete');
    expect(r.settle).toBe(false);
  });

  // Owner 2026-10-01: "best way to mark a job complete that wasn't from a
  // proposal but also from a proposal", without new screens.
  test('a job with no proposal ends on Bill for it, which opens the invoice for that customer', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      jobs.push({ id: 'j-np', client_id: 901, name: 'Leak call', start: todayKey(), days: 1 });
      showJobScorecard('j-np', null);
      const box = [...document.querySelectorAll('.zmodal')].pop();
      const btns = [...box.querySelectorAll('button')].map(b => b.textContent.trim());
      let opened = null;
      const orig = window.openQuickInvoice;
      window.openQuickInvoice = (cid) => { opened = cid; };
      box.querySelector('[data-settle="invoice"]').click();
      window.openQuickInvoice = orig;
      return { btns, opened };
    });
    expect(r.btns).toEqual(['Close', 'Bill for it']);
    expect(r.opened).toBe(901);
  });

  test('sending the bill finishes the job; a bill that never goes out opens it again', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      jobs.push({ id: 'j-np', client_id: 901, name: 'Leak call', start: todayKey(), days: 1 },
        { id: 'j-later', client_id: 901, name: 'Next week', start: addDays(todayKey(), 7), days: 1 });
      openQuickInvoice(901);
      _qiSetMode('set');
      _qi.typed = [{ desc: 'Fix the leak', amount: '250' }];
      _qi.due = 'receipt';
      const bid = _qiSave();
      const j = jobs.find(x => x.id === 'j-np'), later = jobs.find(x => x.id === 'j-later'), prop = jobs.find(x => x.id === 'j7101');
      const done = { status: j.status, date: j.completion_date === todayKey(), bill: j.bid_id === bid.id, later: later.status || null, prop: prop.status || null };
      _qiUnsend(bid.id, 901, '', {});
      return { done, back: { status: j.status || null, date: j.completion_date || null, bill: j.bid_id || null } };
    });
    expect(r.done).toEqual({ status: 'done', date: true, bill: true, later: null, prop: null });
    expect(r.back).toEqual({ status: null, date: null, bill: null });
  });

  test('a signed proposal with no job does not take the customer off Ready to bill; one with a job does', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const kept = jobs.find(j => j.id === 'j7101');
      jobs.splice(jobs.indexOf(kept), 1);
      const noJob = _qiPropJobs(901).map(p => p.jobId);
      jobs.push(kept);
      const withJob = _qiPropJobs(901).map(p => p.jobId);
      return { noJob, withJob };
    });
    expect(r.noJob).toEqual([null]);
    expect(r.withJob).toEqual(['j7101']);
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'quick-invoice.js'), 'utf8');
    expect(src).toContain('if(_qiPropJobs(c.id).some(p=>p.jobId!=null))return;');
  });

  test('null, unknown and junk ids never throw', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const out = [];
      for (const v of [null, undefined, 'nope', 0, {}]) {
        try { openSettleUp(v); qiOpenJob(v); out.push(await _settleFetch(v)); } catch (e) { out.push('threw ' + e.message); }
      }
      return out;
    });
    expect(r).toEqual([false, false, false, false, false]);
  });
});

// The card payment on the customer's page is booked by stripe-webhook. It used
// to write zj_data.payments, a JSON column the app no longer reads, so the
// payment never showed in the app.
test.describe('Card payments reach the ledger the app reads', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'stripe-webhook', 'index.ts'), 'utf8');
  test('payments and refunds are td_payments rows, the fee a td_expenses row', () => {
    expect(src).not.toMatch(/select\('payments/);
    expect(src).not.toMatch(/payments:\s*JSON\.stringify/);
    expect(src).toMatch(/bookRow\('td_payments', uid, \{/);
    expect(src).toMatch(/bookRow\('td_expenses', uid, \{/);
  });
  test('booked once per Stripe reference, keyed by the bid the app uses', () => {
    expect(src).toMatch(/\.eq\('data->>ref', ref\)/);
    expect(src).toMatch(/bid_id: bidKey\(meta\.bidId\)/);
    expect(src).toMatch(/bid_id: bidKey\(sp\.bid_id\)/);
  });
});
