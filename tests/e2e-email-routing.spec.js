// @ts-check
// ── Which road an email takes ───────────────────────────────────────────────
//
// Owner 2026-10-03: Resend is there because a company mail filter blocked a
// bid Zach sent to Bettis Asphalt from his own address. A company inbox wants
// mail from a domain that proves who it is; a personal inbox does not care.
// So a personal address (Gmail, Yahoo, iCloud...) opens the contractor's own
// Mail app filled in, and everything else still goes through Resend, which
// keeps Resend's free 100 a day for the emails that need it.
//
// One screen carries every customer email (proposals, invoices, change
// orders), so one rule in _sendEmailFromCompose covers them all.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

async function boot(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppBoot(page);
  await page.evaluate(() => {
    clients.splice(0, clients.length, { id: 901, name: 'John Doe', addr: '1418 Maple Ave, Topeka, KS 66603', phone: '5555550101', email: 'john@doe.test', status: 'Client', clientToken: 'tok901' });
    bids.splice(0, bids.length, { id: 7001234, client_id: 901, client_name: 'John Doe', amount: 1250.5, status: 'Closed Won', kind: 'quick_invoice', lineItems: [{ desc: 'Water heater', qty: 1, rate: 1250.5 }] });
    S.bname = 'Sample Plumbing'; S.venmoUser = '';
    window._supaUser = window._supaUser || { id: 'e2e-user', email: 'owner@sampleplumbing.test' };
    window._uploadClientHub = async () => {};
  });
}

// Opens the invoice email screen with `to` in the box and presses the button.
// Returns where it went: the Resend call (if any) and the Mail hand-off (if any).
async function sendTo(page, to) {
  return page.evaluate(async (to) => {
    const b = bids[0];
    let resend = null, mail = null;
    window.fetch = async (u, o) => { if (String(u).includes('send-proposal-email')) resend = JSON.parse(o.body); return new Response('{}', { status: 200 }); };
    window._ecOpenMail = (href) => { mail = href; };
    await _sendPaidInvoice(b.id, {});
    document.querySelector('[data-send="email"]').click();
    const box = document.getElementById('_ec-to');
    box.value = to; box.dispatchEvent(new Event('input'));
    const label = document.getElementById('_ec-send-btn').textContent;
    const hint = document.getElementById('_ec-route').textContent;
    await _sendEmailFromCompose();
    await new Promise(r => setTimeout(r, 500));
    return { label, hint, resend: resend && resend.to, mail, sent: !!b.sentAt, open: !!document.getElementById('_email-compose-overlay') };
  }, to);
}

test.describe('email routing', () => {
  test.afterEach(async ({ page }) => { await assertNoErrors(page, 'email routing'); });

  test('personal mailboxes are told apart from company ones', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const yes = ['bob@gmail.com', 'BOB@GMAIL.COM', '  bob@gmail.com ', 'a@yahoo.com', 'a@yahoo.co.uk', 'a@hotmail.fr', 'a@outlook.com',
        'a@live.com', 'a@icloud.com', 'a@me.com', 'a@aol.com', 'a@comcast.net', 'a@att.net', 'a@kc.rr.com', 'a@proton.me'];
      const no = ['estimating@bettisasphalt.com', 'pm@steelers.com', 'a@gmail.co', 'a@notgmail.com', 'a@gmail.com.evil.io',
        'a@outlookconsulting.com', '', null, undefined, 'no-at-sign', '@gmail.com', 'bob@', 42];
      return { yes: yes.filter(a => !emailIsPersonal(a)), no: no.filter(a => emailIsPersonal(a)) };
    });
    expect(r.yes, 'personal addresses read as company').toEqual([]);
    expect(r.no, 'company or junk addresses read as personal').toEqual([]);
  });

  test('a Gmail address opens their own Mail app filled in, and Resend is never called', async ({ page }) => {
    await boot(page);
    const r = await sendTo(page, 'john.doe@gmail.com');
    expect(r.label).toBe('Open in Mail →');
    expect(r.hint).toContain('your own email');
    expect(r.resend).toBeNull();
    expect(r.mail).toMatch(/^mailto:john\.doe%40gmail\.com\?subject=/);
    expect(decodeURIComponent(r.mail)).toContain('#invoice-7001234');
    expect(r).toMatchObject({ sent: true, open: false });
  });

  test('a company address goes through Resend, as the Bettis bid needed', async ({ page }) => {
    await boot(page);
    const r = await sendTo(page, 'estimating@bettisasphalt.com');
    expect(r.label).toBe('Send Email →');
    expect(r.hint).toContain('company mail filters');
    expect(r.resend).toBe('estimating@bettisasphalt.com');
    expect(r.mail).toBeNull();
    expect(r).toMatchObject({ sent: true, open: false });
  });

  test('the button follows the address as it is typed', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      await _sendPaidInvoice(bids[0].id, {});
      document.querySelector('[data-send="email"]').click();
      const box = document.getElementById('_ec-to'), btn = document.getElementById('_ec-send-btn');
      const seen = [btn.textContent];
      for (const v of ['pm@acme.com', 'pm@gmail.com', 'pm@acme.com']) { box.value = v; box.dispatchEvent(new Event('input')); seen.push(btn.textContent); }
      return seen;
    });
    expect(r).toEqual(['Send Email →', 'Send Email →', 'Open in Mail →', 'Send Email →']);
  });
});
