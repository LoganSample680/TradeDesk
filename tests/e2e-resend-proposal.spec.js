// @ts-check
/**
 * One resend for a proposal that already went out (audit 2026-10-01).
 *
 * The bid card's "Resend to client" used to write a mailto describing a paint
 * job: a Sherwin-Williams line, "every surface will be sanded", a fixed 25%
 * deposit and 75% balance, and "Your painting proposal" for a plumber. The
 * dashboard had its own text-only resend and a third copy sat unused. Now both
 * buttons open the one send sheet (tdSendSheet) through resendProposal, with
 * his trade, his total and the deposit the bid stores.
 *
 * Also guards the one deposit-due rule (_bidDepositDue) the pay panel, its
 * chips, the badge and the hub snapshot now share.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

async function boot(page) {
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppBoot(page);
  await page.evaluate(() => {
    S.bname = 'Flow Right Plumbing';
    clients.push({ id: 6601, name: 'Dana Pipes', phone: '316-555-0144', email: 'dana@example.com', clientToken: 'hubtok6601' });
    bids.push({ id: 6602, client_id: 6601, client_name: 'Dana Pipes', trade_type: 'plumbing', type: 'Repipe',
      amount: 4200, deposit: 1000, status: 'Pending', signingToken: 'tok6602', bid_date: '2026-09-20', paint: 'prem' });
  });
}

test.describe('Resend a proposal', () => {
  test.afterEach(async ({ page }) => { await assertNoErrors(page, 'resend proposal'); });

  test('the sheet is the shared send sheet: Text, Email, Other app, Copy link, on the hub link', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      resendProposal(6602);
      const ov = document.getElementById('_resend-overlay');
      const box = ov && ov.querySelector('.zmodal.td-send');
      return {
        zmodal: !!(ov && ov.classList.contains('zmodal-overlay')),
        sends: box ? [...box.querySelectorAll('[data-send]')].map(b => b.getAttribute('data-send')) : [],
        url: box ? box.dataset.url : '',
        who: box ? box.querySelector('.td-send-who').textContent : '',
        amt: box ? box.querySelector('.td-send-amt').textContent : '',
      };
    });
    expect(r.zmodal).toBe(true);
    expect(r.sends).toEqual(['text', 'email', 'other', 'copy', 'close']);
    expect(r.url).toContain('client.html?t=hubtok6601');
    expect(r.who).toBe('Dana Pipes');
    expect(r.amt).toBe('$4,200.00');
  });

  test('the text is his saved follow-up template, with the link last', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      S.smsFollowup = 'Hi {name}, {business} here. Your proposal: {url} Any questions, just reply.';
      resendProposal(6602);
      const box = document.querySelector('#_resend-overlay .zmodal');
      return { body: box.querySelector('[data-send="text"]').dataset.body, url: box.dataset.url };
    });
    expect(r.body.startsWith('Hi Dana, Flow Right Plumbing here.')).toBe(true);
    expect(r.body.endsWith(r.url)).toBe(true);
    expect(r.body.split(r.url).length).toBe(2);   // the link once, not twice
  });

  test('a plumbing resend email says plumbing, no paint, no sanding, and the bid\'s own deposit', async ({ page }) => {
    await boot(page);
    const m = await page.evaluate(() => {
      const b = bids.find(x => x.id === 6602);
      return decodeURIComponent(_resendProposalEmail(b, _resendProposalUrl(b)));
    });
    expect(m.startsWith('mailto:dana@example.com?')).toBe(true);
    expect(m).toMatch(/Your plumbing proposal from Flow Right Plumbing/);
    expect(m).toMatch(/Total: \$4,200\.00/);
    expect(m).toMatch(/Deposit to start: \$1,000\.00/);
    expect(m).toContain('client.html?t=hubtok6601');
    expect(m).not.toMatch(/paint|sherwin|sanded|sanding|spackle/i);
    expect(m).not.toMatch(/25%|75%|\$1,050|\$3,150/);
  });

  test('no deposit stored: the email states none rather than inventing a percentage', async ({ page }) => {
    await boot(page);
    const m = await page.evaluate(() => {
      const b = bids.find(x => x.id === 6602); b.deposit = 0;
      return decodeURIComponent(_resendProposalEmail(b, _resendProposalUrl(b)));
    });
    expect(m).not.toMatch(/Deposit/);
    expect(m).not.toMatch(/%/);
  });

  test('no hub yet: the link falls back to the signing page', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      bids.push({ id: 6603, client_name: 'Walk In', trade_type: 'plumbing', amount: 300, status: 'Pending', signingToken: 'tok6603' });
      return _resendProposalUrl(bids.find(x => x.id === 6603));
    });
    expect(r).toContain('sign.html?t=tok6603');
    expect(r).toContain('&b=6603');
  });

  test('Copy link copies the link and closes the sheet; Not now sends nothing', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      let copied = '';
      const orig = navigator.clipboard.writeText;
      navigator.clipboard.writeText = (t) => { copied = t; return Promise.resolve(); };
      resendProposal(6602);
      document.querySelector('#_resend-overlay [data-send="copy"]').click();
      await new Promise(res => setTimeout(res, 50));
      const closedAfterCopy = !document.getElementById('_resend-overlay');
      resendProposal(6602);
      document.querySelector('#_resend-overlay [data-send="close"]').click();
      navigator.clipboard.writeText = orig;
      return { copied, closedAfterCopy, closed: !document.getElementById('_resend-overlay') };
    });
    expect(r.copied).toContain('client.html?t=hubtok6601');
    expect(r.closedAfterCopy).toBe(true);
    expect(r.closed).toBe(true);
  });

  test('the dashboard and the bid card both point at resendProposal', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      window._mmtCol_pending = false;
      renderTodayFeed();
      const dash = (document.getElementById('dash-money-feed') || {}).innerHTML || '';
      openClientDetail(6601); renderCDBids();
      const card = (document.getElementById('bid-card-6602') || {}).outerHTML || '';
      delete window._mmtCol_pending;
      return { dash: dash.includes('resendProposal(6602)'), card: card.includes('resendProposal(6602)') };
    });
    expect(r.dash).toBe(true);
    expect(r.card).toBe(true);
  });
});

test.describe('The one deposit due (_bidDepositDue)', () => {
  test.afterEach(async ({ page }) => { await assertNoErrors(page, 'deposit due'); });

  test('stored deposit, none stored, capped by balance, quick invoice, junk', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => ({
      stored: _bidDepositDue({ amount: 4200, deposit: 1000 }),
      none: _bidDepositDue({ amount: 4200 }),
      zero: _bidDepositDue({ amount: 4200, deposit: 0 }),
      odd: _bidDepositDue({ amount: 333.33 }),
      capped: _bidDepositDue({ amount: 4200, deposit: 1000 }, 400),
      qi: _bidDepositDue({ amount: 4200, deposit: 1000, kind: 'quick_invoice' }),
      nul: _bidDepositDue(null),
      str: _bidDepositDue({ amount: 'abc', deposit: 'x' }),
    }));
    expect(r.stored).toBe(1000);
    expect(r.none).toBe(1050);       // the same quarter every copy used before
    expect(r.zero).toBe(1050);
    expect(r.odd).toBe(83.33);
    expect(r.capped).toBe(400);
    expect(r.qi).toBe(0);
    expect(r.nul).toBe(0);
    expect(r.str).toBe(0);
  });

  test('the pay panel chip and the badge read the bid\'s deposit, not 25%', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const b = bids.find(x => x.id === 6602); b.status = 'Closed Won';
      openPayPanel(6602);
      const chip = (document.getElementById('mpay-btn-deposit') || {}).textContent || '';
      payments.push({ id: 'p6602', bid_id: 6602, client_id: 6601, amount: 1000, date: '2026-09-21', type: 'deposit' });
      const badge = payStatus(b).label;
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      return { chip, badge };
    });
    expect(r.chip).toMatch(/Deposit \$1,000/);
    expect(r.badge).toBe('Deposit paid');
  });

  test('one copy: no other 25% fallback left in the collect step or the hub snapshot', async () => {
    const fs = require('fs');
    const read = f => fs.readFileSync(require('path').join(__dirname, '..', 'js', f), 'utf8');
    const prop = read('proposals.js'), bidsSrc = read('bids.js');
    // A stored deposit, even 0 (nothing up front), is what their page shows.
    expect(prop).toMatch(/deposit:b\.deposit!=null\?b\.deposit:_bidDepositDue\(b\)/);
    expect(prop).not.toMatch(/\*0\.25\*100\)\/100/);
    expect(bidsSrc).not.toMatch(/total\*0?\.25/);
    expect((bidsSrc.match(/\*\.25\b/g) || []).length).toBe(1);   // only inside _bidDepositDue
  });
});
