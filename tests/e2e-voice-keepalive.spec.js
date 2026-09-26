// @ts-check
/**
 * Talk to Tim keeps listening through a pause, and says so when it cannot.
 *
 * Owner, 2026-09-26: "Talk to Tim failed to pickup what I was doing just now".
 * iOS ends a speech session on its own after a pause or an error, and the
 * native plugin then stops the mic without a word. The panel went on saying
 * "Tim is listening" and nothing after the pause was heard. And a mic that
 * never started showed the same listening panel over nothing.
 *
 * The native plugin is faked here: a session that emits words, ends itself,
 * and reports what it heard, the way SFSpeechRecognizer does.
 */
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Talk to Tim through a pause', () => {
  let page, ctx;
  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await ctx.close(); });

  // A fake TdVoice: start() opens a session, say() streams words into it,
  // end() is the phone closing it (final), stop() returns this session's words.
  const setup = (status, id) => page.evaluate(({ status, id }) => {
    const f = { starts: 0, stops: 0, live: false, latest: '', cb: null };
    window.__fake = f;
    window.__say = (t, final) => { f.latest = t; f.cb && f.cb({ text: t, final: !!final }); if (final) f.live = false; };
    window._voicePlugin = () => ({
      available: async () => ({ status, onDevice: true, available: true }),
      request: async () => ({ granted: status === 'granted' }),
      addListener: async (n, cb) => { f.cb = cb; return { remove() { f.cb = null; } }; },
      start: async () => { f.starts++; f.live = true; f.latest = ''; return { started: true }; },
      stop: async () => { f.stops++; f.live = false; return { text: f.latest }; },
    });
    document.querySelectorAll('#_style-pick-ov,.zmodal-overlay,#_tim-listen,#_tim-listen-host').forEach(e => e.remove());
    clients.length = 0; bids.length = 0;
    clients.push({ id, name: 'John Doe', addr: '2950 SW McClure Rd, Topeka, KS 66614' });
    currentClientId = id;
    openTMEstimate(getClientById(id));
  }, { status, id });

  test('a pause ends the phone\'s session; Tim starts again and keeps every word', async () => {
    await setup('granted', 99201);
    await page.waitForTimeout(500);
    await page.evaluate(() => _geiScopeTalk());
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__fake.starts)).toBe(1);
    // He says a sentence, stops to look at the heater, the phone closes it.
    await page.evaluate(() => window.__say('Pull the old water heater', true));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__fake.starts), 'listening again after the pause').toBe(2);
    await page.evaluate(() => window.__say('and set a tankless'));
    await page.waitForTimeout(100);
    // Done talking.
    await page.evaluate(() => _timTalkStop(true));
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => ({ said: document.getElementById('gei-scope-say').value, talking: _timTalking, live: window.__fake.live }));
    expect(r.said).toBe('Pull the old water heater and set a tankless');
    expect(r.talking).toBe(false);
    expect(r.live, 'mic off').toBe(false);
  });

  test('a session that dies without a word (an error) is restarted after a few quiet seconds', async () => {
    await setup('granted', 99202);
    await page.waitForTimeout(500);
    await page.evaluate(() => _geiScopeTalk());
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__say('Run new pex to the manifold'));
    // The phone drops the session silently: no final, no more words.
    await page.evaluate(() => { window.__fake.live = false; });
    await page.waitForTimeout(5600);
    expect(await page.evaluate(() => window.__fake.starts), 'restarted once it went quiet').toBeGreaterThanOrEqual(2);
    await page.evaluate(() => window.__say('then set a tankless'));
    await page.evaluate(() => _timTalkStop(true));
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.getElementById('gei-scope-say').value)).toBe('Run new pex to the manifold then set a tankless');
    // Once stopped it stays stopped: no more restarts.
    const n = await page.evaluate(() => window.__fake.starts);
    await page.waitForTimeout(5200);
    expect(await page.evaluate(() => window.__fake.starts)).toBe(n);
  });

  test('a mic that will not start says so, instead of pretending to listen', async () => {
    await setup('denied', 99203);
    await page.waitForTimeout(500);
    await page.evaluate(() => _geiScopeTalk());
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({
      talking: _timTalking,
      text: document.getElementById('_tim-listen')?.innerText || '',
      starts: window.__fake.starts,
    }));
    expect(r.starts).toBe(0);
    expect(r.talking).toBe(false);
    expect(r.text).toContain("Tim can't hear you");
    expect(r.text).toContain('Settings');
    expect(r.text).not.toContain('Tim is listening');
    await page.locator('#_tim-listen button', { hasText: 'OK' }).click();
    expect(await page.evaluate(() => !!document.getElementById('_tim-listen'))).toBe(false);
  });

  test('no console errors', async () => { assertNoErrors(page, 'voice keepalive'); });
});
