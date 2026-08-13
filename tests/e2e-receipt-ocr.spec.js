// @ts-check
// ── On-device receipt reading (owner 2026-08-11) ─────────────────────────────
// Apple's Vision OCR reads a scanned receipt on-device in under a second,
// free, and with no signal. These tests pin the JUDGMENT layer, the half OCR
// is bad at and the half that decides whether a contractor's expense is right.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('On-device receipt parsing', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('the total beats the subtotal, the tax, and the cash tendered', async () => {
    const r = await page.evaluate(() => _rcptParseLines([
      'HOME DEPOT',
      '4600 W KELLOGG DR',
      'WICHITA KS 67209',
      '316-555-0142',
      '2x4x8 STUD           $4.28',
      'DECK SCREWS 5LB     $42.97',
      'SUBTOTAL            $47.25',
      'SALES TAX            $3.66',
      'TOTAL               $50.91',
      'CASH               $60.00',
      'CHANGE              $9.09',
      '08/09/2026 14:22',
    ]));
    expect(r.amount, 'the total, never the subtotal').toBe('50.91');
    expect(r.vendor).toBe('HOME DEPOT');
    expect(r.date).toBe('2026-08-09');
  });

  test('a label on its own line still finds its number (thermal receipts)', async () => {
    const r = await page.evaluate(() => _rcptParseLines([
      "MENARDS",
      'PVC ELBOW              3.18',
      'SUBTOTAL',
      '28.44',
      'TOTAL',
      '30.76',
      '7/4/26',
    ]));
    expect(r.amount, 'the number under TOTAL, not under SUBTOTAL').toBe('30.76');
    expect(r.date, 'two-digit years are this century').toBe('2026-07-04');
  });

  test('grand total wins over an earlier total', async () => {
    const r = await page.evaluate(() => _rcptParseLines([
      'ACE HARDWARE', 'TOTAL     100.00', 'DELIVERY   25.00', 'GRAND TOTAL  125.00',
    ]));
    expect(r.amount).toBe('125.00');
  });

  test('no labelled total: the largest amount in the bottom half, flagged as a guess', async () => {
    const r = await page.evaluate(() => _rcptParseLines([
      'Corner Lumber', 'plywood 4x8', '38.50', 'delivery', '62.75',
    ]));
    expect(r.amount).toBe('62.75');
    expect(r.guessed, 'the caller can tell this was inferred').toBe(true);
  });

  test('vendor skips phone numbers, street addresses, and receipt headers', async () => {
    const r = await page.evaluate(() => ({
      header: _rcptParseLines(['RECEIPT #4471', '1200 N Main St', '316-555-0100', 'Bobs Paint Supply', 'TOTAL 12.00']).vendor,
      digits: _rcptParseLines(['#8842119', '2026', 'Sherwin Williams', 'TOTAL 88.00']).vendor,
    }));
    expect(r.header, 'the store name, not the receipt number or address').toBe('Bobs Paint Supply');
    expect(r.digits).toBe('Sherwin Williams');
  });

  test('money detection refuses quantities, SKUs, and phone fragments', async () => {
    const r = await page.evaluate(() => ({
      good: _rcptMoneyIn('TOTAL $1,234.56'),
      plain: _rcptMoneyIn('48.10'),
      qty: _rcptMoneyIn('QTY 3'),
      sku: _rcptMoneyIn('SKU 884211900'),
      phone: _rcptMoneyIn('316-555-0100'),
      empty: _rcptMoneyIn(''),
      nul: _rcptMoneyIn(null),
    }));
    expect(r.good).toEqual([1234.56]);
    expect(r.plain).toEqual([48.10]);
    expect(r.qty, 'a bare integer is not money').toEqual([]);
    expect(r.sku).toEqual([]);
    expect(r.phone).toEqual([]);
    expect(r.empty).toEqual([]);
    expect(r.nul).toEqual([]);
  });

  test('garbage and empty input never throw', async () => {
    const r = await page.evaluate(() => {
      const cases = [[], null, undefined, [''], ['   '], ['%%%', '@@@'], [null, undefined, 42]];
      return cases.map(c => { try { const p = _rcptParseLines(c); return { ok: true, amount: p.amount, vendor: p.vendor }; } catch (e) { return { ok: false }; } });
    });
    r.forEach(x => expect(x.ok, 'a bad OCR read must never break the expense flow').toBe(true));
  });

  test('the local read never overwrites a value already on the form', async () => {
    const r = await page.evaluate(() => {
      const mk = (id, val) => { const el = document.createElement('input'); el.id = id; el.value = val; el.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(el); return el; };
      document.getElementById('em-vendor')?.remove();
      document.getElementById('em-amount')?.remove();
      const v = mk('em-vendor', 'Typed By Hand'), a = mk('em-amount', '');
      const filled = _rcptApplyLocalRead({ vendor: 'OCR Vendor', amount: '50.91' });
      const out = { filled, vendor: v.value, amount: a.value };
      v.remove(); a.remove();
      return out;
    });
    expect(r.vendor, 'a hand-typed vendor is never clobbered').toBe('Typed By Hand');
    expect(r.amount, 'an empty field is filled').toBe('50.91');
    expect(r.filled).toBe(1);
  });

  test('no console errors during receipt parsing tests', async () => {
    assertNoErrors(page, 'on-device receipt parsing');
  });
});

// ── Caller ID removal (owner 2026-08-11: "take out the business caller id") ──
// §7.1: a removal is not done until CI proves the old entry points are gone.
// The inbound Call Directory version was built and then cut, so nothing may
// reference it: no globals, no script tag, no plugin, no build step.
test.describe('Caller ID is fully removed', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('no caller ID globals survive in the running app', async () => {
    const r = await page.evaluate(() => ({
      list: typeof window._callerIdList,
      sync: typeof window._callerIdSync,
      soon: typeof window._callerIdSyncSoon,
      e164: typeof window._callerIdE164,
      prompt: typeof window._callerIdPrompt,
      status: typeof window._callerIdStatus,
      plugin: typeof window._callerIdPlugin,
    }));
    Object.entries(r).forEach(([name, t]) => {
      expect(t, `_callerId${name} must be gone, not merely unused`).toBe('undefined');
    });
  });

  test('the script tag and its file are gone from the app shell', async () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    expect(fs.existsSync(path.join(root, 'js/callerid.js')), 'js/callerid.js deleted').toBe(false);
    expect(fs.existsSync(path.join(root, 'native/td-callerid')), 'the plugin folder deleted').toBe(false);
    expect(fs.existsSync(path.join(root, 'scripts/ios-add-callerid-target.rb')), 'the target script deleted').toBe(false);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    expect(html.includes('callerid.js'), 'no orphan script tag').toBe(false);
  });

  test('the build no longer carries the extension target or its dependency', async () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const wf = fs.readFileSync(path.join(root, '.github/workflows/ios-beta.yml'), 'utf8');
    expect(wf.toLowerCase().includes('callerid'), 'no caller ID build step remains').toBe(false);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'native/package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies)).not.toContain('td-callerid');
  });

  test('nothing still calls the removed sync hooks', async () => {
    const fs = require('fs');
    const path = require('path');
    const jsDir = path.join(__dirname, '..', 'js');
    const offenders = [];
    for (const f of fs.readdirSync(jsDir).filter(n => n.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/_callerId/.test(line.split('//')[0])) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders, 'no orphaned call sites left behind (§7)').toEqual([]);
  });
});
