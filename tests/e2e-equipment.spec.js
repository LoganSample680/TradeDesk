// @ts-check
// ── Client equipment (owner 2026-08-11) ──────────────────────────────────────
// Point the camera at a data plate, the on-device OCR reads it, and the model
// and serial land on the CLIENT so they outlive the job that captured them.
//
// The rule these tests defend: NEVER GUESS. A wrong serial is worse than an
// empty one, because it gets copied onto a warranty claim months later and
// fails there instead, when nobody can go back and re-read the plate.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Equipment plate capture', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('reads a label-then-value plate (the common furnace layout)', async () => {
    const r = await page.evaluate(() => _equipParsePlate([
      'CARRIER', 'Gas Furnace', 'MODEL NO. 58SC0A045S14', 'SERIAL NO. 4218A12345', '208/230V 60Hz',
    ]));
    expect(r.brand).toBe('Carrier');
    expect(r.model).toBe('58SC0A045S14');
    expect(r.serial).toBe('4218A12345');
  });

  test('reads a two-column plate where the value is on the next line', async () => {
    const r = await page.evaluate(() => _equipParsePlate([
      'RHEEM', 'Water Heater', 'MODEL', 'XE50T10H45U0', 'SERIAL', 'Q381912345', '50 GAL',
    ]));
    expect(r.model).toBe('XE50T10H45U0');
    expect(r.serial).toBe('Q381912345');
    expect(r.brand).toBe('Rheem');
  });

  test('reads M/N and S/N shorthand', async () => {
    const r = await page.evaluate(() => _equipParsePlate(['Bradford White', 'M/N MI50T6FBN', 'S/N ZH21449876']));
    expect(r.model).toBe('MI50T6FBN');
    expect(r.serial).toBe('ZH21449876');
    expect(r.brand).toBe('Bradford White');
  });

  test('an unreadable plate returns blanks, never a guess', async () => {
    const r = await page.evaluate(() => ({
      warnings: _equipParsePlate(['WARNING', 'RISK OF FIRE', 'SEE MANUAL']),
      empty: _equipParsePlate([]),
      nul: _equipParsePlate(null),
      junk: _equipParsePlate(['%%%', '   ', '---']),
    }));
    ['warnings', 'empty', 'nul', 'junk'].forEach(k => {
      expect(r[k].model, `${k}: no invented model`).toBe('');
      expect(r[k].serial, `${k}: no invented serial`).toBe('');
      expect(r[k].brand).toBe('');
    });
  });

  test('a label is never mistaken for the value that follows it', async () => {
    const r = await page.evaluate(() => _equipParsePlate(['MODEL', 'SERIAL NO', 'ABC123']));
    expect(r.model, 'MODEL followed by another label must not capture that label').not.toBe('SERIAL NO');
  });

  test('age reads in years, and refuses nonsense', async () => {
    const r = await page.evaluate(() => ({
      year: _equipAgeYears('2011'),
      dated: _equipAgeYears('03/2018'),
      none: _equipAgeYears(''),
      junk: _equipAgeYears('soon'),
      future: _equipAgeYears('2099'),
      ancient: _equipAgeYears('1890'),
    }));
    const thisYear = new Date().getFullYear();
    expect(r.year).toBe(thisYear - 2011);
    expect(r.dated).toBe(thisYear - 2018);
    expect(r.none).toBe(null);
    expect(r.junk).toBe(null);
    expect(r.future, 'a future install date is a misread').toBe(null);
    expect(r.ancient).toBe(null);
  });

  test('saving: scoped to the client, edits in place, deletes clean, needs a client', async () => {
    const r = await page.evaluate(() => {
      const before = getEquipment().length;
      const saved = saveEquipment({ clientId: 777, kind: 'Furnace', brand: 'Carrier', model: '58SC0A045', serial: '4218A12345', installed: '2011' });
      const mine = _equipForClient(777).length;
      const other = _equipForClient(999).length;
      const none = _equipForClient(null).length;
      const edited = saveEquipment({ id: saved.id, clientId: 777, kind: 'Furnace', model: '58SC0A045X' });
      const rows = getEquipment().filter(x => String(x.id) === String(saved.id)).length;
      const line = _equipLine(getEquipment().find(x => String(x.id) === String(saved.id)));
      const del = deleteEquipment(saved.id);
      const after = getEquipment().length;
      const noClient = saveEquipment({ kind: 'Furnace' });
      const nulled = saveEquipment(null);
      return { before, mine, other, none, editedModel: edited.model, rows, line, del, after, noClient, nulled };
    });
    expect(r.mine, 'the unit belongs to its client').toBe(1);
    expect(r.other, 'and to no other client').toBe(0);
    expect(r.none).toBe(0);
    expect(r.editedModel, 'an edit updates in place').toBe('58SC0A045X');
    expect(r.rows, 'and never forks into a second row').toBe(1);
    expect(r.line, 'the summary line reads like a tech would say it').toContain('Furnace');
    expect(r.del).toBe(true);
    expect(r.after, 'delete leaves nothing behind').toBe(r.before);
    expect(r.noClient, 'equipment with no client is refused').toBe(null);
    expect(r.nulled).toBe(null);
  });

  test('equipment rides the synced fabric like vehicles and places', async () => {
    const r = await page.evaluate(() => {
      const t = (typeof _TD_TABLES !== 'undefined' ? _TD_TABLES : []).find(x => x.t === 'td_equipment');
      if (!t) return { registered: false };
      const before = getEquipment().length;
      t.set([{ id: 'e1', clientId: 5, kind: 'Boiler' }]);
      const applied = getEquipment().length === 1 && getEquipment()[0].kind === 'Boiler';
      const readBack = t.get().length;
      t.set([]);
      return { registered: true, applied, readBack, before };
    });
    expect(r.registered, 'a new record type belongs in _TD_TABLES (§7.3)').toBe(true);
    expect(r.applied, 'incoming cloud rows land in the array').toBe(true);
    expect(r.readBack).toBe(1);
  });

  test('no console errors during equipment tests', async () => {
    assertNoErrors(page, 'equipment');
  });
});
