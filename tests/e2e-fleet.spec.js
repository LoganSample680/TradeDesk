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
    expect(text).toContain('No vehicles yet');

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
    // P&L tab should show year and net position
    expect(content).toMatch(/202[56]/);
    expect(content).toContain('Net position');

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
});
