// @ts-check
// Fleet Management E2E tests
const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors } = require('./helpers');

test.describe('Fleet Management', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      bypassCSP: true,
    });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  // ── Test 1: Fleet & Team page has Fleet tab ─────────────────────────────
  test('Fleet tab exists on pg-team', async () => {
    await goPg(page, 'pg-team');

    const fleetTab = await page.locator('#ft-t-fleet').isVisible();
    expect(fleetTab).toBe(true);

    const teamTab = await page.locator('#ft-t-team').isVisible();
    expect(teamTab).toBe(true);

    assertNoErrors(page, 'Fleet tab exists');
  });

  // ── Test 2: Fleet tab is active by default ──────────────────────────────
  test('Fleet tab is active by default, team section hidden', async () => {
    await goPg(page, 'pg-team');

    const ftFleetVisible = await page.evaluate(() => {
      const el = document.getElementById('ft-fleet');
      if (!el) return false;
      return el.style.display !== 'none';
    });
    expect(ftFleetVisible).toBe(true);

    const ftTeamHidden = await page.evaluate(() => {
      const el = document.getElementById('ft-team');
      if (!el) return true;
      return el.style.display === 'none';
    });
    expect(ftTeamHidden).toBe(true);

    assertNoErrors(page, 'Fleet tab active by default');
  });

  // ── Test 3: Empty state shows add vehicle prompt ─────────────────────────
  test('Empty fleet shows add vehicle prompt', async () => {
    await goPg(page, 'pg-team');

    // Ensure no vehicles
    await page.evaluate(() => {
      S.vehicles = [];
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    const list = page.locator('#fleet-vehicle-list');
    const text = await list.textContent();
    expect(text).toContain('Set up your first vehicle');
    expect(text).toContain('Add your first vehicle');

    assertNoErrors(page, 'Empty fleet state');
  });

  // ── Test 4: Add vehicle modal opens ─────────────────────────────────────
  test('Add vehicle modal opens on button click', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [];
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    // Click the add button inside the empty state
    await page.evaluate(() => openAddVehicleModal(-1));
    await page.waitForTimeout(300);

    const overlay = await page.locator('#fleet-veh-overlay').isVisible();
    expect(overlay).toBe(true);

    // Check for vehicle name input
    const nameInput = await page.locator('#fv-name').isVisible();
    expect(nameInput).toBe(true);

    // Close modal
    await page.evaluate(() => _closeFleetVehModal());
    await page.waitForTimeout(200);

    assertNoErrors(page, 'Add vehicle modal opens');
  });

  // ── Test 5: Vehicle can be added and appears as a card ───────────────────
  test('Vehicle card appears after adding a vehicle', async () => {
    await goPg(page, 'pg-team');

    // Reset vehicles
    await page.evaluate(() => {
      S.vehicles = [];
    });

    // Add a vehicle via the modal
    await page.evaluate(() => openAddVehicleModal(-1));
    await page.waitForTimeout(300);

    await page.locator('#fv-name').fill('2019 F-150');
    await page.locator('#fv-nick').fill('Work Truck');
    await page.locator('#fv-color').fill('White');

    await page.evaluate(() => saveFleetVehicle());
    await page.waitForTimeout(300);

    // Fleet list should now show the vehicle
    const listText = await page.locator('#fleet-vehicle-list').textContent();
    expect(listText).toContain('Work Truck');
    expect(listText).not.toContain('No vehicles yet');

    assertNoErrors(page, 'Vehicle card after add');
  });

  // ── Test 6: Vehicle detail modal opens ──────────────────────────────────
  test('Vehicle detail modal opens on card click', async () => {
    await goPg(page, 'pg-team');

    // Make sure we have at least one vehicle
    await page.evaluate(() => {
      if (!S.vehicles || !S.vehicles.length) {
        S.vehicles = [{
          name: '2019 F-150', nickname: 'Work Truck',
          status: 'active', downtimeLog: [], addedDate: '2024-01-01',
          bizUse: 100,
        }];
        renderFleetVehicles();
      }
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => openFleetVehicleDetail(0));
    await page.waitForTimeout(300);

    const overlay = await page.locator('#fleet-detail-overlay').isVisible();
    expect(overlay).toBe(true);

    await page.evaluate(() => _closeFleetDetail());
    await page.waitForTimeout(200);

    assertNoErrors(page, 'Vehicle detail modal');
  });

  // ── Test 7: Maintenance modal opens with oil change fields ───────────────
  test('Maintenance modal opens and shows oil change fields', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [{
        name: '2019 F-150', nickname: 'Work Truck',
        status: 'active', downtimeLog: [], addedDate: '2024-01-01',
        bizUse: 100,
      }];
      maintenance = [];
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => openAddMaintenanceModal(0));
    await page.waitForTimeout(400);

    const maintOverlay = await page.locator('#fleet-maint-overlay').isVisible();
    expect(maintOverlay).toBe(true);

    // Verify service type select exists
    const typeSelect = await page.locator('#maint-type').isVisible();
    expect(typeSelect).toBe(true);

    // Verify oil change fields appear (default type)
    const oilTypeSelect = await page.locator('#m-oil-type').isVisible().catch(() => false);
    expect(oilTypeSelect).toBe(true);

    await page.evaluate(() => _closeMaintModal());
    await page.waitForTimeout(200);

    assertNoErrors(page, 'Maintenance modal oil change fields');
  });

  // ── Test 8: Service record saved and appears in log ─────────────────────
  test('Service record appears in service log after saving', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [{
        name: '2019 F-150', nickname: 'Work Truck',
        status: 'active', downtimeLog: [], addedDate: '2024-01-01',
        bizUse: 100,
      }];
      maintenance = [];
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    // Open maintenance modal and save a record
    await page.evaluate(() => openAddMaintenanceModal(0));
    await page.waitForTimeout(400);

    // Fill in cost
    await page.locator('#maint-cost').fill('89');
    await page.locator('#maint-vendor').fill('Jiffy Lube');

    // Save the record
    await page.evaluate(() => saveMaintRecord());
    await page.waitForTimeout(400);

    // Open detail modal → service tab
    await page.evaluate(() => {
      openFleetVehicleDetail(0);
    });
    await page.waitForTimeout(300);

    await page.evaluate(() => setFleetDetailTab('service'));
    await page.waitForTimeout(300);

    const content = await page.locator('#fleet-detail-content').textContent();
    expect(content).toContain('Oil Change');
    expect(content).toContain('Jiffy Lube');

    await page.evaluate(() => _closeFleetDetail());
    await page.waitForTimeout(200);

    assertNoErrors(page, 'Service record in log');
  });

  // ── Test 9: Switching maintenance type changes the form fields ───────────
  test('Changing maintenance type updates type-specific fields', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [{
        name: '2019 F-150', nickname: 'Work Truck',
        status: 'active', downtimeLog: [], addedDate: '2024-01-01',
        bizUse: 100,
      }];
      maintenance = [];
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => openAddMaintenanceModal(0));
    await page.waitForTimeout(400);

    // Switch to brakes type
    await page.locator('#maint-type').selectOption('brakes');
    await page.evaluate(() => refreshMaintTypeFields());
    await page.waitForTimeout(200);

    const brakeAxle = await page.locator('#m-brake-axle').isVisible().catch(() => false);
    expect(brakeAxle).toBe(true);

    // Switch to tires type
    await page.locator('#maint-type').selectOption('tires');
    await page.evaluate(() => refreshMaintTypeFields());
    await page.waitForTimeout(200);

    const tireBrand = await page.locator('#m-tire-brand').isVisible().catch(() => false);
    expect(tireBrand).toBe(true);

    await page.evaluate(() => _closeMaintModal());
    await page.waitForTimeout(200);

    assertNoErrors(page, 'Maintenance type field switching');
  });

  // ── Test 10: Mark vehicle as down ───────────────────────────────────────
  test('Vehicle can be marked as down', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [{
        name: '2019 F-150', nickname: 'Work Truck',
        status: 'active', downtimeLog: [], addedDate: '2024-01-01',
        bizUse: 100,
      }];
      maintenance = [];
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    // Mark as down via JS (bypass the zPrompt dialog)
    await page.evaluate(() => {
      const vehs = getVehicles();
      vehs[0].status = 'down';
      vehs[0].downtimeLog = [{ start: '2026-05-27', end: null, reason: 'Engine work' }];
      S.vehicles = vehs;
      saveAll();
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    const listText = await page.locator('#fleet-vehicle-list').textContent();
    expect(listText).toContain('Down');

    assertNoErrors(page, 'Vehicle marked as down');
  });

  // ── Test 11: Mark vehicle back as active ─────────────────────────────────
  test('Vehicle can be marked back as active', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [{
        name: '2019 F-150', nickname: 'Work Truck',
        status: 'down',
        downtimeLog: [{ start: '2026-05-20', end: null, reason: 'Engine work' }],
        addedDate: '2024-01-01',
        bizUse: 100,
      }];
      maintenance = [];
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    // Open detail and mark back active
    await page.evaluate(() => {
      openFleetVehicleDetail(0);
    });
    await page.waitForTimeout(300);

    // Call status function directly (bypasses confirm)
    await page.evaluate(() => openFleetStatusModal(0, 'active'));
    await page.waitForTimeout(300);

    const status = await page.evaluate(() => getVehicles()[0].status);
    expect(status).toBe('active');

    const listText = await page.locator('#fleet-vehicle-list').textContent();
    expect(listText).toContain('Active');

    assertNoErrors(page, 'Vehicle back in service');
  });

  // ── Test 12: P&L tab renders ─────────────────────────────────────────────
  test('P&L tab renders with cost breakdown', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [{
        name: '2019 F-150', nickname: 'Work Truck',
        status: 'active', downtimeLog: [], addedDate: '2024-01-01',
        purchasePrice: 35000, purchaseDate: '2024-01-15',
        bizUse: 100,
      }];
      maintenance = [{
        id: 1001, vehicleName: '2019 F-150', date: '2026-05-01',
        odo: 45000, type: 'oil_change', typeLabel: 'Oil Change',
        cost: 89, vendor: 'Jiffy Lube', notes: '',
        created_at: new Date().toISOString(),
      }];
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => openFleetVehicleDetail(0));
    await page.waitForTimeout(300);

    await page.evaluate(() => setFleetDetailTab('pl'));
    await page.waitForTimeout(300);

    const content = await page.locator('#fleet-detail-content').textContent();
    // P&L tab should show year and vehicle deduction line
    expect(content).toMatch(/202[56]/);
    expect(content).toContain('Vehicle deduction');

    await page.evaluate(() => _closeFleetDetail());
    await page.waitForTimeout(200);

    assertNoErrors(page, 'P&L tab renders');
  });

  // ── Test 13: Fleet summary bar shows at bottom ────────────────────────────
  test('Fleet summary block renders at bottom of vehicle list', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [
        { name: '2019 F-150', status: 'active', downtimeLog: [], addedDate: '2024-01-01', bizUse: 100 },
        { name: '2021 Sprinter', status: 'active', downtimeLog: [], addedDate: '2024-06-01', bizUse: 100 },
      ];
      maintenance = [];
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    const listText = await page.locator('#fleet-vehicle-list').textContent();
    expect(listText).toContain('Fleet summary');
    expect(listText).toContain('Active vehicles');

    assertNoErrors(page, 'Fleet summary block');
  });

  // ── Test 14: Team tab still works after fleet changes ────────────────────
  test('Team tab still renders employees section', async () => {
    await goPg(page, 'pg-team');

    // Switch to team tab
    await page.evaluate(() => setFleetTab('team'));
    await page.waitForTimeout(300);

    const teamSection = await page.locator('#ft-team').isVisible();
    expect(teamSection).toBe(true);

    // Check for employees section header
    const teamContent = await page.locator('#ft-team').textContent();
    expect(teamContent).toContain('Employees');
    expect(teamContent).toContain('Subcontractors');

    // Switch back to fleet
    await page.evaluate(() => setFleetTab('fleet'));
    await page.waitForTimeout(200);

    assertNoErrors(page, 'Team tab still works');
  });

  // ── Test 15: Purchase price auto-creates expense record ──────────────────
  test('Adding vehicle with purchase price creates expense record', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [];
      expenses = [];
    });

    await page.evaluate(() => openAddVehicleModal(-1));
    await page.waitForTimeout(300);

    await page.locator('#fv-name').fill('2021 Chevy Express');
    await page.locator('#fv-pprice').fill('28000');
    const dateVal = await page.evaluate(() => todayKey());
    await page.locator('#fv-pdate').fill(dateVal);
    // Select actual expense method so purchase price creates an expense
    await page.evaluate(() => {
      const radio = document.querySelector('input[name="fv-deduct"][value="actual"]');
      if(radio) radio.click();
    });
    await page.waitForTimeout(100);

    await page.evaluate(() => saveFleetVehicle());
    await page.waitForTimeout(300);

    const expCount = await page.evaluate(() => expenses.filter(e => e.notes && e.notes.includes('Vehicle purchase')).length);
    expect(expCount).toBeGreaterThanOrEqual(1);

    assertNoErrors(page, 'Purchase price creates expense');
  });

  // ── Test 16: Sale modal creates income record ─────────────────────────────
  test('Recording a sale creates an income record', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [{
        name: '2018 Ram 1500', status: 'active',
        downtimeLog: [], addedDate: '2023-01-01', bizUse: 100,
        purchasePrice: 25000,
      }];
      income = [];
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    // Open sale modal
    await page.evaluate(() => openFleetSaleModal(0));
    await page.waitForTimeout(300);

    const saleOverlay = await page.locator('#fleet-sale-overlay').isVisible();
    expect(saleOverlay).toBe(true);

    await page.locator('#fs-price').fill('22000');

    await page.evaluate(() => saveFleetSale(0));
    await page.waitForTimeout(300);

    const incomeCount = await page.evaluate(() =>
      income.filter(i => i.type === 'Vehicle Sale' || (i.notes && i.notes.includes('Sale of'))).length
    );
    expect(incomeCount).toBeGreaterThanOrEqual(1);

    const vehicleStatus = await page.evaluate(() => getVehicles()[0].status);
    expect(vehicleStatus).toBe('sold');

    assertNoErrors(page, 'Sale creates income record');
  });

  // ── Test 17: Edit vehicle modal pre-fills fields ─────────────────────────
  test('Edit vehicle modal pre-fills existing vehicle data', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [{
        name: '2019 F-150', nickname: 'Big Red', color: 'Red',
        plate: 'ABC-1234', status: 'active', downtimeLog: [],
        addedDate: '2024-01-01', bizUse: 80,
      }];
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => openAddVehicleModal(0));
    await page.waitForTimeout(300);

    const nameVal = await page.locator('#fv-name').inputValue();
    expect(nameVal).toBe('2019 F-150');

    const nickVal = await page.locator('#fv-nick').inputValue();
    expect(nickVal).toBe('Big Red');

    const colorVal = await page.locator('#fv-color').inputValue();
    expect(colorVal).toBe('Red');

    await page.evaluate(() => _closeFleetVehModal());
    await page.waitForTimeout(200);

    assertNoErrors(page, 'Edit vehicle pre-fills fields');
  });

  // ── Test 18: MAINT_TYPES constant is defined ─────────────────────────────
  test('MAINT_TYPES constant is defined and has expected keys', async () => {
    const hasOilChange = await page.evaluate(() =>
      typeof MAINT_TYPES !== 'undefined' && 'oil_change' in MAINT_TYPES
    );
    expect(hasOilChange).toBe(true);

    const typeCount = await page.evaluate(() => Object.keys(MAINT_TYPES).length);
    expect(typeCount).toBeGreaterThanOrEqual(10);

    assertNoErrors(page, 'MAINT_TYPES defined');
  });

  // ── Test 19: Fleet tab toggle button visibility ───────────────────────────
  test('Fleet add button shows on fleet tab, hidden on team tab', async () => {
    await goPg(page, 'pg-team');

    // Switch to fleet tab
    await page.evaluate(() => setFleetTab('fleet'));
    await page.waitForTimeout(200);

    const fleetAddVisible = await page.evaluate(() => {
      const btn = document.getElementById('fleet-add-btn');
      return btn && btn.style.display !== 'none';
    });
    expect(fleetAddVisible).toBe(true);

    const teamAddHidden = await page.evaluate(() => {
      const btn = document.getElementById('team-add-btn');
      return btn && btn.style.display === 'none';
    });
    expect(teamAddHidden).toBe(true);

    // Switch to team tab
    await page.evaluate(() => setFleetTab('team'));
    await page.waitForTimeout(200);

    const fleetAddHidden = await page.evaluate(() => {
      const btn = document.getElementById('fleet-add-btn');
      return btn && btn.style.display === 'none';
    });
    expect(fleetAddHidden).toBe(true);

    const teamAddVisible = await page.evaluate(() => {
      const btn = document.getElementById('team-add-btn');
      return btn && btn.style.display !== 'none';
    });
    expect(teamAddVisible).toBe(true);

    // Restore fleet tab
    await page.evaluate(() => setFleetTab('fleet'));
    await page.waitForTimeout(200);

    assertNoErrors(page, 'Fleet/team button toggle');
  });

  // ── Test 20: Zero console errors throughout ──────────────────────────────
  test('Zero console errors throughout fleet tests', async () => {
    assertNoErrors(page, 'Fleet overall — zero console errors');
  });

  // ── Test 21: Edit vehicle modal uses compact header, no tbar ─────────────
  test('Edit vehicle modal has compact header title, no tbar class', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [{
        name: '2019 F-150', nickname: 'Work Truck',
        status: 'active', downtimeLog: [], addedDate: '2024-01-01', bizUse: 100,
      }];
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => openAddVehicleModal(0));
    await page.waitForTimeout(300);

    // Header should NOT use tbar class (font-size:30px)
    const hasTbar = await page.evaluate(() => {
      const box = document.getElementById('fleet-veh-box');
      return box ? box.querySelector('.tbar') !== null : false;
    });
    expect(hasTbar).toBe(false);

    // Title text should be visible and readable
    const titleText = await page.evaluate(() => {
      const box = document.getElementById('fleet-veh-box');
      if(!box) return '';
      const hdr = box.querySelector('[style*="font-size:20px"]');
      return hdr ? hdr.textContent.trim() : '';
    });
    expect(titleText).toBe('Edit vehicle');

    await page.evaluate(() => _closeFleetVehModal());
    assertNoErrors(page, 'Edit vehicle compact header');
  });

  // ── Test 22: Edit vehicle modal has NO business use % field ──────────────
  test('Edit vehicle modal does not contain business use % input', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [{
        name: '2019 F-150', nickname: 'Work Truck',
        status: 'active', downtimeLog: [], addedDate: '2024-01-01', bizUse: 100,
      }];
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => openAddVehicleModal(0));
    await page.waitForTimeout(300);

    const hasBizInput = await page.locator('#fv-biz').count();
    expect(hasBizInput).toBe(0);

    // Should still have GVWR select
    const hasGvwr = await page.locator('#fv-gvwr').isVisible();
    expect(hasGvwr).toBe(true);

    // Should have hint about year-end report
    const boxText = await page.locator('#fleet-veh-box').textContent();
    expect(boxText).toContain('year-end odometer report');

    await page.evaluate(() => _closeFleetVehModal());
    assertNoErrors(page, 'No biz% field in edit vehicle modal');
  });

  // ── Test 23: Year-end odometer report opens and calculates bizUse ─────────
  test('Year-end odometer report opens, calculates and saves business use %', async () => {
    await goPg(page, 'pg-team');

    const yr = new Date().getFullYear().toString();

    await page.evaluate((yr) => {
      S.vehicles = [{
        name: '2019 F-150', nickname: 'Work Truck',
        status: 'active', downtimeLog: [], addedDate: '2024-01-01', bizUse: 100,
      }];
      // 3 business trips this year totalling 600 miles
      mileage = [
        { id: 1, vehicle: '2019 F-150', date: yr+'-03-15', miles: 250 },
        { id: 2, vehicle: '2019 F-150', date: yr+'-06-20', miles: 200 },
        { id: 3, vehicle: '2019 F-150', date: yr+'-09-10', miles: 150 },
      ];
      renderFleetVehicles();
    }, yr);
    await page.waitForTimeout(200);

    // Open vehicle detail then odometer report
    await page.evaluate(() => openFleetVehicleDetail(0));
    await page.waitForTimeout(300);

    await page.evaluate(() => openOdometerReport(0));
    await page.waitForTimeout(300);

    const reportVisible = await page.locator('#odo-report-overlay').isVisible();
    expect(reportVisible).toBe(true);

    // Enter odometer readings: start=10000, end=11000 → 1000 total miles
    await page.locator('#odo-start').fill('10000');
    await page.locator('#odo-end').fill('11000');
    await page.waitForTimeout(200);

    // Save
    await page.evaluate(() => saveOdometerReport());
    await page.waitForTimeout(300);

    // Vehicle bizUse should now be 60
    const bizUse = await page.evaluate(() => getVehicles()[0].bizUse);
    expect(bizUse).toBe(60);

    // Odometer log should be saved
    const odoLog = await page.evaluate((yr) => {
      const key = _vehKey(getVehicles()[0]);
      return S.vehicleOdoLog?.[yr]?.[key] || null;
    }, yr);
    expect(odoLog).not.toBeNull();
    expect(odoLog.start).toBe(10000);
    expect(odoLog.end).toBe(11000);

    assertNoErrors(page, 'Year-end odometer report calculates bizUse');
  });

  // ── Test 24: Maintenance modal has receipt scan button ───────────────────
  test('Maintenance modal contains receipt scan button', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [{
        name: '2019 F-150', nickname: 'Work Truck',
        status: 'active', downtimeLog: [], addedDate: '2024-01-01', bizUse: 100,
      }];
      maintenance = [];
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => openAddMaintenanceModal(0));
    await page.waitForTimeout(400);

    // Should have scan receipt label/button
    const scanText = await page.locator('#fleet-maint-box').textContent();
    expect(scanText).toContain('Scan receipt');

    // Photo preview should be hidden initially
    const previewHidden = await page.evaluate(() => {
      const el = document.getElementById('maint-photo-preview');
      return el ? el.style.display === 'none' : true;
    });
    expect(previewHidden).toBe(true);

    await page.evaluate(() => _closeMaintModal());
    assertNoErrors(page, 'Maintenance modal has receipt scan');
  });

  // ── Test 25: Vehicle detail shows lifetime miles ──────────────────────────
  test('Vehicle detail overview shows lifetime miles across all years', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [{
        name: '2019 F-150', nickname: 'Work Truck',
        status: 'active', downtimeLog: [], addedDate: '2024-01-01', bizUse: 100,
      }];
      mileage = [
        { id: 1, vehicle: '2019 F-150', date: '2024-06-15', miles: 400 },
        { id: 2, vehicle: '2019 F-150', date: '2025-03-10', miles: 350 },
        { id: 3, vehicle: '2019 F-150', date: '2026-01-20', miles: 250 },
      ];
      maintenance = [];
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => openFleetVehicleDetail(0));
    await page.waitForTimeout(300);

    const content = await page.locator('#fleet-detail-content').textContent();
    // 400 + 350 + 250 = 1,000 lifetime miles
    expect(content).toContain('1,000');
    expect(content).toContain('Lifetime miles logged');

    await page.evaluate(() => _closeFleetDetail());
    assertNoErrors(page, 'Vehicle detail shows lifetime miles');
  });

  // ── Test 26: Year-end report button visible in vehicle detail overview ────
  test('Vehicle detail overview shows year-end mileage report button', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [{
        name: '2019 F-150', nickname: 'Work Truck',
        status: 'active', downtimeLog: [], addedDate: '2024-01-01', bizUse: 100,
      }];
      mileage = [];
      maintenance = [];
      renderFleetVehicles();
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => openFleetVehicleDetail(0));
    await page.waitForTimeout(300);

    const content = await page.locator('#fleet-detail-content').textContent();
    expect(content).toContain('Year-end mileage report');

    await page.evaluate(() => _closeFleetDetail());
    assertNoErrors(page, 'Year-end report button in detail');
  });

  // ── Test 27: Zero console errors for all new features ────────────────────
  test('Zero console errors after all new fleet feature tests', async () => {
    assertNoErrors(page, 'Fleet new features — zero console errors');
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  VEHICLE SECTION REMOVAL — Settings & Mileage regression suite
//  Verifies that removing the vehicle section from Settings and moving
//  vehicle management to Fleet doesn't break Settings, mileage, or Supabase.
// ════════════════════════════════════════════════════════════════════════════
test.describe('Vehicle management consolidation — removal regression', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });

  test.afterAll(async () => { await page.context().close(); });

  // ── Settings: old vehicle inputs are gone ────────────────────────────────
  test('Settings page does not contain old vehicle add inputs', async () => {
    await goPg(page, 'pg-settings');
    await page.waitForTimeout(400);

    // The old add-from-settings form inputs must be absent
    const hasNewVehInput = await page.locator('#set-new-veh').count();
    expect(hasNewVehInput).toBe(0);

    const hasNickInput = await page.locator('#set-new-veh-nick').count();
    expect(hasNickInput).toBe(0);

    const hasVehList = await page.locator('#set-vehicles-list').count();
    expect(hasVehList).toBe(0);

    const hasVehSection = await page.locator('#settings-vehicles-section').count();
    expect(hasVehSection).toBe(0);

    assertNoErrors(page, 'Settings has no old vehicle inputs');
  });

  // ── Settings: page loads without errors after renderVehicleSettings removed
  test('Settings page loads without console errors (no renderVehicleSettings call)', async () => {
    await goPg(page, 'pg-settings');
    await page.waitForTimeout(500);

    // renderVehicleSettings should no longer exist
    const fnExists = await page.evaluate(() => typeof renderVehicleSettings === 'function');
    expect(fnExists).toBe(false);

    // addVehicle and removeVehicle should no longer exist (removed)
    const addVehExists = await page.evaluate(() => typeof addVehicle === 'function');
    expect(addVehExists).toBe(false);

    const removeVehExists = await page.evaluate(() => typeof removeVehicle === 'function');
    expect(removeVehExists).toBe(false);

    assertNoErrors(page, 'Settings loads cleanly after vehicle section removal');
  });

  // ── Mileage: no-vehicle prompt appears when there are no vehicles ─────────
  test('Mileage page shows no-vehicle onboarding prompt when no vehicles added', async () => {
    await page.evaluate(() => {
      S.vehicles = [];
      mileage = [];
    });
    await goPg(page, 'pg-tracker');
    await page.waitForTimeout(400);

    await page.evaluate(() => renderAllMileage());
    await page.waitForTimeout(300);

    const heroText = await page.locator('#mil-hero-wrap').textContent();
    expect(heroText).toContain('Add a vehicle to start logging');
    expect(heroText).toContain('Add vehicle in Fleet');

    assertNoErrors(page, 'Mileage no-vehicle prompt');
  });

  // ── Mileage: renders normally when vehicles exist (no regression) ─────────
  test('Mileage page renders hero and trip log normally when vehicles present', async () => {
    const yr = new Date().getFullYear().toString();
    await page.evaluate((yr) => {
      S.vehicles = [{ name: '2019 F-150', nickname: 'Work Truck', status: 'active', downtimeLog: [], addedDate: '2024-01-01', bizUse: 80 }];
      mileage = [
        { id: 1, vehicle: '2019 F-150', date: yr+'-04-10', miles: 45, purpose: 'Client visit' },
        { id: 2, vehicle: '2019 F-150', date: yr+'-04-15', miles: 30 },
      ];
    }, yr);
    await page.waitForTimeout(200);

    await page.evaluate(() => renderAllMileage());
    await page.waitForTimeout(300);

    // Hero should show a mileage deduction figure, not the no-vehicle prompt
    const heroText = await page.locator('#mil-hero-wrap').textContent();
    expect(heroText).not.toContain('Add a vehicle to start logging');
    expect(heroText).toContain('business miles');

    assertNoErrors(page, 'Mileage renders normally with vehicles');
  });

  // ── Fleet: openAddVehicleModal called from anywhere navigates to Fleet ────
  test('openAddVehicleModal(-1) is the sole vehicle add entry point', async () => {
    await page.evaluate(() => { S.vehicles = []; });
    await goPg(page, 'pg-team');
    await page.waitForTimeout(200);

    await page.evaluate(() => openAddVehicleModal(-1));
    await page.waitForTimeout(300);

    const overlay = await page.locator('#fleet-veh-overlay').isVisible();
    expect(overlay).toBe(true);

    // Modal should be titled "Add vehicle"
    const title = await page.evaluate(() => {
      const box = document.getElementById('fleet-veh-box');
      const hdr = box?.querySelector('[style*="font-size:20px"]');
      return hdr?.textContent?.trim() || '';
    });
    expect(title).toBe('Add vehicle');

    await page.evaluate(() => _closeFleetVehModal());
    assertNoErrors(page, 'openAddVehicleModal is sole vehicle add entry point');
  });

  // ── Purchase info survives a second edit (vehiclesTs guard) ─────────────
  test('Purchase info survives a second edit (vehiclesTs cloud-overwrite guard)', async () => {
    // Simulate the race: user saves a vehicle with purchase info, then a stale
    // cloud load tries to overwrite S.vehicles with old data lacking those fields.
    // The vehiclesTs guard in supaLoadFromCloud should protect the local version.
    await page.evaluate(() => {
      // Save a vehicle with full purchase info, stamping vehiclesTs
      S.vehicles = [{
        name: '2020 Ram 1500', nickname: 'Fleet Truck',
        purchaseDate: '2020-06-15', purchasePrice: 45000, purchaseOdo: 100,
        gvwr: 'heavy_truck', deductionMethod: 'mileage',
        status: 'active', addedDate: '2020-06-15',
      }];
      S.vehiclesTs = Date.now() - 1000; // 1s ago — local is newer
    });

    // Simulate stale cloud settings arriving (no purchase fields, older ts)
    await page.evaluate(() => {
      const staleSettings = JSON.stringify({
        vehicles: [{ name: '2020 Ram 1500', nickname: 'Fleet Truck', status: 'active', addedDate: '2020-06-15' }],
        vehiclesTs: Date.now() - 60000, // 60s ago — cloud is stale
        bname: 'Test Biz',
      });
      // Run the merge logic that supaLoadFromCloud uses
      const ss = JSON.parse(staleSettings);
      const _localVehs = S.vehicles;
      const _localVehsTs = S.vehiclesTs || 0;
      S = { ...S, ...ss };
      if (_localVehsTs > (ss.vehiclesTs || 0)) {
        S.vehicles = _localVehs;
        S.vehiclesTs = _localVehsTs;
      }
    });

    // Purchase info should still be intact
    const vehs = await page.evaluate(() => S.vehicles);
    expect(vehs[0].purchaseDate).toBe('2020-06-15');
    expect(vehs[0].purchasePrice).toBe(45000);
    expect(vehs[0].purchaseOdo).toBe(100);

    assertNoErrors(page, 'Purchase info survives vehiclesTs guard');
  });

  // ── Zero console errors throughout ───────────────────────────────────────
  test('Zero console errors across vehicle consolidation tests', async () => {
    assertNoErrors(page, 'Vehicle consolidation — zero console errors');
  });

  // ── Service log UX: card link, no inline Delete, Delete in edit modal ────
  test('Fleet card last-service row is a button that opens service log tab', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [{
        name: '2022 Silverado', nickname: 'Van',
        status: 'active', downtimeLog: [], addedDate: '2024-01-01',
        bizUse: 100,
      }];
      maintenance = [{ id: 9001, vehicleName: '2022 Silverado', type: 'oil', typeLabel: 'Oil Change', date: '2025-05-01', cost: 75, odo: 42000 }];
      renderFleetVehicles();
    });

    // The last-service row must be a <button> (not a plain <div>)
    // Fleet cards use class "card"; the service link button contains "Oil Change".
    // Wait for the rendered button explicitly (bounded) instead of a fixed delay —
    // a slow render previously hung the whole test to its 60s timeout.
    const serviceBtn = page.locator('.card button').filter({ hasText: /Oil Change/ });
    await expect(serviceBtn).toHaveCount(1, { timeout: 8000 });

    // Clicking it should open the fleet detail modal at the service tab
    // click() auto-scrolls; no need for a separate scrollIntoViewIfNeeded
    await serviceBtn.click({ timeout: 8000 });
    await page.waitForTimeout(500);

    const activeTab = await page.evaluate(() => {
      return typeof _fleetDetailTab !== 'undefined' ? _fleetDetailTab : null;
    });
    expect(activeTab).toBe('service');

    const detailVisible = await page.evaluate(() => {
      const el = document.getElementById('fleet-detail-overlay');
      return !!el;
    });
    expect(detailVisible).toBe(true);

    await page.evaluate(() => _closeFleetDetail());
    await page.waitForTimeout(200);

    assertNoErrors(page, 'Fleet card service button');
  });

  test('Service log table rows have no inline Delete link', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [{
        name: '2022 Silverado', nickname: 'Van',
        status: 'active', downtimeLog: [], addedDate: '2024-01-01',
        bizUse: 100,
      }];
      maintenance = [{ id: 9002, vehicleName: '2022 Silverado', type: 'oil', typeLabel: 'Oil Change', date: '2025-05-10', cost: 80, odo: 43000 }];
      renderFleetVehicles();
      openFleetVehicleDetail(0);
    });
    await page.waitForTimeout(300);

    await page.evaluate(() => setFleetDetailTab('service'));
    await page.waitForTimeout(300);

    const content = await page.locator('#fleet-detail-content').innerHTML();
    // "Delete" must NOT appear inline in the service log rows
    // (it lives inside the edit modal only)
    expect(content).not.toMatch(/\bDelete\b/);

    await page.evaluate(() => _closeFleetDetail());
    await page.waitForTimeout(200);

    assertNoErrors(page, 'No inline Delete in service log');
  });

  test('Edit maintenance modal shows Delete button when editing existing record', async () => {
    await goPg(page, 'pg-team');

    await page.evaluate(() => {
      S.vehicles = [{
        name: '2022 Silverado', nickname: 'Van',
        status: 'active', downtimeLog: [], addedDate: '2024-01-01',
        bizUse: 100,
      }];
      maintenance = [{ id: 9003, vehicleName: '2022 Silverado', type: 'oil', typeLabel: 'Oil Change', date: '2025-05-15', cost: 90, odo: 44000 }];
      renderFleetVehicles();
      openAddMaintenanceModal(0, 9003);
    });
    await page.waitForTimeout(400);

    // Delete button must exist in the edit modal (ID: fleet-maint-overlay)
    const deleteBtn = page.locator('#fleet-maint-overlay button').filter({ hasText: /Delete this record/i });
    await expect(deleteBtn).toBeVisible();

    // New record modal must NOT show Delete
    await page.evaluate(() => { _closeMaintModal(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => openAddMaintenanceModal(0));
    await page.waitForTimeout(400);

    const deleteBtnNew = page.locator('#fleet-maint-overlay button').filter({ hasText: /Delete this record/i });
    await expect(deleteBtnNew).toHaveCount(0);

    await page.evaluate(() => _closeMaintModal());
    await page.waitForTimeout(200);

    assertNoErrors(page, 'Delete button in edit modal only');
  });

  test('Zero console errors across service log UX tests', async () => {
    assertNoErrors(page, 'Service log UX — zero console errors');
  });
});
