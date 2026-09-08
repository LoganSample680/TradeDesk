// @ts-check
// ── Traced trips on the mileage log and the Time Log (owner 2026-09-08) ──────
//
// "if no address is saved, we show the traced mileage start and stop on the
// map it lists the total miles but then says how they are excluded due to no
// address entered ... only things with addresses saved should update any
// totals, if a address gets added it can add the mileage back on the deriver"
//
// The deriver's half (rule 14) is in tests/e2e-geo-derive.spec.js. This is the
// reading half: the fourth pot, the row, the map note, the Save flow into the
// new-lead form, and the one trip number both screens share.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('traced trips', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // One day: a real leg, a traced leg with an unsaved end, and a hand-typed
  // trip, in that order of departure. Seeded fresh for every test.
  async function seed() {
    return page.evaluate(() => {
      const day = todayKey();
      // No vehicle, no log: renderAllMileage paints the "add a vehicle" hero
      // and returns before the trip list. One truck is enough.
      if (!getVehicles().length) vehicles.push({ id: 7001, name: 'Truck', status: 'active', isDefault: true });
      window.supaLoadFromCloud = async () => {};
      mileage.length = 0;
      mileage.push({ id: 'j-real', legKey: 'j-real', gps: true, date: day, from_name: 'Shop', from: '1200 SW Oakley Ave', to_name: 'John Doe', to: '2950 SW McClure Rd',
        miles: 3.2, mins: 9, purpose: 'Client Consult', calc_method: 'derived-routed', startedIso: '2026-09-08T12:49:00.000Z', endedIso: '2026-09-08T12:58:00.000Z', created_at: '2026-09-08T12:49:00.000Z',
        fromCoord: { lat: 39.0456, lng: -95.7151 }, toCoord: { lat: 39.0123, lng: -95.7465 }, path: [[39.0456, -95.7151, 1], [39.0123, -95.7465, 2]] });
      mileage.push({ id: 'j-traced', legKey: 'j-traced', gps: true, date: day, from_name: 'John Doe', from: '2950 SW McClure Rd', to_name: '', to: '',
        miles: 6.2, mins: 16, purpose: 'Business', calc_method: 'derived-traced', gpsMiles: 6.2, addressUnknown: true, unsavedFrom: false, unsavedTo: true, unsavedVia: false,
        startedIso: '2026-09-08T18:12:00.000Z', endedIso: '2026-09-08T18:28:00.000Z', created_at: '2026-09-08T18:12:00.000Z',
        fromCoord: { lat: 39.0123, lng: -95.7465 }, toCoord: { lat: 39.0350, lng: -95.7000 }, path: [[39.0123, -95.7465, 1], [39.02, -95.72, 2], [39.0350, -95.7000, 3]] });
      mileage.push({ id: 'hand-1', date: day, from_name: 'Shop', to_name: 'Ace Supply', miles: 2.0, purpose: 'Supply run', created_at: '2026-09-08T20:00:00.000Z', loggedAt: '2026-09-08T20:00:00.000Z' });
      return day;
    });
  }

  test.describe('the fourth pot', () => {
    test('a traced row is on no total: not deductible, not reimbursable, not even plain miles', async () => {
      await seed();
      const r = await page.evaluate(() => ({
        ded: deductibleTrips(mileage).map(m => m.id),
        reimb: reimbursableTrips(mileage.map(m => Object.assign({}, m, { reimbursable: true }))).map(m => m.id),
        addressed: addressedTrips(mileage).map(m => m.id),
        unaddressed: unaddressedTrips(mileage).map(m => m.id),
      }));
      expect(r.ded).toEqual(['j-real', 'hand-1']);
      expect(r.reimb).toEqual(['j-real', 'hand-1']);
      expect(r.addressed).toEqual(['j-real', 'hand-1']);
      expect(r.unaddressed).toEqual(['j-traced']);
    });

    test('the day header sums addressed miles only, and the deduction preview agrees', async () => {
      const day = await seed();
      const r = await page.evaluate((d) => {
        renderAllMileage();
        const card = [...document.querySelectorAll('#mil-table .mil-day')].find(el => el.textContent.includes('Trip')) || document.querySelector('#mil-table');
        return { text: card ? card.textContent : '' };
      }, day);
      // 3.2 + 2.0 shown; the traced 6.2 is not in the number.
      expect(r.text).toMatch(/5\.2 mi/);
      expect(r.text).not.toMatch(/11\.4 mi/);
    });

    test('junk never throws through the pots', async () => {
      const ok = await page.evaluate(() => {
        try { addressedTrips(null); addressedTrips([null, 1, 'x', {}]); deductibleTrips(undefined); unaddressedTrips([{ addressUnknown: 'yes' }]); return true; } catch (_e) { return false; }
      });
      expect(ok).toBe(true);
    });
  });

  test.describe('the row', () => {
    test('a traced row names its unsaved end, offers Save, and says it is off the books', async () => {
      await seed();
      const html = await page.evaluate(() => { renderAllMileage(); return document.getElementById('mil-table').innerHTML; });
      const row = html.slice(html.indexOf('data-lp-id="j-traced"'));
      const rowEnd = row.indexOf('data-lp-id="', 20);
      const traced = rowEnd > 0 ? row.slice(0, rowEnd) : row;
      expect(traced).toContain('Unsaved address');
      expect(traced).toMatch(/_mileSaveAddress\('j-traced','to'\)/);
      expect(traced).not.toMatch(/_mileSaveAddress\('j-traced','from'\)/);
      expect(traced).toContain('Not on the books · no address');
      // The Route button is there: the row has a trace to draw.
      expect(traced).toContain('openMileageRoute(');
    });

    test('a traced row is never a review nag: it cannot be answered with a purpose', async () => {
      await seed();
      const r = await page.evaluate(() => {
        mileage.find(m => m.id === 'j-traced').purpose = '';
        renderAllMileage();
        const el = document.querySelector('#mil-table [data-lp-id="j-traced"]');
        return { needs: !!(el && el.classList.contains('needs')) };
      });
      expect(r.needs).toBe(false);
    });

    // ── The two ends are the same word, so the clock is what tells them apart
    // (owner 2026-09-08: "what about the unsaved address to unsaved address
    // with the time stamp in mileage?").
    test('unsaved to unsaved: each end carries its own stamp, and each offers its own Save', async () => {
      await page.evaluate(() => {
        const m = mileage.find(x => x.id === 'j-traced');
        m.unsavedFrom = true; m.from_name = ''; m.from = '';
      });
      const html = await page.evaluate(() => { renderAllMileage(); return document.getElementById('mil-table').innerHTML; });
      const i = html.indexOf('data-lp-id="j-traced"');
      const row = html.slice(i, html.indexOf('data-lp-id="', i + 20));
      expect((row.match(/Unsaved address/g) || []).length, 'both ends say it').toBe(2);
      expect(row).toMatch(/_mileSaveAddress\('j-traced','from'\)/);
      expect(row).toMatch(/_mileSaveAddress\('j-traced','to'\)/);
      // The departure clock on the start, the arrival clock on the end: the
      // only thing distinguishing two identical labels.
      expect(row).toContain('6:12p');
      expect(row).toContain('6:28p');
      expect(row.indexOf('6:12p'), 'departure sits on the FROM end').toBeLessThan(row.indexOf('6:28p'));
      // Said once: with both ends stamped the right-hand span would repeat
      // them. The duration is not something either endpoint says, so it stays.
      expect((row.match(/6:12p/g) || []).length).toBe(1);
      expect((row.match(/6:28p/g) || []).length).toBe(1);
      expect(row).toContain('16m');
    });

    test('one end unsaved keeps the trip span on the right: there is nothing to repeat', async () => {
      await seed();
      const html = await page.evaluate(() => { renderAllMileage(); return document.getElementById('mil-table').innerHTML; });
      const i = html.indexOf('data-lp-id="j-traced"');
      const row = html.slice(i, html.indexOf('data-lp-id="', i + 20));
      expect(row).toContain('6:12p–6:28p');
    });

    test('a named end never grows a stamp: only the ones with nothing else to say', async () => {
      await seed();
      const html = await page.evaluate(() => { renderAllMileage(); return document.getElementById('mil-table').innerHTML; });
      const i = html.indexOf('data-lp-id="j-traced"');
      const row = html.slice(i, html.indexOf('data-lp-id="', i + 20));
      const fromBlock = row.slice(row.indexOf('>From<'), row.indexOf('>To<') > 0 ? row.indexOf('>To<') : undefined);
      expect(fromBlock).toContain('John Doe');
      expect(fromBlock).not.toContain('6:12p');
    });

    test('a row with no clock still renders both ends without throwing', async () => {
      await seed();
      const ok = await page.evaluate(() => {
        const m = mileage.find(x => x.id === 'j-traced');
        m.unsavedFrom = true; m.from_name = ''; delete m.startedIso; delete m.endedIso;
        try { renderAllMileage(); return document.getElementById('mil-table').innerHTML.includes('Unsaved address'); } catch (_e) { return false; }
      });
      expect(ok).toBe(true);
    });

    test('a real row is untouched by any of this', async () => {
      await seed();
      const html = await page.evaluate(() => { renderAllMileage(); return document.getElementById('mil-table').innerHTML; });
      const i = html.indexOf('data-lp-id="j-real"');
      const real = html.slice(i, html.indexOf('data-lp-id="', i + 20));
      expect(real).not.toContain('Address not saved');
      expect(real).not.toContain('Not on the books');
      expect(real).toContain('John Doe');
    });
  });

  test.describe('one trip number, two screens', () => {
    test('numbers run oldest to newest within the day, keyed by id and by leg', async () => {
      const day = await seed();
      const r = await page.evaluate((d) => _mileTripNumbers(d), day);
      expect(r['j-real']).toBe(1);
      expect(r['j-traced']).toBe(2);
      expect(r['hand-1']).toBe(3);
      expect(r['leg:j-traced']).toBe(2);
    });

    test('the mileage log prints them in that order, whatever order the rows render in', async () => {
      await seed();
      const html = await page.evaluate(() => { renderAllMileage(); return document.getElementById('mil-table').innerHTML; });
      const at = (id) => { const i = html.indexOf('data-lp-id="' + id + '"'); const s = html.slice(i, i + 900); const m = s.match(/Trip (\d+)/); return m ? Number(m[1]) : null; };
      expect([at('j-real'), at('j-traced'), at('hand-1')]).toEqual([1, 2, 3]);
    });

    test('a segment of a split drive resolves to its leg\'s number', async () => {
      const day = await seed();
      const r = await page.evaluate((d) => [_mileTripNumberForLeg(d, 'j-traced:1'), _mileTripNumberForLeg(d, 'j-real'), _mileTripNumberForLeg(d, 'nope'), _mileTripNumberForLeg(d, null)], day);
      expect(r).toEqual([2, 1, null, null]);
    });

    test('the Time Log drive row carries the same number', async () => {
      const day = await seed();
      const html = await page.evaluate((d) => _tlRailRow({
        id: 'a1', source: 'auto', rawSource: 'drive', detail: 'Drive time', date: d, minutes: 16,
        clientKey: 'j-traced:0', clientName: 'Destination not saved', startTime: '2026-09-08T18:12:00.000Z', endTime: '2026-09-08T18:28:00.000Z',
      }), day);
      expect(html).toContain('Trip 2');
      expect(html).toContain('Drive time');
    });

    test('a non-drive row never gets a number', async () => {
      const day = await seed();
      const html = await page.evaluate((d) => _tlRailRow({
        id: 'a2', source: 'auto', rawSource: 'client', detail: 'On site', date: d, minutes: 60,
        clientKey: 'd-j-real', clientName: 'John Doe', startTime: '2026-09-08T13:00:00.000Z', endTime: '2026-09-08T14:00:00.000Z',
      }), day);
      expect(html).not.toMatch(/Trip \d/);
    });

    test('adding a row later does not renumber the ones before it', async () => {
      const day = await seed();
      const r = await page.evaluate((d) => {
        const before = _mileTripNumbers(d);
        mileage.push({ id: 'hand-2', date: d, from_name: 'A', to_name: 'B', miles: 1, purpose: 'Business', created_at: '2026-09-08T22:00:00.000Z' });
        const after = _mileTripNumbers(d);
        return { before, after };
      }, day);
      expect(r.after['j-real']).toBe(r.before['j-real']);
      expect(r.after['j-traced']).toBe(r.before['j-traced']);
      expect(r.after['hand-2']).toBe(4);
    });
  });

  test.describe('the map', () => {
    test('a traced trip draws, says the miles are traced and unclaimed, and offers Save on the missing end', async () => {
      await seed();
      const r = await page.evaluate(() => {
        openMileageRoute('j-traced');
        const ov = document.getElementById('_mil-route-ov');
        const t = ov ? ov.textContent : '';
        const h = ov ? ov.innerHTML : '';
        ov && ov.remove();
        return { t, h };
      });
      expect(r.t).toContain('Traced 6.2 mi');
      expect(r.t).toMatch(/Not claimed and not in any total/);
      expect(r.t).toContain('Unsaved address');
      // Said once, not twice: the whole figure IS the trace.
      expect(r.t.match(/Traced 6\.2 mi/g).length).toBe(1);
      expect(r.h).toMatch(/_mileSaveAddress\('j-traced','to'\)/);
      expect(r.h).not.toMatch(/_mileSaveAddress\('j-traced','from'\)/);
      expect(r.t).not.toContain('Logged 6.2');
    });

    test('a real trip\'s map says Logged and carries no such note', async () => {
      await seed();
      const t = await page.evaluate(() => {
        openMileageRoute('j-real');
        const ov = document.getElementById('_mil-route-ov'); const t = ov ? ov.textContent : ''; ov && ov.remove(); return t;
      });
      expect(t).toContain('Logged 3.2 mi');
      expect(t).not.toContain('Not claimed');
    });
  });

  test.describe('save this address', () => {
    test('opens the new-lead form on the traced coordinates, address prefilled from the reverse geocode', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        const keep = window._nominatimReverse;
        window._nominatimReverse = async (lat, lng) => (lat === 39.035 && lng === -95.7 ? '2100 SW Gage Blvd, Topeka, KS 66604' : null);
        try {
          const ok = await _mileSaveAddress('j-traced', 'to');
          return {
            ok,
            title: document.getElementById('cf-title') && document.getElementById('cf-title').textContent,
            street: document.getElementById('cf-street').value, city: document.getElementById('cf-city').value,
            state: document.getElementById('cf-state').value, zip: document.getElementById('cf-zip').value,
            name: document.getElementById('cf-name').value,
            pending: _mileAddressPending,
          };
        } finally { window._nominatimReverse = keep; closeClientForm && closeClientForm(); }
      });
      expect(r.ok).toBe(true);
      expect(r.title).toBe('New lead');
      expect([r.street, r.city, r.state, r.zip]).toEqual(['2100 SW Gage Blvd', 'Topeka', 'KS', '66604']);
      expect(r.name, 'the name is his to give').toBe('');
      expect(r.pending).toEqual(expect.objectContaining({ legKey: 'j-traced', which: 'to', lat: 39.035, lng: -95.7 }));
    });

    test('with no reverse geocode the form still opens, empty, on the right day', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        const keep = window._nominatimReverse;
        window._nominatimReverse = async () => null;
        try {
          const ok = await _mileSaveAddress('j-traced', 'to');
          return { ok, street: document.getElementById('cf-street').value, day: _mileAddressPending && _mileAddressPending.day };
        } finally { window._nominatimReverse = keep; closeClientForm && closeClientForm(); }
      });
      expect(r.ok).toBe(true);
      expect(r.street).toBe('');
      expect(r.day).toBe(await page.evaluate(() => todayKey()));
    });

    test('an end that is not unsaved, or a row that does not exist, is a no-op', async () => {
      await seed();
      const r = await page.evaluate(async () => [
        await _mileSaveAddress('nope', 'to'),
        await _mileSaveAddress('j-traced', 'sideways'),
      ]);
      expect(r).toEqual([false, false]);
    });

    test('saving the lead re-derives that day once, then says which trip is on the books', async () => {
      const day = await seed();
      const r = await page.evaluate(async (d) => {
        const keepD = window._geoDeriveDayNow, keepT = window.showToast;
        const derived = [], toasts = [];
        window._geoDeriveDayNow = async (dk) => { derived.push(dk); return {}; };
        window.showToast = (m) => { toasts.push(m); };
        try {
          _mileAddressPending = { legKey: 'j-traced', day: d, which: 'to', lat: 39.035, lng: -95.7 };
          const a = await _mileAddressSaved({ id: 1, addr: '2100 SW Gage Blvd' });
          const b = await _mileAddressSaved({ id: 1, addr: '2100 SW Gage Blvd' });   // nothing pending now
          return { a, b, derived, toasts, pending: _mileAddressPending };
        } finally { window._geoDeriveDayNow = keepD; window.showToast = keepT; }
      }, day);
      expect(r.a).toBe(true);
      expect(r.b).toBe(false);
      expect(r.derived).toEqual([day]);
      expect(r.toasts).toEqual(['Trip 2 is on the books']);
      expect(r.pending).toBe(null);
    });

    test('a lead saved with no address changes nothing', async () => {
      const day = await seed();
      const r = await page.evaluate(async (d) => {
        const keepD = window._geoDeriveDayNow; let n = 0;
        window._geoDeriveDayNow = async () => { n++; return {}; };
        try {
          _mileAddressPending = { legKey: 'j-traced', day: d, which: 'to', lat: 1, lng: 1 };
          const a = await _mileAddressSaved({ id: 1, addr: '' });
          return { a, n, still: !!_mileAddressPending };
        } finally { window._geoDeriveDayNow = keepD; _mileAddressPending = null; }
      }, day);
      expect(r).toEqual({ a: false, n: 0, still: true });
    });

    test('the form\'s save hands off to the mileage side once the address is geocoded', async () => {
      // finance.js wraps saveClient at runtime (it calls the original first),
      // so the hook is asserted on the served source of the original.
      const src = await page.evaluate(async () => (await (await fetch('/js/clients.js')).text()));
      expect(src).toContain('_mileAddressSaved(c)');
      const wrapped = await page.evaluate(() => saveClient.toString());
      expect(wrapped).toContain('_origSaveClient()');
    });
  });

  // ── A deduction is not a cost (owner 2026-09-08: "summary is showing
  // mileage as a negative number when that's not the case") ─────────────────
  test.describe('the Books summary', () => {
    async function summary(seedFn) {
      return page.evaluate((fn) => {
        income.length = 0; expenses.length = 0; mileage.length = 0;
        // eslint-disable-next-line no-new-func
        (new Function('return ' + fn))()();
        trackerYear = String(new Date().getFullYear());
        renderSummary();
        const el = document.getElementById('sum-mets');
        return el ? el.textContent : '';
      }, seedFn.toString());
    }

    test('driving with no income is not a loss: the deduction lowers the tax, not the profit', async () => {
      const t = await summary(() => {
        const yr = String(new Date().getFullYear());
        mileage.push({ id: 'm1', date: yr + '-09-08', from_name: 'Shop', to_name: 'John Doe', miles: 3.2, purpose: 'Client Consult' });
      });
      // The old formula subtracted the deduction from profit as though it
      // were cash, and printed -$2.32 for one 3.2 mile drive.
      expect(t).not.toContain('-$2.32');
      expect(t).toMatch(/Net profit\$0\.00|Net profit\$0/);
      // The deduction is still shown, on its own tile, as a positive figure.
      expect(t).toContain('$2.32');
      expect(t).toContain('3 mi');
    });

    test('with income, profit is income less expenses less tax, and the deduction is only in the tax', async () => {
      const t = await summary(() => {
        const yr = String(new Date().getFullYear());
        income.push({ id: 'i1', date: yr + '-09-08', amount: 10000, cat: 'Revenue' });
        expenses.push({ id: 'e1', date: yr + '-09-08', amount: 1000, cat: 'supplies' });
        mileage.push({ id: 'm1', date: yr + '-09-08', from_name: 'Shop', to_name: 'John Doe', miles: 100, purpose: 'Client Consult' });
      });
      const num = (label) => { const m = t.match(new RegExp(label + '\\$([\\d,]+\\.\\d\\d)')); return m ? Number(m[1].replace(/,/g, '')) : null; };
      const inc = num('Income'), exp = num('Expenses'), tax = num('Est\\. tax'), profit = num('Net profit');
      expect([inc, exp]).toEqual([10000, 1000]);
      expect(profit).toBeCloseTo(inc - exp - tax, 2);
      // And it is NOT the old double subtraction.
      expect(profit).not.toBeCloseTo(inc - exp - 72.5 - tax, 2);
    });

    test('a traced trip changes no figure on the summary at all', async () => {
      const withOut = await summary(() => {
        const yr = String(new Date().getFullYear());
        income.push({ id: 'i1', date: yr + '-09-08', amount: 5000, cat: 'Revenue' });
        mileage.push({ id: 'm1', date: yr + '-09-08', from_name: 'Shop', to_name: 'John Doe', miles: 10, purpose: 'Client Consult' });
      });
      const withTraced = await summary(() => {
        const yr = String(new Date().getFullYear());
        income.push({ id: 'i1', date: yr + '-09-08', amount: 5000, cat: 'Revenue' });
        mileage.push({ id: 'm1', date: yr + '-09-08', from_name: 'Shop', to_name: 'John Doe', miles: 10, purpose: 'Client Consult' });
        mileage.push({ id: 'm2', date: yr + '-09-08', from_name: '', to_name: '', miles: 99, purpose: 'Business', addressUnknown: true, unsavedTo: true });
      });
      expect(withTraced).toBe(withOut);
    });
  });

  test('no console errors across traced trips', async () => {
    assertNoErrors(page, 'traced trips');
  });
});
