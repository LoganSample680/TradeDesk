// @ts-check
// ── Fleet persistence: td_vehicles (20260809) ────────────────────────────────
//
// Owner-reported bug this suite locks down: "Zach's vehicles don't save — when I
// sign in they go away, the mileage popup says two vehicles but Fleet says one,
// and his vehicle still isn't persisting its name or its current-year mileage."
//
// Root cause: the fleet lived inside the zj_data.settings blob (S.vehicles) with
// its odometer readings in a parallel name-keyed map (S.vehicleOdoLog). That blob
// is last-writer-wins by settingsTs, and supaSaveToCloud SKIPS the entire settings
// write when the cloud stamp is newer ('skip-settings'), so a truck added on one
// device silently never uploaded whenever any other session had touched settings
// since. Two further defects rode along: vehicleOdoLog had no keep-local rule in
// _mergeIncomingSettings at all, and readings were keyed by NAME so a rename
// orphaned them.
//
// The fix is architectural — one td_vehicles row per vehicle with its readings on
// the row — so these tests assert the ARCHITECTURE, not a patched symptom:
// registration in the sync fabric, odometer-on-the-record, rename-safety,
// delete-sweep registration, and an idempotent one-time lift of legacy data.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Fleet persistence: td_vehicles sync fabric', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  // Restore the fleet + the legacy blob keys around each test so one case can
  // never leak state into the next (these are real globals, not fixtures).
  const snapshot = () => page.evaluate(() => ({
    vehicles: JSON.parse(JSON.stringify(vehicles)),
    legacy: JSON.parse(JSON.stringify(S.vehicles || [])),
    legacyOdo: JSON.parse(JSON.stringify(S.vehicleOdoLog || {})),
    migTs: S.vehiclesMigratedTs || 0,
    vehTs: S.vehiclesTs || 0,
    veh: S.veh || '',
  }));
  const restore = (snap) => page.evaluate((s) => {
    vehicles.length = 0; s.vehicles.forEach(v => vehicles.push(v));
    S.vehicles = s.legacy; S.vehicleOdoLog = s.legacyOdo;
    S.vehiclesMigratedTs = s.migTs; S.vehiclesTs = s.vehTs; S.veh = s.veh;
  }, snap);

  // ── The fabric registration itself ────────────────────────────────────────
  // This is the whole fix in one assertion: a data store that is NOT in
  // _TD_TABLES has no per-row upload, no delta cursor, no realtime and no delete
  // sweep — which is exactly the state the fleet was in.
  test('td_vehicles is a registered synced table, wired to the live `vehicles` array', async () => {
    const r = await page.evaluate(() => {
      const def = (typeof _TD_TABLES !== 'undefined' ? _TD_TABLES : []).find(t => t.t === 'td_vehicles');
      if (!def) return { registered: false };
      const before = def.get();
      // The getter must hand back the SAME array identity the app mutates —
      // _userDelete's before/after diff and the delta hash both close over it.
      const sameIdentity = before === vehicles;
      // The setter must replace contents in place, not rebind, for the same reason.
      const probe = [{ id: 'probe-1', name: 'Probe Truck' }];
      def.set(probe);
      const setWorked = vehicles.length === 1 && String(vehicles[0].id) === 'probe-1';
      const stillSameIdentity = def.get() === vehicles;
      def.set(before.slice());
      return { registered: true, sameIdentity, setWorked, stillSameIdentity };
    });
    expect(r.registered, 'td_vehicles present in _TD_TABLES').toBe(true);
    expect(r.sameIdentity, 'getter returns the live vehicles array').toBe(true);
    expect(r.setWorked, 'setter replaces contents').toBe(true);
    expect(r.stillSameIdentity, 'setter mutates in place, never rebinds').toBe(true);
  });

  test('deletes on td_vehicles can sweep: the table is present in BOTH id maps', async () => {
    // _locallyDeletedIds is what authorizes the server-side soft delete;
    // _lastKnownIds is what stops a locally-deleted row resurrecting from a peer.
    // td_maintenance was missing from the latter for weeks — a silent resurrect
    // bug — so this asserts every registered table is covered, not just vehicles.
    const r = await page.evaluate(() => {
      const names = (typeof _TD_TABLES !== 'undefined' ? _TD_TABLES : []).map(t => t.t);
      return {
        names,
        missingDeleted: names.filter(t => !_locallyDeletedIds[t]),
        missingKnown: names.filter(t => !_lastKnownIds[t]),
      };
    });
    expect(r.names, 'td_vehicles registered').toContain('td_vehicles');
    expect(r.missingDeleted, 'every synced table can record a local delete').toEqual([]);
    expect(r.missingKnown, 'every synced table can block a resurrect').toEqual([]);
  });

  // ── Odometer readings live on the vehicle row ─────────────────────────────
  test('_setVehOdo writes onto the vehicle record, not a separate name-keyed map', async () => {
    const snap = await snapshot();
    const r = await page.evaluate(() => {
      _setVehicles([{ id: 'veh-odo-1', name: '2019 F-150' }]);
      const v = getVehicles()[0];
      _setVehOdo(v, 2026, { start: 48250, startDate: '2026-01-01' });
      const stored = getVehicles()[0];
      return {
        onRecord: (stored.odo && stored.odo['2026'] && stored.odo['2026'].start) || 0,
        readBack: _vehOdo(stored, 2026).start || 0,
        // The legacy global map must NOT be written any more; it is a read-only
        // migration source now. Writing both would reintroduce the split brain.
        legacyUntouched: !((S.vehicleOdoLog || {})['2026'] || {})['2019_f-150'],
      };
    });
    expect(r.onRecord, 'reading stored on the vehicle row').toBe(48250);
    expect(r.readBack, '_vehOdo reads it back').toBe(48250);
    expect(r.legacyUntouched, 'legacy name-keyed odo map is no longer written').toBe(true);
    await restore(snap);
  });

  test('_setVehOdo on a vehicle that is not in the fleet reports failure instead of silently dropping it', async () => {
    const snap = await snapshot();
    const r = await page.evaluate(() => {
      _setVehicles([{ id: 'veh-real-1', name: 'Real Truck' }]);
      const ghost = { id: 'veh-deleted-9', name: 'Deleted Truck' };
      const ret = _setVehOdo(ghost, 2026, { start: 123 });
      return {
        returnedNull: ret === null,           // signals "not persisted"
        ghostPatched: (ghost.odo || {})['2026'].start, // caller's object stays consistent
        fleetUntouched: getVehicles().length === 1 && getVehicles()[0].name === 'Real Truck',
        // The critical property: the real fleet was NOT rewritten without the ghost.
        realStillThere: !!getVehicles().find(v => String(v.id) === 'veh-real-1'),
      };
    });
    expect(r.returnedNull, 'a write that did not persist must not report success').toBe(true);
    expect(r.ghostPatched).toBe(123);
    expect(r.fleetUntouched).toBe(true);
    expect(r.realStillThere).toBe(true);
    await restore(snap);
  });

  test('_setVehOdo finds its row by id even when the caller holds a stale object reference', async () => {
    const snap = await snapshot();
    const r = await page.evaluate(() => {
      _setVehicles([{ id: 'veh-stale-1', name: 'Stale Ref Truck' }]);
      // Capture a reference the way the odometer modal does when it builds its
      // task list, then churn the array so every record is a fresh copy.
      const captured = getVehicles()[0];
      _setVehicles(getVehicles());
      _setVehicles(getVehicles());
      const detached = captured !== getVehicles()[0];
      _setVehOdo(captured, 2026, { start: 777 });
      return { detached, persisted: _vehOdo(getVehicles()[0], 2026).start || 0 };
    });
    expect(r.detached, 'the captured reference really is stale by now').toBe(true);
    expect(r.persisted, 'the reading still lands on the live row').toBe(777);
    await restore(snap);
  });

  test('_vehOdo is total: missing vehicle / year / odo map all return {} rather than throwing', async () => {
    const r = await page.evaluate(() => {
      const out = {};
      try { out.noVeh = JSON.stringify(_vehOdo(null, 2026)); } catch (e) { out.noVeh = 'THREW'; }
      try { out.noOdo = JSON.stringify(_vehOdo({ id: 'x', name: 'x' }, 2026)); } catch (e) { out.noOdo = 'THREW'; }
      try { out.noYear = JSON.stringify(_vehOdo({ id: 'x', odo: { 2025: { start: 1 } } }, 2026)); } catch (e) { out.noYear = 'THREW'; }
      try { out.undef = JSON.stringify(_vehOdo(undefined, undefined)); } catch (e) { out.undef = 'THREW'; }
      return out;
    });
    expect(r.noVeh).toBe('{}');
    expect(r.noOdo).toBe('{}');
    expect(r.noYear).toBe('{}');
    expect(r.undef).toBe('{}');
  });

  // THE rename bug: readings used to be keyed by a slug of the vehicle NAME, so
  // renaming a truck silently orphaned its own IRS odometer history and the app
  // re-prompted for it forever.
  test('renaming a vehicle keeps its odometer readings (they hang off the row id)', async () => {
    const snap = await snapshot();
    const r = await page.evaluate(() => {
      _setVehicles([{ id: 'veh-rename-1', name: '2019 F-150' }]);
      _setVehOdo(getVehicles()[0], 2026, { start: 10000, end: 22000 });
      // Rename exactly the way saveFleetVehicle does — same id, new name.
      const vehs = getVehicles();
      vehs[0] = { ...vehs[0], name: '2019 Ford F-150 XLT', nickname: 'Big Blue' };
      _setVehicles(vehs);
      const after = getVehicles()[0];
      return {
        name: after.name,
        start: _vehOdo(after, 2026).start || 0,
        end: _vehOdo(after, 2026).end || 0,
        id: String(after.id),
      };
    });
    expect(r.name).toBe('2019 Ford F-150 XLT');
    expect(r.id, 'row id survives the rename').toBe('veh-rename-1');
    expect(r.start, 'Jan 1 reading survives the rename').toBe(10000);
    expect(r.end, 'Dec 31 reading survives the rename').toBe(22000);
    await restore(snap);
  });

  test('_setVehicles mints a stable id for any record that arrives without one', async () => {
    const snap = await snapshot();
    const r = await page.evaluate(() => {
      _setVehicles([{ name: 'No Id Truck' }, 'Legacy String Van']);
      const vehs = getVehicles();
      return {
        count: vehs.length,
        allHaveIds: vehs.every(v => v.id !== undefined && v.id !== null && String(v.id) !== ''),
        uniqueIds: new Set(vehs.map(v => String(v.id))).size,
        // A bare string entry (the oldest legacy shape) becomes a real record.
        stringBecameObject: typeof vehs[1] === 'object' && vehs[1].name === 'Legacy String Van',
      };
    });
    expect(r.count).toBe(2);
    expect(r.allHaveIds, 'an id-less row could never sync and would duplicate every save').toBe(true);
    expect(r.uniqueIds).toBe(2);
    expect(r.stringBecameObject).toBe(true);
    await restore(snap);
  });

  // ── The one-time lift out of the settings blob ────────────────────────────
  test('migration lifts the legacy fleet AND folds its name-keyed odo readings onto each row', async () => {
    const snap = await snapshot();
    const r = await page.evaluate(() => {
      vehicles.length = 0;
      S.vehiclesMigratedTs = 0;
      S.vehicles = [{ name: '2019 F-150', nickname: 'Big Blue' }, { name: '2021 Transit' }];
      S.vehicleOdoLog = {
        2026: { '2019_f-150': { start: 48250, startDate: '2026-01-01' }, '2021_transit': { start: 900 } },
        2025: { '2019_f-150': { start: 30000, end: 48250 } },
      };
      const lifted = _migrateVehiclesFromSettings();
      const vehs = getVehicles();
      const f150 = vehs.find(v => v.name === '2019 F-150');
      const transit = vehs.find(v => v.name === '2021 Transit');
      return {
        lifted,
        count: vehs.length,
        f150_2026: _vehOdo(f150, 2026).start || 0,
        f150_2025end: _vehOdo(f150, 2025).end || 0,
        transit_2026: _vehOdo(transit, 2026).start || 0,
        nickname: f150.nickname,
        // Deterministic ids derived from the legacy slug: two devices running
        // this lift independently must converge, not double the fleet.
        f150Id: String(f150.id),
        // The legacy blob is deliberately LEFT INTACT as a read-only safety net.
        legacyStillThere: (S.vehicles || []).length === 2,
        // NOT marked done by the lift itself — only once the rows are durable.
        flagSet: !!S.vehiclesMigratedTs,
      };
    });
    expect(r.lifted).toBe(2);
    expect(r.count).toBe(2);
    expect(r.f150_2026, 'current-year reading followed its truck').toBe(48250);
    expect(r.f150_2025end, 'prior-year reading followed its truck').toBe(48250);
    expect(r.transit_2026).toBe(900);
    expect(r.nickname).toBe('Big Blue');
    expect(r.f150Id, 'id derived from the legacy slug, not Date.now()').toBe('v_2019_f-150');
    expect(r.legacyStillThere, 'legacy blob kept as a safety net if the lift ever fails').toBe(true);
    expect(r.flagSet, 'a lift is not marked done until its rows are durable').toBe(false);
    await restore(snap);
  });

  test('migration is idempotent: re-running it never duplicates the fleet', async () => {
    const snap = await snapshot();
    const r = await page.evaluate(() => {
      vehicles.length = 0;
      S.vehiclesMigratedTs = 0;
      S.vehicles = [{ name: '2019 F-150' }];
      S.vehicleOdoLog = {};
      const first = _migrateVehiclesFromSettings();
      // Prod marks the lift done only once the rows are durable; do the same here.
      _markVehiclesMigrated();
      const afterFirst = getVehicles().length;
      const second = _migrateVehiclesFromSettings();
      const afterSecond = getVehicles().length;
      // And the cross-device case: another device that already synced the rows
      // has a non-empty fleet but no local flag — it must still no-op.
      S.vehiclesMigratedTs = 0;
      const third = _migrateVehiclesFromSettings();
      return { first, afterFirst, second, afterSecond, third, afterThird: getVehicles().length };
    });
    expect(r.first).toBe(1);
    expect(r.afterFirst).toBe(1);
    expect(r.second, 'second run lifts nothing').toBe(0);
    expect(r.afterSecond).toBe(1);
    expect(r.third, 'a peer device with rows already synced also no-ops').toBe(0);
    expect(r.afterThird).toBe(1);
    await restore(snap);
  });

  // The regression that the migration flag exists to prevent: without it, an
  // owner who deliberately deletes every vehicle would have them resurrected
  // from the still-present legacy blob on the next boot — the old
  // "Zach's Ford keeps coming back" bug wearing a new costume.
  test('a deliberately emptied fleet is NOT resurrected from the legacy blob', async () => {
    const snap = await snapshot();
    const r = await page.evaluate(() => {
      vehicles.length = 0;
      S.vehiclesMigratedTs = 0;
      S.vehicles = [{ name: '2019 F-150' }];
      S.vehicleOdoLog = {};
      _migrateVehiclesFromSettings();       // lift it once
      _markVehiclesMigrated();               // ...and it lands durably
      _setVehicles([]);                      // owner deletes every vehicle
      const afterDelete = getVehicles().length;
      const lifted = _migrateVehiclesFromSettings(); // next boot re-runs the lift
      return { afterDelete, lifted, afterBoot: getVehicles().length };
    });
    expect(r.afterDelete).toBe(0);
    expect(r.lifted, 'the migrated flag stops a second lift').toBe(0);
    expect(r.afterBoot, 'deleted trucks stay deleted').toBe(0);
    await restore(snap);
  });

  test('migration also lifts the oldest single-vehicle field (S.veh) when no fleet was ever managed', async () => {
    const snap = await snapshot();
    const r = await page.evaluate(() => {
      vehicles.length = 0;
      S.vehiclesMigratedTs = 0; S.vehicles = []; S.vehiclesTs = 0; S.vehicleOdoLog = {};
      S.veh = '2015 Silverado';
      const lifted = _migrateVehiclesFromSettings();
      const vehs = getVehicles();
      return { lifted, count: vehs.length, name: vehs[0] && vehs[0].name, hasId: !!(vehs[0] && vehs[0].id) };
    });
    expect(r.lifted).toBe(1);
    expect(r.count).toBe(1);
    expect(r.name).toBe('2015 Silverado');
    expect(r.hasId).toBe(true);
    await restore(snap);
  });

  test('migration on an account with nothing to lift still marks itself done (never re-scans every boot)', async () => {
    const snap = await snapshot();
    const r = await page.evaluate(() => {
      vehicles.length = 0;
      S.vehiclesMigratedTs = 0; S.vehicles = []; S.veh = ''; S.vehiclesTs = 0;
      const lifted = _migrateVehiclesFromSettings();
      return { lifted, flagSet: !!S.vehiclesMigratedTs, count: getVehicles().length };
    });
    expect(r.lifted).toBe(0);
    expect(r.flagSet).toBe(true);
    expect(r.count).toBe(0);
    await restore(snap);
  });

  // ── Corrupted / hostile input (CLAUDE.md §11.1 input classes) ─────────────
  test('_setVehicles survives null, undefined, empty and non-array input', async () => {
    const snap = await snapshot();
    const r = await page.evaluate(() => {
      const out = {};
      try { _setVehicles(null); out.nullOk = getVehicles().length === 0; } catch (e) { out.nullOk = 'THREW'; }
      try { _setVehicles(undefined); out.undefOk = getVehicles().length === 0; } catch (e) { out.undefOk = 'THREW'; }
      try { _setVehicles([]); out.emptyOk = getVehicles().length === 0; } catch (e) { out.emptyOk = 'THREW'; }
      try { _setVehicles(); out.noArgOk = getVehicles().length === 0; } catch (e) { out.noArgOk = 'THREW'; }
      return out;
    });
    expect(r.nullOk).toBe(true);
    expect(r.undefOk).toBe(true);
    expect(r.emptyOk).toBe(true);
    expect(r.noArgOk).toBe(true);
    await restore(snap);
  });

  test('migration tolerates a corrupted legacy odo map without losing the vehicles', async () => {
    const snap = await snapshot();
    const r = await page.evaluate(() => {
      vehicles.length = 0;
      S.vehiclesMigratedTs = 0;
      S.vehicles = [{ name: '2019 F-150' }];
      S.vehicleOdoLog = { 2026: null, 2025: 'not-an-object' };
      let threw = false;
      let lifted = 0;
      try { lifted = _migrateVehiclesFromSettings(); } catch (e) { threw = true; }
      return { threw, lifted, count: getVehicles().length };
    });
    expect(r.threw, 'a junk odo map must not abort the fleet lift').toBe(false);
    expect(r.lifted).toBe(1);
    expect(r.count, 'the vehicle still migrates even when its readings are unreadable').toBe(1);
    await restore(snap);
  });

  // ── A rename must carry the vehicle's records with it ────────────────────
  // Service records and vehicle expenses link by `vehicleName`, trips by
  // `vehicle`, and nothing re-pointed them on rename. That orphaned the
  // vehicle's whole history — and because _vehSchedC conservatively EXCLUDES
  // any vehicle expense it cannot match to a bucket, the contractor's costs
  // silently stopped deducting on Schedule C after renaming a truck.
  test('renaming a vehicle re-links its service records, expenses and trips', async () => {
    const snap = await snapshot();
    const r = await page.evaluate(() => {
      const _m = maintenance.slice(), _e = expenses.slice(), _t = mileage.slice();
      const _origSave = window.saveAll, _origToast = window.showToast;
      window.saveAll = () => {}; window.showToast = () => {};
      try {
        _setVehicles([{ id: 'veh-relink-1', name: 'OLD TRUCK NAME', deductionMethod: 'actual', bizUse: 100 }]);
        maintenance.length = 0; expenses.length = 0; mileage.length = 0;
        const yr = String(new Date().getFullYear());
        maintenance.push({ id: 'm1', vehicleName: 'OLD TRUCK NAME', date: yr + '-03-01', cost: 250, type: 'oil_change' });
        expenses.push({ id: 'e1', vehicleName: 'OLD TRUCK NAME', date: yr + '-03-02', cat: 'fuel', amount: 400 });
        mileage.push({ id: 't1', vehicle: 'OLD TRUCK NAME', date: yr + '-03-03', miles: 120 });

        // Rename through the real modal path.
        _fleetEditIdx = 0;
        openAddVehicleModal(0);
        document.getElementById('fv-name').value = 'NEW TRUCK NAME';
        saveFleetVehicle();

        const v = getVehicles()[0];
        const sched = _vehSchedC(yr);
        const bucket = (sched.perVehicle || []).find(b => (b.name || b.v?.name) === 'NEW TRUCK NAME') || null;
        return {
          name: v.name,
          maintRelinked: maintenance[0].vehicleName,
          expRelinked: expenses[0].vehicleName,
          tripRelinked: mileage[0].vehicle,
          // The money assertions: the $400 fuel expense must still be attributed,
          // not dumped into "untagged" and dropped from the deduction.
          untagged: sched.untagged,
          untaggedTotal: sched.untaggedTotal,
          vehExpTotal: sched.vehExpTotal,
        };
      } finally {
        maintenance.length = 0; _m.forEach(x => maintenance.push(x));
        expenses.length = 0; _e.forEach(x => expenses.push(x));
        mileage.length = 0; _t.forEach(x => mileage.push(x));
        window.saveAll = _origSave; window.showToast = _origToast;
        document.getElementById('fleet-veh-overlay')?.remove();
      }
    });
    expect(r.name).toBe('NEW TRUCK NAME');
    expect(r.maintRelinked, 'service record follows the rename').toBe('NEW TRUCK NAME');
    expect(r.expRelinked, 'vehicle expense follows the rename').toBe('NEW TRUCK NAME');
    expect(r.tripRelinked, 'mileage trip follows the rename').toBe('NEW TRUCK NAME');
    expect(r.untagged, 'no expense is orphaned into untagged by a rename').toBe(0);
    expect(r.untaggedTotal, 'no dollars fall out of the deduction on rename').toBe(0);
    expect(r.vehExpTotal, 'the $400 fuel cost is still attributed to the vehicle').toBe(400);
    await restore(snap);
  });

  test('zero console errors across the vehicle sync suite', async () => {
    assertNoErrors(page, 'vehicle sync');
  });
});
