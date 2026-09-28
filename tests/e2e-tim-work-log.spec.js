// @ts-check
/**
 * TIM'S WORK, STORED (owner 2026-09-28)
 *
 * "Tim should store so I can see when he's fucked up or need to add
 * capabilities."
 *
 * Every job walk said on T&M, Build Your Own and the quick invoice goes up as
 * a 'scope' row (what he said, what Tim made), and the lines the proposal was
 * saved with go up as a 'kept' row, so what he said can be lined up against
 * how Tim split it.
 *
 * Held here:
 *   - the three screens each write the row, with the right surface
 *   - client names and addresses never leave the phone
 *   - 'kept' only for a proposal Tim built, once per version, never on a draft
 *   - the job-walk rows cannot hold up the dock's rows if the database is
 *     behind (the columns arrive with 20261050)
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe("Tim's work: every job walk is stored", () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.waitForFunction(() => window._supaCloudLoaded === true, null, { timeout: 15000 }).catch(() => {});
  });
  test.afterAll(async () => { await page.context().close(); });

  // Offline so nothing flushes mid-assertion: the queue is what is read.
  const offline = () => page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    try { localStorage.removeItem('td_tim_send'); } catch (_e) {}
  });
  const online = () => page.evaluate(() => { delete navigator.onLine; });
  const queue = () => page.evaluate(() => JSON.parse(localStorage.getItem('td_tim_send') || '[]'));

  test.beforeEach(async () => { await offline(); });
  test.afterEach(async () => { await online(); });

  test('a job walk is queued with what Tim made of it', async () => {
    await page.evaluate(() => timLogScope('pull the old heater put in a new tankless', ['Pull the old heater', 'Put in a new tankless'], 'tm', 'b1'));
    const q = await queue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'scope', surface: 'tm', ref: 'b1', said: 'pull the old heater put in a new tankless',
      made: ['Pull the old heater', 'Put in a new tankless'] });
  });

  test('client names and addresses are scrubbed on the phone, in the words and in the lines', async () => {
    await page.evaluate(() => {
      clients = clients.filter(c => c.id !== 99901);
      clients.push({ id: 99901, name: 'Dana Whitfield', addr: '412 Oak St, Wichita KS 67202' });
      timLogScope('At Dana\'s place, 412 Oak St, Dana Whitfield wants the heater swapped', ['Swap the heater for Dana at 412 Oak St'], 'byo', 'b2');
    });
    const q = await queue();
    expect(q[0].said).not.toMatch(/Dana|Whitfield|412 Oak/);
    expect(q[0].said).toContain('<customer>');
    expect(q[0].said).toContain('<address>');
    expect(q[0].made[0]).not.toMatch(/Dana|412 Oak/);
    await page.evaluate(() => { clients = clients.filter(c => c.id !== 99901); });
  });

  test('a long walk keeps its words, capped so one walk cannot fill the phone', async () => {
    await page.evaluate(() => timLogScope('replace the valve '.repeat(400), Array.from({ length: 90 }, (_, i) => 'Line ' + i), 'tm', 'b3'));
    const q = await queue();
    expect(q[0].said.length).toBe(3000);
    expect(q[0].made).toHaveLength(60);
  });

  test('"kept" is only written for a proposal Tim built, and once per version', async () => {
    const r = await page.evaluate(() => [
      timLogKept('never-built', ['Anything'], 'tm'),
      timLogScope('snake the main', ['Snake the main'], 'tm', 'b4') && 'scoped',
      !!timLogKept('b4', ['Snake the main line'], 'tm'),
      timLogKept('b4', ['Snake the main line'], 'tm'),
      !!timLogKept('b4', ['Snake the main line', 'Camera the line'], 'tm'),
    ]);
    expect(r).toEqual([null, 'scoped', true, null, true]);
    const kinds = (await queue()).map(x => x.kind + ':' + (x.made || []).length);
    expect(kinds).toEqual(['scope:1', 'kept:1', 'kept:2']);
  });

  test('junk in never throws and never queues', async () => {
    const r = await page.evaluate(() => [
      timLogScope('', ['x'], 'tm', 'b5'), timLogScope(null), timLogScope(undefined, null, null, null),
      timLogKept(null, ['x']), timLogKept('', null),
    ]);
    expect(r).toEqual([null, null, null, null, null]);
    expect(await queue()).toHaveLength(0);
    const ok = await page.evaluate(() => !!timLogScope('fix the leak', 'not an array', 7, 12345));
    expect(ok).toBe(true);
    expect((await queue())[0]).toMatchObject({ made: [], ref: '12345' });
  });

  test('T&M: saying the job writes a scope row for this proposal', async () => {
    const r = await page.evaluate(() => {
      clients = clients.filter(c => c.id !== 99902);
      clients.push({ id: 99902, name: 'Blake Tester', addr: '9 Elm St, Wichita KS 67202' });
      openGenericEstimate(getClientById(99902), null, 'plumbing', { mode: 'tm', forceNew: true });
      return new Promise(res => setTimeout(() => {
        _geiIsTM = true; _tmShowPage();
        const box = document.getElementById('gei-scope-say');
        if (box) box.value = 'shut the water off then pull the old heater';
        _geiScopeBuild('tm-scope');
        res({ id: String(_geiEditBidId), hasBox: !!box });
      }, 400));
    });
    expect(r.hasBox).toBe(true);
    const q = (await queue()).filter(x => x.kind === 'scope');
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ surface: 'tm', ref: r.id, made: ['Shut the water off', 'Pull the old heater'] });
  });

  test('T&M: the real save writes what went out; a draft does not', async () => {
    const r = await page.evaluate(() => {
      const id = String(_geiEditBidId);
      timLogScope('shut the water off then pull the old heater', ['Shut the water off', 'Pull the old heater'], 'tm', id);
      _geiScopeChips = ['Shut the water off', 'Pull the old heater', 'Haul it away'];
      try { saveGenericEstimate(true); } catch (_e) {}
      const afterDraft = JSON.parse(localStorage.getItem('td_tim_send') || '[]').filter(x => x.kind === 'kept').length;
      try { saveGenericEstimate(false); } catch (_e) {}
      const kept = JSON.parse(localStorage.getItem('td_tim_send') || '[]').filter(x => x.kind === 'kept');
      return { id, afterDraft, kept };
    });
    expect(r.afterDraft).toBe(0);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]).toMatchObject({ ref: r.id, surface: 'tm', made: ['Shut the water off', 'Pull the old heater', 'Haul it away'] });
  });

  test('Build Your Own and the quick invoice write their own rows', async () => {
    const r = await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay,#_style-pick-ov').forEach(e => e.remove());
      openGenericEstimate(getClientById(99902), null, null, { mode: 'byo' });
      _geiIsFreeForm = true; _geiIsTM = false; goGeiStep(2);
      document.getElementById('byo-say').value = 'Snake the main line. Replace the shutoff valve.';
      _byoSayBuild();
      openQuickInvoice(99902); _qiSetMode('set');
      document.getElementById('qi-say').value = 'Snaked the main line';
      _qiSayBuild();
      return JSON.parse(localStorage.getItem('td_tim_send') || '[]').filter(x => x.kind === 'scope').map(x => [x.surface, x.made]);
    });
    expect(r).toContainEqual(['byo', ['Snake the main line', 'Replace the shutoff valve']]);
    expect(r).toContainEqual(['qi', ['Snaked the main line']]);
    await page.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove()); clients = clients.filter(c => c.id !== 99902); });
  });

  test('a database without the new columns never holds up the dock\'s rows', async () => {
    await online();
    const r = await page.evaluate(async () => {
      localStorage.removeItem('td_tim_send');
      const inserted = [];
      const realFrom = _supa.from.bind(_supa);
      const prevUser = window._supaUser;
      _supaUser = _supaUser || { id: '00000000-0000-0000-0000-000000000001' };
      _supa.from = (t) => t !== 'td_tim_asks' ? realFrom(t) : {
        insert: async (rows) => {
          // An old database: any row naming `made` is refused, like PostgREST
          // refusing a column it does not know.
          if (rows.some(x => 'made' in x)) return { error: { code: 'PGRST204', message: 'column made does not exist' } };
          inserted.push(...rows); return { error: null };
        },
      };
      try {
        timLogScope('pull the heater', ['Pull the heater'], 'tm', 'b9');
        await new Promise(res => setTimeout(res, 50));
        timLearnFrom('what am I owed', { kind: 'ask', ask: 'owed' });
        await new Promise(res => setTimeout(res, 50));
        await timLearnFlush();
        const left = JSON.parse(localStorage.getItem('td_tim_send') || '[]');
        return { sent: inserted.map(x => x.kind), left: left.map(x => x.kind) };
      } finally { _supa.from = realFrom; window._supaUser = prevUser; }
    });
    expect(r.sent).toContain('ask');
    expect(r.sent).not.toContain('scope');
    expect(r.left, 'the job walk waits for the database, it is not lost').toEqual(['scope']);
  });

  test('once the database has the columns, the job walk goes up with them', async () => {
    await online();
    const r = await page.evaluate(async () => {
      localStorage.removeItem('td_tim_send');
      const inserted = [];
      const realFrom = _supa.from.bind(_supa);
      const prevUser = window._supaUser;
      _supaUser = _supaUser || { id: '00000000-0000-0000-0000-000000000001' };
      _supa.from = (t) => t !== 'td_tim_asks' ? realFrom(t) : { insert: async (rows) => { inserted.push(...rows); return { error: null }; } };
      try {
        timLogScope('pull the heater', ['Pull the heater'], 'byo', 'b10');
        await new Promise(res => setTimeout(res, 50));
        await timLearnFlush();
        return { rows: inserted, left: JSON.parse(localStorage.getItem('td_tim_send') || '[]').length };
      } finally { _supa.from = realFrom; window._supaUser = prevUser; }
    });
    expect(r.left).toBe(0);
    expect(r.rows[0]).toMatchObject({ kind: 'scope', surface: 'byo', ref: 'b10', made: ['Pull the heater'], scrubbed: true });
  });

  test('no console errors', async () => { assertNoErrors(page, "tim's work log"); });
});
