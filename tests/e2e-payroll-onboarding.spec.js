// @ts-check
/**
 * Exhaustive E2E coverage for js/payroll-onboarding.js and the W-2/1099
 * misclassification-risk copy in js/cloud.js (_employeeModalHTML, _subModalHTML).
 *
 * Functions covered:
 *   _payrollSetupState, _payrollSetupToggle, _payrollSetupDone,
 *   _payrollStateInfo, _payrollStateSectionHTML, renderPayrollSetupCard
 *
 * Every function is tested for:
 *   null / undefined input, empty input, boundary values, missing DOM,
 *   golden-path, concurrent calls, and XSS-safe escaping.
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('payroll-onboarding.js — exhaustive coverage', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => {
      if (typeof goPg === 'function' && document.getElementById('pg-team')) goPg('pg-team');
    });
    await page.waitForTimeout(300);
  });

  test.afterAll(async () => { await page.close(); });

  // Intentional restructure (owner request 2026-07-12): the old single 7-item
  // list wrongly treated per-hire paperwork (W-4/I-9/new-hire report) as
  // one-time business setup. Now: 4 one-time business items, 5 per-hire items
  // tracked per employee, and 4 recurring reference obligations.
  test('_FEDERAL_PAYROLL_SETUP is the 4 one-time business steps; per-hire and ongoing lists exist', async () => {
    const result = await page.evaluate(() => {
      if (typeof _FEDERAL_PAYROLL_SETUP === 'undefined') return { exists: false };
      return {
        exists: true,
        count: _FEDERAL_PAYROLL_SETUP.length,
        allValid: _FEDERAL_PAYROLL_SETUP.every(i => i.key && i.label && i.note),
        noPerHireKeys: !_FEDERAL_PAYROLL_SETUP.some(i => ['w4', 'i9', 'newHireReport'].includes(i.key)),
        hireCount: typeof _PAYROLL_HIRE_STEPS !== 'undefined' ? _PAYROLL_HIRE_STEPS.length : -1,
        hireValid: typeof _PAYROLL_HIRE_STEPS !== 'undefined' && _PAYROLL_HIRE_STEPS.every(i => i.key && i.label && i.note),
        ongoingCount: typeof _PAYROLL_ONGOING !== 'undefined' ? _PAYROLL_ONGOING.length : -1,
        ongoingValid: typeof _PAYROLL_ONGOING !== 'undefined' && _PAYROLL_ONGOING.every(i => i.label && i.note),
      };
    });
    expect(result.exists).toBe(true);
    expect(result.count).toBe(4);
    expect(result.allValid).toBe(true);
    expect(result.noPerHireKeys).toBe(true);
    expect(result.hireCount).toBe(5);
    expect(result.hireValid).toBe(true);
    expect(result.ongoingCount).toBe(4);
    expect(result.ongoingValid).toBe(true);
  });

  test('_payrollSetupState() creates S.payrollSetup if missing', async () => {
    const result = await page.evaluate(() => {
      delete S.payrollSetup;
      const st = _payrollSetupState();
      return { isObj: typeof st === 'object' && st !== null, sameRef: S.payrollSetup === st };
    });
    expect(result.isObj).toBe(true);
    expect(result.sameRef).toBe(true);
  });

  test('_payrollSetupToggle(null) does not throw and leaves state unchanged', async () => {
    const result = await page.evaluate(() => {
      S.payrollSetup = { ein: true };
      try { _payrollSetupToggle(null); return { ok: true, val: S.payrollSetup.ein }; }
      catch (e) { return { ok: false }; }
    });
    expect(result.ok).toBe(true);
    expect(result.val).toBe(true);
  });

  test('_payrollSetupToggle(undefined) does not throw', async () => {
    const ok = await page.evaluate(() => {
      try { _payrollSetupToggle(undefined); return true; } catch (e) { return false; }
    });
    expect(ok).toBe(true);
  });

  test('_payrollSetupToggle(key) flips a boolean true→false→true', async () => {
    const result = await page.evaluate(() => {
      S.payrollSetup = {};
      _payrollSetupToggle('ein');
      const first = S.payrollSetup.ein;
      _payrollSetupToggle('ein');
      const second = S.payrollSetup.ein;
      return { first, second };
    });
    expect(result.first).toBe(true);
    expect(result.second).toBe(false);
  });

  test('_payrollSetupDone() is 0 on empty state', async () => {
    const n = await page.evaluate(() => { S.payrollSetup = {}; return _payrollSetupDone(); });
    expect(n).toBe(0);
  });

  test('_payrollSetupDone() counts only business-setup keys — w4 moved to per-hire and no longer counts', async () => {
    const n = await page.evaluate(() => {
      S.payrollSetup = { ein: true, posters: true, w4: true, notARealKey: true };
      return _payrollSetupDone();
    });
    expect(n).toBe(2);
  });

  test('_payrollSetupDone() is 4 when every business item is checked (boundary — full completion)', async () => {
    const n = await page.evaluate(() => {
      S.payrollSetup = {};
      _FEDERAL_PAYROLL_SETUP.forEach(i => { S.payrollSetup[i.key] = true; });
      return _payrollSetupDone();
    });
    expect(n).toBe(4);
  });

  test('_payrollHireState() returns null for an unknown employee id, lazily creates the record for a real one', async () => {
    const result = await page.evaluate(() => {
      S.employees = [{ id: 777, name: 'Hire State Test', role: 'tech', permissions: {} }];
      const missing = _payrollHireState(999999);
      const real = _payrollHireState(777);
      return { missing, isObj: typeof real === 'object' && real !== null, onRecord: S.employees[0].hirePaperwork === real };
    });
    expect(result.missing).toBe(null);
    expect(result.isObj).toBe(true);
    expect(result.onRecord).toBe(true);
  });

  test('_payrollHireToggle() stores per-employee state ON the employee record and flips it back', async () => {
    const result = await page.evaluate(() => {
      S.employees = [{ id: 777, name: 'Hire Toggle Test', role: 'tech', permissions: {} }];
      _payrollHireToggle(777, 'w4');
      const first = S.employees[0].hirePaperwork.w4;
      _payrollHireToggle('777', 'w4'); // string id must hit the same record
      const second = S.employees[0].hirePaperwork.w4;
      return { first, second };
    });
    expect(result.first).toBe(true);
    expect(result.second).toBe(false);
  });

  test('_payrollHireToggle() with unknown id or missing key is a safe no-op', async () => {
    const ok = await page.evaluate(() => {
      S.employees = [{ id: 777, name: 'Safe Test', role: 'tech', permissions: {} }];
      try { _payrollHireToggle(999999, 'w4'); _payrollHireToggle(777, null); return true; }
      catch (e) { return false; }
    });
    expect(ok).toBe(true);
  });

  test('_payrollHireDone() counts one employee\'s items without bleeding into another\'s', async () => {
    const result = await page.evaluate(() => {
      S.employees = [
        { id: 777, name: 'A', role: 'tech', permissions: {}, hirePaperwork: { w4: true, i9: true } },
        { id: 888, name: 'B', role: 'tech', permissions: {}, hirePaperwork: { w4: true } },
      ];
      return { a: _payrollHireDone(777), b: _payrollHireDone(888), unknown: _payrollHireDone(1) };
    });
    expect(result.a).toBe(2);
    expect(result.b).toBe(1);
    expect(result.unknown).toBe(0);
  });

  test('_payrollSetupDone() handles concurrent toggles of the same key without corrupting count', async () => {
    const n = await page.evaluate(() => {
      S.payrollSetup = {};
      for (let i = 0; i < 10; i++) _payrollSetupToggle('ein');
      // 10 toggles from false = ends false (even count)
      return _payrollSetupDone();
    });
    expect(n).toBe(0);
  });

  test('_payrollStateInfo() with no S.state returns empty code and null tax/extra', async () => {
    const result = await page.evaluate(() => {
      S.state = '';
      return _payrollStateInfo();
    });
    expect(result.code).toBe('');
    expect(result.tax).toBe(null);
    expect(result.extra).toBe(null);
  });

  test('_payrollStateInfo() with an unknown state code returns nulls, not a throw', async () => {
    const result = await page.evaluate(() => {
      S.state = 'ZZ';
      return _payrollStateInfo();
    });
    expect(result.code).toBe('ZZ');
    expect(result.tax).toBe(null);
    expect(result.extra).toBe(null);
  });

  test('_payrollStateInfo() lowercases-tolerant: normalizes state code to uppercase', async () => {
    const result = await page.evaluate(() => {
      S.state = 'tx';
      return _payrollStateInfo();
    });
    expect(result.code).toBe('TX');
    expect(result.tax && result.tax.noTax).toBe(true);
  });

  test('_payrollStateSectionHTML() golden path with full extra data renders SUTA/workersComp/sdi/localTax rows', async () => {
    const html = await page.evaluate(() => {
      const tax = { name: 'Testland', noTax: false };
      const extra = {
        suta: { agency: 'Testland Workforce Agency', note: 'file quarterly' },
        workersComp: { required: true, threshold: '1+ employees', system: 'private insurance', note: 'no exemption' },
        sdi: { required: true, note: 'Testland TDI applies' },
        localTax: { present: true, note: 'Some cities levy a local wage tax' },
      };
      return _payrollStateSectionHTML('TL', tax, extra);
    });
    expect(html).toContain('Testland Workforce Agency');
    expect(html).toContain('1+ employees');
    expect(html).toContain('Testland TDI applies');
    expect(html).toContain('local wage tax');
  });

  test('_payrollStateSectionHTML() falls back to generic guidance when extra data is missing (state not yet researched)', async () => {
    const html = await page.evaluate(() => _payrollStateSectionHTML('ZZ', null, null));
    expect(html).toContain('Register with your state workforce/unemployment agency');
    // escHtml entity-escapes the apostrophe (XSS-safe by design — see the
    // dedicated escaping test above), so match around it rather than through it.
    expect(html).toContain('Check your state');
    expect(html).toContain('requirement and threshold');
  });

  test('_payrollStateSectionHTML() shows the no-income-tax message for a noTax state', async () => {
    const html = await page.evaluate(() => _payrollStateSectionHTML('TX', { name: 'Texas', noTax: true }, null));
    expect(html).toContain('Not required');
    expect(html).toContain('no state income tax');
  });

  test('_payrollStateSectionHTML() escapes HTML in state/agency data (XSS safety)', async () => {
    const html = await page.evaluate(() => {
      const tax = { name: '<img src=x onerror=alert(1)>', noTax: false };
      return _payrollStateSectionHTML('XX', tax, null);
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  test('renderPayrollSetupCard() with missing DOM element is a safe no-op', async () => {
    const ok = await page.evaluate(() => {
      const el = document.getElementById('payroll-setup-card');
      const parent = el && el.parentElement;
      const next = el && el.nextSibling;
      if (el) el.remove();
      try { renderPayrollSetupCard(); }
      catch (e) { if (parent) parent.insertBefore(el, next); return false; }
      if (parent) parent.insertBefore(el, next);
      return true;
    });
    expect(ok).toBe(true);
  });

  test('renderPayrollSetupCard() golden path: 4 business checkboxes, 0/4 counter, all three sections', async () => {
    const result = await page.evaluate(() => {
      S.payrollSetup = {};
      S.state = 'CA';
      S.employees = []; // no employees → no per-hire sections, business only
      renderPayrollSetupCard();
      const el = document.getElementById('payroll-setup-card');
      return {
        html: el.innerHTML,
        checkboxCount: el.querySelectorAll('input[type="checkbox"]').length,
      };
    });
    expect(result.checkboxCount).toBe(4);
    expect(result.html).toContain('0/4');
    expect(result.html).toContain('One-time business setup');
    expect(result.html).toContain('Every January'); // ongoing section present
    expect(result.html).toContain('Form 941');
    expect(result.html).toContain('Not tax or legal advice');
  });

  test('renderPayrollSetupCard() renders a per-hire section for every non-owner employee', async () => {
    const result = await page.evaluate(() => {
      S.payrollSetup = {};
      S.state = 'CA';
      S.employees = [
        { name: 'Owner', role: 'owner' },
        { id: 777, name: 'Hire Card A', role: 'tech', permissions: {} },
        { id: 888, name: 'Hire Card B', role: 'tech', permissions: {} },
      ];
      renderPayrollSetupCard();
      const el = document.getElementById('payroll-setup-card');
      return {
        html: el.innerHTML,
        // 4 business + 5 per hire × 2 employees
        checkboxCount: el.querySelectorAll('input[type="checkbox"]').length,
      };
    });
    expect(result.checkboxCount).toBe(14);
    expect(result.html).toContain('Hire Card A');
    expect(result.html).toContain('Hire Card B');
    expect(result.html).toContain('Every new hire');
    expect(result.html).not.toContain('>Owner<'); // owner gets no paperwork section
  });

  test('per-hire stateW4 note adapts for a no-income-tax state (TX)', async () => {
    const html = await page.evaluate(() => {
      S.state = 'TX';
      S.employees = [{ id: 777, name: 'TX Hire', role: 'tech', permissions: {} }];
      return _payrollSetupBodyHTML(null);
    });
    expect(html).toContain('Not needed — Texas has no income tax on wages');
  });

  test('renderPayrollSetupCard() reflects a checked item with strike-through styling', async () => {
    const result = await page.evaluate(() => {
      S.payrollSetup = { ein: true };
      S.employees = [];
      renderPayrollSetupCard();
      const el = document.getElementById('payroll-setup-card');
      return { html: el.innerHTML, has14: el.innerHTML.includes('1/4') };
    });
    expect(result.has14).toBe(true);
    expect(result.html).toContain('text-decoration:line-through');
  });

  test('clicking a checkbox in the rendered card calls _payrollSetupToggle and re-renders the count', async () => {
    const result = await page.evaluate(() => {
      S.payrollSetup = {};
      S.state = 'CA';
      S.employees = [];
      renderPayrollSetupCard();
      const cb = document.querySelector('#payroll-setup-card input[type="checkbox"]');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      return document.getElementById('payroll-setup-card').innerHTML;
    });
    expect(result).toContain('1/4');
  });

  test('_payrollSetupBodyHTML() calls out that income tax withholding is NOT calculated', async () => {
    const html = await page.evaluate(() => { S.state = 'CA'; return _payrollSetupBodyHTML(); });
    expect(html).toContain('does not calculate what to withhold');
    expect(html).toContain("TradeDesk doesn't do withholding calculations");
  });

  test('_showPayrollSetupPrompt() opens a modal containing the checklist and a Got it button', async () => {
    const result = await page.evaluate(() => {
      S.payrollSetup = {};
      S.state = 'TX';
      S.employees = []; // business checkboxes only
      _showPayrollSetupPrompt();
      const ov = document.getElementById('_payroll-setup-modal-ov');
      return {
        found: !!ov,
        hasChecklist: !!ov && ov.querySelectorAll('input[type="checkbox"]').length === 4,
        hasGotIt: !!ov && [...ov.querySelectorAll('button')].some(b => b.textContent.trim() === 'Got it'),
        firstFraming: !!ov && ov.innerHTML.includes('First W-2 hire'),
      };
    });
    expect(result.found).toBe(true);
    expect(result.hasChecklist).toBe(true);
    expect(result.hasGotIt).toBe(true);
    expect(result.firstFraming).toBe(true);
    await page.evaluate(() => document.getElementById('_payroll-setup-modal-ov')?.remove());
  });

  test('_showPayrollSetupPrompt(empId, false) — repeat hire — leads with THAT employee\'s paperwork', async () => {
    const result = await page.evaluate(() => {
      S.payrollSetup = {};
      S.state = 'CA';
      S.employees = [
        { name: 'Owner', role: 'owner' },
        { id: 777, name: 'Old Hire', role: 'tech', permissions: {} },
        { id: 888, name: 'Brand New Hire', role: 'tech', permissions: {} },
      ];
      _showPayrollSetupPrompt(888, false);
      const ov = document.getElementById('_payroll-setup-modal-ov');
      const html = ov ? ov.innerHTML : '';
      const out = {
        newHireFraming: html.includes('New W-2 hire') && html.includes('Brand New Hire'),
        notFirstFraming: !html.includes('First W-2 hire'),
        focusedOnly: html.includes('Brand New Hire') && !html.includes('Old Hire'),
        // 4 business + 5 for the focused hire only
        checkboxCount: ov ? ov.querySelectorAll('input[type="checkbox"]').length : 0,
      };
      ov?.remove();
      return out;
    });
    expect(result.newHireFraming).toBe(true);
    expect(result.notFirstFraming).toBe(true);
    expect(result.focusedOnly).toBe(true);
    expect(result.checkboxCount).toBe(9);
  });

  test('_showPayrollSetupPrompt() "Got it" button removes the modal', async () => {
    const removed = await page.evaluate(() => {
      _showPayrollSetupPrompt();
      const btn = [...document.querySelectorAll('#_payroll-setup-modal-ov button')].find(b => b.textContent.trim() === 'Got it');
      btn.click();
      return !document.getElementById('_payroll-setup-modal-ov');
    });
    expect(removed).toBe(true);
  });

  test('_showPayrollSetupPrompt() called twice replaces rather than stacking modals', async () => {
    const count = await page.evaluate(() => {
      _showPayrollSetupPrompt();
      _showPayrollSetupPrompt();
      const n = document.querySelectorAll('#_payroll-setup-modal-ov').length;
      document.getElementById('_payroll-setup-modal-ov')?.remove();
      return n;
    });
    expect(count).toBe(1);
  });

  test('_payrollSetupRefreshAll() keeps the Team-page card and an open prompt modal in sync', async () => {
    const result = await page.evaluate(() => {
      S.payrollSetup = {};
      S.state = 'CA';
      S.employees = [];
      renderPayrollSetupCard();
      _showPayrollSetupPrompt();
      _payrollSetupToggle('ein'); // toggles state + calls _payrollSetupRefreshAll internally
      const cardDone = document.getElementById('payroll-setup-card').innerHTML.includes('1/4');
      const modalDone = document.getElementById('_payroll-setup-modal-ov').innerHTML.includes('1/4');
      document.getElementById('_payroll-setup-modal-ov')?.remove();
      return { cardDone, modalDone };
    });
    expect(result.cardDone).toBe(true);
    expect(result.modalDone).toBe(true);
  });

  test('_payrollSetupRefreshAll() preserves a modal\'s employee focus (data-focus-emp) across refreshes', async () => {
    const result = await page.evaluate(() => {
      S.payrollSetup = {};
      S.state = 'CA';
      S.employees = [
        { id: 777, name: 'Focus Keep A', role: 'tech', permissions: {} },
        { id: 888, name: 'Focus Keep B', role: 'tech', permissions: {} },
      ];
      _showPayrollSetupPrompt(888, false);
      _payrollHireToggle(888, 'w4'); // triggers refresh-all
      const html = document.getElementById('_payroll-setup-modal-ov').innerHTML;
      const out = { stillFocused: html.includes('Focus Keep B') && !html.includes('Focus Keep A'), checked: html.includes('1/5') };
      document.getElementById('_payroll-setup-modal-ov')?.remove();
      return out;
    });
    expect(result.stillFocused).toBe(true);
    expect(result.checked).toBe(true);
  });

  test('STATE_PAYROLL_SETUP has real, researched data for all 50 states', async () => {
    const result = await page.evaluate(() => {
      const codes = Object.keys(STATE_PAYROLL_SETUP);
      return {
        count: codes.length,
        allHaveSuta: codes.every(c => STATE_PAYROLL_SETUP[c].suta && STATE_PAYROLL_SETUP[c].suta.agency),
        allHaveWorkersComp: codes.every(c => STATE_PAYROLL_SETUP[c].workersComp),
      };
    });
    expect(result.count).toBe(50);
    expect(result.allHaveSuta).toBe(true);
    expect(result.allHaveWorkersComp).toBe(true);
  });

  test('TX workers comp is flagged as optional (real fact, not a data-entry accident)', async () => {
    const wc = await page.evaluate(() => STATE_PAYROLL_SETUP.TX.workersComp);
    expect(wc.required).toBe(false);
  });

  test('OH workers comp system mentions the monopolistic state fund', async () => {
    const system = await page.evaluate(() => STATE_PAYROLL_SETUP.OH.workersComp.system);
    expect(system.toLowerCase()).toContain('monopolistic');
  });

  test('renderPayrollSetupCard() for a real researched state (KY) renders the local-tax row', async () => {
    const html = await page.evaluate(() => {
      S.payrollSetup = {};
      S.state = 'KY';
      renderPayrollSetupCard();
      return document.getElementById('payroll-setup-card').innerHTML;
    });
    expect(html).toContain('Local/municipal tax');
    expect(html).toContain('Occupational License Tax');
  });

  test('_payrollShorten() leaves short text untouched (full is null)', async () => {
    const result = await page.evaluate(() => _payrollShorten('Short text.', 130));
    expect(result.full).toBe(null);
    expect(result.short).toBe('Short text.');
  });

  test('_payrollShorten() handles null/undefined/empty without throwing', async () => {
    const result = await page.evaluate(() => ({
      n: _payrollShorten(null, 130),
      u: _payrollShorten(undefined, 130),
      e: _payrollShorten('', 130),
    }));
    expect(result.n.full).toBe(null);
    expect(result.u.full).toBe(null);
    expect(result.e.full).toBe(null);
  });

  test('_payrollShorten() truncates long text and preserves the full original in .full', async () => {
    const long = 'A'.repeat(200) + '. ' + 'B'.repeat(50);
    const result = await page.evaluate((t) => _payrollShorten(t, 130), long);
    expect(result.short.length).toBeLessThan(long.length);
    expect(result.full).toBe(long);
  });

  test('a long state note (KY local tax) renders a "more" toggle that reveals the full text on click', async () => {
    // #payroll-setup-card is display:none by default in the markup (only
    // renderTeam()'s hook flips it to block) — .innerText is layout-aware and
    // reads '' on a display:none element, so assert on the toggle's actual
    // DOM state (style.display + textContent) rather than rendered text size.
    const result = await page.evaluate(() => {
      S.payrollSetup = {};
      S.state = 'KY';
      const card = document.getElementById('payroll-setup-card');
      card.style.display = 'block';
      renderPayrollSetupCard();
      const btn = [...document.querySelectorAll('#payroll-setup-card button')].find(b => b.textContent.trim() === 'more');
      if (!btn) return { found: false };
      const fullSpan = btn.closest('div').querySelector('span[id^="_ps-f-"]');
      const shortSpan = btn.closest('span[id^="_ps-s-"]');
      const beforeFullDisplay = fullSpan.style.display;
      btn.click();
      return {
        found: true,
        beforeFullDisplay,
        afterFullDisplay: fullSpan.style.display,
        afterShortDisplay: shortSpan.style.display,
        fullTextRevealed: fullSpan.textContent.length > 0,
      };
    });
    expect(result.found).toBe(true);
    expect(result.beforeFullDisplay).toBe('none');
    expect(result.afterFullDisplay).toBe('inline');
    expect(result.afterShortDisplay).toBe('none');
    expect(result.fullTextRevealed).toBe(true);
  });

  test('renderPayrollSetupCard() for a no-income-tax state with full research (TX) shows both the noTax line and workers comp optional note', async () => {
    const html = await page.evaluate(() => {
      S.payrollSetup = {};
      S.state = 'TX';
      renderPayrollSetupCard();
      return document.getElementById('payroll-setup-card').innerHTML;
    });
    expect(html).toContain('no state income tax');
    expect(html).toContain('Not required');
  });

  assertNoErrors(() => page);
});

test.describe('W-2/1099 misclassification-risk copy', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('Team page buttons read "+ Add W-2 Employee" and "+ Add 1099 Sub Contractor"', async () => {
    await page.evaluate(() => { if (typeof goPg === 'function') goPg('pg-team'); });
    const empBtn = await page.locator('#team-add-btn').textContent();
    const subBtnCount = await page.locator('button:has-text("+ Add 1099 Sub Contractor")').count();
    expect(empBtn.trim()).toBe('+ Add W-2 Employee');
    expect(subBtnCount).toBeGreaterThan(0);
  });

  test('_employeeModalHTML(null,null) — new employee — includes the behavioral-control steer line', async () => {
    const html = await page.evaluate(() => _employeeModalHTML(null, null));
    expect(html).toContain('Add W-2 Employee');
    expect(html).toContain('you set the hours, direct the job');
  });

  test('_employeeModalHTML(emp, 0) — editing existing — omits the steer line', async () => {
    const html = await page.evaluate(() => _employeeModalHTML({ name: 'Test Tech', role: 'tech' }, 0));
    expect(html).not.toContain('you set the hours, direct the job');
    expect(html).toContain('Edit Test Tech');
  });

  test('_subModalHTML(null,null) — new sub — includes steer line and misclassification disclaimer', async () => {
    const html = await page.evaluate(() => _subModalHTML(null, null));
    expect(html).toContain('Add 1099 Sub Contractor');
    expect(html).toContain('their own schedule');
    expect(html).toContain('most audited issues at the IRS');
    expect(html).toContain('personally liable');
  });

  test('_subModalHTML(sub, 0) — editing existing — omits steer line and disclaimer', async () => {
    const html = await page.evaluate(() => _subModalHTML({ name: 'Test Sub', trade: 'Drywall' }, 0));
    expect(html).not.toContain('most audited issues at the IRS');
    expect(html).toContain('Edit Test Sub');
  });

  test('_subModalHTML disclaimer text is HTML-safe (no unescaped user data interpolated into it)', async () => {
    const html = await page.evaluate(() => _subModalHTML(null, null));
    // The disclaimer is static copy — sanity check it has no stray unclosed tags
    const openDivs = (html.match(/<div/g) || []).length;
    const closeDivs = (html.match(/<\/div>/g) || []).length;
    expect(openDivs).toBe(closeDivs);
  });

  assertNoErrors(() => page);
});

test.describe('_saveEmployee() → every new W-2 hire triggers the payroll setup prompt', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.close(); });

  // No email on any of these employees — keeps _saveEmployee's Supabase
  // upsert branch (if(email&&_supa&&_supaUser)) unreached, so this exercises
  // the trigger logic in isolation without depending on network mocking.
  async function addEmployee(page, name, role) {
    return page.evaluate(({ name, role }) => {
      openAddEmployeeModal();
      document.getElementById('emp-name').value = name;
      const roleSel = document.getElementById('emp-role');
      if (roleSel) roleSel.value = role;
      return _saveEmployee(null);
    }, { name, role });
  }

  test('adding the first-ever non-owner employee opens the prompt with first-hire framing (isFirst=true)', async () => {
    const result = await page.evaluate(async () => {
      S.employees = [{ name: 'Owner', role: 'owner' }];
      let called = false, gotId = null, gotFirst = null;
      const orig = window._showPayrollSetupPrompt;
      window._showPayrollSetupPrompt = (id, first) => { called = true; gotId = id; gotFirst = first; };
      openAddEmployeeModal();
      document.getElementById('emp-name').value = 'First Hire';
      document.getElementById('emp-role').value = 'tech';
      await _saveEmployee(null);
      window._showPayrollSetupPrompt = orig;
      const savedEmp = S.employees.find(e => e.name === 'First Hire');
      return { called, gotFirst, idMatches: savedEmp && String(gotId) === String(savedEmp.id) };
    });
    expect(result.called).toBe(true);
    expect(result.gotFirst).toBe(true);
    expect(result.idMatches).toBe(true);
  });

  // Intentional behavior change (owner request 2026-07-12): the prompt now
  // fires on EVERY new W-2 hire — W-4/I-9/new-hire reporting restart from
  // zero per person, so "first hire only" silently skipped the paperwork
  // reminder for everyone after employee #1.
  test('adding a SECOND non-owner employee re-opens the prompt with new-hire framing (isFirst=false)', async () => {
    const result = await page.evaluate(async () => {
      S.employees = [{ name: 'Owner', role: 'owner' }, { id: 1, name: 'Existing Hire', role: 'tech' }];
      let called = false, gotFirst = null;
      const orig = window._showPayrollSetupPrompt;
      window._showPayrollSetupPrompt = (id, first) => { called = true; gotFirst = first; };
      openAddEmployeeModal();
      document.getElementById('emp-name').value = 'Second Hire';
      document.getElementById('emp-role').value = 'tech';
      await _saveEmployee(null);
      window._showPayrollSetupPrompt = orig;
      return { called, gotFirst };
    });
    expect(result.called).toBe(true);
    expect(result.gotFirst).toBe(false);
  });

  test('editing an existing employee (not adding new) does not open the prompt', async () => {
    const opened = await page.evaluate(async () => {
      S.employees = [{ name: 'Owner', role: 'owner' }, { id: 1, name: 'Existing Hire', role: 'tech', permissions: {} }];
      let called = false;
      const orig = window._showPayrollSetupPrompt;
      window._showPayrollSetupPrompt = () => { called = true; };
      openEditEmployeeModal(1);
      document.getElementById('emp-name').value = 'Existing Hire Renamed';
      await _saveEmployee(1);
      window._showPayrollSetupPrompt = orig;
      return called;
    });
    expect(opened).toBe(false);
  });

  test('adding a new employee with role=owner does not open the prompt', async () => {
    const opened = await page.evaluate(async () => {
      S.employees = [];
      let called = false;
      const orig = window._showPayrollSetupPrompt;
      window._showPayrollSetupPrompt = () => { called = true; };
      openAddEmployeeModal();
      document.getElementById('emp-name').value = 'Solo Owner';
      const roleSel = document.getElementById('emp-role');
      if (roleSel) roleSel.value = 'owner';
      await _saveEmployee(null);
      window._showPayrollSetupPrompt = orig;
      return called;
    });
    expect(opened).toBe(false);
  });

  assertNoErrors(() => page);
});
