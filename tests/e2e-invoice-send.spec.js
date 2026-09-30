// @ts-check
/**
 * The invoice send screen (js/bids.js _sendPaidInvoice), owner 2026-09-29:
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
const sheet = (page) => page.evaluate(() => {
  const box = document.querySelector('.inv-send');
  if (!box) return null;
  return {
    who: box.querySelector('.inv-send-who').textContent, amt: box.querySelector('.inv-send-amt').textContent,
    buttons: [...box.querySelectorAll('.inv-send-btn')].map(b => ({ t: b.textContent, fill: b.classList.contains('fill') })),
    links: [...box.querySelectorAll('.inv-send-links button')].map(b => b.textContent),
    url: /https?:\/\//.test(box.textContent),
    bleed: document.documentElement.scrollWidth - innerWidth,
  };
});

test.describe('Invoice send screen', () => {
  test.afterEach(async ({ page }) => { await assertNoErrors(page, 'invoice send'); });

  test('who and how much, Text it big, Email it under it, Copy link and Not now; no web address on screen', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => _sendPaidInvoice(7001234));
    const r = await sheet(page);
    expect(r.who).toBe('John Doe');
    expect(r.amt).toBe('$1,250.50');
    expect(r.buttons).toEqual([{ t: 'Text it to them', fill: true }, { t: 'Email it', fill: false }]);
    expect(r.links).toEqual(['Copy link', 'Not now']);
    expect(r.url).toBe(false);
    expect(r.bleed).toBeLessThanOrEqual(1);
  });

  test('no phone: Email it is the big button; no email on file says so', async ({ page }) => {
    await boot(page, { noPhone: true, noEmail: true });
    await page.evaluate(() => _sendPaidInvoice(7001234));
    const r = await sheet(page);
    expect(r.buttons).toEqual([{ t: 'Email it (no email on file)', fill: true }]);
  });

  test('Email it: to their address, a subject with the business, the same message and link as the text', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      await _sendPaidInvoice(7001234);
      const href = document.querySelector('[data-inv-email]').dataset.href;
      const body = document.querySelector('[data-inv-text]').dataset.body;
      const u = new URL(href.replace('mailto:', 'http://x/'));
      return { to: decodeURIComponent(u.pathname.slice(1)), subject: u.searchParams.get('subject'), same: u.searchParams.get('body') === body, link: /client\.html\?t=tok901.*#invoice-7001234/.test(u.searchParams.get('body')) };
    });
    expect(r).toEqual({ to: 'john@doe.test', subject: 'Invoice from Sample Plumbing', same: true, link: true });
  });

  test('it counts as sent when it leaves by text, email or copy; Not now and a tap outside do not', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
      const b = bids[0];
      const out = {};
      let calls = 0;
      await _sendPaidInvoice(b.id, { onUnsent: () => calls++ });
      document.querySelector('[data-inv-close]').click();
      out.notNow = { sent: !!b.sentAt, calls, gone: !document.querySelector('.inv-send') };
      await _sendPaidInvoice(b.id, { onUnsent: () => calls++ });
      document.querySelector('.inv-send').parentElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      out.outside = { sent: !!b.sentAt, calls };
      await _sendPaidInvoice(b.id, { onUnsent: () => calls++ });
      document.querySelector('[data-inv-copy]').click();
      out.copied = { sent: !!b.sentAt, text: document.querySelector('[data-inv-copy]').textContent };
      document.querySelector('[data-inv-close]').click();
      out.afterCopy = { calls };
      return out;
    });
    expect(r.notNow).toEqual({ sent: false, calls: 1, gone: true });
    expect(r.outside).toEqual({ sent: false, calls: 2 });
    expect(r.copied).toEqual({ sent: true, text: 'Copied' });
    expect(r.afterCopy, 'closing after it went out is not unsent').toEqual({ calls: 2 });
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
      document.querySelector('[data-inv-close]').click();
      const c = getClientById(901);
      const d = _qiDraftGet(c, '');          // one property: the invoice opened with no address picked
      const back = { bid: bids.some(b => String(b.id) === String(id)), draft: !!d, sameId: d && d.id === id, due: d && d.due, line: d && d.typed[0].desc };
      openQuickInvoice(901);
      const reopened = { id: _qi.id, due: _qi.due };
      _qi.due = '15';
      qiSend();
      await new Promise(res => setTimeout(res, 50));
      document.querySelector('[data-inv-text]').dispatchEvent(new MouseEvent('click', { bubbles: false }));
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
