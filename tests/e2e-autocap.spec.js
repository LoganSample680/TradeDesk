// @ts-check
// Auto-capitalization (utils.js _autoCapWords + the spacebar-triggered
// normalizers). Every typed word title-cases as you type — via the native
// autocapitalize="words" attribute on mobile and a desktop spacebar-keydown
// fallback. Critically, NEITHER mutates a field during a programmatic value-set
// (page.fill fires no keydown), so the rest of the suite is unaffected.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('auto-capitalize free-text fields', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test('_autoCapWords title-cases each word; lowercase can never survive', async () => {
    const r = await page.evaluate(() => ({
      lower: _autoCapWords('master bedroom'),
      mixed: _autoCapWords('Master bedroom'),
      acronym: _autoCapWords('ABC painting'),
      camel: _autoCapWords('the McDowell job'),
      empty: _autoCapWords(''),
      nul: _autoCapWords(null),
      undef: _autoCapWords(undefined),
      spaces: _autoCapWords('  living   room  '),
    }));
    expect(r.lower).toBe('Master Bedroom');
    expect(r.mixed).toBe('Master Bedroom');
    expect(r.acronym).toBe('ABC Painting');
    expect(r.camel).toBe('The McDowell Job');
    expect(r.empty).toBe('');
    expect(r.nul).toBe('');
    expect(r.undef).toBe('');
    expect(r.spaces).toBe('  Living   Room  ');
  });

  test('eligible text fields get autocapitalize="words"; excluded types do not', async () => {
    const r = await page.evaluate(() => {
      const host = document.createElement('div'); document.body.appendChild(host);
      host.innerHTML =
        '<input type="text" id="_ac_text">' +
        '<textarea id="_ac_ta"></textarea>' +
        '<input type="email" id="_ac_email">' +
        '<input type="tel" id="_ac_tel">' +
        '<input type="number" id="_ac_num">' +
        '<input type="text" inputmode="email" id="_ac_im">' +
        '<input type="text" autocapitalize="none" id="_ac_opt">';
      _applyAutoCapAttrs(host);
      const ac = id => document.getElementById(id).getAttribute('autocapitalize');
      const out = {
        text: ac('_ac_text'), ta: ac('_ac_ta'), email: ac('_ac_email'),
        tel: ac('_ac_tel'), num: ac('_ac_num'), im: ac('_ac_im'), opt: ac('_ac_opt'),
      };
      host.remove(); return out;
    });
    expect(r.text).toBe('words');
    expect(r.ta).toBe('words');
    expect(r.email).toBe(null);
    expect(r.tel).toBe(null);
    expect(r.num).toBe(null);
    expect(r.im).toBe(null);
    expect(r.opt).toBe('none');   // explicit opt-out preserved
  });

  test('a real spacebar keydown title-cases the value (desktop fallback)', async () => {
    const out = await page.evaluate(async () => {
      const i = document.createElement('input'); i.type = 'text';
      document.body.appendChild(i); i.focus();
      i.value = 'master bedroom';
      i.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      await new Promise(r => setTimeout(r, 20));   // handler normalizes on next tick
      const v = i.value; i.remove(); return v;
    });
    expect(out).toBe('Master Bedroom');
  });

  test('page.fill does NOT capitalize (no keydown) — the suite stays safe', async () => {
    await page.evaluate(() => {
      const i = document.createElement('input'); i.type = 'text'; i.id = '_ac_fill';
      document.body.appendChild(i);
    });
    await page.fill('#_ac_fill', 'master bedroom');
    const v = await page.inputValue('#_ac_fill');
    await page.evaluate(() => { document.getElementById('_ac_fill')?.remove(); });
    expect(v).toBe('master bedroom');   // programmatic fill is left untouched
  });

  test('no console errors — auto-capitalize', async () => {
    assertNoErrors(page, 'auto-capitalize');
  });
});
