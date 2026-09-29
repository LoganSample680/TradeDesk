const { test, mockAllExternal, waitForAppBoot } = require('./helpers');
test('dump', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppBoot(page);
  const vis = () => page.evaluate(() => {
    const pg = document.querySelector('.pg.active') || document.body;
    return pg.innerText;
  });
  await page.evaluate(() => {
    S.ownerName = 'Logan Sample'; S.ownerBillRate = 110;
    S.employees = [{ name: 'Jack Miller', email: 'j@x', role: 'Apprentice', pay_type: 'hourly', pay_rate: 22, billRate: 90 }];
    clients.length = 0; clients.push({ id: 92001, name: 'Ray Whitcomb', addr: '412 Bell St, Topeka, KS 66603', phone: '7855550100' });
    currentClientId = 92001; openTMEstimate(getClientById(92001));
  });
  await page.waitForTimeout(400);
  console.log('TM>>>' + JSON.stringify(await vis()));
  await page.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove()); openFreeFormEstimate(getClientById(92001)); });
  await page.waitForTimeout(400);
  console.log('BYO>>>' + JSON.stringify(await vis()));
  await page.evaluate(() => { document.querySelectorAll('.zmodal-overlay').forEach(e => e.remove()); openClientDetail(92001); });
  await page.waitForTimeout(400);
  console.log('CLIENT>>>' + JSON.stringify(await vis()));
});
