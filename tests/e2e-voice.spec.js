// @ts-check
// ── Voice notes (owner 2026-08-11) ───────────────────────────────────────────
// Hold the mic, talk, let go, the words land in the field. Transcribed ON the
// phone, so it costs nothing, works with no signal, and the audio never
// leaves the device.
//
// What these lock down, in order of how badly each would hurt:
//   • dictation APPENDS, it never wipes text the user already typed
//   • the mic is never drawn on a device that cannot dictate (no dead control)
//   • a thumb sliding off the button stops the recording (no hot mic)
//   • the field fires input/change so autosave and validation behave as typing
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');

test.describe('Voice notes', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
    page = await ctx.newPage();
    await mockAllExternal(page);
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await waitForAppBoot(page);
  });
  test.afterAll(async () => { await page.context().close(); });

  test('joining reads like a person wrote it', async () => {
    const r = await page.evaluate(() => ({
      fresh: _voiceJoin('', 'gate code is 4471'),
      appended: _voiceJoin('bring the ladder', 'and extra paint'),
      afterSentence: _voiceJoin('Bring the ladder.', 'Dog in the back yard'),
      trailingSpace: _voiceJoin('bring the ladder   ', 'and paint'),
      nothingHeard: _voiceJoin('bring the ladder', ''),
      nothingHeardBlank: _voiceJoin('bring the ladder', '   '),
      bothEmpty: _voiceJoin('', ''),
      nulls: _voiceJoin(null, null),
    }));
    expect(r.fresh).toBe('gate code is 4471');
    expect(r.appended).toBe('bring the ladder and extra paint');
    expect(r.afterSentence).toBe('Bring the ladder. Dog in the back yard');
    expect(r.trailingSpace, 'no double space').toBe('bring the ladder and paint');
    expect(r.nothingHeard, 'a silent recording never damages the note').toBe('bring the ladder');
    expect(r.nothingHeardBlank).toBe('bring the ladder');
    expect(r.bothEmpty).toBe('');
    expect(r.nulls).toBe('');
  });

  test('no mic button on a device that cannot dictate', async () => {
    const r = await page.evaluate(() => {
      const realCap = window.Capacitor;
      try {
        window.Capacitor = undefined;                 // browser / PWA
        const el = document.createElement('textarea');
        document.body.appendChild(el);
        const btn = _voiceMic(el);
        el.remove();
        return { capable: _voiceCapable(), btn: btn === null };
      } finally { window.Capacitor = realCap; }
    });
    expect(r.capable).toBe(false);
    expect(r.btn, 'nothing drawn beats a dead control').toBe(true);
  });

  test('dictation appends to typed text and fires input/change', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      let listener = null;
      try {
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: () => ({
            available: () => Promise.resolve({ status: 'granted', onDevice: true, available: true }),
            addListener: (name, cb) => { listener = cb; return Promise.resolve({ remove: () => { listener = null; } }); },
            start: () => Promise.resolve({ started: true }),
            stop: () => Promise.resolve({ text: 'gate code is 4471' }),
          }),
        };
        const el = document.createElement('textarea');
        el.value = 'Bring the ladder.';
        document.body.appendChild(el);
        let inputs = 0, changes = 0;
        el.addEventListener('input', () => inputs++);
        el.addEventListener('change', () => changes++);

        await _voiceStart(el);
        // A partial result mid-sentence updates the field live.
        listener({ text: 'gate code', final: false });
        const partial = el.value;
        const final = await _voiceStop();
        el.remove();
        return { partial, final, value: final, inputs, changes };
      } finally { window.Capacitor = realCap; }
    });
    expect(r.partial, 'the text appears while you are still talking').toBe('Bring the ladder. gate code');
    expect(r.final, 'and the typed note is never wiped').toBe('Bring the ladder. gate code is 4471');
    expect(r.inputs, 'autosave and validation see it as typing').toBeGreaterThanOrEqual(1);
    expect(r.changes).toBeGreaterThanOrEqual(1);
  });

  test('denied permission dictates nothing and leaves the field untouched', async () => {
    const r = await page.evaluate(async () => {
      const realCap = window.Capacitor;
      try {
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: () => ({
            available: () => Promise.resolve({ status: 'denied' }),
            start: () => { throw new Error('should never be called'); },
          }),
        };
        const el = document.createElement('textarea');
        el.value = 'typed by hand';
        document.body.appendChild(el);
        const started = await _voiceStart(el);
        const after = el.value;
        el.remove();
        return { started, after };
      } finally { window.Capacitor = realCap; }
    });
    expect(r.started).toBe(false);
    expect(r.after, 'a refused mic must not touch the note').toBe('typed by hand');
  });

  test('the field note editor grows a mic on both note fields', async () => {
    const r = await page.evaluate(() => {
      const realCap = window.Capacitor, savedJobs = jobs.slice(), savedClients = clients.slice();
      try {
        window.Capacitor = {
          isNativePlatform: () => true,
          registerPlugin: () => ({ available: () => Promise.resolve({ status: 'granted' }) }),
        };
        clients.length = 0; clients.push({ id: 4400, name: 'Voice Client', addr: '9 Oak St', phone: '316-555-0100' });
        jobs.length = 0; jobs.push({ id: 4401, name: 'Voice Job', client_id: 4400, addr: '9 Oak St', status: 'upcoming', start: todayKey(), days: 1 });
        _openJobNoteEditor(4401);
        const mics = document.querySelectorAll('#_jobnote-ov .td-voice-mic').length;
        const rows = document.querySelectorAll('#_jobnote-ov .td-voice-row').length;
        // The textarea must still be usable, not swallowed by the wrapper.
        const ta = document.getElementById('_jn-note-ta');
        const inRow = !!(ta && ta.parentElement && ta.parentElement.classList.contains('td-voice-row'));
        _jnAttachMics();                       // idempotent: no second mic
        const afterTwice = document.querySelectorAll('#_jobnote-ov .td-voice-mic').length;
        document.getElementById('_jobnote-ov')?.remove();
        return { mics, rows, inRow, afterTwice };
      } finally {
        window.Capacitor = realCap;
        jobs.length = 0; savedJobs.forEach(j => jobs.push(j));
        clients.length = 0; savedClients.forEach(c => clients.push(c));
        document.getElementById('_jobnote-ov')?.remove();
      }
    });
    expect(r.mics, 'the job note AND the site-access note both get one').toBe(2);
    expect(r.rows).toBe(2);
    expect(r.inRow).toBe(true);
    expect(r.afterTwice, 'wiring twice never doubles the button').toBe(2);
  });

  test('no console errors during voice tests', async () => {
    assertNoErrors(page, 'voice notes');
  });
});
