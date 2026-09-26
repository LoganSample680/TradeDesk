// @ts-check
/**
 * Branding > Logo: the logo can be changed from the Branding page, not only
 * from Business info, and changing a logo that is already loaded works.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

// 1x1 PNGs, one red and one blue, so a replace is a visibly different file.
const RED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const BLUE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==', 'base64');

test.describe('Branding: change logo', () => {
  let page;
  const errors = [];

  test.beforeEach(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
    await page.evaluate(() => { S.logoData = ''; S.logoUrl = ''; S.logoHash = ''; S.bname = 'Sample Painting'; });
  });

  test.afterEach(async () => { await page.context().close(); });

  test('Branding page has a logo row that renders the current logo', async () => {
    const r = await page.evaluate(() => {
      _openSetDetail('branding');
      const brand = document.getElementById('set-logo-preview-brand');
      const btn = document.getElementById('set-logo-btn-brand');
      return { hasTile: !!brand, inBranding: !!brand && !!brand.closest('#setd-branding'), btn: btn && btn.textContent,
        rmHidden: brand && getComputedStyle(brand.closest('.set-form-row').querySelector('.set-logo-rm')).display === 'none',
        initials: brand && brand.textContent };
    });
    expect(r.hasTile).toBe(true);
    expect(r.inBranding).toBe(true);
    expect(r.btn).toBe('Upload image');
    expect(r.rmHidden).toBe(true);
    expect(r.initials).toBe('SP');
  });

  test('upload from Branding, then replace the already-loaded logo', async () => {
    await page.evaluate(() => _openSetDetail('branding'));
    await page.setInputFiles('#set-logo-file', { name: 'red.png', mimeType: 'image/png', buffer: RED });
    await page.waitForFunction(() => (S.logoData || '').startsWith('data:image/png'));
    const first = await page.evaluate(() => S.logoData);
    const after1 = await page.evaluate(() => ({
      btn: document.getElementById('set-logo-btn-brand').textContent,
      brandImg: document.querySelector('#set-logo-preview-brand img')?.getAttribute('src'),
      bizImg: document.querySelector('#set-logo-preview-biz img')?.getAttribute('src'),
      inputCleared: document.getElementById('set-logo-file').value === '',
    }));
    expect(after1.btn).toBe('Change logo');
    expect(after1.brandImg).toBe(first);
    expect(after1.bizImg).toBe(first);
    expect(after1.inputCleared).toBe(true);

    // Replace with a different file.
    await page.setInputFiles('#set-logo-file', { name: 'blue.png', mimeType: 'image/png', buffer: BLUE });
    await page.waitForFunction(f => S.logoData && S.logoData !== f, first);
    const second = await page.evaluate(() => S.logoData);
    expect(second).not.toBe(first);
    expect(await page.evaluate(() => document.querySelector('#set-logo-preview-brand img')?.getAttribute('src'))).toBe(second);

    // Re-picking the same file as before still fires (input was cleared).
    await page.setInputFiles('#set-logo-file', { name: 'red.png', mimeType: 'image/png', buffer: RED });
    await page.waitForFunction(f => S.logoData === f, first);
  });

  test('tapping the logo tile opens the file picker', async () => {
    await page.evaluate(() => { goPg('pg-settings'); _openSetDetail('branding'); });
    const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.locator('#set-logo-preview-brand').click();
    expect(await chooser).toBeTruthy();
  });

  test('Remove clears both tiles and the topbar slot', async () => {
    await page.evaluate(() => { S.logoData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='; _openSetDetail('branding'); _renderLogoPreview(); applyBrandLogo(); });
    await page.evaluate(() => clearLogoSetting());
    const r = await page.evaluate(() => ({
      logo: S.logoData,
      imgs: document.querySelectorAll('.set-logo-tile img').length,
      slotImgs: document.querySelectorAll('.brand-logo-slot img').length,
      btn: document.getElementById('set-logo-btn-brand').textContent,
    }));
    expect(r.logo).toBe('');
    expect(r.imgs).toBe(0);
    expect(r.slotImgs).toBe(0);
    expect(r.btn).toBe('Upload image');
  });

  test('old single-id hooks are gone', async () => {
    const r = await page.evaluate(() => ({
      biz: typeof _renderLogoPreviewBiz,
      oldBtn: document.querySelectorAll('#set-logo-btn').length,
      oldFn: document.querySelectorAll('#set-logo-filename').length,
    }));
    expect(r.biz).toBe('undefined');
    expect(r.oldBtn).toBe(0);
    expect(r.oldFn).toBe(0);
  });

  test('no console errors', async () => {
    await page.evaluate(() => { _openSetDetail('branding'); _renderLogoPreview(); });
    await assertNoErrors(page, errors);
  });
});
