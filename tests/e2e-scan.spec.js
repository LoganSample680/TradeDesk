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
        hasSqFt: /352 wall sq ft/.test(plain),
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

  // Build #12 batch: the capture screen's Floor chip stamps each room with the
  // floor the user SAID they were on, and the plugin exports a parametric USDZ
  // for the Quick Look 3D/AR walkaround. The web half must carry both.
  test('stories and the USDZ path ride the capture result into the saved scan', async () => {
    const r = await page.evaluate(async (raw) => {
      const realCap = window.Capacitor;
      const before = scans.length;
      try {
        localStorage.setItem('td_scan_preflight', '1');
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: (n) => n === 'TdScan' ? {
            isSupported: () => Promise.resolve({ supported: true }),
            startScan: () => Promise.resolve({
              rooms: [raw, raw], labels: ['Kitchen', 'Bedroom'], stories: [1, 2],
              photos: [], headingDeg: 90, usdz: '/docs/td_scan_1.usdz',
            }),
          } : null,
        };
        const sc = await startRoomScan({ clientId: 42 });
        const out = {
          saved: !!sc,
          story1: sc && sc.rooms[0].story, story2: sc && sc.rooms[1].story,
          usdz: sc && sc.usdz,
          stories: sc ? _scanStories(sc) : null,
        };
        scans.length = before; saveAll();
        return out;
      } finally { window.Capacitor = realCap; }
    }, fabricatedRoom());
    expect(r.saved).toBe(true);
    expect(r.story1, 'first room stamped with its floor').toBe(1);
    expect(r.story2, 'second room stamped with its floor').toBe(2);
    expect(r.usdz).toBe('/docs/td_scan_1.usdz');
    expect(r.stories).toEqual([1, 2]);
  });

  test('the pre-flight checklist gates the first capture only, and cancelling it never starts the scan', async () => {
    const r = await page.evaluate(async (raw) => {
      const realCap = window.Capacitor;
      const before = scans.length;
      let scanCalls = 0;
      try {
        localStorage.removeItem('td_scan_preflight');
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: (n) => n === 'TdScan' ? {
            startScan: () => { scanCalls++; return Promise.resolve({ rooms: [raw], labels: ['Room'], stories: [1], photos: [], headingDeg: -1 }); },
          } : null,
        };
        // First capture: the checklist appears and the plugin must NOT have
        // been called yet.
        const p1 = startRoomScan({ clientId: 42 });
        await new Promise(r2 => setTimeout(r2, 30));
        const modalShown = !!document.getElementById('_scan-pre-ov');
        const heldBeforeGo = scanCalls === 0;
        document.getElementById('_scan-pre-go')?.click();
        const sc1 = await p1;
        // Second capture: seen once, never again.
        const p2 = startRoomScan({ clientId: 42 });
        await new Promise(r2 => setTimeout(r2, 30));
        const modalAgain = !!document.getElementById('_scan-pre-ov');
        const sc2 = await p2;
        scans.length = before; saveAll();
        return { modalShown, heldBeforeGo, started1: !!sc1, modalAgain, started2: !!sc2, scanCalls };
      } finally {
        window.Capacitor = realCap;
        document.getElementById('_scan-pre-ov')?.remove();
        localStorage.setItem('td_scan_preflight', '1');
      }
    }, fabricatedRoom());
    expect(r.modalShown, 'first scan opens the checklist').toBe(true);
    expect(r.heldBeforeGo, 'the plugin waits for Got it').toBe(true);
    expect(r.started1).toBe(true);
    expect(r.modalAgain, 'seen once, never nags again').toBe(false);
    expect(r.started2).toBe(true);
    expect(r.scanCalls).toBe(2);
  });

  test('a multi-floor scan gets Floor tabs and draws one floor at a time; single-floor scans get none', async () => {
    const r = await page.evaluate((raw) => {
      const before = scans.length;
      try {
        const r1 = _scanParseRoom(raw, 'Kitchen'); r1.story = 1;
        const r2 = _scanParseRoom(raw, 'Bedroom'); r2.story = 2;
        const sc = saveScan({ id: 'sc-floors', clientId: null, name: 'Two story', createdAt: new Date().toISOString(), rooms: [r1, r2], photos: [], price: null, purchasedAt: null });
        _scanViewStory = null; _scanViewLens = 'plan';
        openScanViewer(sc.id);
        let ov = document.getElementById('_scan-view-ov');
        const html1 = ov ? ov.innerHTML : '';
        const floor1Only = /Kitchen/.test(html1) && !/Bedroom/.test(html1);
        _scanSetStory(sc.id, 2);
        ov = document.getElementById('_scan-view-ov');
        const html2 = ov ? ov.innerHTML : '';
        const floor2Only = /Bedroom/.test(html2) && !/Kitchen/.test(html2);
        document.getElementById('_scan-view-ov')?.remove();
        // Single-floor control: no Floor tabs at all.
        const single = saveScan({ id: 'sc-flat', clientId: null, name: 'Flat', createdAt: new Date().toISOString(), rooms: [_scanParseRoom(raw, 'Studio')], photos: [], price: null, purchasedAt: null });
        _scanViewStory = null;
        openScanViewer(single.id);
        const html3 = document.getElementById('_scan-view-ov')?.innerHTML || '';
        const noTabs = !/>Floor 1</.test(html3);
        document.getElementById('_scan-view-ov')?.remove();
        return { hasTabs: />Floor 1</.test(html1) && />Floor 2</.test(html1), floor1Only, floor2Only, noTabs };
      } finally { scans.length = before; saveAll(); _scanViewStory = null; }
    }, fabricatedRoom());
    expect(r.hasTabs, 'two stories, two tabs').toBe(true);
    expect(r.floor1Only, 'floor 1 draws only floor 1').toBe(true);
    expect(r.floor2Only, 'floor 2 draws only floor 2').toBe(true);
    expect(r.noTabs, 'a flat scan shows no floor tabs').toBe(true);
  });

  test('the 3D viewer hands the USDZ to the plugin in the shell and stays inert in a browser', async () => {
    const r = await page.evaluate((raw) => {
      const realCap = window.Capacitor;
      const before = scans.length;
      const viewed = [];
      try {
        const sc = saveScan({ id: 'sc-usdz', clientId: null, name: 'AR', createdAt: new Date().toISOString(), rooms: [_scanParseRoom(raw, 'Room')], photos: [], usdz: '/docs/model.usdz', price: null, purchasedAt: null });
        // Browser: no plugin, no throw, no call.
        window.Capacitor = undefined;
        let browserOk = true;
        try { _scanViewUsdz(sc.id); } catch (e) { browserOk = false; }
        // Shell: the path goes straight to Quick Look.
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: (n) => n === 'TdScan' ? { viewUsdz: (o) => { viewed.push(o.path); return Promise.resolve(); } } : null,
        };
        _scanViewUsdz(sc.id);
        return { browserOk, viewed };
      } finally { window.Capacitor = realCap; scans.length = before; saveAll(); }
    }, fabricatedRoom());
    expect(r.browserOk).toBe(true);
    expect(r.viewed).toEqual(['/docs/model.usdz']);
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

  test('scanned rooms auto-line the next estimate for that client, and only that client', async () => {
    const r = await page.evaluate((raw) => {
      const savedClients = clients.slice();
      try {
        clients.length = 0;
        clients.push({ id: 701, name: 'Seed Client' }, { id: 702, name: 'Other Client' });
        const room = _scanParseRoom(raw, 'Kitchen');
        const n = _scanPaintNumbers(room, false);
        window._scanEstimateSeed = { scanId: 'sx', clientId: 701,
          rooms: [{ name: 'Kitchen', wallSqFt: n.wallSqFt, ceilSqFt: n.ceilSqFt, ceilHt: n.ceilHt, doors: 1, windows: 1 }] };
        // Wrong client first: the seed must survive untouched.
        openGenericEstimate(clients[1]);
        const wrongLines = _geiLines.length;
        const seedSurvived = !!window._scanEstimateSeed;
        // Right client: consumed into lines.
        openGenericEstimate(clients[0]);
        const line = _geiLines[0];
        const consumed = !window._scanEstimateSeed;
        return { wrongLines, seedSurvived, lines: _geiLines.length, consumed,
                 desc: line && line.desc, qty: line && line.qty, unit: line && line.unit };
      } finally {
        clients.length = 0; savedClients.forEach(c => clients.push(c));
        window._scanEstimateSeed = null; _geiLines = [];
        goPg('pg-dash');
      }
    }, fabricatedRoom());
    expect(r.wrongLines, 'another client never inherits scanned rooms').toBe(0);
    expect(r.seedSurvived).toBe(true);
    expect(r.lines).toBe(1);
    expect(r.consumed, 'the seed is consumed exactly once').toBe(true);
    expect(r.desc).toContain('Kitchen');
    expect(r.desc).toContain('352 wall sq ft');
    expect(r.qty).toBe(352);
    expect(r.unit).toBe('sq ft');
  });

  test('the scan rate auto-prices rooms: 352 sq ft at $2.50 bills $880 the moment they load', async () => {
    const r = await page.evaluate((raw) => {
      const savedClients = clients.slice(), savedRate = S.scanRateSqFt;
      try {
        clients.length = 0; clients.push({ id: 711, name: 'Rate Client' });
        const room = _scanParseRoom(raw, 'Kitchen');
        const n = _scanPaintNumbers(room, false);
        S.scanRateSqFt = 2.5;
        window._scanEstimateSeed = { scanId: 'sr', clientId: 711,
          rooms: [{ name: 'Kitchen', wallSqFt: n.wallSqFt, ceilHt: n.ceilHt, doors: 0, windows: 0 }] };
        openGenericEstimate(clients[0]);
        const priced = { rate: _geiLines[0].rate, total: _geiLines[0].total };
        // No rate set: quantity measured, price left to the contractor.
        S.scanRateSqFt = 0;
        window._scanEstimateSeed = { scanId: 'sr2', clientId: 711,
          rooms: [{ name: 'Kitchen', wallSqFt: n.wallSqFt, ceilHt: n.ceilHt, doors: 0, windows: 0 }] };
        openGenericEstimate(clients[0]);
        const unpriced = { rate: _geiLines[0].rate, total: _geiLines[0].total };
        return { priced, unpriced };
      } finally {
        clients.length = 0; savedClients.forEach(c => clients.push(c));
        S.scanRateSqFt = savedRate; window._scanEstimateSeed = null; _geiLines = [];
        goPg('pg-dash');
      }
    }, fabricatedRoom());
    expect(r.priced.rate).toBe(2.5);
    expect(r.priced.total).toBe(880);
    expect(r.unpriced.rate, 'no rate set leaves pricing to the contractor').toBe(0);
    expect(r.unpriced.total).toBe(0);
  });

  test('photo pins land on the plan where the camera stood, and the walkthrough steps through them', async () => {
    const r = await page.evaluate((raw) => {
      try {
        const cam = (x, z) => { const m = new Array(16).fill(0); m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1; m[12] = x; m[14] = z; return m; };
        saveScan({ id: 'scan-photo-1', clientId: null, name: 'Photo scan',
          rooms: [_scanParseRoom(raw, 'Kitchen')],
          photos: [{ path: '/tmp/p1.jpg', cam: cam(0.5, 0.5), room: 0 }, { path: '/tmp/p2.jpg', cam: cam(-0.5, -0.5), room: 0 }] });
        const sc = getScans().find(s => s.id === 'scan-photo-1');
        const svg = _scanPlanSvg(sc, { lens: 'plan', scanId: sc.id, photos: sc.photos });
        const noPins = _scanPlanSvg(sc, { lens: 'plan' });
        _scanOpenPhoto('scan-photo-1', 0);
        const ov = document.getElementById('_scan-photo-ov');
        const first = ov && ov.innerHTML;
        _scanOpenPhoto('scan-photo-1', -1);   // wraps to the last photo
        const wrapped = document.getElementById('_scan-photo-ov').innerHTML;
        document.getElementById('_scan-photo-ov')?.remove();
        return {
          pins: (svg.match(/_scanOpenPhoto/g) || []).length,
          noPins: (noPins.match(/_scanOpenPhoto/g) || []).length,
          firstCounter: /1 of 2/.test(first), firstSrc: /p1\.jpg/.test(first),
          wrappedCounter: /2 of 2/.test(wrapped), wrappedSrc: /p2\.jpg/.test(wrapped),
        };
      } finally { deleteScan('scan-photo-1'); document.getElementById('_scan-photo-ov')?.remove(); }
    }, fabricatedRoom());
    expect(r.pins, 'one tappable pin per photo').toBe(2);
    expect(r.noPins, 'no pins unless the viewer passes photos').toBe(0);
    expect(r.firstCounter).toBe(true);
    expect(r.firstSrc).toBe(true);
    expect(r.wrappedCounter, 'stepping back from the first wraps to the last').toBe(true);
    expect(r.wrappedSrc).toBe(true);
  });

  test('Scan Estimate: standalone builder prices rooms from measured surfaces, bakes multipliers, stamps scanId', async () => {
    const r = await page.evaluate((raw) => {
      const savedClients = clients.slice(), savedRates = S.scanRates, savedTrade = S.trade;
      try {
        S.trade = 'Painting';
        clients.length = 0; clients.push({ id: 801, name: 'Builder Client' });
        const room = _scanParseRoom(raw, 'Kitchen');
        saveScan({ id: 'scan-se-1', clientId: 801, rooms: [room], name: 'SE scan' });
        S.scanRates = { wall: 2, ceiling: 1, trimLf: 0, door: 0, window: 0 };
        openScanEstimate(clients[0]);
        const ov = document.getElementById('_se-ov');
        const opened = !!ov;
        // Walls on by default at $2: 352 x 2 = 704. Add the ceiling: +120.
        const t1 = _seTotal();
        _seToggleSurf(0, 'ceiling');
        const t2 = _seTotal();
        // Heavy prep bakes +15% into the RATE, so qty x rate stays honest.
        _seToggleMult(0, 'prep');
        const t3 = _seTotal();
        const autoHigh = _seState.rooms[0].mults.highCeil;   // 8 ft: NOT auto-flagged
        _seCreateProposal();
        const seeded = { lines: _geiLines.length, firstRate: _geiLines[0].rate, scanId: _geiScanId, builderGone: !document.getElementById('_se-ov') };
        deleteScan('scan-se-1');
        return { opened, t1, t2, t3, autoHigh, seeded };
      } finally {
        clients.length = 0; savedClients.forEach(c => clients.push(c));
        S.scanRates = savedRates; S.trade = savedTrade;
        window._scanEstimateSeed = null; _geiLines = []; _geiScanId = null; _seState = null;
        document.getElementById('_se-ov')?.remove();
        goPg('pg-dash');
      }
    }, fabricatedRoom());
    expect(r.opened).toBe(true);
    expect(r.t1).toBe(704);
    expect(r.t2).toBe(824);
    expect(r.t3, '+15% prep on both surfaces').toBeCloseTo(947.6, 0);
    expect(r.autoHigh, '8 ft ceilings are not high ceilings').toBe(false);
    expect(r.seeded.lines).toBe(2);
    expect(r.seeded.firstRate, 'the multiplier is baked into the line rate').toBeCloseTo(2.3, 5);
    expect(r.seeded.scanId, 'the bid will carry the scan for the proposal plan embed').toBe('scan-se-1');
    expect(r.seeded.builderGone).toBe(true);
  });

  test('Scan Estimate: a measured 10 ft room auto-flags high ceilings; electricians bill by device count', async () => {
    const r = await page.evaluate((raw) => {
      const savedClients = clients.slice(), savedTrade = S.trade, savedER = S.scanElecRates;
      try {
        clients.length = 0; clients.push({ id: 802, name: 'Elec Client' });
        const room = _scanParseRoom(raw, 'Kitchen');
        room.hM = 3.05;   // a measured 10 ft ceiling
        saveScan({ id: 'scan-se-2', clientId: 802, rooms: [room], name: 'Tall scan' });
        S.trade = 'Electrical';
        S.scanElecRates = { outlet: 100, sw: 80, gfci: 150 };
        openScanEstimate(clients[0]);
        const autoHigh = _seState.rooms[0].mults.highCeil;
        _seToggleMult(0, 'highCeil');           // turn it OFF for clean device math
        const total = _seTotal();               // 5 outlets x100 + 1 switch x80 + GFCI 150 = 730
        _seCreateProposal();
        const kinds = _geiLines.map(l => l.desc);
        deleteScan('scan-se-2');
        return { autoHigh, total, lines: _geiLines.length, kinds };
      } finally {
        clients.length = 0; savedClients.forEach(c => clients.push(c));
        S.trade = savedTrade; S.scanElecRates = savedER;
        window._scanEstimateSeed = null; _geiLines = []; _geiScanId = null; _seState = null;
        document.getElementById('_se-ov')?.remove();
        goPg('pg-dash');
      }
    }, fabricatedRoom());
    expect(r.autoHigh, 'a MEASURED 10 ft ceiling arrives pre-flagged').toBe(true);
    expect(r.total).toBe(730);
    expect(r.lines).toBe(3);
    expect(r.kinds.join(' ')).toContain('receptacles');
    expect(r.kinds.join(' ')).toContain('GFCI');
  });

  // Phase 1 of the beat-the-market design (research 2026-08-09): the 2D plan
  // draws to real drafting conventions, and a hand-rolled isometric dollhouse
  // gives 3D with zero dependencies.
  test('the plan draws drafting conventions: poché walls, door swing arcs, window glazing, north arrow', async () => {
    const r = await page.evaluate((raw) => {
      const room = _scanParseRoom(raw, 'Kitchen');
      const svg = _scanPlanSvg({ rooms: [room], headingDeg: 40 }, { lens: 'plan' });
      return {
        poche: /<line[^>]*stroke-width="1\.[0-9]+"[^>]*stroke-linecap="square"/.test(svg) || /stroke-linecap="square"/.test(svg),
        swingArc: /<path d="M [\d. ]+A [\d. ]+/.test(svg) && /stroke-dasharray/.test(svg),
        northArrow: /rotate\(40\)/.test(svg) && />N</.test(svg),
        stillHasLabel: /Kitchen/.test(svg) && /352 wall sq ft/.test(svg),
        dims: /12'0"/.test(svg),
      };
    }, fabricatedRoom());
    expect(r.poche, 'walls render as solid poché with closed corners').toBe(true);
    expect(r.swingArc, 'doors get the quarter-circle swing arc').toBe(true);
    expect(r.northArrow, 'a captured heading draws the north arrow').toBe(true);
    expect(r.stillHasLabel).toBe(true);
    expect(r.dims, 'wall dimensions annotate the plan').toBe(true);
  });

  test('the dollhouse stacks floors with labels; a flat scan gets no floor labels; the viewer has a 3D tab', async () => {
    const r = await page.evaluate((raw) => {
      const before = scans.length;
      try {
        const r1 = _scanParseRoom(raw, 'Kitchen'); r1.story = 1;
        const r2 = _scanParseRoom(raw, 'Bedroom'); r2.story = 2;
        const two = _scanDollhouseSvg({ rooms: [r1, r2] });
        const flat = _scanDollhouseSvg({ rooms: [_scanParseRoom(raw, 'Studio')] });
        const sc = saveScan({ id: 'sc-3d', clientId: null, name: '3D', createdAt: new Date().toISOString(), rooms: [r1, r2], photos: [], price: null, purchasedAt: null });
        _scanViewLens = '3d'; _scanViewStory = null;
        openScanViewer(sc.id);
        const html = document.getElementById('_scan-view-ov')?.innerHTML || '';
        document.getElementById('_scan-view-ov')?.remove();
        return {
          // 2 rooms x 4 walls + 2 floor slabs = 10 polygons minimum.
          twoPolys: (two.match(/<polygon/g) || []).length,
          twoLabels: /Floor 1/.test(two) && /Floor 2/.test(two),
          flatNoLabels: !/Floor 1/.test(flat),
          viewerRenders: /Dollhouse|dollhouse/.test(html) && /<polygon/.test(html),
          tabPresent: />3D</.test(html),
        };
      } finally { scans.length = before; saveAll(); _scanViewLens = null; _scanViewStory = null; }
    }, fabricatedRoom());
    expect(r.twoPolys).toBeGreaterThanOrEqual(10);
    expect(r.twoLabels, 'stacked stories are labeled').toBe(true);
    expect(r.flatNoLabels, 'one story needs no labels').toBe(true);
    expect(r.viewerRenders, 'the 3D tab renders the dollhouse').toBe(true);
    expect(r.tabPresent).toBe(true);
  });

  test('the builder plan navigates by tap and the money pivots by room or by surface', async () => {
    const r = await page.evaluate((raw) => {
      const savedScans = scans.slice(), savedClients = clients.slice(), savedRates = S.scanRates;
      try {
        S.scanRates = { wall: 2, ceiling: 1, trimLf: 0, door: 0, window: 0 };
        clients.push({ id: 77401, name: 'Pivot Client' });
        const room = _scanParseRoom(raw, 'Kitchen');
        scans.push({ id: 'sc-pivot', clientId: 77401, name: 'Pivot scan', createdAt: new Date().toISOString(), rooms: [room, { ...room, label: 'Bedroom' }], photos: [] });
        openScanEstimate(clients.find(c => c.id === 77401));
        const ov = () => document.getElementById('_se-ov');
        const planClickable = /onclick="_seJumpRoom\(0\)"/.test(ov().innerHTML) && /onclick="_seJumpRoom\(1\)"/.test(ov().innerHTML);
        const hasCards = !!document.getElementById('se-room-0') && !!document.getElementById('se-room-1');
        _seSetView('surfaces');
        const sHtml = ov().innerHTML;
        // Walls on for both rooms by default: 352 x 2 = 704 sq ft at $2 = $1,408.
        const surfaceRow = /Walls/.test(sHtml) && /704 sq ft across 2 rooms/.test(sHtml) && /\$1,408/.test(sHtml);
        const cardsGone = !document.getElementById('se-room-0');
        // Tapping a room on the plan from the surface view lands back on its card.
        _seJumpRoom(1);
        const jumped = !!document.getElementById('se-room-1');
        ov()?.remove(); _seState = null;
        return { planClickable, hasCards, surfaceRow, cardsGone, jumped };
      } finally {
        scans.length = 0; savedScans.forEach(x => scans.push(x));
        clients.length = 0; savedClients.forEach(x => clients.push(x));
        S.scanRates = savedRates; saveAll();
        document.getElementById('_se-ov')?.remove(); _seState = null;
      }
    }, fabricatedRoom());
    expect(r.planClickable, 'every room polygon is a tap target').toBe(true);
    expect(r.hasCards).toBe(true);
    expect(r.surfaceRow, 'the surface pivot rolls the same money up across rooms').toBe(true);
    expect(r.cardsGone, 'surface view replaces the room cards').toBe(true);
    expect(r.jumped, 'a plan tap from surface view returns to the room card').toBe(true);
  });

  // Conduit's close-rate move (research 2026-08-09): the client proposal
  // shows THEIR house, color-keyed to the money. Quoted rooms tint + get a
  // legend chip with the room total; rooms not in the quote stay white.
  test('the proposal plan is color-keyed to the quoted rooms with a room-total legend', async () => {
    const r = await page.evaluate(async (raw) => {
      const savedScans = scans.slice(), savedClients = clients.slice(), savedBids = bids.slice(), savedRates = S.scanRates;
      try {
        S.scanRates = { wall: 2, ceiling: 0, trimLf: 0, door: 0, window: 0 };
        clients.push({ id: 77501, name: 'Legend Client' });
        const k = _scanParseRoom(raw, 'Kitchen');
        const b = _scanParseRoom(raw, 'Bedroom');
        b.poly = b.poly.map(([x, z]) => [x + 3.8, z]);
        b.walls = b.walls.map(w => ({ ...w, ax: w.ax + 3.8, bx: w.bx + 3.8 }));
        scans.push({ id: 'sc-legend', clientId: 77501, name: 'Legend scan', createdAt: new Date().toISOString(), rooms: [k, b], photos: [] });
        openScanEstimate(clients.find(c => c.id === 77501));
        _seToggleRoom(1);           // Bedroom OFF: must stay untinted
        _seCreateProposal();
        await new Promise(r2 => setTimeout(r2, 80));
        await sendGenericProposal(true);
        await new Promise(r2 => setTimeout(r2, 250));
        const html = document.body.innerHTML;
        return {
          hasPlan: /Measured floor plan/.test(html),
          kitchenTinted: /fill="#DCE8F5"/.test(html),
          legendKitchen: /Kitchen · \$704/.test(html),
          bedroomNotInLegend: !/Bedroom · \$/.test(html),
        };
      } finally {
        document.querySelectorAll('.zmodal-overlay,#_se-ov').forEach(el => el.remove());
        document.querySelectorAll('[id*=proposal-preview]').forEach(el => el.remove());
        scans.length = 0; savedScans.forEach(x => scans.push(x));
        bids.length = 0; savedBids.forEach(x => bids.push(x));
        clients.length = 0; savedClients.forEach(x => clients.push(x));
        S.scanRates = savedRates; _seState = null; saveAll();
      }
    }, fabricatedRoom());
    expect(r.hasPlan, 'the proposal embeds the measured plan').toBe(true);
    expect(r.kitchenTinted, 'the quoted room is tinted').toBe(true);
    expect(r.legendKitchen, 'the legend prices the quoted room').toBe(true);
    expect(r.bedroomNotInLegend, 'an unquoted room stays out of the legend').toBe(true);
  });

  test('the interactive 3D viewer opens, renders or degrades gracefully, and closes clean', async () => {
    const r = await page.evaluate(async (raw) => {
      const before = scans.length;
      try {
        const r1 = _scanParseRoom(raw, 'Kitchen'); r1.story = 1;
        const r2 = _scanParseRoom(raw, 'Bedroom'); r2.story = 2;
        const sc = saveScan({ id: 'sc-orbit', clientId: null, name: 'Orbit', createdAt: new Date().toISOString(), rooms: [r1, r2], photos: [], price: null, purchasedAt: null });
        await _scan3dOpen(sc.id);
        const ov = document.getElementById('_scan-3d-ov');
        const opened = !!ov;
        // Headless runners may lack WebGL: a canvas OR the honest fallback
        // message both count as a working surface. A blank mount does not.
        const canvas = !!ov?.querySelector('canvas');
        const fallback = /WebGL/.test(ov?.textContent || '');
        _scan3dClose();
        const closed = !document.getElementById('_scan-3d-ov');
        return { opened, canvas, fallback, closed, stateCleared: _s3d === null };
      } finally { scans.length = before; saveAll(); _scan3dClose(); }
    }, fabricatedRoom());
    expect(r.opened).toBe(true);
    expect(r.canvas || r.fallback, 'a real render or an honest fallback, never a blank screen').toBe(true);
    expect(r.closed, 'close tears the overlay down').toBe(true);
    expect(r.stateCleared).toBe(true);
  });

  test('the estimate-type chooser leads with Scan Estimate', async () => {
    const r = await page.evaluate(() => {
      try {
        _showEstimateStylePicker({ id: 901, name: 'Chooser Client' });
        const ov = document.getElementById('_style-pick-ov');
        const html = ov ? ov.innerHTML : '';
        return {
          hasScanCard: /Scan Estimate/.test(html) && /Measured by LiDAR/.test(html),
          scanFirst: html.indexOf('Scan Estimate') < html.indexOf('Build Your Own'),
        };
      } finally { document.getElementById('_style-pick-ov')?.remove(); window._stylePickState = null; }
    });
    expect(r.hasScanCard).toBe(true);
    expect(r.scanFirst, 'the flagship type leads the chooser').toBe(true);
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
