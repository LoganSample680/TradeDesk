// @ts-check
// ── TdScan: scan-to-estimate, the web half ───────────────────────────────────
// The native plugin returns raw RoomPlan JSON; everything tested here is the
// JS that turns it into money: parsing simd geometry into rooms, wall/floor
// footage for paint, the NEC 210.52 receptacle engine, trade-default lenses,
// the synced td_scans store, and the sell/unlock rule (signed + paid IN FULL,
// owner call 2026-08-09). The plugin itself only runs on a LiDAR iPhone, so
// these fabricate CapturedRoom JSON in exactly the shape RoomPlan encodes.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// A 12 ft x 10 ft room in meters (RoomPlan units), 8 ft ceilings, one 3 ft
// door on the south wall, one window on the north wall. Transforms are
// column-major flat 16-arrays: col0 = the wall's direction, col3 = center.
function fabricatedRoom() {
  const L = 3.6576, W = 3.048, H = 2.4384; // 12ft, 10ft, 8ft
  const wall = (id, dir, cx, cz, len) => ({
    identifier: id,
    category: { wall: {} },
    dimensions: [len, H, 0],
    transform: [dir[0], 0, dir[1], 0, 0, 1, 0, 0, -dir[1], 0, dir[0], 0, cx, H / 2, cz, 1],
  });
  return JSON.stringify({
    identifier: 'room-1', story: 0, version: 2,
    walls: [
      wall('w-n', [1, 0], 0, -W / 2, L),
      wall('w-s', [1, 0], 0, W / 2, L),
      wall('w-e', [0, 1], L / 2, 0, W),
      wall('w-w', [0, 1], -L / 2, 0, W),
    ],
    doors: [{
      identifier: 'd-1', parentIdentifier: 'w-s',
      category: { door: { isOpen: false } },
      dimensions: [0.9144, 2.0320, 0],
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.4, 1.0, W / 2, 1],
    }],
    windows: [{
      identifier: 'win-1', parentIdentifier: 'w-n',
      category: { window: {} },
      dimensions: [1.2192, 1.2192, 0],
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.6, 1.5, -W / 2, 1],
    }],
    openings: [],
    objects: [],
    floors: [{
      identifier: 'f-1', category: { floor: {} },
      dimensions: [L, 0, W],
      polygonCorners: [[-L / 2, 0, -W / 2], [L / 2, 0, -W / 2], [L / 2, 0, W / 2], [-L / 2, 0, W / 2]],
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    }],
  });
}

test.describe('TdScan web half', () => {
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

  test('parses RoomPlan JSON into honest footage: 120 sq ft floor, 44 ft of wall, 8 ft ceilings', async () => {
    const r = await page.evaluate((raw) => {
      const room = _scanParseRoom(raw, 'Kitchen');
      const paint = _scanPaintNumbers(room, false);
      const paintSub = _scanPaintNumbers(room, true);
      return {
        label: room.label,
        floorSqFt: Math.round(_scanSqFt(room.floorM2)),
        wallFt: paint.wallFt,
        wallSqFt: paint.wallSqFt,
        wallSqFtSub: paintSub.wallSqFt,
        ceilHt: paint.ceilHt,
        doors: room.doorN, windows: room.winN,
      };
    }, fabricatedRoom());
    expect(r.label).toBe('Kitchen');
    expect(r.floorSqFt).toBe(120);
    expect(r.wallFt).toBe(44);
    expect(r.wallSqFt).toBe(352);          // 44 ft perimeter x 8 ft
    expect(r.wallSqFtSub).toBeLessThan(r.wallSqFt);  // openings really subtract
    expect(r.ceilHt).toBe("8'0\"");
    expect(r.doors).toBe(1);
    expect(r.windows).toBe(1);
  });

  test('NEC engine: 6-foot rule placement, walls under 2 ft skipped, doorways break the run', async () => {
    const r = await page.evaluate((raw) => {
      const room = _scanParseRoom(raw, 'Bedroom');
      const plan = _scanOutletPlan(room);
      const el = _scanElectricalNumbers(room);
      // A bare 20 ft wall must get 2 receptacles (ceil(20/12)); 18 in of wall
      // gets none (under the 2 ft minimum).
      const wall20 = { walls: [{ id: 'a', ax: 0, az: 0, bx: 6.096, bz: 0, len: 6.096, h: 2.4, doors: [], windows: [] }] };
      const wall18in = { walls: [{ id: 'b', ax: 0, az: 0, bx: 0.4572, bz: 0, len: 0.4572, h: 2.4, doors: [], windows: [] }] };
      return {
        marks: plan.length,
        southSplit: plan.filter(m => m.wallId === 'w-s').length,
        n20: _scanOutletPlan(wall20).length,
        n18in: _scanOutletPlan(wall18in).length,
        gfciBedroom: el.gfci,
      };
    }, fabricatedRoom());
    // North 12ft: 1. South 12ft split by the door into ~5.8ft + ~3.2ft: 1 each.
    // East + West 10ft: 1 each. Total 5, and never fewer than code needs.
    expect(r.marks).toBe(5);
    expect(r.southSplit, 'the doorway splits the south wall into two spaces').toBe(2);
    expect(r.n20).toBe(2);
    expect(r.n18in, 'wall spaces under 2 ft carry no requirement').toBe(0);
    expect(r.gfciBedroom, 'a bedroom is not a GFCI room').toBe(false);
    const gk = await page.evaluate((raw) => _scanElectricalNumbers(_scanParseRoom(raw, 'Kitchen')).gfci, fabricatedRoom());
    expect(gk, 'a kitchen is').toBe(true);
  });

  test('the scan opens in the lens matching the business trade', async () => {
    const r = await page.evaluate(() => {
      const was = S.trade;
      const out = {};
      S.trade = 'Painting';   out.paint = _scanDefaultLens();
      S.trade = 'Electrical'; out.elec = _scanDefaultLens();
      S.trade = 'HVAC';       out.hvac = _scanDefaultLens();
      S.trade = 'Plumbing';   out.plumb = _scanDefaultLens();
      S.trade = was;
      return out;
    });
    expect(r.paint).toBe('paint');
    expect(r.elec).toBe('electrical');
    expect(r.hvac).toBe('hvac');
    expect(r.plumb).toBe('plan');
  });

  test('td_scans rides the sync fabric and the store round-trips', async () => {
    const r = await page.evaluate((raw) => {
      const inTables = _TD_TABLES.some(t => t.t === 'td_scans');
      const before = getScans().length;
      const sc = saveScan({ id: 'scan-test-1', clientId: 77, rooms: [_scanParseRoom(raw, 'Office')], name: 'Test scan' });
      const after = getScans().length;
      const found = getScans().find(s => s.id === 'scan-test-1');
      deleteScan('scan-test-1');
      return { inTables, grew: after === before + 1, foundName: found && found.name, gone: !getScans().some(s => s.id === 'scan-test-1'), savedId: sc.id };
    }, fabricatedRoom());
    expect(r.inTables, 'td_scans is registered in _TD_TABLES (§7.3)').toBe(true);
    expect(r.grew).toBe(true);
    expect(r.foundName).toBe('Test scan');
    expect(r.gone).toBe(true);
  });

  test('unlock rule: purchased unlocks; a booked job unlocks only signed AND paid in full', async () => {
    const r = await page.evaluate(() => {
      const savedBids = bids.slice();
      try {
        bids.length = 0;
        bids.push({ id: 'b-1', client_id: 501, status: 'Closed Won', amount: 5000, signedAt: '2026-08-01' });
        window._scanTestPaid = 0;
        const realPaid = window.getBidPaid;
        window.getBidPaid = () => window._scanTestPaid;
        const sc = { id: 's1', clientId: 501, purchasedAt: null };
        const locked = scanUnlocked(sc);                      // signed, $0 paid
        window._scanTestPaid = 2500;
        const deposit = scanUnlocked(sc);                     // deposit is NOT enough
        window._scanTestPaid = 5000;
        const paidFull = scanUnlocked(sc);                    // 100% paid unlocks
        const purchased = scanUnlocked({ id: 's2', clientId: 999, purchasedAt: '2026-08-09' });
        window.getBidPaid = realPaid;
        return { locked, deposit, paidFull, purchased };
      } finally { bids.length = 0; savedBids.forEach(b => bids.push(b)); delete window._scanTestPaid; }
    });
    expect(r.locked).toBe(false);
    expect(r.deposit, 'a deposit must NOT unlock the plan, the whole bill does').toBe(false);
    expect(r.paidFull).toBe(true);
    expect(r.purchased, 'a standalone purchase unlocks regardless of any job').toBe(true);
  });

  test('the plan SVG renders rooms, labels, and electrical markers', async () => {
    const r = await page.evaluate((raw) => {
      const sc = { id: 'svg-1', rooms: [_scanParseRoom(raw, 'Kitchen')] };
      const plain = _scanPlanSvg(sc, { lens: 'plan' });
      const elec = _scanPlanSvg(sc, { lens: 'electrical' });
      return {
        hasPolygon: /<polygon/.test(plain),
        hasLabel: /Kitchen/.test(plain),
        hasSqFt: /120 sq ft/.test(plain),
        plainCircles: (plain.match(/<circle/g) || []).length,
        elecCircles: (elec.match(/<circle/g) || []).length,
      };
    }, fabricatedRoom());
    expect(r.hasPolygon).toBe(true);
    expect(r.hasLabel).toBe(true);
    expect(r.hasSqFt).toBe(true);
    expect(r.plainCircles, 'no outlet markers outside the electrical lens').toBe(0);
    expect(r.elecCircles).toBe(5);
  });

  test('in a plain browser the capture path is inert and honest', async () => {
    const r = await page.evaluate(async () => {
      const plugin = _scanPlugin();
      const supported = await scanIsSupported();
      const started = await startRoomScan({ clientId: 1 });
      return { plugin, supported, started };
    });
    expect(r.plugin).toBe(null);
    expect(r.supported).toBe(false);
    expect(r.started).toBe(null);
  });

  test('hub snapshot gate: a locked scan ships NO geometry, an unlocked one ships the plan', async () => {
    const r = await page.evaluate((raw) => {
      const savedBids = bids.slice(), savedClients = clients.slice();
      try {
        clients.length = 0; clients.push({ id: 601, name: 'Hub Client', clientToken: 'tok601' });
        bids.length = 0;
        saveScan({ id: 'scan-hub-1', clientId: 601, rooms: [_scanParseRoom(raw, 'Kitchen')], name: 'Main floor', price: 99, purchasedAt: null });
        const lockedSnap = _buildClientHubSnapshot(601);
        const locked = (lockedSnap.scans || [])[0];
        const sc = getScans().find(s => s.id === 'scan-hub-1');
        sc.purchasedAt = '2026-08-09'; saveScan(sc);
        const openSnap = _buildClientHubSnapshot(601);
        const open = (openSnap.scans || [])[0];
        deleteScan('scan-hub-1');
        return {
          lockedHasSvg: 'svg' in (locked || {}), lockedHasRooms: 'rooms' in (locked || {}),
          lockedUnlocked: locked && locked.unlocked, lockedTeaserSqFt: locked && locked.totalSqFt,
          lockedPrice: locked && locked.price,
          openHasSvg: !!(open && open.svg && /<polygon/.test(open.svg)),
          openSqFt: open && open.totalSqFt, openRooms: open && open.rooms && open.rooms.length,
        };
      } finally {
        bids.length = 0; savedBids.forEach(b => bids.push(b));
        clients.length = 0; savedClients.forEach(c => clients.push(c));
      }
    }, fabricatedRoom());
    expect(r.lockedHasSvg, 'locked scans must never ship the drawing').toBe(false);
    expect(r.lockedHasRooms, 'locked scans must never ship room detail').toBe(false);
    expect(r.lockedUnlocked).toBe(false);
    expect(r.lockedTeaserSqFt % 50, 'teaser square footage is rounded, not exact').toBe(0);
    expect(r.lockedPrice).toBe(99);
    expect(r.openHasSvg, 'a purchased scan ships the real plan').toBe(true);
    expect(r.openSqFt).toBe(120);
    expect(r.openRooms).toBe(1);
  });

  test('no console errors across the scan suite', async () => { await assertNoErrors(page); });
});

test.describe('client hub: floor plan cards', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/client.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(600);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('locked card: decoy blur, lock, price, and zero real geometry; unlocked card: the plan and room rows', async () => {
    const r = await page.evaluate(() => {
      const locked = _hubScanCards([{ id: 's1', name: 'Main floor', roomCount: 3, totalSqFt: 450, price: 99, unlocked: false }]);
      const open = _hubScanCards([{ id: 's2', name: 'Main floor', roomCount: 1, totalSqFt: 120, unlocked: true,
        svg: '<svg viewBox="0 0 100 50"><polygon points="1,1 99,1 99,49 1,49"/></svg>',
        rooms: [{ label: 'Kitchen', sqFt: 120, ceilHt: "8'0\"" }] }]);
      return {
        lockedHasLock: /Unlock your floor plan/.test(locked),
        lockedHasPrice: /\$99/.test(locked),
        lockedBlurred: /blur\(/.test(locked),
        lockedNoPolygonData: !/points="1,1 99,1/.test(locked),
        openHasSvg: /<polygon points="1,1 99,1/.test(open),
        openHasRoom: /Kitchen/.test(open) && /120 sq ft/.test(open),
        openNoLock: !/Unlock your floor plan/.test(open),
      };
    });
    expect(r.lockedHasLock).toBe(true);
    expect(r.lockedHasPrice).toBe(true);
    expect(r.lockedBlurred).toBe(true);
    expect(r.lockedNoPolygonData, 'the locked card contains only the decoy, never real data').toBe(true);
    expect(r.openHasSvg).toBe(true);
    expect(r.openHasRoom).toBe(true);
    expect(r.openNoLock).toBe(true);
  });
});
