// @ts-check
/**
 * Venmo (owner 2026-09-26): "can our app launch Venmo?" A venmo.com link opens
 * the customer's own Venmo with the amount and a note filled in, paying this
 * business's username. TradeDesk never touches the money and charges nothing.
 *
 * The username lives on S (one per business), is set in Settings > How you get
 * paid, and is offered on the setup checklist. With it: the invoice text ends
 * in a Pay with Venmo link, and Pay now > Log it > Venmo can put a code on
 * screen for the customer to scan. Without it: nothing Venmo is added.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

async function boot(page) {
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppBoot(page);
  await page.evaluate(() => {
    clients.splice(0, clients.length, { id: 901, name: 'John Doe', addr: '1418 Maple Ave', phone: '5555550101', status: 'Client', clientToken: 'tok901' });
    bids.push({ id: 7001234, client_id: 901, client_name: 'John Doe', amount: 1250.5, status: 'Closed Won', kind: 'quick_invoice', lineItems: [{ desc: 'Water heater', qty: 1, rate: 1250.5 }] });
    S.bname = 'Sample Plumbing';
    window._supaUser = window._supaUser || { id: 'e2e-user' };
    window._uploadClientHub = async () => {};
  });
}

test.describe('Venmo', () => {
  test.afterEach(async ({ page }) => { await assertNoErrors(page, 'venmo'); });

  test('the username is cleaned: @, a pasted link, spaces and junk all come out as the bare name', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => [
      '@John-Doe_22', ' john-doe ', 'https://venmo.com/u/John-Doe', 'https://account.venmo.com/u/John-Doe?x=1', 'venmo.com/John-Doe',
      'john doe', 'j<o>hn', '', null, undefined, 42, 'x'.repeat(50),
    ].map(v => _venmoClean(v)));
    expect(r).toEqual(['John-Doe_22', 'john-doe', 'John-Doe', 'John-Doe', 'John-Doe', 'john', 'john', '', '', '', '42', 'x'.repeat(30)]);
  });

  test('the pay link: username, amount to the cent, the note; nothing without a username or an amount', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      S.venmoUser = '';
      const none = _venmoPayUrl(100, 'x');
      S.venmoUser = '@John-Doe';
      return { none, ok: _venmoPayUrl(1250.5, 'Invoice from Sample Plumbing #1234'), zero: _venmoPayUrl(0, 'x'), neg: _venmoPayUrl(-5, 'x'), junk: _venmoPayUrl('abc', 'x') };
    });
    expect(r.none).toBe('');
    expect(r.ok).toBe('https://venmo.com/John-Doe?txn=pay&amount=1250.50&note=Invoice%20from%20Sample%20Plumbing%20%231234');
    expect(r.zero).toBe('');
    expect(r.neg).toBe('');
    expect(r.junk).toBe('');
  });

  test('Settings: the box shows the saved name and saving cleans what was typed', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      S.venmoUser = 'John-Doe';
      loadSettingsForm();
      const shown = document.getElementById('set-venmo').value;
      document.getElementById('set-venmo').value = '@Jack-Side-Biz ';
      saveSettings();
      return { shown, saved: S.venmoUser };
    });
    expect(r.shown).toBe('John-Doe');
    expect(r.saved).toBe('Jack-Side-Biz');
  });

  test('the invoice text ends in the Venmo link for what is still owed; no link without a username', async ({ page }) => {
    await boot(page);
    const read = () => page.evaluate(async () => {
      const btn = document.querySelector('[data-inv-text]');
      const body = btn ? btn.dataset.body : '';
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      return body;
    });
    await page.evaluate(() => { S.venmoUser = ''; return _sendPaidInvoice(7001234); });
    const without = await read();
    await page.evaluate(() => { S.venmoUser = 'John-Doe'; return _sendPaidInvoice(7001234); });
    const withIt = await read();
    expect(without).not.toContain('venmo');
    expect(withIt).toContain('here is your invoice for $1,250.50');
    expect(withIt.split('\n').pop()).toBe('Or pay with Venmo: https://venmo.com/John-Doe?txn=pay&amount=1250.50&note=Invoice%20from%20Sample%20Plumbing%20%231234');
  });

  test('the Invoice ready sheet: Text it opens Messages with the whole body, Copy link copies (both were dead on tap)', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      S.venmoUser = 'John-Doe';
      const hrefs = []; let copied = null;
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { copied = t; } }, configurable: true });
      window.__errs = []; window.addEventListener('error', e => window.__errs.push(e.message));
      await _sendPaidInvoice(7001234);
      document.querySelector('[data-inv-copy]').click();
      await new Promise(r => setTimeout(r, 30));
      const copyTxt = document.querySelector('[data-inv-copy]').textContent;
      const tb = document.querySelector('[data-inv-text]');
      tb.dispatchEvent(new MouseEvent('click', { bubbles: false }));
      return { copied, copyTxt, errs: window.__errs, sheetGone: !document.querySelector('[data-inv-text]') };
    });
    expect(r.errs).toEqual([]);
    expect(r.copied).toMatch(/client\.html\?t=tok901.*#invoice-7001234$/);
    expect(r.copyTxt).toContain('Copied');
    expect(r.sheetGone).toBe(true);
  });

  // Owner 2026-09-27: "hit record payment for Venmo and it didn't launch
  // Venmo even with my Venmo username in". Picking Venmo opens the code by
  // itself now; the button under the pills only brings it back.
  test('Record payment: picking Venmo opens the code by itself, drawn on the phone, with Text them the link and Open Venmo', async ({ page }) => {
    let fetched = 0;
    await page.route('**/api.qrserver.com/**', r => { fetched++; return r.abort(); });
    await boot(page);
    const r = await page.evaluate(() => {
      const toasts = []; const t = window.showToast; window.showToast = (m) => toasts.push(m);
      S.venmoUser = '';
      openPayPanel(7001234);
      _mpayPickMethod('Venmo');
      const noUser = { ov: !!document.getElementById('_venmo-qr-ov'), btn: getComputedStyle(document.getElementById('mpay-venmo-qr')).display };
      closePayPanel();
      S.venmoUser = 'John-Doe';
      openPayPanel(7001234);
      _mpayPickMethod('Cash');
      const cash = !!document.getElementById('_venmo-qr-ov');
      document.getElementById('mpay-amount').value = '500.00';
      _mpayPickMethod('Venmo');
      const ov = document.getElementById('_venmo-qr-ov');
      const opened = []; const wo = window.open; window.open = (u) => { opened.push(u); return null; };
      document.getElementById('_venmo-open').click();
      window.open = wo; window.showToast = t;
      const out = { noUser, toasts, cash, open: !!ov, title: ov.querySelector('.zmodal div').textContent, sub: ov.textContent,
        src: ov.querySelector('img').src.slice(0, 21), sms: document.getElementById('_venmo-text').dataset.href, opened,
        btn: getComputedStyle(document.getElementById('mpay-venmo-qr')).display };
      document.getElementById('_venmo-done').click();
      out.closed = !document.getElementById('_venmo-qr-ov');
      return out;
    });
    expect(r.noUser).toEqual({ ov: false, btn: 'none' });
    expect(r.toasts).toEqual(['Add your Venmo username in Settings first.']);
    expect(r.cash).toBe(false);
    expect(r.open, 'the code comes up the moment Venmo is picked').toBe(true);
    expect(r.title, 'the amount being collected, not the whole balance').toBe('Pay $500.00 with Venmo');
    expect(r.sub).toContain('paying @John-Doe');
    expect(r.src, 'drawn on the phone, works with no signal').toBe('data:image/gif;base64');
    expect(fetched).toBe(0);
    expect(decodeURIComponent(r.sms)).toBe('sms:5555550101?body=Hi John, here is the Venmo link for $500.00: https://venmo.com/John-Doe?txn=pay&amount=500.00&note=Invoice from Sample Plumbing #1234');
    expect(r.opened).toEqual(['https://venmo.com/']);
    expect(r.btn, 'the button stays to bring the code back').toBe('block');
    expect(r.closed).toBe(true);
  });

  test('the code with no username refuses with a toast, not an empty code', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      S.venmoUser = ''; const toasts = []; const t = window.showToast; window.showToast = (m) => toasts.push(m);
      try { showVenmoQr(7001234); showVenmoQr(null); showVenmoQr(999); } finally { window.showToast = t; }
      return { toasts, ov: !!document.getElementById('_venmo-qr-ov') };
    });
    expect(r.ov).toBe(false);
    expect(r.toasts).toEqual(['Add your Venmo username in Settings first.']);
  });

  test('setup checklist: "Add your Venmo" shows, can be skipped, drops off once a username is saved, and Add lands on the box', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      try { if (typeof _isEmployee !== 'undefined') _isEmployee = false; } catch (e) {}
      S.setupSkipped = []; S.setupDone = false; S.venmoUser = '';
      _renderDashSetupTodo();
      const has = () => /_setupTodoGo\('venmo'\)/.test(document.getElementById('dash-setup-todo').innerHTML);
      const shown = has();
      const row = [...document.querySelectorAll('#dash-setup-todo .td-setup-row')].find(x => /Add your Venmo/.test(x.textContent));
      const skippable = !!(row && /Skip for now/.test(row.innerHTML));
      S.venmoUser = 'John-Doe'; _renderDashSetupTodo();
      const gone = !has();
      S.venmoUser = ''; S.setupSkipped = ['venmo']; _renderDashSetupTodo();
      const skipped = !has();
      S.setupSkipped = [];
      return { shown, skippable, gone, skipped };
    });
    expect(r).toEqual({ shown: true, skippable: true, gone: true, skipped: true });
    await page.evaluate(() => _setupTodoGo('venmo'));
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'set-venmo', null, { timeout: 5000 });
  });

  test('one business, one username: it rides on S, so a side business keeps its own (9.10)', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      S.venmoUser = 'Dads-Plumbing'; const dad = _venmoPayUrl(10, 'x');
      S.venmoUser = 'Jack-Lawns'; const jack = _venmoPayUrl(10, 'x');
      return { dad, jack };
    });
    expect(r.dad).toContain('venmo.com/Dads-Plumbing?');
    expect(r.jack).toContain('venmo.com/Jack-Lawns?');
  });
});
