// @ts-check
/**
 * The one send screen (js/proposals.js tdSendSheet), shown here through the
 * invoice (js/bids.js _sendPaidInvoice). Owner 2026-09-29: "Send it to them
 * needs to be shared code with proposals too", and before that:
 *
 *   "This is also ugly" (the old sheet printed the whole web address), and
 *   "I got to that screen and didn't send it but yet it disappeared from my
 *   invoices, why?"
 *
 *   - Who and how much, Text it as the big button, Email it under it, Copy
 *     link and Not now as plain links. No web address on screen.
 *   - It counts as sent when it leaves by text, email or copy (bid.sentAt).
 *   - A quick invoice closed without sending goes back to a draft on Ready to
 *     bill under the same number, days and all.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

async function boot(page, opts) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppBoot(page);
  await page.evaluate((o) => {
    clients.splice(0, clients.length, { id: 901, name: 'John Doe', addr: '1418 Maple Ave, Topeka, KS 66603', phone: o.noPhone ? '' : '5555550101', email: o.noEmail ? '' : 'john@doe.test', status: 'Client', clientToken: 'tok901' });
    bids.splice(0, bids.length, { id: 7001234, client_id: 901, client_name: 'John Doe', amount: 1250.5, status: 'Closed Won', kind: 'quick_invoice', lineItems: [{ desc: 'Water heater', qty: 1, rate: 1250.5 }] });
    S.bname = 'Sample Plumbing'; S.venmoUser = '';
    window._supaUser = window._supaUser || { id: 'e2e-user' };
    window._uploadClientHub = async () => {};
  }, opts || {});
}
const sheet = (page, id) => page.evaluate((id) => {
  const box = document.querySelector('#' + (id || '_inv-send-ov') + ' .td-send');
  if (!box) return null;
  return {
    who: box.querySelector('.td-send-who').textContent, amt: box.querySelector('.td-send-amt') ? box.querySelector('.td-send-amt').textContent : '',
    buttons: [...box.querySelectorAll('.td-send-btn')].map(b => ({ t: b.textContent, fill: b.classList.contains('fill') })),
    links: [...box.querySelectorAll('.td-send-links button')].map(b => b.textContent),
    url: /https?:\/\//.test(box.textContent),
    bleed: document.documentElement.scrollWidth - innerWidth,
  };
}, id);

test.describe('Invoice send screen', () => {
  test.afterEach(async ({ page }) => { await assertNoErrors(page, 'invoice send'); });

  test('who and how much, Text it big, Email it under it, Other app, Copy link and Not now; no web address on screen', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => _sendPaidInvoice(7001234));
    const r = await sheet(page);
    expect(r.who).toBe('John Doe');
    expect(r.amt).toBe('$1,250.50');
    expect(r.buttons).toEqual([{ t: 'Text it to them', fill: true }, { t: 'Email it', fill: false }]);
    expect(r.links).toEqual(['Other app', 'Copy link', 'Not now']);
    expect(r.url).toBe(false);
    expect(r.bleed).toBeLessThanOrEqual(1);
  });

  test('no phone: Email it is the big button; no email on file says so', async ({ page }) => {
    await boot(page, { noPhone: true, noEmail: true });
    await page.evaluate(() => _sendPaidInvoice(7001234));
    const r = await sheet(page);
    expect(r.buttons).toEqual([{ t: 'Email it (no email on file)', fill: true }]);
  });

  test('Email it opens the same compose screen proposals use, as an invoice; sending it counts, cancelling it does not', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const b = bids[0]; let unsent = 0, sentBody = null;
      window.fetch = async (u, o) => { sentBody = JSON.parse(o.body); return new Response('{}', { status: 200 }); };
      await _sendPaidInvoice(b.id, { onUnsent: () => unsent++ });
      document.querySelector('[data-send="email"]').click();
      const ov = document.getElementById('_email-compose-overlay');
      const compose = { to: document.getElementById('_ec-to').value, subject: document.getElementById('_ec-subj').value };
      document.querySelector('#_email-compose-overlay button[onclick="_ecCancel()"]').click();
      const afterCancel = { unsent, sent: !!b.sentAt };
      await _sendPaidInvoice(b.id, { onUnsent: () => unsent++ });
      document.querySelector('[data-send="email"]').click();
      await _sendEmailFromCompose();
      return { opened: !!ov, compose, afterCancel, kind: sentBody && sentBody.kind, link: sentBody && /#invoice-7001234$/.test(sentBody.proposalUrl), sent: !!b.sentAt, unsent };
    });
    expect(r.opened).toBe(true);
    expect(r.compose).toEqual({ to: 'john@doe.test', subject: 'Invoice from Sample Plumbing' });
    expect(r.afterCancel).toEqual({ unsent: 1, sent: false });
    expect(r.kind).toBe('invoice');
    expect(r.link).toBe(true);
    expect(r).toMatchObject({ sent: true, unsent: 1 });
  });

  test('proposals, change orders and invoices are the same screen: same buttons, same links, same look', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const read = id => { const box = document.querySelector('#' + id + ' .td-send'); const o = box ? { buttons: [...box.querySelectorAll('.td-send-btn')].map(b => b.textContent), links: [...box.querySelectorAll('.td-send-links button')].map(b => b.textContent), url: !!box.dataset.url } : null; document.getElementById(id)?.remove(); return o; };
      await _sendPaidInvoice(7001234);
      const inv = read('_inv-send-ov');
      _pendingShareData = { url: 'https://x/sign.html?t=1', cname: 'John Doe', bname: 'Sample Plumbing', cphone: '5555550101', cemail: 'john@doe.test' };
      _showGeiSendOverlay();
      const prop = read('_gei-send-overlay');
      return { inv, prop, oldSheets: typeof _showCONotifyModal };
    });
    expect(r.prop).toEqual(r.inv);
    expect(r.inv.url).toBe(true);
  });

  test('a quick invoice closed without sending goes back to a draft on Ready to bill, same number; texted, it stays an invoice', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      bids.splice(0, bids.length);
      const make = () => {
        openQuickInvoice(901); _qiSetMode('set');
        _qi.typed = [{ desc: 'Replaced the water heater', amount: '1250' }];
        _qi.due = '15';
        return _qi.id;
      };
      const id = make();
      qiSend();
      await new Promise(res => setTimeout(res, 50));
      document.querySelector('[data-send="close"]').click();
      const c = getClientById(901);
      const d = _qiDraftGet(c, '');          // one property: the invoice opened with no address picked
      const back = { bid: bids.some(b => String(b.id) === String(id)), draft: !!d, sameId: d && d.id === id, due: d && d.due, line: d && d.typed[0].desc };
      openQuickInvoice(901);
      const reopened = { id: _qi.id, due: _qi.due };
      _qi.due = '15';
      qiSend();
      await new Promise(res => setTimeout(res, 50));
      document.querySelector('[data-send="text"]').dispatchEvent(new MouseEvent('click', { bubbles: false }));
      const kept = bids.find(b => String(b.id) === String(id));
      return { id, back, reopened, kept: !!kept, sent: !!(kept && kept.sentAt), draftAfter: !!_qiDraftGet(c, '') };
    });
    expect(r.back).toEqual({ bid: false, draft: true, sameId: true, due: '15', line: 'Replaced the water heater' });
    expect(r.reopened).toEqual({ id: r.id, due: '15' });
    expect(r.kept).toBe(true);
    expect(r.sent).toBe(true);
    expect(r.draftAfter).toBe(false);
  });

  test('money taken on it, or no hub link to send: never quietly undone by the wrong path', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      bids.splice(0, bids.length, { id: 88, client_id: 901, amount: 100, status: 'Closed Won', kind: 'quick_invoice', sentAt: '2026-09-29T12:00:00Z' });
      _qiUnsend(88, 901, '', { id: 88 });
      const sentStays = bids.some(b => b.id === 88);
      _qiUnsend('nope', 901, '', {});
      return { sentStays, junk: bids.length };
    });
    expect(r).toEqual({ sentStays: true, junk: 1 });
  });
});
