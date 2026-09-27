// @ts-check
// Auto-capitalization (utils.js _autoCapWords / _autoCapSentences + the
// spacebar-triggered normalizers). A proper-noun field (a name, a street, a
// city) title-cases every word; every other free-text field is sentence case
// (Earl audit 2026-09-27: Title Casing a line title printed "Replce 50 Gal
// Water Heter" on a customer's proposal). Native autocapitalize on mobile and
// a desktop spacebar-keydown fallback. Critically, NEITHER mutates a field during a programmatic value-set
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

  // Was: every eligible field got "words". Now a plain text field and a
  // textarea are "sentences" and a name/address field keeps "words" (Earl audit).
  test('eligible text fields get sentences, name fields get words; excluded types get nothing', async () => {
    const r = await page.evaluate(() => {
      const host = document.createElement('div'); document.body.appendChild(host);
      host.innerHTML =
        '<input type="text" id="_ac_text">' +
        '<textarea id="_ac_ta"></textarea>' +
        '<input type="text" id="_ac_name" autocomplete="name">' +
        '<input type="text" id="cf-street">' +
        '<input type="email" id="_ac_email">' +
        '<input type="tel" id="_ac_tel">' +
        '<input type="number" id="_ac_num">' +
        '<input type="text" inputmode="email" id="_ac_im">' +
        '<input type="text" autocapitalize="none" id="_ac_opt">';
      _applyAutoCapAttrs(host);
      const ac = id => document.getElementById(id).getAttribute('autocapitalize');
      const out = {
        text: ac('_ac_text'), ta: ac('_ac_ta'), name: ac('_ac_name'), street: ac('cf-street'), email: ac('_ac_email'),
        tel: ac('_ac_tel'), num: ac('_ac_num'), im: ac('_ac_im'), opt: ac('_ac_opt'),
      };
      host.remove(); return out;
    });
    expect(r.text).toBe('sentences');
    expect(r.ta).toBe('sentences');
    expect(r.name).toBe('words');
    expect(r.street).toBe('words');
    expect(r.email).toBe(null);
    expect(r.tel).toBe(null);
    expect(r.num).toBe(null);
    expect(r.im).toBe(null);
    expect(r.opt).toBe('none');   // explicit opt-out preserved
  });

  test('eligible fields also get autocorrect="on" + spellcheck="true"; opt-outs and excluded types do not', async () => {
    // iOS/Safari heuristically disable autocorrect on unclassifiable fields
    // (ours mostly carry autocomplete="off"): the tagger must force it back on
    // for free-text fields, and only those.
    const r = await page.evaluate(() => {
      const host = document.createElement('div'); document.body.appendChild(host);
      host.innerHTML =
        '<input type="text" id="_acr_text">' +
        '<textarea id="_acr_ta"></textarea>' +
        '<input type="email" id="_acr_email">' +
        '<input type="text" autocapitalize="none" id="_acr_opt">' +
        '<input type="text" autocorrect="off" id="_acr_own">';
      _applyAutoCapAttrs(host);
      const g = (id, a) => document.getElementById(id).getAttribute(a);
      const out = {
        text: [g('_acr_text', 'autocorrect'), g('_acr_text', 'spellcheck')],
        ta: [g('_acr_ta', 'autocorrect'), g('_acr_ta', 'spellcheck')],
        email: [g('_acr_email', 'autocorrect'), g('_acr_email', 'spellcheck')],
        opt: [g('_acr_opt', 'autocorrect'), g('_acr_opt', 'spellcheck')],
        own: g('_acr_own', 'autocorrect'),   // field's own setting wins
      };
      host.remove(); return out;
    });
    expect(r.text).toEqual(['on', 'true']);
    expect(r.ta).toEqual(['on', 'true']);
    expect(r.email).toEqual([null, null]);
    expect(r.opt).toEqual([null, null]);     // autocapitalize opt-out ⇒ no forced autocorrect either
    expect(r.own).toBe('off');
  });

  // Was: any text field title-cased to "Master Bedroom". Now that is a name
  // field's behavior only; a free-text field is sentence case (Earl audit).
  test('a real spacebar keydown title-cases a name field and sentence-cases free text (desktop fallback)', async () => {
    const out = await page.evaluate(async () => {
      const run = async (attrs) => {
        const i = document.createElement('input'); i.type = 'text';
        Object.keys(attrs).forEach(k => i.setAttribute(k, attrs[k]));
        document.body.appendChild(i); i.focus();
        i.value = 'master bedroom';
        i.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        await new Promise(r => setTimeout(r, 20));   // handler normalizes on next tick
        const v = i.value; i.remove(); return v;
      };
      return { name: await run({ autocomplete: 'name' }), free: await run({}) };
    });
    expect(out.name).toBe('Master Bedroom');
    expect(out.free).toBe('Master bedroom');
  });

  test('page.fill does NOT capitalize (no keydown), the suite stays safe', async () => {
    await page.evaluate(() => {
      const i = document.createElement('input'); i.type = 'text'; i.id = '_ac_fill';
      document.body.appendChild(i);
    });
    await page.fill('#_ac_fill', 'master bedroom');
    const v = await page.inputValue('#_ac_fill');
    await page.evaluate(() => { document.getElementById('_ac_fill')?.remove(); });
    expect(v).toBe('master bedroom');   // programmatic fill is left untouched
  });

  test('no console errors, auto-capitalize', async () => {
    assertNoErrors(page, 'auto-capitalize');
  });
});
