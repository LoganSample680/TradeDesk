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

  // ── "trip 1 is repeated 3 times" (owner 2026-09-18) ─────────────────────
  // DELETED 2026-09-19 (§7). "A collapsed trip names which drive of it you are
  // looking at" covered _mileTripLegForLeg, which is gone with the label it
  // fed. Three drives reading TRIP 1 was the chain collapsing three real
  // drives into one leg, fixed in the deriver rather than explained on the
  // rail (tests/e2e-geo-derive.spec.js, "a work-length stop closes the chain").
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
    // ── IT ASKS WHAT THE ADDRESS IS FIRST (owner 2026-09-16) ────────────
    // "He clicked save address for a plumbing place and it dropped it as a
    //  lead, go look at neenans co, that's supposed to be a supply house not
    //  a lead."
    //
    // Save used to go straight here for every address on the log, so a stop at
    // a plumbing supply counter became a sales lead, and then got enriched off
    // Zillow as a single family home. The kind is not cosmetic: a supply run is
    // held for its receipt and a client visit is not. So it asks, and this test
    // now answers "A customer" before asserting everything it always did.
    test('asks what the address is, and a customer opens the new-lead form prefilled', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        const keep = window._nominatimReverse;
        window._nominatimReverse = async (lat, lng) => (lat === 39.035 && lng === -95.7 ? '2100 SW Gage Blvd, Topeka, KS 66604' : null);
        try {
          const ok = await _mileSaveAddress('j-traced', 'to');
          const asked = !!document.getElementById('_mile-kind-ov');
          await _mileSaveKind('client');
          // AMENDED 2026-09-19 (10.4). 'client' used to open the new-lead form
          // directly and this test asserted that. It now asks WHOSE address
          // this is first (owner: "add in a option for a picker on time sheet
          // save address where we can pick a client or add new"), because a
          // second visit to somebody already on the books was making a
          // duplicate record every time. Add a new customer is one tap in that
          // picker and lands on exactly the form this test has always checked.
          const askedWho = !!document.getElementById('_mile-who-ov');
          _mileWhoNew();
          return {
            asked, askedWho, gone: !document.getElementById('_mile-kind-ov'),
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
      expect(r.asked, 'it asks before it assumes').toBe(true);
      expect(r.askedWho, 'and it asks whose it is before it makes a new one').toBe(true);
      expect(r.gone, 'and gets out of the way once answered').toBe(true);
      expect(r.title).toBe('New lead');
      expect([r.street, r.city, r.state, r.zip]).toEqual(['2100 SW Gage Blvd', 'Topeka', 'KS', '66604']);
      expect(r.name, 'the name is his to give').toBe('');
      expect(r.pending).toEqual(expect.objectContaining({ legKey: 'j-traced', which: 'to', lat: 39.035, lng: -95.7 }));
    });

    // Jack's Wednesday, 2026-09-09: shop to shop through a place he never
    // saved. Both ends of that row ARE the shop, so Save used to open the
    // lead form on his own yard. The deriver now carries the stop as viaCoord
    // and that is what gets saved.
    test('a round trip through an unsaved stop saves the STOP, not the shop it left from', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        mileage.push({ id: 'j-via', legKey: 'j-via', gps: true, date: todayKey(), from_name: 'Shop', from: '1200 SW Oakley Ave', to_name: 'Shop', to: '1200 SW Oakley Ave',
          miles: 4.7, mins: 33, purpose: 'Other', calc_method: 'derived-traced', gpsMiles: 4.7, addressUnknown: true, unsavedFrom: false, unsavedTo: false, unsavedVia: true,
          startedIso: '2026-09-09T18:48:34.000Z', endedIso: '2026-09-09T20:56:17.000Z', created_at: '2026-09-09T18:48:34.000Z',
          fromCoord: { lat: 39.0456, lng: -95.7151 }, toCoord: { lat: 39.0456, lng: -95.7151 },
          viaCoord: { lat: 39.06146, lng: -95.69681 }, viaIso: '2026-09-09T19:05:42.000Z', path: [[39.0456, -95.7151, 1], [39.06146, -95.69681, 2], [39.0456, -95.7151, 3]] });
        renderAllMileage();
        const row = [...document.querySelectorAll('#mil-table .mil-trip, #mil-table [data-mid]')].map(el => el.outerHTML).find(h => /_mileSaveAddress\('j-via','to'\)/.test(h)) || document.getElementById('mil-table').innerHTML;
        const clk = (t) => bizTime(t).replace(/\s/g, '').replace('AM', 'a').replace('PM', 'p');
        const keep = window._nominatimReverse;
        window._nominatimReverse = async () => null;
        try {
          const ok = await _mileSaveAddress('j-via', 'to');
          await _mileSaveKind('client');
          return { ok, pending: _mileAddressPending, stamp: row.includes(clk('2026-09-09T19:05:42.000Z')) };
        } finally { window._nominatimReverse = keep; closeClientForm && closeClientForm(); }
      });
      expect(r.ok).toBe(true);
      expect(r.pending).toEqual(expect.objectContaining({ legKey: 'j-via', which: 'to', lat: 39.06146, lng: -95.69681 }));
      // And the stamp beside "Unsaved address" is when he was AT the stop.
      expect(r.stamp).toBe(true);
    });

    // ── AND THE OTHER ARM: NEENANS CO (owner 2026-09-16) ────────────────
    // The one that did not exist. A supply house is not a customer, and the
    // place form is the app's own form for it: it already takes a coordinate
    // and already refuses to save without a real type. No new form, no second
    // copy of the flow (7.3). The re-derive fires from either arm, or the trip
    // that prompted the save would still read "Unsaved address" afterwards.
    test('a supply house opens the PLACE form, not a lead, on the same coordinate', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        try {
          // cf-title is static markup, so its presence proves nothing. Blank it
          // first: openNewClient is what writes 'New lead' into it, so the
          // text is the only honest tell that the lead form ran.
          document.getElementById('cf-title').textContent = '';
          await _mileSaveAddress('j-traced', 'to');
          await _mileSaveKind('place');
          const pm = document.getElementById('place-modal');
          return {
            place: !!pm, lead: document.getElementById('cf-title').textContent === 'New lead',
            pending: _mileAddressPending,
            // Every kind the place form offers, so a supply house is reachable.
            kinds: pm ? [...pm.querySelectorAll('#place-kind option')].map(o => o.value).filter(Boolean) : [],
          };
        } finally {
          document.getElementById('place-modal')?.remove();
          if (typeof closeClientForm === 'function') closeClientForm();
        }
      });
      expect(r.place, 'the place form, on the traced coordinate').toBe(true);
      expect(r.lead, 'and no lead form anywhere').toBe(false);
      expect(r.kinds, 'supply house among them').toContain('supply');
      expect(r.pending, 'and the same day is still queued to re-derive')
        .toEqual(expect.objectContaining({ legKey: 'j-traced', lat: 39.035, lng: -95.7 }));
    });

    // ── AND IT KNOWS WHAT IS STANDING THERE (owner 2026-09-16) ──────────
    // "For save address I guess we need to make it smart enough to know and
    //  ask is this a Supply House or a Lead/Client."
    //
    // Apple names the business on a commercial pin and _reverseGeocode was
    // throwing that name away before anyone saw it. Neenans Co is the real
    // case: a plumbing supply counter at 3210 S Kansas Ave that the app turned
    // into a sales lead and then enriched off Zillow as a single family home.
    test('a supply house names itself and leads with Supply house', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        // Bare assignment, not window.: _mapkitReady is a script-scope `let`
        // and window._mapkitReady = true sets a different variable (the same
        // note withMapKit carries below).
        const keepMk = _mapkitReady, keepG = window.mapkit;
        _mapkitReady = true;
        window.mapkit = {
          Coordinate: function (a, b) { this.latitude = a; this.longitude = b; },
          Geocoder: function () {
            this.reverseLookup = (c, cb) => cb(null, { results: [{
              name: 'Neenans Co', fullThoroughfare: '3210 S Kansas Ave',
              locality: 'Topeka', administrativeAreaCode: 'KS', postCode: '66611' }] });
          },
        };
        try {
          await _mileSaveAddress('j-traced', 'to');
          // The lookup fills the prompt in after it paints, so wait for it.
          for (let i = 0; i < 40 && !/Neenans/.test(document.getElementById('_mile-kind-ov')?.textContent || ''); i++) {
            await new Promise(r => setTimeout(r, 25));
          }
          const ov = document.getElementById('_mile-kind-ov');
          const btns = [...ov.querySelectorAll('button')].map(b => ({ t: b.textContent, p: b.className.includes('btn-p') }));
          return { text: ov.textContent, btns, guess: _mileAddressPending.found };
        } finally { _mapkitReady = keepMk; window.mapkit = keepG;
                    document.getElementById('_mile-kind-ov')?.remove(); }
      });
      expect(r.text, 'it says what is there instead of a raw coordinate').toContain('Neenans Co');
      // AND IT DOES NOT PRETEND TO KNOW. "Neenans Co" is the case that started
      // this and the name says nothing: no keyword in it suggests plumbing
      // supply. A confident wrong answer here is the exact failure the prompt
      // exists to stop, so a named business the list cannot place is shown by
      // name with both answers offered evenly. Knowing it is Neenans Co rather
      // than 39.0106, -95.6811 is most of the value on its own.
      expect(r.guess.guess, 'named, but not placed').toBe('');
      // AND NO STATE EVER FILLS ONE (owner 2026-09-16: "it leads click customer
      // heavy, want them to look at it twice to ensure it's right"). A filled
      // primary is the app telling you where to tap, and the app's guess is the
      // thing that was wrong here. The guess orders them and says itself in
      // words; both look identical so he has to read them.
      expect(r.btns.filter(b => b.p), 'neither side is pre-picked').toHaveLength(0);
      expect(r.btns.map(b => b.t)).toEqual(expect.arrayContaining(['Supply house', 'Lead or client']));
      expect(r.text).toContain('The map found that name but not what it is');
    });

    // Even the confident case leads without leaning: first in the list, same
    // weight as the other, and the guess stated in words above them.
    test('a confident guess still fills no button, it only orders them', async () => {
      const r = await page.evaluate(async () => {
        // Restored in the finally: _mileWhatIsHere is a top-level function, so
        // assigning to window really does replace it, and leaving it replaced
        // silently fed this fixture to the next test in the file.
        const keep = window._mileWhatIsHere;
        try {
          window._mileWhatIsHere = async () => ({ parts: {}, name: 'Ferguson Plumbing Supply',
            guess: 'supply', supply: true });
          await _mileSaveAddress('j-traced', 'to');
          for (let i = 0; i < 40 && !_mileAddressPending.found; i++) await new Promise(r => setTimeout(r, 25));
          const ov = document.getElementById('_mile-kind-ov');
          return { btns: [...ov.querySelectorAll('button')].map(b => ({ t: b.textContent, p: b.className.includes('btn-p') })),
                   text: ov.textContent };
        } finally { window._mileWhatIsHere = keep; document.getElementById('_mile-kind-ov')?.remove(); }
      });
      expect(r.btns[0].t, 'the likely one is simply first').toBe('Supply house');
      expect(r.btns.filter(b => b.p), 'and nothing is weighted').toHaveLength(0);
      expect(r.text, 'the guess is words, not a heavy button')
        .toContain('reads like a supply house');
      expect(r.text).toContain('Check it before you pick');
    });

    // ── AND IT DOES NOT MOVE WHEN THE LOOKUP LANDS (owner 2026-09-20) ────
    // On a clip of himself tapping Save this address: "see how the screen
    // jumps up a bit? Needs to be perfectly smooth."
    //
    // Two causes, one line of code. The second paint went through
    // ov.innerHTML, which REPLACES the .zmodal node, so its td-modal-in
    // entrance (.24s scale, index.html) ran a second time on a box that had
    // already settled; and the two text lines changed length between the
    // paints, so margin:auto (.zmodal-overlay>*) re-centred a taller box and
    // it rose. Measured here rather than eyeballed: same element, same
    // rectangle, before the lookup and after it.
    test('the kind prompt never moves when the lookup lands', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        const keep = window._mileWhatIsHere;
        let release;
        try {
          // Held open on purpose, so "before" is genuinely the pre-lookup
          // paint and not a race with a fixture that resolves immediately.
          window._mileWhatIsHere = () => new Promise(res => { release = res; });
          await _mileSaveAddress('j-traced', 'to');
          const ov = document.getElementById('_mile-kind-ov');
          const before = ov.querySelector('.zmodal');
          const skel = ov.querySelectorAll('.td-skel').length;
          // offsetHeight/offsetTop, not getBoundingClientRect: the rect
          // includes td-modal-in's scale(.97), so measuring through it reads
          // the entrance animation rather than the box (webkit, shard 3,
          // 2026-09-20: 11px of scale on a box that never changed). These two
          // are layout values, which is exactly what "it moved" means here.
          // The entrance is waited out anyway rather than slept past, so the
          // numbers are of a settled box either way.
          await Promise.all(before.getAnimations().map(x => x.finished.catch(() => {})));
          const b = { h: before.offsetHeight, top: before.offsetTop };
          release({ parts: { addr: '3210 S Kansas Ave, Topeka, KS 66611' },
                    name: 'Neenans Co', guess: '', supply: false });
          await new Promise(r => setTimeout(r, 80));
          const after = ov.querySelector('.zmodal');
          const a = { h: after.offsetHeight, top: after.offsetTop };
          return { skel, same: before === after, boxes: ov.querySelectorAll('.zmodal').length,
                   dTop: b.top - a.top, dH: b.h - a.h,
                   stillSkel: ov.querySelectorAll('.td-skel').length,
                   named: after.textContent.includes('Neenans Co') };
        } finally { window._mileWhatIsHere = keep;
                    document.getElementById('_mile-kind-ov')?.remove(); }
      });
      expect(r.skel, 'the name line shimmers while the lookup is out (8.4)').toBe(1);
      expect(r.named, 'and the lookup really did land').toBe(true);
      expect(r.stillSkel, 'the shimmer is gone once it has an answer').toBe(0);
      expect(r.same, 'the same box, not a replacement that animates itself in again').toBe(true);
      expect(r.boxes, 'and only ever one of it').toBe(1);
      expect(r.dH, 'its height never changed').toBe(0);
      expect(r.dTop, 'so it never moved').toBe(0);
    });

    // A lookup that never answers must not leave a shimmer spinning where a
    // name was promised.
    test('a lookup that fails clears the shimmer and asks evenly', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        const keep = window._mileWhatIsHere;
        try {
          window._mileWhatIsHere = () => Promise.reject(new Error('no signal'));
          await _mileSaveAddress('j-traced', 'to');
          for (let i = 0; i < 40 && document.querySelectorAll('#_mile-kind-ov .td-skel').length; i++) {
            await new Promise(r => setTimeout(r, 25));
          }
          const ov = document.getElementById('_mile-kind-ov');
          return { skel: ov.querySelectorAll('.td-skel').length, text: ov.textContent,
                   btns: [...ov.querySelectorAll('button')].map(b => b.textContent) };
        } finally { window._mileWhatIsHere = keep;
                    document.getElementById('_mile-kind-ov')?.remove(); }
      });
      expect(r.skel, 'nothing is still pretending to load').toBe(0);
      expect(r.btns[0], 'and with nothing known, neither answer leads').toBe('Lead or client');
      expect(r.text).toContain('A supply house is a place');
    });

    test('a name that says what it is is read as a supply house', async () => {
      const r = await page.evaluate(() => [
        _mileGuessKind('Ferguson Plumbing Supply'), _mileGuessKind('Westlake Ace Hardware'),
        _mileGuessKind('Capital City Lumber'), _mileGuessKind('Neenans Co'),
        _mileGuessKind(''), _mileGuessKind('Bill Lorson'),
      ]);
      expect(r).toEqual(['supply', 'supply', 'supply', '', 'client', '']);
    });

    test('a house leads with Lead or client, which is the old behaviour', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        // Bare assignment, not window.: _mapkitReady is a script-scope `let`
        // and window._mapkitReady = true sets a different variable (the same
        // note withMapKit carries below).
        const keepMk = _mapkitReady, keepG = window.mapkit;
        _mapkitReady = true;
        window.mapkit = {
          Coordinate: function (a, b) { this.latitude = a; this.longitude = b; },
          Geocoder: function () {
            this.reverseLookup = (c, cb) => cb(null, { results: [{
              fullThoroughfare: '1530 SW Arvonia Pl', locality: 'Topeka',
              administrativeAreaCode: 'KS', postCode: '66604' }] });
          },
        };
        window._geocodeAddress = async () => [];
        try {
          await _mileSaveAddress('j-traced', 'to');
          for (let i = 0; i < 40 && !_mileAddressPending.found; i++) await new Promise(r => setTimeout(r, 25));
          const ov = document.getElementById('_mile-kind-ov');
          return { first: ov.querySelector('button').textContent, supply: _mileAddressPending.found.supply };
        } finally { _mapkitReady = keepMk; window.mapkit = keepG;
                    document.getElementById('_mile-kind-ov')?.remove(); }
      });
      expect(r.supply, 'a street address with no business on it').toBe(false);
      expect(r.first).toBe('Lead or client');
    });

    // The guess only ORDERS the buttons. Picking the other one is one tap and
    // decides it, which is the whole reason this asks rather than assuming.
    test('Supply house opens the place form already set to supply', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        try {
          document.getElementById('cf-title').textContent = '';
          await _mileSaveAddress('j-traced', 'to');
          _mileAddressPending.found = { name: 'Neenans Co', supply: true, parts: {} };
          await _mileSaveKind('supply');
          return {
            kind: document.getElementById('place-kind').value,
            name: document.getElementById('place-name') ? document.getElementById('place-name').value : null,
            lead: document.getElementById('cf-title').textContent === 'New lead',
          };
        } finally { document.getElementById('place-modal')?.remove();
                    document.getElementById('_mile-kind-ov')?.remove(); }
      });
      expect(r.kind, 'his answer, not a default').toBe('supply');
      expect(r.lead, 'and no lead anywhere near it').toBe(false);
    });

    // Somewhere else still opens on the placeholder, because nobody picked a
    // type there. That is the 2026-08-31 rule and it is unchanged.
    test('Somewhere else still opens with no type pre-picked', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        try {
          await _mileSaveAddress('j-traced', 'to');
          await _mileSaveKind('place');
          return document.getElementById('place-kind').value;
        } finally { document.getElementById('place-modal')?.remove();
                    document.getElementById('_mile-kind-ov')?.remove(); }
      });
      expect(r).toBe('');
    });

    // ── The Time Log's button comes through the same door (owner 2026-09-09:
    // "wire the functions together with a split in between them ... one
    // update carries it to both locations") ────────────────────────────────
    test.describe('from the Time Log rail', () => {
      const seedVia = () => page.evaluate(() => {
        mileage.push({ id: 'j-chain', legKey: 'j-chain', gps: true, date: todayKey(),
          from_name: 'Shop', from: '1200 SW Oakley Ave', to_name: 'John Doe', to: '2950 SW McClure Rd',
          miles: 8.1, mins: 40, purpose: 'Client Consult', calc_method: 'derived-routed',
          startedIso: '2026-09-09T13:00:00.000Z', endedIso: '2026-09-09T13:40:00.000Z',
          fromCoord: { lat: 39.0456, lng: -95.7151 }, toCoord: { lat: 39.0123, lng: -95.7465 },
          viaStops: [{ lat: 39.06146, lng: -95.69681, at: '2026-09-09T13:10:00.000Z' },
                     { lat: 39.0700, lng: -95.6800, at: '2026-09-09T13:25:00.000Z' }] });
      });
      const save = (key) => page.evaluate(async (key) => {
        const keep = window._nominatimReverse;
        window._nominatimReverse = async () => null;
        try { return { ok: await _mileSaveStopAddress(key, todayKey()), pending: _mileAddressPending }; }
        finally { window._nominatimReverse = keep; closeClientForm && closeClientForm(); }
      }, key);

      test('the :sN on the rail row picks that stop off the leg', async () => {
        await seed(); await seedVia();
        const r = await save('j-chain:s1');
        expect(r.ok).toBe(true);
        expect(r.pending).toEqual(expect.objectContaining(
          { legKey: 'j-chain', which: 'to', lat: 39.07, lng: -95.68 }));
      });

      test('and the first stop is the first stop', async () => {
        await seed(); await seedVia();
        const r = await save('j-chain:s0');
        expect(r.pending).toEqual(expect.objectContaining({ lat: 39.06146, lng: -95.69681 }));
      });

      // A leg that reached a saved fence is NOT traced and carries no
      // viaCoord, which is exactly the row this needed viaStops for.
      test('a leg on the books still answers its stops', async () => {
        await seed(); await seedVia();
        const claimed = await page.evaluate(() => {
          const m = mileage.find(x => x.id === 'j-chain');
          return { addressUnknown: !!m.addressUnknown, viaCoord: m.viaCoord || null };
        });
        expect(claimed).toEqual({ addressUnknown: false, viaCoord: null });
        expect((await save('j-chain:s0')).ok).toBe(true);
      });

      test('a via row written before viaStops existed still answers its first stop', async () => {
        await seed();
        await page.evaluate(() => {
          mileage.push({ id: 'j-old', legKey: 'j-old', gps: true, date: todayKey(), from_name: 'Shop', to_name: 'Shop',
            miles: 4.7, addressUnknown: true, unsavedVia: true, calc_method: 'derived-traced',
            fromCoord: { lat: 39.0456, lng: -95.7151 }, toCoord: { lat: 39.0456, lng: -95.7151 },
            viaCoord: { lat: 39.061, lng: -95.697 } });
        });
        expect((await save('j-old:s0')).pending).toEqual(expect.objectContaining({ lat: 39.061, lng: -95.697 }));
        // ...and only the first: nothing invents a second stop it never saw.
        expect((await save('j-old:s1')).ok).toBe(false);
      });

      test('junk keys and legs that are not here do nothing at all', async () => {
        await seed(); await seedVia();
        for (const key of ['j-chain', 'j-chain:0', 'nope:s0', '', null, ':s0']) {
          expect((await save(key)).ok, String(key)).toBe(false);
        }
      });

      // ── THE COMMONEST STOP OF ALL, AND THE ONE IT COULD NOT PLACE ──────
      //
      // A drive that simply ENDED somewhere nobody saved. Its dwell row is
      // keyed 'd-' + the leg id (the identity rule, js/geo-derive.js), it is
      // on no viaStops because nothing was collapsed through it, and it
      // carries no ':sN'. So it matched neither arm and the rail's chip did
      // nothing at all when pressed, silently.
      //
      // Geometry is the owner's real 2026-09-19 (error_log 202-204, 207-209,
      // three dead taps in one minute): leg j-...mu8n60wd, shop to an unsaved
      // address, and the rail row keyed d-j-...mu8n60wd.
      test('a stop that is the leg\'s own destination resolves off toCoord', async () => {
        await seed();
        await page.evaluate(() => {
          mileage.push({ id: 'j-30a2b589-mu8n60wd', legKey: 'j-30a2b589-mu8n60wd', gps: true,
            date: todayKey(), from_name: 'TradeDesk shop', to_name: '', miles: 3.9, mins: 3,
            addressUnknown: true, unsavedTo: true, calc_method: 'derived-traced',
            fromCoord: { lat: 39.0307066, lng: -95.7112082 },
            toCoord: { lat: 39.0451214, lng: -95.7584343 } });
        });
        const r = await save('d-j-30a2b589-mu8n60wd');
        expect(r.ok, 'the button that was dead in his hand').toBe(true);
        expect(r.pending).toEqual(expect.objectContaining(
          { legKey: 'j-30a2b589-mu8n60wd', which: 'to', lat: 39.0451214, lng: -95.7584343 }));
      });

      // Both ends unsaved writes no mileage leg at all (rules 18 and 20), so
      // there is genuinely nothing holding a coordinate for that stop. It
      // must not throw, and the rail must not offer a chip for it.
      test('a stop with no leg behind it resolves to nothing, and says so', async () => {
        await seed();
        const r = await page.evaluate(() => ({
          coord: _mileStopCoord('d-j-30a2b589-mu8jn7va', todayKey()),
          saved: null,
        }));
        expect(r.coord).toBe(null);
        expect((await save('d-j-30a2b589-mu8jn7va')).ok).toBe(false);
      });

      // One resolver, so the chip and the handler can never disagree about
      // whether a stop can be placed.
      test('the resolver answers all three shapes and nothing else', async () => {
        await seed(); await seedVia();
        const r = await page.evaluate(() => {
          mileage.push({ id: 'j-dest', legKey: 'j-dest', gps: true, date: todayKey(),
            from_name: 'Shop', to_name: '', addressUnknown: true, unsavedTo: true,
            fromCoord: { lat: 39.04, lng: -95.71 }, toCoord: { lat: 39.09, lng: -95.61 } });
          const at = k => { const c = _mileStopCoord(k, todayKey()); return c ? [c.lat, c.lng] : null; };
          return { via: at('j-chain:s0'), dest: at('d-j-dest'), junk: at('d-nope'), none: at('x') };
        });
        expect(r.via).toEqual([39.06146, -95.69681]);
        expect(r.dest).toEqual([39.09, -95.61]);
        expect(r.junk).toBe(null);
        expect(r.none).toBe(null);
      });

      // ── THE KEY, NOT THE POSITION (owner 2026-09-14) ──────────────────
      // A stop row is now keyed by the drive that ended there, because that
      // is a fact off the tape and its position in a list is not: a leg drops
      // an interior segment too short to be a drive, and every stop after it
      // shifts. The leg says which stop is which by naming the key beside
      // the coordinate (viaStops[].key, js/geo-derive.js).
      test.describe('a stop keyed by its own drive', () => {
        const seedKeyed = () => page.evaluate(() => {
          mileage.push({ id: 'j-a', legKey: 'j-a', gps: true, date: todayKey(),
            from_name: 'Shop', to_name: 'John Doe', miles: 8.1, mins: 40,
            startedIso: '2026-09-09T13:00:00.000Z', endedIso: '2026-09-09T13:40:00.000Z',
            segKeys: ['j-a', 'j-b', 'j-c'],
            segEnds: [{ from: 'Shop', to: '' }, { from: '', to: '' }, { from: '', to: 'John Doe' }],
            viaStops: [{ lat: 39.06146, lng: -95.69681, at: '2026-09-09T13:10:00.000Z', key: 'd-j-a' },
                       { lat: 39.07, lng: -95.68, at: '2026-09-09T13:25:00.000Z', key: 'd-j-b' }] });
        });

        test('the rail row finds its own stop wherever it sits in the list', async () => {
          await seed(); await seedKeyed();
          expect((await save('d-j-b')).pending).toEqual(expect.objectContaining(
            { legKey: 'j-a', which: 'to', lat: 39.07, lng: -95.68, stopKey: 'd-j-b' }));
          expect((await save('d-j-a')).pending).toEqual(expect.objectContaining(
            { lat: 39.06146, lng: -95.69681, stopKey: 'd-j-a' }));
        });

        test('a key no leg claims answers nothing, and never the wrong stop', async () => {
          await seed(); await seedKeyed();
          for (const key of ['d-j-z', 'j-a', 'd-', '']) {
            expect((await save(key)).ok, String(key)).toBe(false);
          }
        });

        test('_mileLegSeg: a drive row names its leg and which segment it is', async () => {
          await seed(); await seedKeyed();
          const r = await page.evaluate(() => {
            const one = k => { const x = _mileLegSeg(k, todayKey()); return x ? [x.leg.id, x.ix, x.split] : null; };
            return { mid: one('j-b'), last: one('j-c'), first: one('j-a'), none: one('j-zz'), junk: one('') };
          });
          // The first segment's key IS the leg's, and it still says split, so
          // the rail reads segEnds[0] rather than the journey's two ends.
          expect(r.first).toEqual(['j-a', 0, true]);
          expect(r.mid).toEqual(['j-a', 1, true]);
          expect(r.last).toEqual(['j-a', 2, true]);
          expect([r.none, r.junk]).toEqual([null, null]);
        });

        test('_mileLegSeg: a leg that never split, and a day too old to re-derive', async () => {
          await seed();
          await page.evaluate(() => {
            mileage.push({ id: 'j-plain', legKey: 'j-plain', gps: true, date: todayKey(),
              from_name: 'Shop', to_name: 'John Doe', miles: 4, startedIso: '2026-09-09T15:00:00.000Z' });
            // Written under the old shape and past the seven days of tape, so
            // nothing will ever re-key it. It still has to draw.
            mileage.push({ id: 'j-old2', legKey: 'j-old2', gps: true, date: todayKey(),
              from_name: 'Shop', to_name: 'John Doe', miles: 6, startedIso: '2026-09-09T16:00:00.000Z',
              segEnds: [{ from: 'Shop', to: '' }, { from: '', to: 'John Doe' }] });
          });
          const r = await page.evaluate(() => {
            const one = k => { const x = _mileLegSeg(k, todayKey()); return x ? [x.leg.id, x.ix, x.split] : null; };
            return { plain: one('j-plain'), legacy: one('j-old2:1'), legacy0: one('j-old2:0') };
          });
          expect(r.plain, 'one segment, so no index and no split').toEqual(['j-plain', 0, false]);
          expect(r.legacy).toEqual(['j-old2', 1, true]);
          expect(r.legacy0).toEqual(['j-old2', 0, true]);
        });
      });

      test('both doors end in the same place: one pending target, one form', async () => {
        await seed(); await seedVia();
        const r = await page.evaluate(async () => {
          const keep = window._nominatimReverse;
          window._nominatimReverse = async () => null;
          const out = {};
          try {
            await _mileSaveAddress('j-traced', 'to');
            out.viaMileage = Object.assign({}, _mileAddressPending);
            out.formA = !!document.getElementById('cf-street');
            closeClientForm && closeClientForm();
            await _mileSaveStopAddress('j-chain:s0', todayKey());
            out.viaRail = Object.assign({}, _mileAddressPending);
            out.formB = !!document.getElementById('cf-street');
          } finally { window._nominatimReverse = keep; closeClientForm && closeClientForm(); }
          return out;
        });
        // OLD: the two doors handed over identical targets. NEW (2026-09-10):
        // the rail door adds the stop, because a rail row IS one stop of a leg
        // and the too-old-to-rebuild path has to name that row and no other.
        // It carries the row's own KEY rather than its position (2026-09-14):
        // a position is a count of the segments in front of it, which is the
        // deriver's own inference and moves when it revises one.
        // Everything else the two doors carry still has to match exactly, or
        // they have stopped being one behaviour.
        const shared = k => Object.keys(k).filter(x => x !== 'stopKey').sort();
        expect(shared(r.viaMileage)).toEqual(shared(r.viaRail));
        expect(r.viaMileage.stopKey, 'the mileage log names an END, so it names no stop').toBe(undefined);
        expect(r.viaRail.stopKey, 'the rail names the row that was pressed').toBe('j-chain:s0');
        expect([r.formA, r.formB], 'the same lead form opens either way').toEqual([true, true]);
      });
    });

    // ── Apple Maps answers first, and it answers in fields (owner
    // 2026-09-10: "rather than calling Apple Maps to fill the form fields
    // out") ────────────────────────────────────────────────────────────────
    test.describe('the reverse geocode behind it', () => {
      const withMapKit = (place) => page.evaluate(async (place) => {
        // _mapkitReady is a script-scope `let`, so window._mapkitReady = true
        // sets a different variable and the branch never runs. Bare
        // assignment is what reaches the real binding.
        const keepReady = _mapkitReady, keepKit = window.mapkit, keepNom = window._nominatimReverse;
        let nomCalled = false;
        window._nominatimReverse = async () => { nomCalled = true; return 'fallback st, Topeka, Kansas, 66604'; };
        _mapkitReady = true;
        window.mapkit = {
          Coordinate: function (lat, lng) { this.latitude = lat; this.longitude = lng; },
          Geocoder: function () { this.reverseLookup = (c, cb) => cb(place ? null : new Error('no'), place ? { results: [place] } : null); },
        };
        try { return { parts: await _reverseGeocode(39.0123, -95.7465), nomCalled }; }
        finally { _mapkitReady = keepReady; window.mapkit = keepKit; window._nominatimReverse = keepNom; }
      }, place);

      test('Apple gives the pieces already separated, and nothing else is asked', async () => {
        const r = await withMapKit({ fullThoroughfare: '1530 SW Arvonia Pl', locality: 'Topeka',
                                     administrativeAreaCode: 'KS', postCode: '66604' });
        // AMENDED 2026-09-16: `name` rides along now. Apple names the business
        // standing on a commercial pin and this function was discarding it,
        // which is the one fact that tells a supply counter from a house
        // (owner: "make it smart enough to know and ask is this a Supply House
        // or a Lead/Client"). A residential pin like this one has no name, and
        // an empty string is the honest answer for it.
        expect(r.parts).toEqual({ street: '1530 SW Arvonia Pl', city: 'Topeka', state: 'KS', zip: '66604',
                                  addr: '1530 SW Arvonia Pl, Topeka, KS 66604', name: '' });
        expect(r.nomCalled, 'no second lookup once Apple answered').toBe(false);
      });

      test('a house number and street arriving apart still make one street line', async () => {
        const r = await withMapKit({ subThoroughfare: '1530', thoroughfare: 'SW Arvonia Pl',
                                     locality: 'Topeka', administrativeAreaCode: 'KS', postCode: '66604' });
        expect(r.parts.street).toBe('1530 SW Arvonia Pl');
      });

      // A pin in the middle of a field has no street to give.
      test('an Apple answer with only a one-liner is read apart', async () => {
        const r = await withMapKit({ formattedAddress: '2100 SW Gage Blvd, Topeka, Kansas, 66604' });
        expect(r.parts).toEqual(expect.objectContaining({ street: '2100 SW Gage Blvd', city: 'Topeka', state: 'KS', zip: '66604' }));
      });

      test('Apple refusing falls through to the open one, still in fields', async () => {
        const r = await withMapKit(null);
        expect(r.nomCalled).toBe(true);
        expect(r.parts).toEqual(expect.objectContaining({ street: 'fallback st', city: 'Topeka', state: 'KS', zip: '66604' }));
      });

      test('no geocoder at all, and junk coordinates, answer empty rather than guessing', async () => {
        const r = await page.evaluate(async () => {
          const keep = window._nominatimReverse;
          window._nominatimReverse = async () => null;
          try {
            return { none: await _reverseGeocode(39.01, -95.74), nan: await _reverseGeocode('x', null),
                     undef: await _reverseGeocode() };
          } finally { window._nominatimReverse = keep; }
        });
        const empty = { street: '', city: '', state: '', zip: '', addr: '' };
        expect([r.none, r.nan, r.undef]).toEqual([empty, empty, empty]);
      });

      // The owner's actual bug, end to end: one tap, four boxes filled.
      test('Save this address fills all four boxes, not one long one', async () => {
        await seed();
        const r = await page.evaluate(async () => {
          const keep = window._nominatimReverse;
          window._nominatimReverse = async () => '1530 Southwest Arvonia Place, Topeka, Kansas, 66604';
          try {
            await _mileSaveAddress('j-traced', 'to');
            await _mileSaveKind('client');   // the chooser, answered (2026-09-16)
            _mileWhoNew();                   // and the who picker (2026-09-19)
            return ['cf-street', 'cf-city', 'cf-state', 'cf-zip'].map(id => document.getElementById(id).value);
          } finally { window._nominatimReverse = keep; closeClientForm && closeClientForm(); }
        });
        expect(r).toEqual(['1530 Southwest Arvonia Place', 'Topeka', 'KS', '66604']);
      });
    });

    test('with no reverse geocode the form still opens, empty, on the right day', async () => {
      await seed();
      const r = await page.evaluate(async () => {
        const keep = window._nominatimReverse;
        window._nominatimReverse = async () => null;
        try {
          const ok = await _mileSaveAddress('j-traced', 'to');
          await _mileSaveKind('client');
          _mileWhoNew();
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

    // ── The day too old to rebuild (owner 2026-09-10) ─────────────────────
    // "How long does the code save the address if it's an unsaved address?"
    // The coordinate is on the row forever; the REPLAY needs Apple's motion
    // tape and iOS keeps about seven days of it. Past that the deriver
    // correctly refuses to rebuild a day it cannot see, and the trip used to
    // sit on the log reading "Unsaved address" with its miles uncounted
    // however many times the lead was saved.
    test.describe('a trip older than the tape', () => {
      const stale = () => page.evaluate(() => { window._geoDeriveDayNow = async () => null; });

      test('names the end on the row that is already there, and the miles count', async () => {
        const day = await seed();
        await stale();
        const r = await page.evaluate(async (d) => {
          _mileAddressPending = { legKey: 'j-traced', day: d, which: 'to', lat: 39.035, lng: -95.7 };
          await _mileAddressSaved({ id: 9, name: 'Ace Hardware', addr: '2100 SW Gage Blvd' });
          const row = mileage.find(m => m.id === 'j-traced');
          return { to: row.to, toName: row.to_name, unsavedTo: !!row.unsavedTo,
                   unknown: !!row.addressUnknown, fixed: !!row.fixedAt,
                   addressed: addressedTrips(mileage).map(m => m.id),
                   miles: row.miles };
        }, day);
        expect(r.to, 'the end carries the address the person just saved').toBe('2100 SW Gage Blvd');
        expect(r.toName).toBe('Ace Hardware');
        expect([r.unsavedTo, r.unknown], 'and nothing is unsaved about it now').toEqual([false, false]);
        expect(r.fixed, 'stamped as a person\'s answer, not a derive').toBe(true);
        expect(r.addressed, 'so it counts, like any other trip').toContain('j-traced');
        expect(r.miles, 'the drive itself was never in question').toBe(6.2);
      });

      test('a leg with BOTH ends missing still counts nothing until both are named', async () => {
        const day = await seed();
        await stale();
        const r = await page.evaluate(async (d) => {
          const row = mileage.find(m => m.id === 'j-traced');
          row.unsavedFrom = true; row.from = ''; row.from_name = '';
          _mileAddressPending = { legKey: 'j-traced', day: d, which: 'to', lat: 39.035, lng: -95.7 };
          await _mileAddressSaved({ id: 9, name: 'Ace Hardware', addr: '2100 SW Gage Blvd' });
          const half = { unknown: !!row.addressUnknown, addressed: addressedTrips(mileage).map(m => m.id) };
          _mileAddressPending = { legKey: 'j-traced', day: d, which: 'from', lat: 39.012, lng: -95.74 };
          await _mileAddressSaved({ id: 10, name: 'John Doe', addr: '2950 SW McClure Rd' });
          return { half, from: row.from, unknown: !!row.addressUnknown,
                   addressed: addressedTrips(mileage).map(m => m.id) };
        }, day);
        expect(r.half.unknown, 'one end named is still a trip with a hole in it').toBe(true);
        expect(r.half.addressed).not.toContain('j-traced');
        expect(r.from).toBe('2950 SW McClure Rd');
        expect([r.unknown], 'both named, and only now is it whole').toEqual([false]);
        expect(r.addressed).toContain('j-traced');
      });

      // ── ONE PLACE, EVERY END OF IT (owner 2026-09-20) ──────────────────
      // "If I save an unsaved address the day rail and mileage SHALL populate
      // and update in real time."
      //
      // Naming a stop used to name the leg that ARRIVED and nothing else. The
      // live flow test caught it on a day that ran shop -> stop -> elsewhere:
      // the row above the stop took the name and the row below it still read
      // "Unsaved address ->", with its miles still uncountable because
      // addressUnknown never came off.
      test('naming a stop names BOTH the drive in and the drive out', async () => {
        const day = await seed();
        await stale();
        const r = await page.evaluate(async (d) => {
          const STOP = { lat: 39.0412, lng: -95.7333 };
          // In: shop -> the stop. Out: the stop -> somewhere else entirely.
          mileage.push({ id: 'j-in', legKey: 'j-in', gps: true, date: d,
            from_name: 'Shop', from: '1200 SW Oakley Ave', to: '', to_name: '',
            miles: 4.1, mins: 12, purpose: 'Business', calc_method: 'derived-traced',
            addressUnknown: true, unsavedTo: true, toCoord: STOP,
            fromCoord: { lat: 39.0456, lng: -95.7151 },
            startedIso: '2026-09-08T14:00:00.000Z', endedIso: '2026-09-08T14:12:00.000Z' });
          mileage.push({ id: 'j-out', legKey: 'j-out', gps: true, date: d,
            from: '', from_name: '', to_name: 'Menards', to: '5900 SW Huntoon St',
            miles: 3.3, mins: 10, purpose: 'Business', calc_method: 'derived-traced',
            addressUnknown: true, unsavedFrom: true, fromCoord: STOP,
            toCoord: { lat: 39.0352, lng: -95.7714 },
            startedIso: '2026-09-08T15:00:00.000Z', endedIso: '2026-09-08T15:10:00.000Z' });
          _mileAddressPending = { legKey: 'j-in', day: d, which: 'to',
                                  lat: STOP.lat, lng: STOP.lng, stopKey: 'd-j-in' };
          await _mileAddressSaved({ id: 12, name: 'Aldi GUYS', addr: '2950 SW McClure Rd' });
          const a = mileage.find(m => m.id === 'j-in'), b = mileage.find(m => m.id === 'j-out');
          return { inTo: a.to, inUnknown: !!a.addressUnknown,
                   outFrom: b.from, outName: b.from_name,
                   outUnsavedFrom: !!b.unsavedFrom, outUnknown: !!b.addressUnknown,
                   addressed: addressedTrips(mileage).map(m => m.id) };
        }, day);
        expect(r.inTo, 'the drive in takes the name, as it always did').toBe('2950 SW McClure Rd');
        expect(r.outFrom, 'and so does the drive out').toBe('2950 SW McClure Rd');
        expect(r.outName).toBe('Aldi GUYS');
        expect([r.outUnsavedFrom, r.outUnknown], 'nothing on it is nameless now').toEqual([false, false]);
        expect([r.inUnknown]).toEqual([false]);
        expect(r.addressed, 'both legs count, in the same breath')
          .toEqual(expect.arrayContaining(['j-in', 'j-out']));
      });

      test('a place somewhere else on the same day is left alone', async () => {
        const day = await seed();
        await stale();
        const r = await page.evaluate(async (d) => {
          mileage.push({ id: 'j-a', legKey: 'j-a', gps: true, date: d,
            from_name: 'Shop', from: '1200 SW Oakley Ave', to: '', to_name: '',
            miles: 4.1, mins: 12, purpose: 'Business', addressUnknown: true,
            unsavedTo: true, toCoord: { lat: 39.0412, lng: -95.7333 },
            startedIso: '2026-09-08T14:00:00.000Z', endedIso: '2026-09-08T14:12:00.000Z' });
          // Two miles away: a different stop, still nameless, and none of this
          // customer's business.
          mileage.push({ id: 'j-b', legKey: 'j-b', gps: true, date: d,
            from_name: 'Shop', from: '1200 SW Oakley Ave', to: '', to_name: '',
            miles: 2.2, mins: 8, purpose: 'Business', addressUnknown: true,
            unsavedTo: true, toCoord: { lat: 39.0712, lng: -95.7633 },
            startedIso: '2026-09-08T16:00:00.000Z', endedIso: '2026-09-08T16:08:00.000Z' });
          _mileAddressPending = { legKey: 'j-a', day: d, which: 'to',
                                  lat: 39.0412, lng: -95.7333, stopKey: 'd-j-a' };
          await _mileAddressSaved({ id: 13, name: 'Aldi GUYS', addr: '2950 SW McClure Rd' });
          const b = mileage.find(m => m.id === 'j-b');
          return { to: b.to, unsaved: !!b.unsavedTo, unknown: !!b.addressUnknown };
        }, day);
        expect(r.to, 'a different pin is a different place').toBe('');
        expect([r.unsaved, r.unknown], 'and is still waiting to be named').toEqual([true, true]);
      });

      test('a round trip names its STOP, never the two ends that were always the same fence', async () => {
        const day = await seed();
        await stale();
        const r = await page.evaluate(async (d) => {
          mileage.push({ id: 'j-loop', legKey: 'j-loop', gps: true, date: d,
            from_name: 'Shop', from: '1200 SW Oakley Ave', to_name: 'Shop', to: '1200 SW Oakley Ave',
            miles: 8.4, mins: 40, purpose: 'Business', calc_method: 'derived-traced',
            addressUnknown: true, unsavedVia: true, viaCoord: { lat: 39.02, lng: -95.72 },
            viaStops: [{ lat: 39.02, lng: -95.72, at: '2026-09-08T19:00:00.000Z' }],
            startedIso: '2026-09-08T18:40:00.000Z', endedIso: '2026-09-08T19:20:00.000Z' });
          _mileAddressPending = { legKey: 'j-loop', day: d, which: 'to', lat: 39.02, lng: -95.72, stopKey: 'j-loop:s0' };
          await _mileAddressSaved({ id: 11, name: 'Ace Hardware', addr: '2100 SW Gage Blvd' });
          const row = mileage.find(m => m.id === 'j-loop');
          return { from: row.from, to: row.to, via: row.via_addr, viaName: row.via_name,
                   unsavedVia: !!row.unsavedVia, unknown: !!row.addressUnknown,
                   addressed: addressedTrips(mileage).map(m => m.id) };
        }, day);
        expect([r.from, r.to], 'both ends are his own yard and stay his own yard')
          .toEqual(['1200 SW Oakley Ave', '1200 SW Oakley Ave']);
        expect(r.via, 'the place between them is what was missing').toBe('2100 SW Gage Blvd');
        expect(r.viaName).toBe('Ace Hardware');
        expect([r.unsavedVia, r.unknown]).toEqual([false, false]);
        expect(r.addressed).toContain('j-loop');
      });

      test('the rail row for that stop is named too, and only that one', async () => {
        const day = await seed();
        await stale();
        let r = await page.evaluate(async (d) => {
          const sent = [];
          window._supa = { from: (t) => ({ update: (u) => { const f = { _t: t, _u: u, _w: {} };
            f.eq = (k, v) => { f._w[k] = v; return f; };
            f.then = (res) => { sent.push({ table: f._t, update: f._u, where: f._w }); return res({ error: null }); };
            return f; } }) };
          window._supaUser = { id: 'emp-1' };
          _mileAddressPending = { legKey: 'j-traced', day: d, which: 'to', lat: 39.035, lng: -95.7, stopKey: 'j-traced:s2' };
          await _mileAddressSaved({ id: 9, name: 'Ace Hardware', addr: '2100 SW Gage Blvd' });
          return sent;
        }, day);
        // OLD, and right at the time: ONE write, to the stop row that was
        // pressed. NEW (owner 2026-09-20, "if I save an unsaved address the
        // day rail and mileage SHALL populate and update in real time"): the
        // rail draws a DRIVE from both its ends, so a stop named without its
        // drive left "Shop -> Unsaved address" sitting directly above a row
        // that had just been named. Every end standing at that pin is written,
        // which here is the stop itself and the leg that arrived at it.
        const stop = r.find(x => x.where.client_key === 'j-traced:s2');
        const leg = r.find(x => x.where.client_key === 'j-traced');
        expect(r.length, 'the stop, and the drive that reached it').toBe(2);
        expect(r.every(x => x.table === 'job_time_entries')).toBe(true);
        expect(!!leg, 'the drive row no longer says Unsaved address at that end').toBe(true);
        expect(leg.update.dest_place).toBe('Ace Hardware');
        expect(leg.update.source, 'a drive is still a drive; only its end was missing')
          .toBe(undefined);
        expect(!!stop, 'the row that was pressed, written back under its own key').toBe(true);
        r = [stop];
        expect(r[0].where.employee_user_id).toBe('emp-1');
        expect(r[0].update.dest_place, 'the client\'s name, the way a resolved dwell carries it')
          .toBe('Ace Hardware');
        expect(r[0].update.source, 'answered as work, so it leaves the unpaid bucket').toBe('client');
        // OLD, and it was right at the time: the stamp was the only thing that
        // kept this name through the next rebuild, because a rebuild re-keyed
        // the row and the sweep would otherwise have retired it.
        // NEW (owner 2026-09-14): the key is stable, so the row this names is
        // the row the deriver rewrites. A stamp would now do real harm, twice
        // over: geo_replace_day reads a stamped row's own span back over the
        // derive, freezing the guessed times forever, and the sweep cannot
        // retire a stamped row that DOES go stale. Saving an address creates a
        // client; it does not correct a row, and fixed_at means a person
        // corrected this row.
        expect(r[0].update.fixed_at, 'not a hand correction, so not stamped as one').toBe(undefined);
      });

      test('no stop was pressed, so no time row is touched', async () => {
        const day = await seed();
        await stale();
        const n = await page.evaluate(async (d) => {
          let calls = 0;
          window._supa = { from: () => { calls++; return { update: () => ({ eq: () => ({ eq: () => ({ then: (r) => r({ error: null }) }) }) }) }; } };
          window._supaUser = { id: 'emp-1' };
          _mileAddressPending = { legKey: 'j-traced', day: d, which: 'to', lat: 39.035, lng: -95.7 };
          await _mileAddressSaved({ id: 9, name: 'Ace Hardware', addr: '2100 SW Gage Blvd' });
          return calls;
        }, day);
        expect(n, 'a mileage-log Save names a leg end and nothing else').toBe(0);
      });

      test('a day that DID rebuild is left entirely alone', async () => {
        const day = await seed();
        const r = await page.evaluate(async (d) => {
          // The derive ran and resolved the end, which is what it does inside
          // the window. The row is already right; nothing here may touch it.
          window._geoDeriveDayNow = async () => {
            const row = mileage.find(m => m.id === 'j-traced');
            row.to = '1 Derived Way'; row.to_name = 'Derived'; row.unsavedTo = false;
            delete row.addressUnknown;
            return {};
          };
          _mileAddressPending = { legKey: 'j-traced', day: d, which: 'to', lat: 39.035, lng: -95.7 };
          await _mileAddressSaved({ id: 9, name: 'Ace Hardware', addr: '2100 SW Gage Blvd' });
          const row = mileage.find(m => m.id === 'j-traced');
          return { to: row.to, fixed: !!row.fixedAt };
        }, day);
        expect(r.to, 'the deriver had it, so the deriver keeps it').toBe('1 Derived Way');
        expect(r.fixed, 'and it is not marked as a hand fix, because it is not one').toBe(false);
      });

      // ── AND THE RAIL IS STILL TOLD (owner 2026-09-21) ──────────────────
      // "I just saved this top address as Logan Sample and guess what, it
      // didn't update."
      //
      // The test above is right that a day the deriver rebuilt keeps the
      // deriver's answer in the MILEAGE book. It was also read as meaning
      // nothing else happens, and that is what hid this: on his phone the
      // derive succeeds, names the leg, and the timesheet row keeps source
      // 'unsaved' and a null dest_place forever, because only the
      // could-not-rebuild branch ever spoke to the rail.
      //
      // A CI runner has no CoreMotion tape, so the derive always bails there
      // and the flow test always took the other branch. This one stubs the
      // branch his phone actually takes.
      test('a day that DID rebuild still tells the rail what the stop is', async () => {
        const day = await seed();
        const r = await page.evaluate(async (d) => {
          const sent = [];
          window._supa = { from: (t) => ({ update: (u) => { const f = { _t: t, _u: u, _w: {} };
            f.eq = (k, v) => { f._w[k] = v; return f; };
            f.then = (res) => { sent.push({ table: f._t, update: f._u, where: f._w }); return res({ error: null }); };
            return f; } }) };
          window._supaUser = { id: 'emp-1' };
          // The derive resolves the end, exactly as it does inside the tape's
          // window, and leaves nothing for the hand fix to do.
          window._geoDeriveDayNow = async () => {
            const row = mileage.find(m => m.id === 'j-traced');
            row.to = '1 Derived Way'; row.to_name = 'Derived'; row.unsavedTo = false;
            row.toCoord = { lat: 39.035, lng: -95.7 };
            delete row.addressUnknown;
            return {};
          };
          _mileAddressPending = { legKey: 'j-traced', day: d, which: 'to',
                                  lat: 39.035, lng: -95.7, stopKey: 'd-j-traced' };
          await _mileAddressSaved({ id: 14, name: 'Logan Sample', addr: '6800 SW Tenth Ave' });
          const row = mileage.find(m => m.id === 'j-traced');
          return { to: row.to, fixed: !!row.fixedAt, sent };
        }, day);
        expect(r.to, 'the deriver had it, so the deriver still keeps it').toBe('1 Derived Way');
        expect(r.fixed, 'and this is still not a hand fix').toBe(false);
        const stop = r.sent.find(x => x.where.client_key === 'd-j-traced');
        const leg = r.sent.find(x => x.where.client_key === 'j-traced');
        expect(!!stop, 'the rail row for the stop is named').toBe(true);
        expect(stop.update.dest_place).toBe('Logan Sample');
        expect(stop.update.source, 'so it leaves the unpaid bucket').toBe('client');
        expect(stop.update.fixed_at, 'never stamped, so a rebuild can still correct it').toBe(undefined);
        expect(!!leg, 'and so is the drive that reached it').toBe(true);
        expect(leg.update.dest_place).toBe('Logan Sample');
      });

      test('junk cannot name anything', async () => {
        const day = await seed();
        await stale();
        const r = await page.evaluate(async (d) => {
          const out = [];
          // A leg that is not there, an end that is not missing, a client with
          // no name and no address.
          _mileAddressPending = { legKey: 'nope', day: d, which: 'to', lat: 1, lng: 1 };
          out.push(await _mileAddressSaved({ id: 1, addr: 'x' }));
          _mileAddressPending = { legKey: 'j-real', day: d, which: 'to', lat: 1, lng: 1 };
          out.push(await _mileAddressSaved({ id: 1, addr: 'x' }));
          const real = mileage.find(m => m.id === 'j-real');
          return { out, realTo: real.to, realFixed: !!real.fixedAt };
        }, day);
        expect(r.realTo, 'a trip that was never missing an end is untouched').toBe('2950 SW McClure Rd');
        expect(r.realFixed).toBe(false);
      });
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

  // ── WHOSE ADDRESS IS THIS (owner 2026-09-19) ───────────────────────────
  // "add in a option for a picker on time sheet save address where we can pick
  // a client or add new, this feeds address to property card on lead client
  // record."
  //
  // Saving a stop always made a NEW customer, which is right the first time
  // somebody is quoted and wrong every time after: a second visit, a
  // landlord's second rental, a builder's next job site. Each one made a
  // duplicate record, and the fence landed on the duplicate instead of on the
  // person whose jobs and proposals rule 13 actually reads.
  test.describe('the who picker', () => {
    // The real path, because _mileAddressPending is module-scoped and a test
    // that sets window._mileAddressPending is poking a different variable
    // (found the hard way, 2026-09-19). Save the address, answer the kind
    // chooser, and the who picker is what opens.
    const arm = (o) => page.evaluate(async (o) => {
      window.clients = o.clients; window.jobs = []; window.bids = [];
      window._nominatimReverse = async () => '4310 SW Twilight Dr, Topeka, KS 66610';
      window._mileWhatIsHere = async () => (o.found || null);
      await _mileSaveAddressAt(39.0444, -95.7129, { day: '2026-09-18', legKey: 'j-p', which: 'to' });
      await new Promise(r => setTimeout(r, 40));   // the kind chooser's own lookup
      await _mileSaveKind('client');
      return !!document.getElementById('_mile-who-ov');
    }, o);
    const shot = () => page.evaluate(() => {
      const c = (window.clients || [])[0] || {};
      return { addr: c.addr || '', lat: c.lat, lon: c.lon, geoAddr: c.geoAddr || '',
        extras: (c.extraAddresses || []).map(a => [a.label, a.addr, a.lat, a.lon, a.geoAddr]) };
    });
    const ADDR = '4310 SW Twilight Dr, Topeka, KS 66610';

    test('it lists the customers he already has, with how many properties each', async () => {
      const open = await arm({ clients: [
        { id: 701, name: 'Neenan Builders', addr: '1 First St', extraAddresses: [{ label: 'Lot 2', addr: '2 Second St' }] },
        { id: 702, name: 'Jane Doe', addr: '' },
      ] });
      expect(open).toBe(true);
      const r = await page.evaluate(() => ({
        hits: document.getElementById('_mile-who-hits').textContent,
        all: document.getElementById('_mile-who-ov').textContent,
      }));
      expect(r.hits).toContain('Neenan Builders');
      expect(r.hits).toContain('2 properties');
      expect(r.hits).toContain('No address yet');
      // The pin he is filing says what it is, above the list.
      expect(r.all).toContain(ADDR);
      expect(r.all, 'and the other door is right there').toContain('Add a new customer');
    });

    // ── The real button, actually tapped ────────────────────────────────
    //
    // Owner report 2026-09-20, from the app itself: a red toast, "[:1]
    // SyntaxError: Unexpected token '}'", the picker stuck open. Every test
    // above this one calls _mileWhoPick() directly, which never asks the
    // browser to parse the onclick ATTRIBUTE the render actually wrote, so
    // none of them could have caught it. The bug: JSON.stringify(id) writes
    // literal " characters into an attribute that is itself double-quoted,
    // which truncates it, and WebKit only discovers the resulting syntax
    // error the first time the button is pressed. A click is the only way
    // to prove this stays fixed.
    test('the rendered button survives an actual tap, not just the function call', async () => {
      await arm({ clients: [{ id: 701, name: 'Neenan Builders', addr: '' }] });
      await page.locator('#_mile-who-hits button').first().click();
      await page.waitForTimeout(50);
      const r = await shot();
      expect(r.addr, 'the tap actually filed the address').toBe(ADDR);
      const pageErrors = (page._consoleErrors || []).filter(e => /SyntaxError|Unexpected token/.test(e));
      expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    });

    test('a customer with no address yet gets this one as their primary', async () => {
      await arm({ clients: [{ id: 702, name: 'Jane Doe', addr: '' }] });
      await page.evaluate(() => _mileWhoPick('702'));
      const r = await shot();
      expect([r.addr, r.geoAddr]).toEqual([ADDR, ADDR]);
      expect([r.lat, r.lon], 'the pin IS the coordinate, so no geocode is needed').toEqual([39.0444, -95.7129]);
      expect(r.extras, 'a record with one address has a primary, not a property card').toEqual([]);
    });

    test('a customer who already has one gets a property card beside it', async () => {
      await arm({ clients: [{ id: 701, name: 'Neenan Builders', addr: '1 First St', lat: 39.01, lon: -95.70, geoAddr: '1 First St' }],
        found: { name: 'Lot 14', parts: { street: '4310 SW Twilight Dr', city: 'Topeka', state: 'KS', zip: '66610' } } });
      await page.evaluate(() => _mileWhoPick('701'));
      const r = await shot();
      expect(r.addr, 'his primary is not touched').toBe('1 First St');
      // The map's name is the label, because that is the only thing anybody
      // has said about which property this is.
      expect(r.extras).toEqual([['Lot 14', ADDR, 39.0444, -95.7129, ADDR]]);
    });

    test('with no name from the map the card still says what it is', async () => {
      await arm({ clients: [{ id: 701, name: 'Neenan Builders', addr: '1 First St' }] });
      await page.evaluate(() => _mileWhoPick('701'));
      const r = await shot();
      expect(r.extras.map(a => a[0])).toEqual(['Additional property']);
    });

    test('filing the same pin twice is one property card, not two', async () => {
      await arm({ clients: [{ id: 701, name: 'Neenan Builders', addr: '1 First St' }] });
      await page.evaluate(() => _mileWhoPick('701'));
      const kept = await page.evaluate(() => window.clients);
      await arm({ clients: kept });
      await page.evaluate(() => _mileWhoPick('701'));
      const r = await shot();
      expect(r.extras.length).toBe(1);
    });

    test('the property it files is a fence the same moment, which is the whole point', async () => {
      await arm({ clients: [{ id: 701, name: 'Neenan Builders', addr: '1 First St', lat: 39.01, lon: -95.70, geoAddr: '1 First St' }] });
      await page.evaluate(() => _mileWhoPick('701'));
      const r = await page.evaluate(() => _geoDeriveFences('2026-09-18')
        .filter(f => f.kind === 'client').map(f => [f.id, f.addr, f.lat, f.lng]));
      expect(r).toEqual([
        ['client-701', '1 First St', 39.01, -95.70],
        ['client-701-p0', ADDR, 39.0444, -95.7129],
      ]);
    });

    test('a pin already filed is spent: the second tap writes nothing', async () => {
      await arm({ clients: [{ id: 701, name: 'Neenan Builders', addr: '1 First St' }] });
      const r = await page.evaluate(async () => {
        const a = await _mileWhoPick('701');
        const b = await _mileWhoPick('701');
        return { a, b, extras: window.clients[0].extraAddresses.length };
      });
      expect([r.a, r.b]).toEqual([true, false]);
      expect(r.extras).toBe(1);
    });

    test('a customer who is not there files nothing and never throws', async () => {
      await arm({ clients: [{ id: 701, name: 'Neenan Builders', addr: '1 First St' }] });
      const r = await page.evaluate(async () => {
        const out = [await _mileWhoPick('nope'), await _mileWhoPick(null), await _mileWhoPick(undefined)];
        return { out, extras: (window.clients[0].extraAddresses || []).length };
      });
      expect(r.out).toEqual([false, false, false]);
      expect(r.extras).toBe(0);
    });

    test('an address the reverse lookup could not name files nothing', async () => {
      const r = await page.evaluate(async () => {
        window.clients = [{ id: 701, name: 'Neenan Builders', addr: '1 First St' }];
        window._nominatimReverse = async () => null;
        window._mileWhatIsHere = async () => null;
        await _mileSaveAddressAt(39.04, -95.71, { day: '2026-09-18', legKey: 'j-p', which: 'to' });
        await new Promise(r2 => setTimeout(r2, 40));
        await _mileSaveKind('client');
        const ok = await _mileWhoPick('701');
        return { ok, extras: (window.clients[0].extraAddresses || []).length };
      });
      expect(r.ok, 'nothing to file, so nothing is filed').toBe(false);
      expect(r.extras).toBe(0);
    });
  });

  test('no console errors across traced trips', async () => {
    assertNoErrors(page, 'traced trips');
  });
});
