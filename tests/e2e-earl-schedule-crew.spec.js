// @ts-check
/**
 * Earl audit (2026-09-27): a 58-year-old plumber, three guys, an iPhone SE.
 * Owner: "just do it all." One test per finding, in the order they were found:
 *
 *  1  a second service call for the same guy on the same day was refused
 *  2  new jobs defaulted to 2 days plus a buffer day
 *  3  plain crew saw dollars on Home and Calendar, and the money tiles
 *  4  Mark job done never appeared (it needed a status nothing ever set)
 *  5  a job with no proposal behind it vanished from the Jobs screen
 *  6  a clock left running 20 hours was banked as 20 hours, silently
 *  7  Mileage hid every trip and the export when no vehicle was on file
 *  8  Reschedule opened a blank form (a duplicate waiting to happen), and
 *     the button row ran off a 375px screen
 *  9  conflict cards for two jobs that belonged to two different guys
 * 10  painter copy for everyone, and a tip squashed into three columns
 * 11  Export IRS report never offered the mileage log
 * 12  job sheet buttons under 44px, today's jobs five screens down Home
 *  +  a Sunday job without the weekend flag read Monday on the grid only
 */
const { test, expect, mockAllExternal, waitForAppBoot, goPg, assertNoErrors } = require('./helpers');

async function boot(page, viewport) {
  if (viewport) await page.setViewportSize(viewport);
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppBoot(page);
}

// The shop: Earl owns it, Jack and Luis are crew.
const seedShop = (page) => page.evaluate(() => {
  const tk = todayKey();
  S.employees = [{ id: 'jack', name: 'Jack', role: 'tech' }, { id: 'luis', name: 'Luis', role: 'tech' }];
  clients.length = 0;
  clients.push({ id: 77001, name: 'Pat Moore', phone: '5551234567', addr: '12 Elm St, Springfield' });
  clients.push({ id: 77002, name: 'Dana Ruiz', phone: '5559876543', addr: '40 Oak Ave, Springfield' });
  jobs.length = 0;
  jobs.push({ id: 88001, client_id: 77001, name: 'Pat Moore, water heater', addr: '12 Elm St', start: tk, days: 1, value: 1850, eventType: 'job', status: 'upcoming', assignedTo: 'jack', color: '#185FA5' });
  jobs.push({ id: 88002, client_id: 77002, name: 'Dana Ruiz, repipe', addr: '40 Oak Ave', start: tk, days: 1, value: 4200, eventType: 'job', status: 'upcoming', assignedTo: 'luis', color: '#185FA5' });
  return tk;
});

const asCrew = (page, perms) => page.evaluate((p) => {
  window._supaUser = { id: 'jack-u', email: 'jack@x.com' };
  _isEmployee = true; _contractorUserId = 'earl-1'; _coOwner = false;
  _employeeRecord = { id: 'jack', contractor_user_id: 'earl-1', employee_user_id: 'jack-u', name: 'Jack', role: 'tech', active: true, permissions: p };
  _user = { id: 'jack-u', email: 'jack@x.com', name: 'Jack', role: 'tech', account_id: null };
  applyPermissions();
}, perms);
const asOwner = (page) => page.evaluate(() => { _isEmployee = false; _contractorUserId = null; _employeeRecord = null; _coOwner = false; applyPermissions(); });

// Fill the scheduler the way a person does, then press Add to calendar.
const bookCall = (page, o) => page.evaluate((o) => {
  goPg('pg-schedule'); setSchedType('job');
  document.getElementById('s-name').value = o.name;
  document.getElementById('s-start').value = o.start;
  document.getElementById('s-days').value = String(o.days || 1);
  document.getElementById('s-time').value = o.time || '';
  const cs = document.getElementById('s-crew-sel'); cs.value = o.crew || '';
  const wk = document.getElementById('s-allow-weekend'); if (wk) wk.checked = true;
  window._submitting = false; if (typeof _submitting !== 'undefined') _submitting = false;
  scheduleJob();
  const err = document.getElementById('sched-err');
  return { n: jobs.filter(j => j.name === o.name).length, err: err && err.style.display !== 'none' ? err.textContent : '' };
}, o);

test.describe('Earl audit: schedule, jobs, time, mileage, crew', () => {
  test.afterEach(async ({ page }) => { await assertNoErrors(page, 'earl-schedule-crew'); });

  test('1: two same-day calls for one guy both save; a real time overlap warns once, then books', async ({ page }) => {
    await boot(page);
    await seedShop(page);
    const day = await page.evaluate(() => addDays(todayKey(), 9));
    const a = await bookCall(page, { name: 'Call A', start: day, crew: 'jack' });
    const b = await bookCall(page, { name: 'Call B', start: day, crew: 'jack' });
    expect(a).toEqual({ n: 1, err: '' });
    expect(b).toEqual({ n: 1, err: '' });
    // A single-day call never greys the day out for the next one.
    const held = await page.evaluate((d) => getBookedDaysForCrew('jack').booked.has(d), day);
    expect(held).toBe(false);
    // Two TIMED calls that overlap: warned, not refused; the second tap books it.
    const t1 = await bookCall(page, { name: 'Call C', start: day, crew: 'jack', time: '09:00' });
    const t2 = await bookCall(page, { name: 'Call D', start: day, crew: 'jack', time: '09:30' });
    expect(t1.n).toBe(1);
    expect(t2.n).toBe(0);
    expect(t2.err).toContain('overlap');
    // Second tap on the same, still-filled form.
    const t2b = await page.evaluate(() => { _submitting = false; scheduleJob(); return jobs.filter(j => j.name === 'Call D').length; });
    expect(t2b).toBe(1);
    // A multi-day project over another multi-day project for the same guy warns too.
    const p1 = await bookCall(page, { name: 'Remodel 1', start: addDaysStr(day, 14), crew: 'luis', days: 3 });
    const p2 = await bookCall(page, { name: 'Remodel 2', start: addDaysStr(day, 15), crew: 'luis', days: 3 });
    expect(p1.n).toBe(1);
    expect(p2.n).toBe(0);
    expect(p2.err).toContain('already booked');
  });

  test('9: jobs for two different guys on the same day make no conflict card; the same guy double-booked does', async ({ page }) => {
    await boot(page);
    await seedShop(page);
    const r = await page.evaluate(() => {
      const d = addDays(todayKey(), 20);
      jobs.push({ id: 88101, name: 'Jack project', start: d, days: 3, allowWeekend: true, eventType: 'job', status: 'upcoming', assignedTo: 'jack' });
      jobs.push({ id: 88102, name: 'Luis project', start: d, days: 3, allowWeekend: true, eventType: 'job', status: 'upcoming', assignedTo: 'luis' });
      renderCalConflicts();
      const apart = document.getElementById('cal-conflicts').innerHTML;
      jobs.push({ id: 88103, name: 'Jack second project', start: d, days: 2, allowWeekend: true, eventType: 'job', status: 'upcoming', assignedTo: 'jack' });
      renderCalConflicts();
      return { apart, same: document.getElementById('cal-conflicts').textContent };
    });
    expect(r.apart).toBe('');
    expect(r.same).toContain('Jack project');
    expect(r.same).toContain('for Jack');
  });

  test('2 + 10: a new job defaults to one day with no buffer, and the tip is one wrapping sentence with no painter words', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      goPg('pg-schedule'); setSchedType('job');
      const a = { days: document.getElementById('s-days').value, buf: document.getElementById('s-buf').value };
      document.getElementById('s-days').value = '4'; resetSched();
      const b = { days: document.getElementById('s-days').value, buf: document.getElementById('s-buf').value };
      setSchedType('estimate');
      const tip = document.getElementById('sched-tip');
      return { a, b, kids: tip.children.length, text: tip.textContent };
    });
    expect(r.a).toEqual({ days: '1', buf: '0' });
    expect(r.b).toEqual({ days: '1', buf: '0' });
    expect(r.kids).toBe(1);
    expect(r.text.toLowerCase()).not.toContain('paint');
  });

  test('3: crew without financials sees no dollars on Home or Calendar, no money tiles, and only his own jobs', async ({ page }) => {
    await boot(page);
    await seedShop(page);
    await asCrew(page, { collect: false });
    await goPg(page, 'pg-dash');
    await page.evaluate(() => { renderDash(); renderDashToday(); });
    const home = await page.evaluate(() => {
      const vis = el => !!el && el.offsetParent !== null;
      return {
        today: document.getElementById('dash-today').innerText,
        dash: document.getElementById('pg-dash').innerText,
        invoice: vis(document.getElementById('qa-invoice-btn')),
        collect: vis(document.getElementById('qa-collect-btn')),
        expense: vis(document.querySelector('#dash-quick .qa[onclick*="\'expense\'"]')),
        sources: vis(document.querySelector('.td-dw[data-dw="sources"]')),
      };
    });
    expect(home.today).toContain('Pat Moore');
    expect(home.today).not.toContain('Dana Ruiz');
    expect(home.dash).not.toMatch(/\$\s?\d/);
    expect(home).toMatchObject({ invoice: false, collect: false, expense: false, sources: false });
    await goPg(page, 'pg-cal');
    const cal = await page.evaluate(() => { renderCalUpcoming(); return document.getElementById('cal-upcoming').innerText; });
    expect(cal).toContain('Pat Moore');
    expect(cal).not.toContain('Dana Ruiz');
    expect(cal).not.toMatch(/\$\s?\d/);
    await asOwner(page);
  });

  test('3: crew WITH financials sees the dollars and the tiles', async ({ page }) => {
    await boot(page);
    await seedShop(page);
    await asCrew(page, { financials: true, schedule: true });
    await goPg(page, 'pg-dash');
    const r = await page.evaluate(() => {
      renderDashToday(); renderCalUpcoming();
      const vis = el => !!el && el.offsetParent !== null;
      return { today: document.getElementById('dash-today').innerText, cal: document.getElementById('cal-upcoming').innerText, invoice: vis(document.getElementById('qa-invoice-btn')) };
    });
    expect(r.today).toContain('$1,850');
    expect(r.today).toContain('$4,200');
    expect(r.cal).toContain('$1,850');
    expect(r.invoice).toBe(true);
    await asOwner(page);
  });

  test('4: Mark job done shows on a job scheduled today and completes it', async ({ page }) => {
    await boot(page);
    await seedShop(page);
    await page.evaluate(() => openJobSheet(77001));
    const btn = page.locator('.zmodal-overlay .js-mark-done');
    await expect(btn).toHaveCount(1);
    await btn.click();
    await page.locator('.zmodal-overlay button', { hasText: 'Complete job' }).click();
    await expect.poll(() => page.evaluate(() => jobs.find(j => j.id === 88001).status)).toBe('done');
    // A job that has not started yet has no Mark done.
    const future = await page.evaluate(() => {
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      jobs.push({ id: 88009, client_id: 77002, name: 'Later', start: addDays(todayKey(), 5), days: 1, eventType: 'job', status: 'upcoming' });
      jobs.find(j => j.id === 88002).start = addDays(todayKey(), 4);
      openJobSheet(77002);
      const n = document.querySelectorAll('.zmodal-overlay .js-mark-done').length;
      document.querySelectorAll('.zmodal-overlay').forEach(o => o.remove());
      return n;
    });
    expect(future).toBe(0);
  });

  test('5: a walk-up job with no proposal is listed on Jobs, and crew see their own jobs there', async ({ page }) => {
    await boot(page);
    await seedShop(page);
    await goPg(page, 'pg-jobs');
    const owner = await page.evaluate(() => { bids.length = 0; renderJobsPage(); return document.getElementById('jobs-list').innerText; });
    expect(owner).toContain('Pat Moore, water heater');
    expect(owner).toContain('Dana Ruiz, repipe');
    await asCrew(page, {});
    const crew = await page.evaluate(() => { renderJobsPage(); return document.getElementById('jobs-list').innerText; });
    expect(crew).toContain('Pat Moore, water heater');
    expect(crew).not.toContain('Dana Ruiz');
    expect(crew).not.toMatch(/\$\s?\d/);
    await asOwner(page);
  });

  test('6: clocking out after 20 hours asks when he stopped and banks that, not 20h', async ({ page }) => {
    await boot(page);
    await seedShop(page);
    const r = await page.evaluate(() => {
      clockIn(88001);
      const startMs = Date.now() - 20 * 3600000;
      _activeTimer.startTime = startMs;
      const row = timeEntries.find(e => e.id === _activeTimer.entryId);
      row.start_time = new Date(startMs).toISOString();
      clockOut();
      return { asked: !!document.getElementById('_clock-stop-ov'), stillOpen: !!row.open, entryId: row.id, startMs };
    });
    expect(r.asked).toBe(true);
    expect(r.stillOpen).toBe(true);
    // He stopped nine hours in.
    await page.evaluate((s) => {
      const d = new Date(s + 9 * 3600000); const p = n => String(n).padStart(2, '0');
      document.getElementById('_clock-stop-at').value = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
    }, r.startMs);
    await page.locator('#_clock-stop-save').click();
    const after = await page.evaluate((id) => { const e = timeEntries.find(x => x.id === id); return { open: e.open, minutes: e.minutes, timer: !!_activeTimer }; }, r.entryId);
    expect(after.open).toBe(false);
    expect(after.timer).toBe(false);
    expect(Math.abs(after.minutes - 540)).toBeLessThanOrEqual(1);
    // A normal shift is not asked about.
    const short = await page.evaluate(() => { clockIn(88001); _activeTimer.startTime = Date.now() - 3 * 3600000; clockOut(); return !!document.getElementById('_clock-stop-ov') || !!_activeTimer; });
    expect(short).toBe(false);
  });

  test('7 + 11: with no vehicle, Mileage still lists the trips and exports straight to the mileage log', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      vehicles.length = 0;
      const d = todayKey();
      mileage.length = 0;
      mileage.push({ id: 99001, date: d, from: 'Shop', to: '12 Elm St', miles: 14.2, purpose: 'Job site' });
      trackerYear = Number(d.slice(0, 4));
      goPg('pg-tracker'); setTrTab('mileage', document.getElementById('tr-t-mileage'));
    });
    await expect(page.locator('#mil-no-vehicle')).toBeVisible();
    await expect(page.locator('#mil-table')).toContainText('12 Elm St');
    await page.locator('#mil-export-btn').click();
    await expect(page.locator('#export-panel #exp-mileage-log')).toBeVisible();
    await expect(page.locator('#export-panel')).toContainText('Mileage log');
    const close = await page.locator('#export-panel-close').boundingBox();
    expect(close.width).toBeGreaterThanOrEqual(44);
    expect(close.height).toBeGreaterThanOrEqual(44);
    await page.locator('#export-panel-close').click();
    await expect(page.locator('#export-panel')).toHaveCount(0);
  });

  test('8: Reschedule opens the scheduler holding this job and moves it, no duplicate', async ({ page }) => {
    await boot(page);
    await seedShop(page);
    await page.evaluate(() => { jobs.find(j => j.id === 88001).start = addDays(todayKey(), 2); openJobSheet(77001); });
    await page.locator('#js-resched-btn').click();
    const pre = await page.evaluate(() => ({ pg: document.querySelector('.pg.active').id, name: document.getElementById('s-name').value, start: document.getElementById('s-start').value, crew: document.getElementById('s-crew-sel').value, cta: document.querySelector('#pg-schedule .sf-cta').textContent }));
    expect(pre.pg).toBe('pg-schedule');
    expect(pre.name).toBe('Pat Moore, water heater');
    expect(pre.crew).toBe('jack');
    expect(pre.cta).toBe('Save changes');
    const moved = await page.evaluate(() => {
      const to = addDays(todayKey(), 6);
      document.getElementById('s-start').value = to;
      const before = jobs.length;
      scheduleJob();
      return { to, before, after: jobs.length, start: jobs.find(j => j.id === 88001).start, dupes: jobs.filter(j => j.name === 'Pat Moore, water heater').length };
    });
    expect(moved.after).toBe(moved.before);
    expect(moved.dupes).toBe(1);
    expect(moved.start).toBe(moved.to);
  });

  test('8 + 12: the job sheet at 375px has no horizontal bleed and every action is at least 44px tall', async ({ page }) => {
    await boot(page, { width: 375, height: 667 });
    await seedShop(page);
    await page.evaluate(() => {
      bids.push({ id: 66001, client_id: 77001, status: 'Closed Won', amount: 1850, bid_date: todayKey() });
      jobs.find(j => j.id === 88001).bid_id = 66001;
      openJobSheet(77001);
    });
    const r = await page.evaluate(() => {
      const ov = document.querySelector('.zmodal-overlay');
      const btns = [...ov.querySelectorAll('button,a')].filter(b => b.offsetParent !== null);
      const over = btns.filter(b => b.getBoundingClientRect().right > innerWidth + 1).map(b => b.textContent.trim());
      const want = ['+ Assign sub', 'Drive', 'OMW', '+Days', 'Push back', 'Reschedule', 'Call'];
      const small = btns.filter(b => want.some(w => b.textContent.trim().endsWith(w)) && b.getBoundingClientRect().height < 44).map(b => b.textContent.trim());
      const found = want.filter(w => btns.some(b => b.textContent.trim().endsWith(w)));
      return { over, small, found, sw: document.documentElement.scrollWidth, iw: innerWidth };
    });
    expect(r.over).toEqual([]);
    expect(r.small).toEqual([]);
    expect(r.found.length).toBe(7);
    expect(r.sw).toBeLessThanOrEqual(r.iw + 1);
  });

  test('12: today\'s jobs sit right under the top tiles on Home', async ({ page }) => {
    await boot(page);
    const order = await page.evaluate(() => { const s = S.dashWidgetOrder; S.dashWidgetOrder = undefined; const o = _getDashWidgetOrder(); S.dashWidgetOrder = s; return o; });
    expect(order.indexOf('calendar')).toBe(1);
  });

  test('weekend: a Sunday job with no weekend flag is Sunday on the grid, on Home and for the crew; a Thursday 5-day job ends the next Wednesday everywhere', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      // 2026-10-04 is a Sunday, 2026-10-01 a Thursday.
      const sun = { id: 1, start: '2026-10-04', days: 1, eventType: 'job', status: 'upcoming' };
      const thu = { id: 2, start: '2026-10-01', days: 5, eventType: 'job', status: 'upcoming' };
      jobs.length = 0; jobs.push(sun, thu);
      return {
        sunDays: getJobWorkDays(sun),
        gridSun: getJobsOnDay('2026-10-04').map(x => x.job.id),
        gridMon: getJobsOnDay('2026-10-05').map(x => x.job.id).filter(id => id === 1),
        activeSun: _jobActiveOn(sun, '2026-10-04'),
        thuLast: _jobLastWorkDay(thu),
        thuActiveWed: _jobActiveOn(thu, '2026-10-07'),
        thuGridWed: getJobsOnDay('2026-10-07').some(x => x.job.id === 2 && !x.isBuf),
        thuActiveThuAfter: _jobActiveOn(thu, '2026-10-08'),
      };
    });
    expect(r.sunDays).toEqual(['2026-10-04']);
    expect(r.gridSun).toContain(1);
    expect(r.gridMon).toEqual([]);
    expect(r.activeSun).toBe(true);
    expect(r.thuLast).toBe('2026-10-07');
    expect(r.thuActiveWed).toBe(true);
    expect(r.thuGridWed).toBe(true);
    expect(r.thuActiveThuAfter).toBe(false);
  });
});

function addDaysStr(key, n) {
  const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
