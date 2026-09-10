// @ts-check
/**
 * "Here's the title, here's the description the client sees. Scope of work
 * pulls from both, and it's encouraged to fill it out." (owner 2026-09-07)
 *
 * The description was called Notes, marked optional, never remembered, and
 * silently replaced on the proposal with "Labor and materials per agreed
 * scope". So it was never typed, and the client read a bare title: the exact
 * vague scope line that research the same day names as the top reason
 * homeowners push back on a price. Worse, a T&M or fixed-scope estimate with
 * no scope chips printed no Scope of work section at all.
 *
 * What we verify:
 *  1. The price book remembers a description, and never loses one to a blank
 *  2. Adding from the book brings the words with it, typed by nobody
 *  3. The field says it is the client's, and nudges while empty
 *  4. Scope of work prints title + description, for EVERY estimate type
 */

const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('the description the client reads', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { window.supaLoadFromCloud = async () => {}; });
  });
  test.afterAll(async () => { await page.context().close(); });
  test.beforeEach(async () => {
    await page.evaluate(() => {
      S.priceBook = {};
      _byoItems = []; _geiLines = []; _geiScopeChips = []; _geiScopeNoScope = false;
      document.getElementById('_byo-add-modal')?.remove();
    });
  });

  // ── 1. The book remembers it ───────────────────────────────────────────────

  test('a described line teaches the book its words', async () => {
    const e = await page.evaluate(() => {
      _pbLearn('Water heater replacement', 1450, 'ea', '50 gal gas unit, haul-off of the old tank, new flex lines and expansion tank');
      return _pbFind('Water heater replacement', _pbTrade());
    });
    expect(e.notes).toContain('haul-off of the old tank');
    expect(e.rate).toBe(1450);
  });

  test('a blank description never erases a good one', async () => {
    const e = await page.evaluate(() => {
      _pbLearn('Shutoff valve', 180, 'ea', 'Quarter-turn ball valve at the meter');
      _pbLearn('Shutoff valve', 180, 'ea', '');       // added fast from the book
      _pbLearn('Shutoff valve', 180, 'ea');            // and again with none at all
      return _pbFind('Shutoff valve', _pbTrade());
    });
    expect(e.notes, 'losing the sentence to a fast add teaches him not to trust the field').toBe('Quarter-turn ball valve at the meter');
  });

  test('a better description replaces the old one', async () => {
    const e = await page.evaluate(() => {
      _pbLearn('Stack repair', 600, 'ea', 'Cut and replace');
      _pbLearn('Stack repair', 600, 'ea', 'Cut and replace 6 ft of cast iron, re-tie the branch, pressure test');
      return _pbFind('Stack repair', _pbTrade());
    });
    expect(e.notes).toContain('pressure test');
  });

  test('junk never lands in the book', async () => {
    const r = await page.evaluate(() => {
      _pbLearn('', 100, 'ea', 'x'); _pbLearn('ab', 100, 'ea', 'x'); _pbLearn('Good line', 0, 'ea', 'x');
      _pbLearn(null, null, null, null); _pbLearn(undefined);
      return (S.priceBook[_pbTrade()] || []).length;
    });
    expect(r).toBe(0);
  });

  // ── 2. The second job is free ──────────────────────────────────────────────

  test('adding from the book brings the description with it', async () => {
    const it = await page.evaluate(() => {
      // Twice: the book only OFFERS a line once it has been used more than
      // once (_pbList n>=2), which is what keeps one-off room names out of it.
      _pbLearn('Water heater replacement', 1450, 'ea', '50 gal gas unit, haul-off, new expansion tank');
      _pbLearn('Water heater replacement', 1450, 'ea');
      _byaAddFromBook('Work', _pbList().findIndex(b => b.desc === 'Water heater replacement'));
      return _byoItems[_byoItems.length - 1];
    });
    expect(it.label).toBe('Water heater replacement');
    expect(it.notes, 'the payoff: he typed nothing and the client still gets the words').toBe('50 gal gas unit, haul-off, new expansion tank');
  });

  test('the add and the edit modals both teach the book', async () => {
    const r = await page.evaluate(() => {
      _byoAddItem('Work');
      document.getElementById('_bya-label').value = 'Sump pump swap';
      document.getElementById('_bya-price').value = '900';
      document.getElementById('_bya-notes').value = 'New 1/3 hp pump, check valve, discharge tested';
      _byaConfirm('Work');
      const afterAdd = _pbFind('Sump pump swap', _pbTrade());

      _byoEditItem(_byoItems.length - 1);
      document.getElementById('_bya-notes').value = 'New 1/3 hp pump, check valve, discharge tested, pit cleaned out';
      _byaEditConfirm(_byoItems.length - 1);
      const afterEdit = _pbFind('Sump pump swap', _pbTrade());
      document.getElementById('_byo-add-modal')?.remove();
      return { add: afterAdd && afterAdd.notes, edit: afterEdit && afterEdit.notes };
    });
    expect(r.add).toContain('check valve');
    expect(r.edit, 'a description written on the second pass must not be lost to the next job').toContain('pit cleaned out');
  });

  test('the smarts reach every estimate type, not just BYO', async () => {
    const r = await page.evaluate(() => {
      // T&M / fixed-scope lines carry notes too, and used to teach the book
      // nothing: only BYO's own modal ever passed a description through.
      _byoItems = [{ id: 1, section: 'Work', label: 'Cabinet doors', price: 900, notes: 'Sprayed, two coats, hardware off and back on', on: true }];
      _geiLines = [
        { desc: 'Paint and primer', notes: 'Sherwin-Williams Duration, tinted to the approved color', qty: 1, unit: 'lot', rate: 420, total: 420 },
        { desc: 'Crew labor', qty: 16, unit: 'hr', rate: 130, total: 2080, _tmLabor: true }
      ];
      _pbLearnAll();
      const book = S.priceBook[_pbTrade()] || [];
      return {
        byo: (book.find(b => b.desc === 'Cabinet doors') || {}).notes,
        tm: (book.find(b => b.desc === 'Paint and primer') || {}).notes,
        labor: !!book.find(b => b.desc === 'Crew labor')
      };
    });
    expect(r.byo).toContain('hardware off and back on');
    expect(r.tm, 'a T&M category described once must arrive described on the next job').toContain('Sherwin-Williams Duration');
    expect(r.labor, 'the crew rate is not a thing he sells').toBe(false);
  });

  test('the T&M material modal teaches the book too', async () => {
    const notes = await page.evaluate(() => {
      _geiLines = [];
      _tmAddMatCat();
      document.getElementById('tcm-name').value = 'Drop cloths and masking';
      document.getElementById('tcm-cost').value = '85';
      document.getElementById('tcm-notes').value = 'Canvas on every floor, plastic on the fixtures';
      _tmMatCatSave(-1);
      const e = _pbFind('Drop cloths and masking', _pbTrade());
      document.getElementById('_tm-mat-modal')?.remove();
      return e && e.notes;
    });
    expect(notes).toContain('Canvas on every floor');
  });

  test('the T&M modal calls it a Description the client reads', async () => {
    const t = await page.evaluate(() => {
      _tmAddMatCat();
      const s = document.getElementById('_tm-mat-modal').textContent;
      document.getElementById('_tm-mat-modal')?.remove();
      return s;
    });
    expect(t).toContain('what it consists of');
    expect(t).toContain('The client reads this');
    expect(t).not.toContain('(optional)');
  });

  // ── 3. It says whose it is, and nudges ─────────────────────────────────────

  test('the field is a Description the client sees, not private Notes', async () => {
    const r = await page.evaluate(() => {
      _byoAddItem('Work');
      const t = document.getElementById('_byo-add-modal').textContent;
      const hint = document.getElementById('_bya-desc-hint').textContent;
      document.getElementById('_byo-add-modal')?.remove();
      return { t, hint };
    });
    expect(r.t).toContain('Title');
    expect(r.t).toContain('the client sees this');
    expect(r.t).toContain('what it consists of');
    expect(r.t, 'calling it Notes reads like something for him').not.toContain('Notes');
    expect(r.t, 'encouraged, not optional').not.toContain('(optional)');
    expect(r.hint, 'the nudge shows on an empty field').toContain('vague scope');
  });

  test('the nudge disappears the moment he writes anything', async () => {
    const r = await page.evaluate(() => {
      _byoAddItem('Work');
      const before = document.getElementById('_bya-desc-hint').textContent;
      document.getElementById('_bya-notes').value = 'Two coats';
      _byaDescHint();
      const after = document.getElementById('_bya-desc-hint').textContent;
      document.getElementById('_byo-add-modal')?.remove();
      return { before, after };
    });
    expect(r.before.length).toBeGreaterThan(20);
    expect(r.after, 'a nudge that stays reads as an error he has to clear').toBe('');
  });

  test('_byaDescHint never throws with no modal open', async () => {
    const ok = await page.evaluate(() => { try { _byaDescHint(); return true; } catch (e) { return String(e); } });
    expect(ok).toBe(true);
  });

  test('an undescribed line offers to be described, right in the list', async () => {
    const r = await page.evaluate(() => ({
      empty: _geiItemRowHtml({ label: 'Water heater', notes: '', price: 1450, editFn: '_byoEditItem(0)', delFn: 'x', delTitle: 'd', checked: true }),
      filled: _geiItemRowHtml({ label: 'Water heater', notes: '50 gal gas', price: 1450, editFn: '_byoEditItem(0)', delFn: 'x', delTitle: 'd', checked: true })
    }));
    expect(r.empty).toContain('+ Add description');
    expect(r.filled).toContain('50 gal gas');
    expect(r.filled).not.toContain('+ Add description');
  });

  // ── 4. Scope of work, on every estimate type ───────────────────────────────

  test('a fixed-scope proposal with no chips finally prints a scope section', async () => {
    const html = await page.evaluate(async () => {
      _geiIsFreeForm = false; _geiIsTM = false; _geiScopeChips = [];
      _geiLines = [
        { desc: 'Water heater replacement', notes: '50 gal gas unit, haul-off of the old tank', qty: 1, unit: 'ea', rate: 1450, total: 1450 },
        { desc: 'Shutoff valve', notes: '', qty: 1, unit: 'ea', rate: 180, total: 180 }
      ];
      return await sendGenericProposal(true, { silent: true });
    });
    expect(html, 'a price table with nothing describing the work is what we shipped before').toContain('Scope of work');
    expect(html).toContain('Water heater replacement');
    expect(html).toContain('50 gal gas unit');
    expect(html, 'a line with no description still names itself').toContain('Shutoff valve');
  });

  test('the labor line and RRP inserts stay out of the scope list', async () => {
    const html = await page.evaluate(async () => {
      _geiIsFreeForm = false; _geiIsTM = false; _geiScopeChips = [];
      _geiLines = [
        { desc: 'Labor: 2 workers @ $65/hr', qty: 16, unit: 'hr', rate: 130, total: 2080, _tmLabor: true },
        { desc: 'Drain cleaning', notes: 'Cable the main to 75 ft', qty: 1, unit: 'ea', rate: 300, total: 300 },
        { desc: 'Lead-safe practices', notes: 'hint', qty: 1, unit: 'lot', rate: 0, total: 0, _rrp: true }
      ];
      return await sendGenericProposal(true, { silent: true });
    });
    // Only the scope section itself: the price table below it legitimately
    // lists the labor row, so slicing past </ol> would test nothing.
    const scope = html.split('Scope of work')[1].split('</ol>')[0];
    expect(scope).toContain('Drain cleaning');
    expect(scope, 'a labor row is priced time, not scope').not.toContain('Labor: 2 workers');
    expect(scope, 'the RRP disclosure insert is boilerplate, not sold work').not.toContain('Lead-safe');
  });

  test('a line repeating a chip is not printed twice', async () => {
    const html = await page.evaluate(async () => {
      _geiIsFreeForm = false; _geiIsTM = false;
      _geiScopeChips = ['Drain cleaning'];
      _geiLines = [{ desc: 'Drain cleaning', notes: 'Cable the main to 75 ft', qty: 1, unit: 'ea', rate: 300, total: 300 }];
      return await sendGenericProposal(true, { silent: true });
    });
    const n = (html.match(/Drain cleaning/g) || []).length;
    expect(n, 'the same work said twice in one section reads as a padded document').toBeLessThanOrEqual(2);
  });

  test('"no scope" still suppresses the section on every type', async () => {
    const html = await page.evaluate(async () => {
      _geiIsFreeForm = false; _geiIsTM = false; _geiScopeChips = []; _geiScopeNoScope = true;
      _geiLines = [{ desc: 'Diagnostic visit', notes: 'One hour on site', qty: 1, unit: 'ea', rate: 150, total: 150 }];
      const h = await sendGenericProposal(true, { silent: true });
      _geiScopeNoScope = false;
      return h;
    });
    expect(html).not.toContain('Scope of work');
  });

  // ── BYO describes the job once ─────────────────────────────────────────────
  // Owner 2026-09-07: "why am I still seeing scope of work selections in BYO?
  // Thought we made that smart off descriptions?" The reader got smart and the
  // input never got removed.

  test('a clean BYO estimate has no scope chip card at all', async () => {
    const r = await page.evaluate(() => {
      _geiScopeChips = [];
      _geiRenderScopeCard('byo');
      const card = document.getElementById('byo-scopecard-wrap');
      return { mode: _geiScopeCardMode('byo'), html: card.innerHTML, hidden: card.style.display === 'none' };
    });
    expect(r.mode).toBe('off');
    expect(r.html).toBe('');
    expect(r.hidden, 'an empty bordered card is worse than no card').toBe(true);
  });

  test('T&M keeps it, because nothing else in a T&M estimate says what the crew does', async () => {
    const r = await page.evaluate(() => {
      _geiScopeChips = [];
      _geiRenderScopeCard('tm');
      const card = document.getElementById('tm-scopecard-wrap');
      return { mode: _geiScopeCardMode('tm'), add: card.innerHTML.includes('+ Add scope'), wrap: !!document.getElementById('tm-scope-wrap') };
    });
    expect(r.mode).toBe('full');
    expect(r.add).toBe(true);
    expect(r.wrap).toBe(true);
  });

  test('a BYO draft that already has chips keeps them removable, never addable', async () => {
    const r = await page.evaluate(() => {
      _geiScopeChips = ['Two coats', 'Prep and caulk'];
      _geiRenderScopeCard('byo');
      _renderScopeChips('byo-scope-wrap');
      const card = document.getElementById('byo-scopecard-wrap');
      return {
        mode: _geiScopeCardMode('byo'),
        add: card.innerHTML.includes('+ Add scope'),
        explains: card.innerHTML.includes('are the scope on this proposal now'),
        listed: card.innerHTML.includes('Two coats') && card.innerHTML.includes('Prep and caulk')
      };
    });
    expect(r.mode).toBe('legacy');
    expect(r.add, 'nothing new can be added').toBe(false);
    expect(r.explains, 'it says why it is going away').toBe(true);
    expect(r.listed, 'they still print, so they have to still be visible').toBe(true);
  });

  test('removing the last legacy chip takes the card with it', async () => {
    const r = await page.evaluate(() => {
      _geiScopeChips = ['Two coats'];
      _geiIsFreeForm = true; _geiIsTM = false;
      _geiRenderScopeCard('byo');
      const before = _geiScopeCardMode('byo');
      _toggleScopeChip('Two coats');
      const card = document.getElementById('byo-scopecard-wrap');
      return { before, after: _geiScopeCardMode('byo'), html: card.innerHTML, chips: _geiScopeChips.length };
    });
    expect(r.before).toBe('legacy');
    expect(r.chips).toBe(0);
    expect(r.after).toBe('off');
    expect(r.html, 'no stranded empty card').toBe('');
  });

  test('a legacy chip still prints on the proposal, so removing it is a real choice', async () => {
    const html = await page.evaluate(async () => {
      _geiEditBidId = null; _geiClientId = null;
      _geiIsFreeForm = true; _geiIsTM = false;
      _geiScopeChips = ['Two coats'];
      _byoItems = [_byoNormItem({ id: 1, section: 'Work', label: 'Repaint living room', qty: 1, unit: 'ea', rate: 1200, notes: 'Walls and trim', on: true })];
      _geiLines = []; _geiExclusions = [];
      _byoUpdateRail();
      return await sendGenericProposal(true, { silent: true });
    });
    expect(html).toContain('Scope of work');
    expect(html, 'the line and its description are the scope').toContain('Repaint living room');
    expect(html).toContain('Walls and trim');
    expect(html, 'and an old chip is still on the document until he takes it off').toContain('Two coats');
  });

  test('_geiScopeCardMode holds on anything it is handed', async () => {
    const r = await page.evaluate(() => {
      _geiScopeChips = [];
      return { byo: _geiScopeCardMode('byo'), tm: _geiScopeCardMode('tm'), junk: _geiScopeCardMode('nope'), nul: _geiScopeCardMode(null) };
    });
    expect(r.byo).toBe('off');
    expect(r.tm).toBe('full');
    expect(r.junk, 'anything that is not byo keeps the picker').toBe('full');
    expect(r.nul).toBe('full');
  });

  test('no console errors across the description loop', async () => {
    await assertNoErrors(page);
  });
});
