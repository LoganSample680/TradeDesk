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
      // Drives setActiveTrade, the seam the app really uses. This test used to
      // assign S.trade, which nothing outside this file has ever written: the
      // trade lives on _config.business_type / _activeTrade (js/lifecycle.js
      // documents the same thing), so the lens was 'plan' for every real
      // contractor while this test read green.
      const was = typeof _activeTrade !== 'undefined' ? _activeTrade : null;
      const out = {};
      try {
        setActiveTrade('painting');   out.paint = _scanDefaultLens();
        setActiveTrade('electrical'); out.elec = _scanDefaultLens();
        setActiveTrade('hvac');       out.hvac = _scanDefaultLens();
        setActiveTrade('plumbing');   out.plumb = _scanDefaultLens();
      } finally { setActiveTrade(was); }
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

  // Squaring pass (owner 2026-08-10: "off by 8 inches in some cases"). LiDAR
  // drift skews one wall a degree or two off the others; the parse snaps any
  // wall within 6 degrees of the room's dominant grid onto it, so dimension
  // chains stop accumulating skew error. Genuinely angled walls stay.
  test('squaring: a drift-skewed wall snaps onto the room grid, lengths untouched', async () => {
    const r = await page.evaluate(() => {
      const L = 3.6576, W = 3.048, H = 2.4384;
      const rad = 2 * Math.PI / 180; // 2 degree tracking drift on one wall
      const wall = (id, dir, cx, cz, len) => ({
        identifier: id, category: { wall: {} }, dimensions: [len, H, 0],
        transform: [dir[0], 0, dir[1], 0, 0, 1, 0, 0, -dir[1], 0, dir[0], 0, cx, H / 2, cz, 1],
      });
      const raw = JSON.stringify({
        identifier: 'room-sq', story: 0, version: 2,
        walls: [
          wall('w-n', [1, 0], 0, -W / 2, L),
          wall('w-s', [Math.cos(rad), Math.sin(rad)], 0, W / 2, L), // drifted
          wall('w-e', [0, 1], L / 2, 0, W),
          wall('w-w', [0, 1], -L / 2, 0, W),
        ],
        doors: [], windows: [], openings: [], objects: [], floors: [],
      });
      const room = _scanParseRoom(raw, 'Sq');
      const Q = Math.PI / 2;
      const fold = (a) => a - Math.round(a / Q) * Q;
      const folds = room.walls.map(w => fold(Math.atan2(w.bz - w.az, w.bx - w.ax)));
      const spread = Math.max(...folds) - Math.min(...folds);
      const lenOk = room.walls.every(w => Math.abs(Math.hypot(w.bx - w.ax, w.bz - w.az) - w.len) < 1e-9);
      return { spread, lenOk };
    });
    expect(r.spread, 'all four walls share one grid after the snap').toBeLessThan(0.001);
    expect(r.lenOk, 'snap rotates about the center, never changes a length').toBe(true);
  });

  test('squaring: a real 45 degree bay wall is left alone', async () => {
    const r = await page.evaluate(() => {
      const H = 2.4384, a45 = Math.PI / 4;
      const wall = (id, dir, cx, cz, len) => ({
        identifier: id, category: { wall: {} }, dimensions: [len, H, 0],
        transform: [dir[0], 0, dir[1], 0, 0, 1, 0, 0, -dir[1], 0, dir[0], 0, cx, H / 2, cz, 1],
      });
      const raw = JSON.stringify({
        identifier: 'room-bay', story: 0, version: 2,
        walls: [
          wall('w-n', [1, 0], 0, -1.5, 3.6),
          wall('w-s', [1, 0], 0, 1.5, 3.6),
          wall('w-e', [0, 1], 1.8, 0, 3.0),
          wall('w-bay', [Math.cos(a45), Math.sin(a45)], -1.8, 0, 1.2), // deliberate 45
        ],
        doors: [], windows: [], openings: [], objects: [], floors: [],
      });
      const room = _scanParseRoom(raw, 'Bay');
      const bay = room.walls.find(w => w.id === 'w-bay');
      const ang = Math.atan2(bay.bz - bay.az, bay.bx - bay.ax);
      return { deg: ang * 180 / Math.PI };
    });
    expect(Math.abs(r.deg - 45), 'the bay keeps its real angle').toBeLessThan(0.5);
  });

  // RoomPlan fragments one real piece into several boxes (owner screenshots
  // 2026-08-10: a hutch as two stacked storages, a table as two overlapping
  // slabs). Overlapping same-category boxes union into ONE plan symbol;
  // separate pieces and different categories never merge.
  test('furniture fragments: overlapping same-category boxes union into one symbol', async () => {
    const r = await page.evaluate(() => {
      const H = 2.4384;
      const wall = (id, dir, cx, cz, len) => ({
        identifier: id, category: { wall: {} }, dimensions: [len, H, 0],
        transform: [dir[0], 0, dir[1], 0, 0, 1, 0, 0, -dir[1], 0, dir[0], 0, cx, H / 2, cz, 1],
      });
      const obj = (cat, cx, cz, w, d) => ({
        identifier: cat + cx, category: { [cat]: {} }, dimensions: [w, 0.8, d],
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, cx, 0.4, cz, 1],
      });
      const raw = JSON.stringify({
        identifier: 'rm', story: 0, version: 2,
        walls: [wall('w-n', [1, 0], 0, -2, 5), wall('w-s', [1, 0], 0, 2, 5)],
        doors: [], windows: [], openings: [],
        objects: [
          obj('table', 0, 0, 1.8, 1.0),      // one table captured as
          obj('table', 0.7, 0.1, 1.4, 0.9),  // two overlapping slabs
          obj('toilet', 2.0, 1.5, 0.5, 0.7), // different cat, nearby: untouched
        ],
        floors: [],
      });
      const room = _scanParseRoom(raw, 'Frag');
      const tables = room.objects.filter(o => o.cat === 'table');
      const toilet = room.objects.filter(o => o.cat === 'toilet');
      return {
        total: room.objects.length,
        tables: tables.length,
        spanOk: tables.length === 1 && tables[0].w >= 2.2, // union spans both slabs
        toilet: toilet.length,
      };
    });
    expect(r.tables, 'two overlapping table slabs merge into one').toBe(1);
    expect(r.spanOk, 'the union spans both fragments').toBe(true);
    expect(r.toilet, 'a different category never merges in').toBe(1);
    expect(r.total).toBe(2);
  });

  // Bleed-through de-overlap (owner screenshots 2026-08-10): where two rooms
  // on one floor claim the same area, the later-walked room owns it and the
  // earlier room's floor number gives it up. Raw area is kept so the pass is
  // idempotent, and rooms on different floors never interact.
  test('floor de-overlap: the later room owns the bleed, idempotent, per floor', async () => {
    const r = await page.evaluate(() => {
      const mk = (poly, story) => ({ label: 'R', poly, story, floorM2: Math.abs(_scanShoelace(poly)), walls: [], objects: [] });
      const A = mk([[0, 0], [4, 0], [4, 3], [0, 3]], 1);      // 12 m2, bled into B's space
      const B = mk([[3, 0], [6, 0], [6, 3], [3, 3]], 1);      // 9 m2, walked later: owns 3..4
      const C = mk([[3, 0], [6, 0], [6, 3], [3, 3]], 2);      // same footprint, other floor
      _scanDedupeFloors([A, B, C]);
      const once = { a: A.floorM2, b: B.floorM2, c: C.floorM2, rawKept: A.floorRawM2 };
      _scanDedupeFloors([A, B, C]);
      return { once, twice: { a: A.floorM2, b: B.floorM2 } };
    });
    expect(Math.abs(r.once.a - 9), 'the earlier room gives up the 3 m2 overlap').toBeLessThan(0.2);
    expect(r.once.b, 'the later room keeps its full area').toBeCloseTo(9, 5);
    expect(r.once.c, 'a different floor never interacts').toBeCloseTo(9, 5);
    expect(r.once.rawKept, 'the captured area survives in floorRawM2').toBeCloseTo(12, 5);
    expect(Math.abs(r.twice.a - r.once.a), 'running the pass again changes nothing').toBeLessThan(1e-9);
  });

  // Interruption draft (owner 2026-08-10: phone auto-locked mid-scan, data
  // lost): native keeps a draft after every finished room; a fresh capture
  // offers resume / start fresh / back out, and each choice drives the plugin
  // correctly.
  test('interrupted-scan draft: resume passes resumeDraft, fresh discards, backing out never scans', async () => {
    const r = await page.evaluate(async (raw) => {
      const realCap = window.Capacitor;
      const before = scans.length;
      const calls = { starts: [], discards: 0 };
      try {
        localStorage.setItem('td_scan_preflight', '1');
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: (n) => n === 'TdScan' ? {
            pendingDraft: () => Promise.resolve({ exists: true, count: 2, labels: ['Kitchen', 'Bath'], ts: 1 }),
            discardDraft: () => { calls.discards++; return Promise.resolve(); },
            startScan: (o) => { calls.starts.push(o); return Promise.resolve({ rooms: [raw], labels: ['Kitchen'], stories: [1], photos: [], headingDeg: -1 }); },
          } : null,
        };
        // 1) Resume: the prompt shows the saved rooms and passes resumeDraft.
        const p1 = startRoomScan({ clientId: 42 });
        await new Promise(res => setTimeout(res, 30));
        const promptShown = !!document.getElementById('_scan-draft-ov');
        const promptNames = (document.querySelector('#_scan-draft-ov .zmodal')?.textContent || '').includes('Kitchen');
        document.getElementById('_scan-draft-go')?.click();
        const sc1 = await p1;
        // 2) Start fresh: the draft is discarded, no resumeDraft sent.
        const p2 = startRoomScan({ clientId: 42 });
        await new Promise(res => setTimeout(res, 30));
        document.getElementById('_scan-draft-no')?.click();
        const sc2 = await p2;
        // 3) Back out: tapping the scrim starts nothing.
        const p3 = startRoomScan({ clientId: 42 });
        await new Promise(res => setTimeout(res, 30));
        const ov = document.getElementById('_scan-draft-ov');
        ov?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const sc3 = await p3;
        scans.length = before; saveAll();
        return {
          promptShown, promptNames,
          resumed: !!sc1, resumeFlag: calls.starts[0] && calls.starts[0].resumeDraft === true,
          fresh: !!sc2, freshFlag: !!(calls.starts[1] && calls.starts[1].resumeDraft),
          discards: calls.discards,
          backedOut: sc3 === null, startCount: calls.starts.length,
        };
      } finally {
        window.Capacitor = realCap;
        document.getElementById('_scan-draft-ov')?.remove();
      }
    }, fabricatedRoom());
    expect(r.promptShown, 'the draft prompt appears before any capture').toBe(true);
    expect(r.promptNames, 'it names the rooms already saved').toBe(true);
    expect(r.resumed).toBe(true);
    expect(r.resumeFlag, 'resume rides resumeDraft:true into the plugin').toBe(true);
    expect(r.fresh).toBe(true);
    expect(r.freshFlag, 'start fresh never sends resumeDraft').toBe(false);
    expect(r.discards, 'start fresh throws the draft away exactly once').toBe(1);
    expect(r.backedOut, 'scrim tap backs out without scanning').toBe(true);
    expect(r.startCount, 'only the two confirmed choices reached the plugin').toBe(2);
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

  // ── Naming a room, and getting out of the viewer ──────────────────────────
  // Owner (2026-08-10): "it looks like the scanner goes to nowhere, and the
  // ability to name a room is a click through rather than a custom name, I want
  // a custom name."
  test.describe('room names and the way into an estimate', () => {
    const seed = () => page.evaluate(() => {
      if (typeof scans === 'undefined') window.scans = [];
      scans.length = 0;
      const room = (label) => ({ label, story: 1,
        walls: [{ w: 12, h: 8 }, { w: 10, h: 8 }, { w: 12, h: 8 }, { w: 10, h: 8 }],
        doors: [{ w: 3, h: 6.7 }], windows: [{ w: 4, h: 3 }], dims: { x: 12, y: 8, z: 10 } });
      scans.push({ id: 's-name', name: 'Scan', clientId: 55, date: '2026-08-09',
                   rooms: [room('Living room'), room('Room')], photos: [] });
      openScanViewer('s-name');
      // A painter now LANDS on their own takeoff, so tests about the Plan tab
      // have to ask for it. That is the _scanDefaultLens fix landing: it used
      // to read S.trade, which nothing in the app ever sets, so every
      // contractor got a bare plan.
      _scanSetLens('s-name', 'plan');
    });

    // Owner (2026-08-10): "other trades shouldn't be visible unless I'm writing
    // things under that trade, hvac shouldn't show for painters and neither
    // should electrical and vice versa."
    test('you see the geometry and your own trade, never somebody else\'s', async () => {
      const r = await page.evaluate(() => {
        const real = typeof _activeTrade !== 'undefined' ? _activeTrade : null;
        const read = () => _scanTabs().map(t => t[1]).join();
        try {
          setActiveTrade('painting');   const painter = read();
          setActiveTrade('electrical'); const sparky = read();
          setActiveTrade('hvac');       const hvac = read();
          setActiveTrade('general');    const gc = read();
          return { painter, sparky, hvac, gc };
        } finally { if (real !== null) setActiveTrade(real); }
      });
      expect(r.painter, 'a painter is not shown load calcs').toBe('Plan,3D,Paint');
      expect(r.sparky, 'a sparky is not shown paint takeoff').toBe('Plan,3D,Electrical');
      expect(r.hvac).toBe('Plan,3D,HVAC');
      // A trade with no takeoff of its own gets the geometry, not all three.
      expect(r.gc, 'showing a GC three takeoffs is the thing this stops').toBe('Plan,3D');
    });

    test('a lens from another trade cannot strand you on a hidden tab', async () => {
      await seed();
      const r = await page.evaluate(() => {
        const real = typeof _activeTrade !== 'undefined' ? _activeTrade : null;
        try {
          setActiveTrade('painting');
          _scanViewLens = 'hvac';       // left over from another trade
          openScanViewer('s-name');
          const lens = _scanViewLens;
          document.getElementById('_scan-view-ov')?.remove();
          return { lens };
        } finally { if (real !== null) setActiveTrade(real); }
      });
      expect(r.lens, 'falls back to this trade instead of a tab with no button')
        .toBe('paint');
    });

    test('the Plan tab leads into an estimate, above selling the plan', async () => {
      await seed();
      const r = await page.evaluate(() => {
        const h = document.getElementById('_scan-view-ov').innerHTML;
        return { cta: /Build the estimate from these rooms/.test(h),
                 order: h.indexOf('Build the estimate') < h.indexOf('Sell floor plan') };
      });
      // The scan exists to price work. The only path to that used to live on the
      // Paint tab, which is why this read as a dead end.
      expect(r.cta, 'the tab you land on must lead somewhere').toBe(true);
      expect(r.order, 'selling the plan is the side hustle, not the point').toBe(true);
    });

    test('a room takes a name the contractor types, not one off a list', async () => {
      await seed();
      const r = await page.evaluate(() => {
        const real = window.prompt;
        window.prompt = () => "Zach's office";
        try { _scanRenameRoom('s-name', 1); } finally { window.prompt = real; }
        _scanToEstimate('s-name');
        return { label: scans[0].rooms[1].label,
                 seed: (window._scanEstimateSeed?.rooms || []).map(x => x.name) };
      });
      expect(r.label).toBe("Zach's office");
      // The label feeds the plan drawing, the takeoff and the line items, so a
      // rename has to survive all the way into the estimate.
      expect(r.seed, 'the name the contractor chose is the one on the estimate')
        .toContain("Zach's office");
    });

    test('cancelling or clearing the prompt never wipes a name', async () => {
      await seed();
      const r = await page.evaluate(() => {
        const real = window.prompt;
        window.prompt = () => 'Kitchen';
        try { _scanRenameRoom('s-name', 0); } finally { window.prompt = real; }
        const named = scans[0].rooms[0].label;
        window.prompt = () => null;
        try { _scanRenameRoom('s-name', 0); } finally { window.prompt = real; }
        const afterCancel = scans[0].rooms[0].label;
        window.prompt = () => '   ';
        try { _scanRenameRoom('s-name', 0); } finally { window.prompt = real; }
        return { named, afterCancel, afterBlank: scans[0].rooms[0].label };
      });
      expect(r.named).toBe('Kitchen');
      expect(r.afterCancel, 'a cancel is not an edit').toBe('Kitchen');
      expect(r.afterBlank, 'blank is not a name').toBe('Kitchen');
    });

    // The Floor tabs sit directly above this list and the plan below draws one
    // floor at a time. A list ignoring the selection contradicted both, and the
    // multi-floor test caught it.
    test('the Plan room list follows the floor tabs', async () => {
      const r = await page.evaluate(() => {
        const room = (label, story) => ({ label, story,
          walls: [{ w: 12, h: 8 }], doors: [], windows: [], dims: { x: 12, y: 8, z: 10 } });
        scans.length = 0;
        scans.push({ id: 's-two', name: 'Two story', clientId: null, date: '2026-08-09',
                     rooms: [room('Zebraroom', 1), room('Yakroom', 2)], photos: [] });
        _scanViewStory = null; _scanViewLens = 'plan';
        openScanViewer('s-two');
        const one = document.getElementById('_scan-view-ov').innerHTML;
        _scanSetStory('s-two', 2);
        const two = document.getElementById('_scan-view-ov').innerHTML;
        document.getElementById('_scan-view-ov')?.remove();
        _scanViewStory = null;
        // Deliberately odd room names: the electrical lens's own disclaimer
        // contains the words "Kitchen counters", so a room called Kitchen makes
        // this pass or fail on static copy rather than on the filter.
        return { f1: /Zebraroom/.test(one) && !/Yakroom/.test(one),
                 f2: /Yakroom/.test(two) && !/Zebraroom/.test(two) };
      });
      expect(r.f1, 'floor 1 lists only floor 1').toBe(true);
      expect(r.f2, 'floor 2 lists only floor 2').toBe(true);
    });

    // The Plan list had the floor filter and the three takeoffs did not, so a
    // two-storey scan showed Floor 1 selected above a takeoff for the whole
    // building. One helper now, so they cannot drift apart again.
    test('every takeoff follows the floor tabs, not just the plan', async () => {
      const r = await page.evaluate(() => {
        const real = typeof _activeTrade !== 'undefined' ? _activeTrade : null;
        const room = (label, story) => ({ label, story,
          walls: [{ w: 12, h: 8 }], doors: [], windows: [], dims: { x: 12, y: 8, z: 10 } });
        try {
          scans.length = 0;
          scans.push({ id: 's-lens', name: 'Two story', clientId: null, date: '2026-08-09',
                       rooms: [room('Zebraroom', 1), room('Yakroom', 2)], photos: [] });
          const out = {};
          [['paint', 'painting'], ['electrical', 'electrical'], ['hvac', 'hvac']].forEach(([lens, trade]) => {
            setActiveTrade(trade);
            _scanViewStory = 1; _scanViewLens = lens;
            openScanViewer('s-lens');
            const a = document.getElementById('_scan-view-ov').innerHTML;
            _scanSetStory('s-lens', 2);
            const b = document.getElementById('_scan-view-ov').innerHTML;
            document.getElementById('_scan-view-ov')?.remove();
            out[lens] = /Zebraroom/.test(a) && !/Yakroom/.test(a) &&
                        /Yakroom/.test(b) && !/Zebraroom/.test(b);
          });
          _scanViewStory = null;
          return out;
        } finally { if (real !== null) setActiveTrade(real); }
      });
      expect(r.paint).toBe(true);
      expect(r.electrical).toBe(true);
      expect(r.hvac).toBe(true);
    });

    test('every lens offers the rename, so none of them drift apart', async () => {
      await seed();
      const counts = await page.evaluate(() => {
        const n = () => document.querySelectorAll('[onclick^="_scanRenameRoom"]').length;
        const out = { plan: n() };
        ['paint', 'electrical', 'hvac'].forEach(l => { _scanSetLens('s-name', l); out[l] = n(); });
        _scanSetLens('s-name', 'plan');
        document.getElementById('_scan-view-ov')?.remove();
        return out;
      });
      expect(counts.plan).toBe(2);
      expect(counts.paint).toBe(2);
      expect(counts.electrical).toBe(2);
      expect(counts.hvac).toBe(2);
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
      const savedClients = clients.slice(), savedRates = S.scanRates;
      const savedTrade = typeof _activeTrade !== 'undefined' ? _activeTrade : null;
      try {
        setActiveTrade('painting');
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
        S.scanRates = savedRates; setActiveTrade(savedTrade);
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
      const savedClients = clients.slice(), savedER = S.scanElecRates;
      const savedTrade = typeof _activeTrade !== 'undefined' ? _activeTrade : null;
      try {
        clients.length = 0; clients.push({ id: 802, name: 'Elec Client' });
        const room = _scanParseRoom(raw, 'Kitchen');
        room.hM = 3.05;   // a measured 10 ft ceiling
        saveScan({ id: 'scan-se-2', clientId: 802, rooms: [room], name: 'Tall scan' });
        setActiveTrade('electrical');
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
        setActiveTrade(savedTrade); S.scanElecRates = savedER;
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
        // Owner review (2026-08-09 vs reference plans): the arc is SOLID (the
        // old dashed assertion is gone with the dashes), and the sweep flag
        // for the fabricated room's south-wall door must be 1, the value that
        // bows the arc INTO the room. The old constant-cross bug emitted 0
        // here, drawing the swing through the wall.
        swingArc: /<path d="M [\d. ]+A [\d. ]+ 0 0 1 /.test(svg) && !/stroke-dasharray/.test(svg),
        // Triple-line window: both wall faces redrawn across the opening plus
        // jamb caps (the 0.35 family), so a window reads as a window.
        windowLines: (svg.match(/stroke-width="0\.35"/g) || []).length >= 4,
        northArrow: /rotate\(40\)/.test(svg) && />N</.test(svg),
        stillHasLabel: /Kitchen/.test(svg) && /352 wall sq ft/.test(svg),
        dims: /12'0"/.test(svg),
      };
    }, fabricatedRoom());
    expect(r.poche, 'walls render as solid poché with closed corners').toBe(true);
    expect(r.swingArc, 'the door swing bows into the room, solid arc').toBe(true);
    expect(r.windowLines, 'windows draw the triple-line convention, never a bare gap').toBe(true);
    expect(r.northArrow, 'a captured heading draws the north arrow').toBe(true);
    expect(r.stillHasLabel).toBe(true);
    expect(r.dims, 'wall dimensions annotate the plan').toBe(true);
  });

  // Owner review (2026-08-10) against Polycam: "it looks nothing like Polycam,
  // just a ton weaker." The geometry was already right; the sheet around it
  // was missing.
  test.describe('the plan is a drawing sheet, not a diagram', () => {
    // Two rooms side by side, so a side of the envelope breaks into a chain of
    // dimensions with an overall run outside it.
    const twoUp = () => {
      const raw = JSON.parse(fabricatedRoom());
      return [raw, JSON.parse(fabricatedRoom())];
    };

    test('the title block carries the name, the address, and the total', async () => {
      const r = await page.evaluate((raw) => {
        const room = _scanParseRoom(raw, 'Kitchen');
        const sheet = _scanPlanSvg({ rooms: [room] },
          { lens: 'plan', sheet: true, title: 'Patterson scan', subtitle: '12 Elm St' });
        const bare = _scanPlanSvg({ rooms: [room] }, { lens: 'plan' });
        return {
          title: /Patterson scan/.test(sheet), addr: /12 Elm St/.test(sheet),
          total: /Approximately 120 sq ft total/.test(sheet),
          scaleBar: /\d+ ft<\/text>/.test(sheet) && /Measured with TradeDesk/.test(sheet),
          // A plan embedded as a room picker takes none of it.
          bareHasNoBlock: !/Approximately/.test(bare) && !/Measured with TradeDesk/.test(bare),
          paper: /<rect x="0" y="0" width="100"[^>]*fill="#FFFFFF"/.test(sheet),
          font: /font-family="/.test(sheet),
        };
      }, fabricatedRoom());
      expect(r.title).toBe(true);
      expect(r.addr).toBe(true);
      expect(r.total, 'the total is the number a client looks for first').toBe(true);
      expect(r.scaleBar, 'a scale bar is what makes a printout measurable').toBe(true);
      expect(r.bareHasNoBlock).toBe(true);
      expect(r.paper, 'the sheet is white paper in either theme, it is a document').toBe(true);
      expect(r.font, 'no font-family means the UA serif, which reads as a worksheet').toBe(true);
    });

    test('rooms tint by what they are, and an explicit fill still wins', async () => {
      const r = await page.evaluate((raw) => {
        const mk = (n) => _scanParseRoom(raw, n);
        const svg = _scanPlanSvg({ rooms: [mk('Kitchen'), mk('Primary bath'), mk('Bedroom')] }, { lens: 'plan' });
        const forced = _scanPlanSvg({ rooms: [mk('Kitchen')] }, { lens: 'plan', roomFills: { 0: '#ff0000' } });
        return {
          kitchen: _scanRoomTint('Kitchen'), bath: _scanRoomTint('Primary bath'),
          bed: _scanRoomTint('Bedroom'), unknown: _scanRoomTint('Zebraroom'),
          nameless: _scanRoomTint(null),
          distinct: new Set([_scanRoomTint('Kitchen'), _scanRoomTint('Bath'), _scanRoomTint('Bedroom'), _scanRoomTint('Dining')]).size,
          drawn: (svg.match(/<polygon[^>]*fill="#[0-9A-F]{6}"/gi) || []).length,
          forcedWins: /fill="#ff0000"/.test(forced),
        };
      }, fabricatedRoom());
      expect(r.kitchen).not.toBe(r.bath);
      expect(r.bed).not.toBe(r.kitchen);
      expect(r.distinct, 'four room types, four tints').toBe(4);
      expect(r.unknown, 'an unrecognized name still gets paper, never undefined').toBe(r.nameless);
      expect(r.drawn, 'every room draws its tint').toBe(3);
      expect(r.forcedWins, 'the proposal color-keys priced rooms and that must win').toBe(true);
    });

    test('dimensions are strings around the envelope, chained per room, never floating text', async () => {
      const r = await page.evaluate((raws) => {
        // Second room shifted 5 m east so the top edge breaks into two runs.
        const a = _scanParseRoom(raws[0], 'Kitchen');
        const b = _scanParseRoom(raws[1], 'Bedroom');
        const shift = (rm, dx) => {
          rm.poly = rm.poly.map(([x, z]) => [x + dx, z]);
          rm.walls = rm.walls.map(w => ({ ...w, ax: w.ax + dx, bx: w.bx + dx }));
          return rm;
        };
        shift(b, 5);
        const svg = _scanPlanSvg({ rooms: [a, b] }, { lens: 'plan' });
        const runsTop = _scanSideRuns([a, b], 'top', -1.83, -1.53, 6.83, 1.53);
        return {
          topRuns: runsTop.length,
          // Two per-room runs plus the overall = 3 figures across the top.
          figures: (svg.match(/12'0"/g) || []).length,
          overall: svg.includes(_scanFtIn(runsTop[runsTop.length - 1][1] - runsTop[0][0])),
          // Ticks and extension lines are what make it a dimension STRING.
          ticks: (svg.match(/stroke="#98A0AE"/g) || []).length,
          rotatedSide: /rotate\(-90\)/.test(svg),
          merges: _scanSideRuns([a, a], 'top', -1.83, -1.53, 1.83, 1.53).length,
          none: _scanSideRuns([], 'top', 0, 0, 1, 1).length,
        };
      }, twoUp());
      expect(r.topRuns, 'two rooms reaching the top edge, two runs').toBe(2);
      expect(r.figures, 'each run is dimensioned').toBeGreaterThanOrEqual(2);
      expect(r.overall, 'and an overall run outside them').toBe(true);
      expect(r.ticks, 'extension lines, dimension lines, and tick marks').toBeGreaterThan(10);
      expect(r.rotatedSide, 'the left and right figures read up the page').toBe(true);
      expect(r.merges, 'two rooms on the same span merge into one dimension').toBe(1);
      expect(r.none, 'no rooms on a side draws no string').toBe(0);
    });
  });

  // Owner review (2026-08-10): "arches are rendering as squares, I want exact
  // furniture markings to come through in grave detail."
  test.describe('archways are not doors, and the furniture RoomPlan sees gets drawn', () => {
    // Same 12x10 room, plus a 5 ft archway on the west wall and four pieces of
    // furniture, one of them sitting at 30 degrees to the walls.
    const furnished = () => {
      const raw = JSON.parse(fabricatedRoom());
      const W = 3.048, L = 3.6576;
      raw.openings = [{
        identifier: 'op-1', parentIdentifier: 'w-w', category: { opening: {} },
        dimensions: [1.524, 2.1336, 0],
        transform: [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, -L / 2, 1.06, 0, 1],
      }];
      const obj = (cat, cx, cz, w, d, deg) => {
        const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
        return { identifier: cat, category: { [cat]: {} }, dimensions: [w, 0.8, d],
                 transform: [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, cx, 0.4, cz, 1] };
      };
      raw.objects = [obj('sofa', -0.9, -1.0, 2.0, 0.9, 0), obj('bed', 1.0, 0.6, 1.5, 2.0, 30),
                     obj('toilet', -1.5, 1.0, 0.5, 0.75, 0), obj('stove', 1.2, -1.1, 0.76, 0.65, 0)];
      return JSON.stringify(raw);
    };

    test('an archway punches the wall, caps its jambs, and never grows a door swing', async () => {
      const r = await page.evaluate((raw) => {
        const room = _scanParseRoom(raw, 'Kitchen');
        const svg = _scanPlanSvg({ rooms: [room] }, { lens: 'plan' });
        const westDoors = room.walls.find(w => w.doors.some(d => d.kind === 'opening'));
        return {
          kinds: room.walls.flatMap(w => w.doors.map(d => d.kind)).sort().join(),
          winKind: room.walls.flatMap(w => w.windows.map(d => d.kind)).join(),
          // ONE swing arc for the ONE real door. The archway used to draw a
          // second leaf plus arc, which is what read as a square door.
          swings: (svg.match(/ A [\d.]+ [\d.]+ 0 0 [01] /g) || []).length,
          header: (svg.match(/stroke-dasharray/g) || []).length,
          breaksWallSpace: !!westDoors,
        };
      }, furnished());
      expect(r.kinds, 'an opening rides in the wall door list, tagged as itself').toBe('door,opening');
      expect(r.winKind).toBe('window');
      expect(r.swings, 'one swing for the one door that actually swings').toBe(1);
      expect(r.header, 'the archway draws a dashed header instead').toBe(1);
      expect(r.breaksWallSpace, 'the NEC engine still sees it break the wall').toBe(true);
    });

    test('furniture parses with its footprint and the angle it really sits at', async () => {
      const r = await page.evaluate((raw) => {
        const room = _scanParseRoom(raw, 'Kitchen');
        const bed = (room.objects || []).find(o => o.cat === 'bed');
        return {
          cats: (room.objects || []).map(o => o.cat).join(),
          bedDeg: bed && Math.round(Math.atan2(bed.uz, bed.ux) * 180 / Math.PI),
          bedDepth: bed && +bed.d.toFixed(2),
          bedH: bed && +bed.h.toFixed(2),
          unit: bed && +Math.hypot(bed.ux, bed.uz).toFixed(3),
          noObjects: (_scanParseRoom(JSON.stringify({ walls: [], objects: null }), 'X') || {}).objects,
        };
      }, furnished());
      expect(r.cats).toBe('sofa,bed,toilet,stove');
      expect(r.bedDeg, 'a bed at 30 degrees stays at 30 degrees').toBe(30);
      expect(r.bedDepth, 'depth comes off the transform, it is not guessed').toBe(2);
      expect(r.bedH, 'the measured height rides along for the 3D model').toBe(0.8);
      expect(r.unit, 'the axis is normalized so the symbol never stretches').toBe(1);
      expect(r.noObjects, 'a scan with no objects still parses').toEqual([]);
    });

    test('each piece draws its own plan symbol, rotated, lighter than the walls', async () => {
      const r = await page.evaluate((raw) => {
        const svg = _scanPlanSvg({ rooms: [_scanParseRoom(raw, 'Kitchen')] }, { lens: 'plan' });
        return {
          groups: (svg.match(/<g class="td-obj"/g) || []).length,
          rotated: /rotate\(30\.0\)/.test(svg),
          burners: (svg.match(/<circle[^>]*stroke-width="0\.25"/g) || []).length,
          bowl: /<ellipse/.test(svg),
          // Furniture must never out-weigh the poché or the plan turns to soup.
          lighter: /stroke-width="0\.25"/.test(svg) && !/stroke-width="0\.25"[^>]*stroke-linecap="square"/.test(svg),
          // Symbols sit UNDER the walls: the first wall line comes after the
          // last furniture group in the string.
          under: svg.lastIndexOf('rotate(30.0)') < svg.indexOf('stroke-linecap="square"'),
          haloed: /paint-order="stroke"/.test(svg),
        };
      }, furnished());
      expect(r.groups, 'four pieces, four placed symbols').toBe(4);
      expect(r.rotated, 'the symbol is rotated, not squared up to the page').toBe(true);
      expect(r.burners, 'a stove draws its burners and a toilet its bowl').toBeGreaterThanOrEqual(4);
      expect(r.bowl).toBe(true);
      expect(r.lighter).toBe(true);
      expect(r.under, 'walls draw on top of furniture').toBe(true);
      expect(r.haloed, 'room labels clear the furniture beneath them').toBe(true);
    });

    test('a tiny or malformed object degrades to its footprint instead of throwing', async () => {
      const r = await page.evaluate(() => {
        const room = { label: 'X', poly: [[0, 0], [3, 0], [3, 3], [0, 3]], walls: [], wallM2: 1, floorM2: 9,
          objects: [{ cat: 'sofa', cx: 1, cz: 1, w: 0.1, d: 0.1, ux: 1, uz: 0 },
                    { cat: 'nothing-we-know', cx: 2, cz: 2, w: 1, d: 1, ux: 1, uz: 0 },
                    { cat: 'bed', cx: 2, cz: 1, w: 0, d: 1, ux: 1, uz: 0 },
                    null] };
        let threw = null;
        let svg = '';
        try { svg = _scanPlanSvg({ rooms: [room] }, { lens: 'plan' }); } catch (e) { threw = String(e); }
        return { threw, groups: (svg.match(/<g class="td-obj"/g) || []).length };
      });
      expect(r.threw).toBe(null);
      expect(r.groups, 'a zero-width object is skipped; the other two still draw').toBe(2);
    });
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

  // The trust rule (research 2026-08-09): auto-generated numbers the
  // contractor can't inspect, correct, and undo are the top rage point on
  // competitor apps. Every measured quantity adjusts in one tap, adjusted
  // numbers LOOK adjusted, and the scan value restores in one more tap.
  test('a measured number adjusts in one tap, wears its provenance, and restores to the scan value', async () => {
    const r = await page.evaluate(async (raw) => {
      const savedScans = scans.slice(), savedClients = clients.slice(), savedRates = S.scanRates;
      try {
        S.scanRates = { wall: 2, ceiling: 0, trimLf: 0, door: 0, window: 0 };
        clients.push({ id: 77601, name: 'Adjust Client' });
        scans.push({ id: 'sc-adjust', clientId: 77601, name: 'Adjust scan', createdAt: new Date().toISOString(), rooms: [_scanParseRoom(raw, 'Kitchen')], photos: [] });
        openScanEstimate(clients.find(c => c.id === 77601));
        const measuredTotal = _seTotal();                       // 352 x $2
        _seEditQty(0, 'wall');
        const modal = document.getElementById('_se-qty-ov')?.textContent || '';
        const showsMeasured = /Measured by scan: 352 sq ft/.test(modal);
        document.getElementById('_se-qty-inp').value = '400';
        _seSaveQty(0, 'wall');
        const adjustedTotal = _seTotal();                       // 400 x $2
        const line = _seRoomLines(_seState.scan.rooms[0], _seState.rooms[0])[0];
        const provenance = line.notes;
        const chipHtml = document.getElementById('se-room-0')?.innerHTML || '';
        const chipAdjusted = /Walls · 400\*/.test(chipHtml) && /#D97706/.test(chipHtml);
        _seEditQty(0, 'wall');
        const hasRestore = /Restore 352/.test(document.getElementById('_se-qty-ov')?.textContent || '');
        _seRestoreQty(0, 'wall');
        const restoredTotal = _seTotal();
        const restoredNotes = _seRoomLines(_seState.scan.rooms[0], _seState.rooms[0])[0].notes;
        document.getElementById('_se-ov')?.remove(); _seState = null;
        return { measuredTotal, showsMeasured, adjustedTotal, provenance, chipAdjusted, hasRestore, restoredTotal, restoredNotes };
      } finally {
        scans.length = 0; savedScans.forEach(x => scans.push(x));
        clients.length = 0; savedClients.forEach(x => clients.push(x));
        S.scanRates = savedRates; saveAll();
        document.getElementById('_se-qty-ov')?.remove();
        document.getElementById('_se-ov')?.remove(); _seState = null;
      }
    }, fabricatedRoom());
    expect(r.measuredTotal).toBe(704);
    expect(r.showsMeasured, 'the adjuster names the measured value').toBe(true);
    expect(r.adjustedTotal, '400 sq ft at $2 reprices live').toBe(800);
    expect(r.provenance).toContain('Adjusted from measured 352 sq ft');
    expect(r.chipAdjusted, 'an adjusted chip goes amber with a star, never passes as measured').toBe(true);
    expect(r.hasRestore).toBe(true);
    expect(r.restoredTotal, 'one tap back to the scan').toBe(704);
    expect(r.restoredNotes).toContain('Measured by LiDAR scan');
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

  // Owner (2026-08-10): "3d needs its shine." The shine is the furniture: the
  // parts library is pure data so these run without a GL context.
  test.describe('3D furniture: real parts, measured heights, a layer pill', () => {
    test('each category builds an assembly, inside its own footprint', async () => {
      const r = await page.evaluate(() => {
        const inside = (parts, w, d) => parts.every(p => {
          const hx = p.shape === 'cyl' ? p.r : p.w / 2, hz = p.shape === 'cyl' ? p.r : p.d / 2;
          return Math.abs(p.x) + hx <= w / 2 + 0.02 && Math.abs(p.z) + hz <= d / 2 + 0.02 && p.y - p.h / 2 >= -0.01;
        });
        const bed = _scan3dFurnSpec('bed', 1.5, 2.0, 0.6);
        const stove = _scan3dFurnSpec('stove', 0.76, 0.65, 0.9);
        const toilet = _scan3dFurnSpec('toilet', 0.5, 0.75, 0);
        const table = _scan3dFurnSpec('table', 1.2, 0.7, 0.74);
        const mystery = _scan3dFurnSpec('hoverboard-dock', 1, 0.5, 0);
        return {
          bedParts: bed.length, bedInside: inside(bed, 1.5, 2.0),
          burners: stove.filter(p => p.shape === 'cyl').length,
          bowl: toilet.some(p => p.shape === 'cyl'),
          legs: table.filter(p => p.h > 0.5).length,
          mysteryBox: mystery.length === 1 && mystery[0].shape === 'box',
          mysteryH: mystery[0].y * 2,
        };
      });
      expect(r.bedParts, 'a bed is frame + mattress + pillow, not one slab').toBeGreaterThanOrEqual(3);
      expect(r.bedInside, 'no part sticks out of the measured footprint').toBe(true);
      expect(r.burners, 'a stove shows its burners from above').toBe(4);
      expect(r.bowl, 'a toilet has a round bowl').toBe(true);
      expect(r.legs, 'a table stands on four legs').toBe(4);
      expect(r.mysteryBox, 'an unknown category degrades to its box').toBe(true);
      expect(r.mysteryH, 'and takes the generic fallback height').toBeCloseTo(0.75, 5);
    });

    test('the height the scan measured wins over the category default', async () => {
      const r = await page.evaluate(() => {
        const top = parts => Math.max(...parts.map(p => p.y + p.h / 2));
        return {
          measured: top(_scan3dFurnSpec('storage', 1, 0.5, 2.3)),
          fallback: top(_scan3dFurnSpec('storage', 1, 0.5, 0)),
          junk: top(_scan3dFurnSpec('storage', 1, 0.5, 0.02)),
        };
      });
      expect(r.measured, 'a 2.3 m wardrobe models at 2.3 m').toBeCloseTo(2.3, 5);
      expect(r.fallback).toBeCloseTo(1.1, 5);
      expect(r.junk, 'a degenerate 2 cm box falls back instead of modeling a coaster').toBeCloseTo(1.1, 5);
    });

    test('the viewer offers the Furniture pill only when there is furniture', async () => {
      const r = await page.evaluate(async (raw) => {
        const before = scans.length;
        try {
          const furnished = _scanParseRoom(raw, 'Kitchen');
          furnished.objects = [{ cat: 'sofa', cx: 0, cz: 0, w: 2, d: 0.9, h: 0.8, ux: 1, uz: 0 }];
          const bare = _scanParseRoom(raw, 'Hall');
          const sc1 = saveScan({ id: 'sc-furn', clientId: null, name: 'Furnished', createdAt: new Date().toISOString(), rooms: [furnished], photos: [], price: null, purchasedAt: null });
          await _scan3dOpen(sc1.id);
          const withPill = !!document.getElementById('_s3d-furn-btn');
          const toggleSafe = (() => { try { _scan3dToggleFurn(); return true; } catch (e) { return false; } })();
          _scan3dClose();
          const sc2 = saveScan({ id: 'sc-bare', clientId: null, name: 'Bare', createdAt: new Date().toISOString(), rooms: [bare], photos: [], price: null, purchasedAt: null });
          await _scan3dOpen(sc2.id);
          const withoutPill = !!document.getElementById('_s3d-furn-btn');
          _scan3dClose();
          return { withPill, toggleSafe, withoutPill };
        } finally { scans.length = before; saveAll(); _scan3dClose(); }
      }, fabricatedRoom());
      expect(r.withPill, 'furniture in the scan, pill on the glass').toBe(true);
      expect(r.toggleSafe, 'toggling with no GL context must not throw').toBe(true);
      expect(r.withoutPill, 'no furniture, no dead pill').toBe(false);
    });
  });

  // Owner (2026-08-10): "show the client a scan, have them pick their color
  // and show what it would look like on the wall."
  test.describe('paint mode: the client picks a color on their own walls', () => {
    test('what the client picked saves onto the scan record, name and all', async () => {
      const r = await page.evaluate(() => {
        const before = scans.length;
        try {
          const sc = { id: 'sc-paint', name: 'Paint', rooms: [], photos: [] };
          _scan3dSetPaint(sc, _scan3dPaintKey(0, 'w-n'), '#D1CBC1', 'Agreeable Gray SW 7029');
          const stored = sc.wallPaint['0:w-n'];
          const named = sc.wallPaintNames['0:w-n'];
          const persisted = scans.some(s => s.id === 'sc-paint');
          _scan3dSetPaint(sc, '0:w-n', null);
          return { stored, named, persisted,
                   cleared: !('0:w-n' in sc.wallPaint) && !('0:w-n' in sc.wallPaintNames),
                   swatches: _S3D_PAINT.length };
        } finally { scans.length = before; saveAll(); }
      });
      expect(r.stored).toBe('#D1CBC1');
      expect(r.named, 'the NAME is what goes on the estimate and the paint order').toBe('Agreeable Gray SW 7029');
      expect(r.persisted, 'the pick rides td_scans, it is on file at estimate time').toBe(true);
      expect(r.cleared, 'reset erases the color and its name together').toBe(true);
      expect(r.swatches).toBe(12);
    });

    // Owner (2026-08-10): "for painters we need to load in sherwin Williams
    // colors." The deck follows the active trade like the scan lenses do.
    test('painters get the Sherwin-Williams deck, other trades the generic one', async () => {
      const r = await page.evaluate(() => {
        const real = typeof _activeTrade !== 'undefined' ? _activeTrade : null;
        try {
          setActiveTrade('painting');
          const sw = _scan3dPalette();
          setActiveTrade('hvac');
          const gen = _scan3dPalette();
          return {
            swBrand: sw.brand, swCount: sw.colors.length,
            allCoded: sw.colors.every(c => /^SW \d{4}$/.test(c[1])),
            hasStaples: ['Agreeable Gray', 'Alabaster', 'Naval', 'Sea Salt']
              .every(n => sw.colors.some(c => c[0] === n)),
            genBrand: gen.brand, genCount: gen.colors.length,
          };
        } finally { setActiveTrade(real); }
      });
      expect(r.swBrand).toBe('Sherwin-Williams');
      expect(r.swCount, 'a real deck, not a token dozen').toBeGreaterThanOrEqual(40);
      expect(r.allCoded, 'every SW color carries its number, that is the language').toBe(true);
      expect(r.hasStaples, 'the staples every painter quotes are in the deck').toBe(true);
      expect(r.genBrand).toBe(null);
      expect(r.genCount).toBe(12);
    });

    test('the textured mesh round-trips and paints without touching the photo elsewhere', async () => {
      const r = await page.evaluate(() => {
        // Two triangles: one flat against a wall, one out in the room.
        const head = JSON.stringify({ v: 1, corners: 6, stride: 20,
          groups: [{ img: '/tmp/kf1.jpg', start: 0, count: 6, gain: 1.12 }] });
        const hb = new TextEncoder().encode(head + '\n');
        const buf = new ArrayBuffer(hb.length + 6 * 20);
        new Uint8Array(buf).set(hb);
        const dv = new DataView(buf, hb.length);
        const corners = [
          [0.5, 1.0, 0.05, 0.1, 0.9], [1.5, 1.0, 0.05, 0.5, 0.9], [1.0, 2.0, 0.05, 0.3, 0.1],
          [0.5, 1.0, 2.0, 0.1, 0.9], [1.5, 1.0, 2.0, 0.5, 0.9], [1.0, 2.0, 2.0, 0.3, 0.1]];
        corners.forEach((c, i) => {
          dv.setFloat32(i * 20, c[0], true); dv.setFloat32(i * 20 + 4, c[1], true);
          dv.setFloat32(i * 20 + 8, c[2], true); dv.setFloat32(i * 20 + 12, c[3], true);
          dv.setFloat32(i * 20 + 16, c[4], true);
        });
        const soup = _scan3dParseTdm(buf);
        const rooms = [{ walls: [{ id: 'w1', ax: 0, az: 0, bx: 3, bz: 0, len: 3, h: 2.4, ey: 1.2 }] }];
        const tint = _scan3dMeshTintTex(soup, rooms, { '0:w1': '#33465E' });
        const bare = _scan3dMeshTintTex(soup, rooms, {});
        return {
          corners: soup && soup.corners, groupImg: soup && soup.groups[0].img,
          gainKept: soup && soup.groups[0].gain === 1.12,
          uvKept: soup && Math.abs(soup.uv[1] - 0.9) < 1e-6,
          wallTinted: tint[2] > tint[0],                        // navy leans blue
          roomLeftAlone: tint[9] === 1 && tint[10] === 1 && tint[11] === 1,
          bareAllWhite: Array.from(bare).every(v => v === 1),
          junkNull: _scan3dParseTdm(new TextEncoder().encode('not json\n').buffer) === null,
        };
      });
      expect(r.corners).toBe(6);
      expect(r.groupImg).toBe('/tmp/kf1.jpg');
      expect(r.gainKept, 'the exposure gain rides the group to the material').toBe(true);
      expect(r.uvKept).toBe(true);
      expect(r.wallTinted, 'the wall corner takes the paint').toBe(true);
      expect(r.roomLeftAlone, 'multiply-white leaves the photo untouched off the wall').toBe(true);
      expect(r.bareAllWhite).toBe(true);
      expect(r.junkNull).toBe(true);
    });

    test('the PLY the phone bakes parses back byte for byte', async () => {
      const r = await page.evaluate(() => {
        const head = 'ply\nformat binary_little_endian 1.0\nelement vertex 3\n' +
          'property float x\nproperty float y\nproperty float z\n' +
          'property uchar red\nproperty uchar green\nproperty uchar blue\n' +
          'element face 1\nproperty list uchar int vertex_indices\nend_header\n';
        const hb = new TextEncoder().encode(head);
        const buf = new ArrayBuffer(hb.length + 3 * 15 + 13);
        new Uint8Array(buf).set(hb);
        const dv = new DataView(buf);
        let o = hb.length;
        [[0, 0, 0, 255, 0, 0], [1, 0, 0, 0, 255, 0], [0, 1, 0, 0, 0, 255]].forEach(v => {
          dv.setFloat32(o, v[0], true); dv.setFloat32(o + 4, v[1], true); dv.setFloat32(o + 8, v[2], true);
          new Uint8Array(buf).set([v[3], v[4], v[5]], o + 12); o += 15;
        });
        new Uint8Array(buf)[o] = 3;
        dv.setUint32(o + 1, 0, true); dv.setUint32(o + 5, 1, true); dv.setUint32(o + 9, 2, true);
        const m = _scan3dParsePly(buf);
        const bad = _scan3dParsePly(new TextEncoder().encode('ply\nformat ascii 1.0\nend_header\n').buffer);
        return { nV: m && m.nV, nF: m && m.nF, x1: m && m.pos[3], red: m && m.col[0],
                 idx: m && Array.from(m.idx).join(), badIsNull: bad === null };
      });
      expect(r.nV).toBe(3);
      expect(r.nF).toBe(1);
      expect(r.x1).toBe(1);
      expect(r.red).toBe(255);
      expect(r.idx).toBe('0,1,2');
      expect(r.badIsNull, 'an ascii or foreign PLY refuses instead of garbling').toBe(true);
    });

    test('painting a wall on the photo mesh tints only that wall and keeps their light', async () => {
      const r = await page.evaluate(() => {
        // Four vertices: dark on-wall, bright on-wall, off-wall, above the band.
        const mesh = { nV: 4,
          pos: new Float32Array([1, 1.2, 0.05, 2, 1.2, 0.05, 1, 1.2, 2.5, 1, 4.0, 0.05]),
          col: new Uint8Array([50, 50, 50, 220, 220, 220, 120, 120, 120, 120, 120, 120]) };
        const rooms = [{ walls: [{ id: 'w1', ax: 0, az: 0, bx: 3, bz: 0, len: 3, h: 2.4, ey: 1.2 }] }];
        const navy = _scan3dMeshTint(mesh, rooms, { '0:w1': '#33465E' });
        const untouched = _scan3dMeshTint(mesh, rooms, {});
        return {
          darkBlue: navy[2] > navy[0], brightBlue: navy[5] > navy[3],
          brighterKept: navy[5] > navy[2],
          offWall: navy[6] === 120 && navy[7] === 120 && navy[8] === 120,
          aboveBand: navy[9] === 120,
          noPaintNoChange: Array.from(untouched).join() === Array.from(mesh.col).join(),
        };
      });
      expect(r.darkBlue, 'a painted vertex leans blue').toBe(true);
      expect(r.brightBlue).toBe(true);
      expect(r.brighterKept, 'the baked lighting survives the recolor').toBe(true);
      expect(r.offWall, 'the sofa two meters away is not painted').toBe(true);
      expect(r.aboveBand, 'the floor above does not catch this floor\'s paint').toBe(true);
      expect(r.noPaintNoChange).toBe(true);
    });

    test('the viewer offers Paint always, Photo only when this phone holds a mesh', async () => {
      const r = await page.evaluate(async (raw) => {
        const before = scans.length;
        try {
          const sc = saveScan({ id: 'sc-pmode', clientId: null, name: 'P', createdAt: new Date().toISOString(), rooms: [_scanParseRoom(raw, 'Kitchen')], photos: [], price: null, purchasedAt: null });
          await _scan3dOpen(sc.id);
          const strip = document.getElementById('_s3d-paint-strip');
          const out = {
            paintPill: !!document.getElementById('_s3d-paint-btn'),
            hiddenUntilOpened: strip && strip.style.display === 'none',
            swatchButtons: strip ? strip.querySelectorAll('[data-hex]').length : 0,
            deckSize: _scan3dPalette().colors.length,
            customWell: !!(strip && strip.querySelector('input[type=color]')),
            fanDeckLine: /confirm/i.test(document.getElementById('_s3d-paint-deck')?.textContent || ''),
            // No mesh on this scan and no plugin on web: no dead Photo pill.
            meshPill: !!document.getElementById('_s3d-mesh-btn'),
          };
          _scan3dClose();
          return out;
        } finally { scans.length = before; saveAll(); _scan3dClose(); }
      }, fabricatedRoom());
      expect(r.paintPill).toBe(true);
      expect(r.hiddenUntilOpened, 'the strip waits behind the pill').toBe(true);
      expect(r.swatchButtons, 'the strip shows the whole active deck').toBe(r.deckSize);
      expect(r.customWell, 'any color, not just the deck').toBe(true);
      expect(r.fanDeckLine, 'the screen-preview honesty line is on the glass').toBe(true);
      expect(r.meshPill).toBe(false);
    });
  });

  // Owner (2026-08-10): "we need photos so we can walk back through it later
  // if we have details that we need to see from actual photos." The walk
  // frames are the job record; these prove the record answers questions.
  test.describe('the walkthrough record: real photos of real spots, later', () => {
    // A camera standing at the origin looking down -z, 4:3 frame.
    const frame = (path, cam) => ({ path, cam, fx: 1500, fy: 1500, cx: 960, cy: 720, w: 1920, h: 1440 });
    const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    // Same camera, moved 3 m along +x (still looking down -z).
    const MOVED = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 0, 0, 1];

    test('the best frame is the one that saw the spot squarely and close', async () => {
      const r = await page.evaluate(({ f0, f3 }) => {
        const sc = { walk: [f0, f3] };
        const ahead = _scanBestFrame(sc, { x: 0, y: 0, z: -2 });
        const nearOther = _scanBestFrame(sc, { x: 3, y: 0, z: -2 });
        const behind = _scanBestFrame(sc, { x: 0, y: 0, z: 5 });
        const tooFar = _scanBestFrame(sc, { x: 0, y: 0, z: -30 });
        const offFrame = _scanBestFrame(sc, { x: -9, y: 0, z: -2 });
        return {
          aheadI: ahead && ahead.i,
          centered: ahead && Math.abs(ahead.u - 960) < 1 && Math.abs(ahead.v - 720) < 1,
          nearI: nearOther && nearOther.i,
          behindNull: behind === null, farNull: tooFar === null, offNull: offFrame === null,
          emptyNull: _scanBestFrame({ walk: [] }, { x: 0, y: 0, z: -1 }) === null,
        };
      }, { f0: frame('/a.jpg', IDENT), f3: frame('/b.jpg', MOVED) });
      expect(r.aheadI, 'the frame that stood in front of the spot wins').toBe(0);
      expect(r.centered, 'a dead-ahead spot projects to the frame center').toBe(true);
      expect(r.nearI, 'the spot in front of the OTHER camera picks that one').toBe(1);
      expect(r.behindNull, 'a spot behind every lens has no photo').toBe(true);
      expect(r.farNull).toBe(true);
      expect(r.offNull, 'edge-of-frame sightings do not count as seeing it').toBe(true);
      expect(r.emptyNull).toBe(true);
    });

    test('re-walking shows the frames in order, wraps, and pins the tapped detail', async () => {
      const r = await page.evaluate(({ f0, f3 }) => {
        const before = scans.length;
        try {
          saveScan({ id: 'sc-walk', clientId: null, name: 'Walk', createdAt: new Date().toISOString(),
                     rooms: [], photos: [], walk: [f0, f3], price: null, purchasedAt: null });
          _scanOpenWalk('sc-walk', 0, { u: 960, v: 360 });
          let ov = document.getElementById('_scan-photo-ov');
          const first = /1 of 2/.test(ov?.textContent || '');
          const inOrder = /the walk, in order/.test(ov?.textContent || '');
          const mark = ov?.querySelector('div[style*="border-radius:50%"]');
          const markLeft = mark && /left:50/.test(mark.getAttribute('style'));
          const markTop = mark && /top:25/.test(mark.getAttribute('style'));
          _scanOpenWalk('sc-walk', -1);
          ov = document.getElementById('_scan-photo-ov');
          const wrapped = /2 of 2/.test(ov?.textContent || '');
          const noMark = !ov?.querySelector('div[style*="border-radius:50%"]');
          ov?.remove();
          return { first, inOrder, markLeft, markTop, wrapped, noMark };
        } finally { scans.length = before; saveAll(); document.getElementById('_scan-photo-ov')?.remove(); }
      }, { f0: frame('/a.jpg', IDENT), f3: frame('/b.jpg', MOVED) });
      expect(r.first).toBe(true);
      expect(r.inOrder, 'prev and next ARE re-walking the house').toBe(true);
      expect(r.markLeft, 'the crosshair lands where the detail projects (u 960/1920)').toBe(true);
      expect(r.markTop, 'and v 360/1440').toBe(true);
      expect(r.wrapped, 'stepping back from the first wraps to the last').toBe(true);
      expect(r.noMark, 'plain browsing carries no stale crosshair').toBe(true);
    });

    test('walk dots ride the plan, small and apart from the numbered shutter pins', async () => {
      const r = await page.evaluate((raw) => {
        const room = _scanParseRoom(raw, 'Kitchen');
        const cam = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, 1.4, 0.5, 1];
        const sc = { rooms: [room], walk: [{ path: '/w.jpg', cam, fx: 1, fy: 1, cx: 1, cy: 1, w: 2, h: 2 }] };
        const withWalk = _scanPlanSvg(sc, { lens: 'plan', scanId: 's1', walk: sc.walk });
        const without = _scanPlanSvg(sc, { lens: 'plan', scanId: 's1' });
        return {
          dot: /_scanOpenWalk\('s1',0\)/.test(withWalk),
          small: /r="1\.1" fill="#8A9BB0"/.test(withWalk),
          none: !/_scanOpenWalk/.test(without),
        };
      }, fabricatedRoom());
      expect(r.dot, 'tap a dot, stand there again').toBe(true);
      expect(r.small).toBe(true);
      expect(r.none, 'no walk, no dots').toBe(true);
    });

    test('the walkthrough saves onto the scan record from the capture result', async () => {
      const r = await page.evaluate(() => {
        const sc = { walk: [{ path: '/w1.jpg', cam: new Array(16).fill(0), fx: 1, fy: 1, cx: 1, cy: 1, w: 4, h: 3 }] };
        // The save path maps result.walk field for field; prove the mapping
        // shape here so a Swift-side rename cannot silently drop the record.
        const mapped = (sc.walk || []).map(k => ({ path: k.path, cam: k.cam, fx: k.fx, fy: k.fy, cx: k.cx, cy: k.cy, w: k.w, h: k.h }));
        return { keys: Object.keys(mapped[0]).sort().join(), n: mapped.length };
      });
      expect(r.keys).toBe('cam,cx,cy,fx,fy,h,path,w');
      expect(r.n).toBe(1);
    });
  });

  // Owner (2026-08-10): "there is no way to cancel a previous scan and start
  // over or add to it, why." Adding rides the saved ARWorldMap; these prove
  // the merge math and the gating.
  test.describe('growing a scan: add rooms later, or start it over', () => {
    test('a resumed capture folds into the scan without disturbing what was there', async () => {
      const r = await page.evaluate((raw) => {
        const before = scans.length;
        try {
          const sc = saveScan({ id: 'sc-grow', clientId: 5, name: 'Grow', createdAt: new Date().toISOString(),
            rooms: [_scanParseRoom(raw, 'Kitchen')],
            photos: [{ path: '/p0.jpg', cam: [], room: 0 }],
            walk: [{ path: '/w0.jpg', cam: [], fx: 1, fy: 1, cx: 1, cy: 1, w: 4, h: 3 }],
            usdz: '/old.usdz', meshTex: '/old.tdm', meshPly: null, worldMap: '/old.armap',
            wallPaint: { '0:w-n': '#9CAF88' }, price: null, purchasedAt: null });
          const res = { rooms: [raw], labels: ['Addition'], stories: [2],
            photos: [{ path: '/p1.jpg', cam: [], room: 0 }],
            walk: [{ path: '/w1.jpg', cam: [], fx: 1, fy: 1, cx: 1, cy: 1, w: 4, h: 3 }],
            usdz: '/new.usdz', meshTex: '/new.tdm', meshPly: '/new.ply', worldMap: '/new.armap' };
          const merged = _scanMergeResult(sc, res);
          const empty = _scanMergeResult(sc, { rooms: [] });
          return {
            rooms: merged.rooms.length,
            newLabel: merged.rooms[1].label, newStory: merged.rooms[1].story,
            photoShift: merged.photos[1].room,
            walkGrew: merged.walk.length,
            oldUsdzKept: merged.usdz, oldTexKept: merged.meshTex,
            plyFilled: merged.meshPly,
            mapUpdated: merged.worldMap,
            paintSurvives: merged.wallPaint['0:w-n'],
            emptyNull: empty === null, emptyNoMutate: sc.rooms.length === 2,
          };
        } finally { scans.length = before; saveAll(); }
      }, fabricatedRoom());
      expect(r.rooms).toBe(2);
      expect(r.newLabel).toBe('Addition');
      expect(r.newStory).toBe(2);
      expect(r.photoShift, 'new photos index against the grown room list').toBe(1);
      expect(r.walkGrew).toBe(2);
      expect(r.oldUsdzKept, 'a filled artifact slot is kept, it covers more rooms').toBe('/old.usdz');
      expect(r.oldTexKept).toBe('/old.tdm');
      expect(r.plyFilled, 'an empty slot takes the new file').toBe('/new.ply');
      expect(r.mapUpdated, 'the newest map is the one that relocalizes best').toBe('/new.armap');
      expect(r.paintSurvives, 'room indexes never move, so the client\'s colors hold').toBe('#9CAF88');
      expect(r.emptyNull, 'a cancelled or empty capture merges nothing').toBe(true);
      expect(r.emptyNoMutate).toBe(true);
    });

    test('Add rooms needs the world map on this phone; Start over just needs a scanner', async () => {
      const r = await page.evaluate((raw) => {
        const before = scans.length, realCap = window.Capacitor;
        try {
          const mk = (id, map) => saveScan({ id, clientId: null, name: id, createdAt: new Date().toISOString(),
            rooms: [_scanParseRoom(raw, 'Kitchen')], photos: [], worldMap: map, price: null, purchasedAt: null });
          mk('sc-map', '/m.armap'); mk('sc-nomap', null);
          const open = (id) => {
            _scanViewLens = 'plan'; openScanViewer(id);
            const h = document.getElementById('_scan-view-ov')?.innerHTML || '';
            document.getElementById('_scan-view-ov')?.remove();
            return h;
          };
          const webH = open('sc-map');
          window.Capacitor = { isNativePlatform: () => true, registerPlugin: () => ({}) };
          const shellMap = open('sc-map');
          const shellNoMap = open('sc-nomap');
          return {
            webHasNeither: !/Add rooms|Start over/.test(webH),
            shellBoth: /Add rooms/.test(shellMap) && /Start over/.test(shellMap),
            shellNoMapOnlyOver: !/Add rooms/.test(shellNoMap) && /Start over/.test(shellNoMap),
          };
        } finally {
          window.Capacitor = realCap; scans.length = before; saveAll();
          document.getElementById('_scan-view-ov')?.remove();
        }
      }, fabricatedRoom());
      expect(r.webHasNeither, 'web cannot scan, so it offers neither').toBe(true);
      expect(r.shellBoth).toBe(true);
      expect(r.shellNoMapOnlyOver, 'no saved map, no Add rooms, never a dead button').toBe(true);
    });
  });

  // Scanning is hardware (owner 2026-08-09): a phone with no LiDAR can never do
  // it, so the card greys out and explains itself instead of failing on tap.
  // Capability comes from RoomPlan's own probe, cached; there is deliberately
  // no hardcoded model list anywhere in the logic.
  test('the estimate-type chooser leads with Scan Estimate on a phone that can scan', async () => {
    const r = await page.evaluate(() => {
      const real = window._scanCapable;
      window._scanCapable = () => true;
      try {
        _showEstimateStylePicker({ id: 901, name: 'Chooser Client' });
        const ov = document.getElementById('_style-pick-ov');
        const html = ov ? ov.innerHTML : '';
        return {
          hasScanCard: /Scan Estimate/.test(html) && /Measured by LiDAR/.test(html),
          scanFirst: html.indexOf('Scan Estimate') < html.indexOf('Build Your Own'),
          notGreyed: !/grayscale/.test(html),
        };
      } finally {
        window._scanCapable = real;
        document.getElementById('_style-pick-ov')?.remove(); window._stylePickState = null;
      }
    });
    expect(r.hasScanCard).toBe(true);
    expect(r.scanFirst, 'the flagship type leads the chooser').toBe(true);
    expect(r.notGreyed).toBe(true);
  });

  test('no LiDAR: the scan card greys out, explains itself, and never opens the builder', async () => {
    const r = await page.evaluate(() => {
      const realOpen = window.openScanEstimate;
      let opened = 0;
      window.openScanEstimate = () => { opened++; };
      try {
        // A plain browser has no scanner plugin, so _scanCapable() is already false.
        _showEstimateStylePicker({ id: 902, name: 'No LiDAR Client' });
        const html = document.getElementById('_style-pick-ov')?.innerHTML || '';
        const greyed = /grayscale/.test(html) && /Needs a Pro iPhone/.test(html);
        const routesToWhy = /_scanWhyNoLidar\(\)/.test(html) && !/_pickEstStyle\('scan'\)/.test(html);
        // The one entry point refuses too, even if something calls it directly.
        _pickEstStyle('scan');
        const why = document.getElementById('_scan-why-ov');
        const explains = !!why && /12 Pro/.test(why.textContent) && /Pro Max/.test(why.textContent);
        // The other two types are untouched.
        const othersLive = /_pickEstStyle\('freeform'\)/.test(html) && /_pickEstStyle\('tm'\)/.test(html);
        return { greyed, routesToWhy, opened, explains, othersLive };
      } finally {
        window.openScanEstimate = realOpen;
        document.getElementById('_scan-why-ov')?.remove();
        document.getElementById('_style-pick-ov')?.remove(); window._stylePickState = null;
      }
    });
    expect(r.greyed, 'the card is visibly disabled, not silently broken').toBe(true);
    expect(r.routesToWhy, 'tapping it explains rather than starting a scan').toBe(true);
    expect(r.opened, 'the builder never opens without a scanner').toBe(0);
    expect(r.explains, 'the explainer names the phones that work').toBe(true);
    expect(r.othersLive, 'Build Your Own and T&M stay fully available').toBe(true);
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
});
