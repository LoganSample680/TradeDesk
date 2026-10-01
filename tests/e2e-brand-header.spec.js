// @ts-check
/**
 * The top corner is his (owner 2026-10-01: "still got a TradeDesk logo and a
 * tiny logo for the business with no business name"). Once a business has a
 * logo or a name, TradeDesk's tile leaves the header, and the shape of the
 * logo decides the layout: square = logo tile + name, wide = the logo alone,
 * no logo = initials on the brand colour + name, nothing = TradeDesk.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

const SQ = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#000"/></svg>').toString('base64');

async function boot(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAllExternal(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppBoot(page);
}
const paint = (page, v) => page.evaluate((v) => {
  Object.assign(S, { logoData: '', logoUrl: '', logoMeta: null, bname: '', brandColor: '' }, v);
  window._logoEnsureMeta = async () => S.logoMeta;
  applyBrandLogo();
  const bar = document.getElementById('mobile-topbar-brand');
  const slot = bar.querySelector('.brand-logo-slot');
  const tile = slot.querySelector('.brand-tile');
  return {
    tdTile: getComputedStyle(bar.querySelector('.mobile-topbar-icon')).display !== 'none',
    text: slot.textContent.trim(),
    tile: tile ? Math.round(tile.getBoundingClientRect().height) : 0,
    wide: !!slot.querySelector('img.brand-wide'),
    initials: (slot.querySelector('.brand-initials') || {}).textContent || '',
    bleed: document.documentElement.scrollWidth > innerWidth + 1,
  };
}, v);

test.describe('Brand in the top corner', () => {
  test.afterEach(async ({ page }) => { await assertNoErrors(page, 'brand header'); });

  test('a square logo is a 40px tile with his name next to it, and no TradeDesk tile', async ({ page }) => {
    await boot(page);
    const r = await paint(page, { logoData: SQ, logoMeta: { ratio: 1, solid: true, light: false }, bname: 'Plumbing Solutions By JS' });
    expect(r).toMatchObject({ tdTile: false, text: 'Plumbing Solutions By JS', tile: 40, wide: false, bleed: false });
  });

  test('a logo saved only as a link still shows, with the name', async ({ page }) => {
    await boot(page);
    const r = await paint(page, { logoUrl: SQ, logoMeta: { ratio: 1, solid: true }, bname: 'Plumbing Solutions By JS' });
    expect(r).toMatchObject({ tdTile: false, text: 'Plumbing Solutions By JS', tile: 40 });
  });

  test('a wide logo stands alone at full height: the name is already in it', async ({ page }) => {
    await boot(page);
    const r = await paint(page, { logoData: SQ, logoMeta: { ratio: 4 }, bname: 'Precision Electric' });
    expect(r).toMatchObject({ tdTile: false, text: '', wide: true, bleed: false });
  });

  test('no logo: his initials on his colour, and his name', async ({ page }) => {
    await boot(page);
    const r = await paint(page, { bname: 'Ace Roofing & Gutters', brandColor: '#B45309' });
    expect(r).toMatchObject({ tdTile: false, initials: 'AR', tile: 40, bleed: false });
    expect(r.text).toBe('ARAce Roofing & Gutters');
  });

  test('nothing set up yet: TradeDesk, as before', async ({ page }) => {
    await boot(page);
    const r = await paint(page, {});
    expect(r).toMatchObject({ tdTile: true, text: 'TradeDesk', tile: 0 });
  });

  // Owner 2026-10-01: "I uploaded the same logo that Jack did and our
  // invoices and proposals look completely different". His copy was a
  // screenshot (a hairline at the edge) and his saved measurement, made by
  // the old four-corner check, said not solid; it was never measured again.
  test('a screenshot of a dark square logo, hairline edge and all, is still its own square', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const draw = (edge) => { const c = document.createElement('canvas'); c.width = 600; c.height = 600; const x = c.getContext('2d');
        x.fillStyle = '#000'; x.fillRect(0, 0, 600, 600); x.fillStyle = '#1e90ff'; x.fillRect(150, 150, 300, 300);
        if (edge) { x.fillStyle = '#d0d0d0'; x.fillRect(597, 0, 3, 600); x.fillRect(0, 597, 600, 3); }
        return c.toDataURL('image/png'); };
      const meta = async (src) => { S.logoData = src; S.logoUrl = ''; S.logoMeta = null; return await _logoEnsureMeta(); };
      const a = await meta(draw(false)), b = await meta(draw(true));
      // Black, give or take a unit of resampling.
      return { clean: tdLogoIsTile(a), shot: tdLogoIsTile(b), v: b.v, black: (b.bg.match(/\d+/g) || []).every(n => +n < 8) };
    });
    expect(r).toEqual({ clean: true, shot: true, v: 2, black: true });
  });

  test('a measurement saved the old way is made again, so a wrong answer repairs itself', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 200; const x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, 200, 200); x.fillStyle = '#e11'; x.fillRect(60, 60, 80, 80);
      S.logoData = c.toDataURL('image/png'); S.logoUrl = '';
      const h = String(_hubHash(S.logoData));
      S.logoMeta = { hash: h, ratio: 1, solid: false, light: false, bg: 'rgb(0,0,0)' };   // the stale answer
      const m = await _logoEnsureMeta();
      const again = await _logoEnsureMeta();                                          // now cached
      return { solid: m.solid, v: m.v, same: again === m };
    });
    expect(r).toEqual({ solid: true, v: 2, same: true });
  });

  test('initials skip the little words, and junk never throws', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => [
      _brandInitials('Plumbing Solutions By JS'), _brandInitials('The Paint Co'), _brandInitials(''), _brandInitials(null), _brandInitials('<b>'),
    ]);
    expect(r).toEqual(['PS', 'P', '?', '?', 'B']);
  });

  test('a very long name stays on two lines inside the bar', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      Object.assign(S, { logoData: '', logoUrl: '', logoMeta: null, bname: "ZJ's Painting & Special Coatings of Greater Northeast Kansas" });
      applyBrandLogo();
      const n = document.querySelector('#mobile-topbar-brand .brand-name').getBoundingClientRect();
      const bar = document.getElementById('mobile-topbar').getBoundingClientRect();
      return { inside: n.bottom <= bar.bottom + 1 && n.top >= bar.top - 1, bleed: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    expect(r).toEqual({ inside: true, bleed: false });
  });
});
