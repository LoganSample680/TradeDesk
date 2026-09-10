// Team, after the bars (owner 2026-08-30, asked how the affordance work
// carries to Team and picked option 1: "per-person bars inside the expanded
// card, drill goes to that person's week then day").
//
// The card used to open onto a flat six-column table of every day that month.
// It now opens onto that person's weekly bars, and tapping one drills into the
// same week and day screens the owner already has for himself. Which means
// Team gained a second person's data on screens that were written assuming the
// rows were YOURS, and that assumption is what most of this file is about.
const { test, expect, mockAllExternal, waitForAppBoot, assertNoErrors } = require('./helpers');
const { mountTeam, mountTeamCard, mountWeekBars, settleBars } = require('./week-bars-fixture');

test.describe('team: the card opens onto that person', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    await mountTeam(page);
  });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'team bars'); });

  test('every crew card carries a chart and none carries a table', async ({ page }) => {
    const r = await page.evaluate(() => ({
      cards: [...document.querySelectorAll('.bk-week')].map(c => ({
        bars: c.querySelectorAll('.tl-wbar-col').length,
        rows: c.querySelectorAll('.tl-tbl tr').length,
      })),
      // The function that drew that table is gone, not merely uncalled (§7).
      tlRow: typeof window._tlRow,
    }));
    expect(r.cards.length).toBe(3);
    r.cards.forEach(c => { expect(c.bars).toBeGreaterThan(0); expect(c.rows).toBe(0); });
    expect(r.tlRow).toBe('undefined');
  });

  test('a card shows that person\'s weeks, not the crew\'s', async ({ page }) => {
    const r = await page.evaluate(() => {
      const card = [...document.querySelectorAll('.bk-week')]
        .find(c => (c.textContent || '').includes('Jose'));
      return {
        // firstChild: the label's own text, without the › chevron span that
        // follows it on an openable column.
        labels: [...card.querySelectorAll('.tl-wbar-dow')].map(e => e.firstChild.textContent),
        drills: [...card.querySelectorAll('.tl-wbar-hit')]
          .map(b => b.getAttribute('onclick')),
      };
    });
    // Jose worked the week of 8/2 and the week of 8/23. The owner's own four
    // weeks are on the owner's card, not this one.
    // AMENDED 2026-09-05 (10.4, design handoff): a week is a RANGE now, not
    // the date it starts on. Same two weeks, named as spans.
    expect(r.labels).toEqual(['2\u20138', '23\u201329']);
    r.drills.forEach(d => expect(d).toContain("_tlDrillPerson('crew-jose'"));
  });

  test('no card carries a Send button', async ({ page }) => {
    // One primary Send per screen (§15.1). Three open cards would otherwise be
    // three, and each would send the wrong person's hours anyway.
    const n = await page.evaluate(() => document.querySelectorAll('.tl-wbar-share').length);
    expect(n).toBe(0);
  });

  test('the page itself still has no crew roll-up chart', async ({ page }) => {
    const r = await page.evaluate(() => ({
      pageChart: !!document.querySelector('#tl-list > .tl-wbar-wrap'),
      folded: _tlMonthBarsHtml(_tlLastRows, '2026-08', 'team'),
    }));
    // Folding five people into one bar per week hides who did what, which is
    // the one thing the cards exist to show. A uid is what makes it one
    // person's chart and therefore legitimate.
    expect(r.pageChart).toBe(false);
    expect(r.folded).toBe('');
  });
});

test.describe('team: drilling into one crew member', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    await mountTeamCard(page, 'crew-jose');
    await page.evaluate(() => _tlDrillPerson('crew-jose', '2026-08-23'));
    await page.waitForTimeout(300);
    await settleBars(page);
  });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'team drill'); });

  test('the screen says whose week it is and where back goes', async ({ page }) => {
    const r = await page.evaluate(() => ({
      who: (document.querySelector('.tl-drill-who') || {}).textContent,
      back: (document.querySelector('.tl-drill-back') || {}).textContent,
      title: (document.querySelector('.tl-monav-lbl') || {}).textContent,
      share: document.querySelectorAll('.tl-wbar-share').length,
    }));
    // Without the name, this is a week chart belonging to nobody in particular.
    expect(r.who).toBe('Jose Ramirez');
    expect(r.back).toContain('All crew');
    expect(r.title).toContain('Aug 23');
    // _tlShareWeekAt reads _tlLastRows, which in Team is everybody.
    expect(r.share).toBe(0);
  });

  test('the chart is his week and his total, not the crew\'s', async ({ page }) => {
    const r = await page.evaluate(() => ({
      total: (document.querySelector('.tl-monav-tot') || {}).textContent,
      hours: [...document.querySelectorAll('.tl-wbar-amt')].map(e => e.textContent),
    }));
    // 430 + 110 + 470 + 55 = 1065 paid minutes across Mon to Thu.
    expect(r.total).toBe('17h 45m');
    expect(r.hours).toEqual(['—', '7h', '1h', '7h', '55m', '—', '—']);
  });

  test('the arrows stay inside him', async ({ page }) => {
    const r = await page.evaluate(() => ({
      sibs: _tlDrillSiblings(_tlLastRows),
      uid: _tlDrill.uid,
    }));
    // His two weeks in August. Stepping from his Tuesday onto somebody else's
    // Wednesday is not a sideways move, it is a different question.
    expect(r.uid).toBe('crew-jose');
    expect(r.sibs).toEqual(['2026-08-02', '2026-08-23']);
  });

  test('down to a day keeps him, back up to the month lets him go', async ({ page }) => {
    const down = await page.evaluate(async () => {
      _tlDrillTo('day', '2026-08-26');
      await new Promise(r => setTimeout(r, 250));
      return { uid: _tlDrill.uid, level: _tlDrill.level,
               who: (document.querySelector('.tl-drill-who') || {}).textContent,
               back: (document.querySelector('.tl-drill-back') || {}).textContent };
    });
    expect(down.uid).toBe('crew-jose');
    expect(down.back).toContain('Aug 23');
    expect(down.who).toBe('Jose Ramirez');

    const up = await page.evaluate(async () => {
      _tlDrillUp();                       // day -> week, still his
      await new Promise(r => setTimeout(r, 250));
      const mid = _tlDrill.uid;
      _tlDrillUp();                       // week -> month, the crew list
      await new Promise(r => setTimeout(r, 300));
      return { mid, uid: _tlDrill.uid,
               cards: document.querySelectorAll('.bk-week').length,
               who: !!document.querySelector('.tl-drill-who') };
    });
    // A person is not a level: it rides week to day and is dropped only at the
    // one screen that is not about one person.
    expect(up.mid).toBe('crew-jose');
    expect(up.uid).toBe(null);
    expect(up.cards).toBe(3);
    expect(up.who).toBe(false);
  });

  test('a person with nothing that month falls back to the crew list', async ({ page }) => {
    const r = await page.evaluate(async () => {
      _tlDrillPerson('crew-nobody', '2026-08-23');
      await new Promise(r => setTimeout(r, 350));
      return { uid: _tlDrill.uid,
               cards: document.querySelectorAll('.bk-week').length,
               empty: (document.querySelector('#tl-list') || {}).innerHTML.trim().length };
    });
    // Never a blank screen: the crew list is always a truthful answer.
    expect(r.uid).toBe(null);
    expect(r.cards).toBe(3);
    expect(r.empty).toBeGreaterThan(0);
  });

  test('switching back to Me does not take a crew id with it', async ({ page }) => {
    const r = await page.evaluate(async () => {
      setTimeLogScope('me');
      await new Promise(r => setTimeout(r, 350));
      return { uid: _tlDrill.uid, sibs: _tlDrillSiblings(_tlLastRows).length };
    });
    // Left set, it filters your own weeks by somebody else's id and both
    // arrows simply look dead.
    expect(r.uid).toBe(null);
    expect(r.sibs).toBeGreaterThan(0);
  });

  test('_tlDrillPerson refuses nothing at all', async ({ page }) => {
    const r = await page.evaluate(() => {
      const before = _tlDrill.uid;
      const call = a => { try { _tlDrillPerson(a, '2026-08-23'); return _tlDrill.uid; }
                          catch (e) { return 'threw'; } };
      return [before, call(null), call(undefined), call(''), call(0)];
    });
    // Every one of them leaves the uid exactly as it was, and none throws.
    expect(r).toEqual(['crew-jose', 'crew-jose', 'crew-jose', 'crew-jose', 'crew-jose']);
  });
});

test.describe('team: answering a hole is not something you do for somebody else', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
  });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'team gap'); });

  test('a crew member\'s hole is shown, and named, but not answerable', async ({ page }) => {
    await mountTeamCard(page, 'crew-jose');
    const r = await page.evaluate(async () => {
      _tlDrillPerson('crew-jose', '2026-08-23');
      await new Promise(r => setTimeout(r, 250));
      _tlDrillTo('day', '2026-08-26');
      await new Promise(r => setTimeout(r, 300));
      const gap = document.querySelector('.tl-rail-row[data-kind="gap"]');
      return { there: !!gap,
               chips: gap ? gap.querySelectorAll('.tl-rail-chip').length : -1,
               text: gap ? gap.textContent : '' };
    });
    // _tlAddUnaccounted stamps the CURRENT user, so a chip here would put the
    // owner's own manual hours on Jose's Wednesday and nothing would say so.
    expect(r.there).toBe(true);
    expect(r.chips).toBe(0);
    // Still ASKED, because an unanswered hole in a crew week is exactly what
    // payroll needs to see. Only the button is withheld.
    expect(r.text).toContain('What was this time?');
    expect(r.text).toContain('Only Jose can answer this');
  });

  test('my own hole still has its three chips', async ({ page }) => {
    await mountWeekBars(page);
    const r = await page.evaluate(async () => {
      _tlDrillTo('day', '2026-08-26');
      await new Promise(r => setTimeout(r, 300));
      const gap = document.querySelector('.tl-rail-row[data-kind="gap"]');
      return { chips: gap ? [...gap.querySelectorAll('.tl-rail-chip')].map(c => c.textContent) : [] };
    });
    // The guard must not have cost the owner the feature it protects.
    expect(r.chips.length).toBe(3);
    expect(r.chips.join(' ')).toContain('Personal');
  });

  test('the predicate itself, on every shape of row', async ({ page }) => {
    const r = await page.evaluate(() => {
      const call = a => { try { return _tlRowIsMine(a); } catch (e) { return 'threw'; } };
      return { own: call({ personUid: null }), other: call({ personUid: 'crew-jose' }),
               nul: call(null), undef: call(undefined), str: call('row'),
               arr: call([]), num: call(7) };
    });
    // An owner's own manual rows carry personUid null, which is the whole
    // reason this predicate is not just an equality check.
    expect(r.own).toBe(true);
    expect(r.other).toBe(false);
    expect([r.nul, r.undef, r.str, r.num]).toEqual([false, false, false, false]);
  });
});

test.describe('team: deleting an entry survived the table', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    await mountWeekBars(page);
  });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'rail delete'); });

  test('the 3-second hold moved onto the rail row', async ({ page }) => {
    const r = await page.evaluate(() => {
      const manual = { rawId: 91, source: 'manual', personUid: null,
        personName: 'Logan Sample', clientName: 'Riverside', minutes: 60,
        startTime: '2026-08-27T13:00:00Z', endTime: '2026-08-27T14:00:00Z' };
      const auto = { rawId: 92, source: 'auto', rawSource: 'client',
        personUid: 'crew-jose', personName: 'Jose Ramirez', clientName: 'X', minutes: 60,
        startTime: '2026-08-27T13:00:00Z', endTime: '2026-08-27T14:00:00Z' };
      const grab = h => { const d = document.createElement('div'); d.innerHTML = h;
        const li = d.querySelector('li'); return { id: li.getAttribute('data-lp-id'),
          type: li.getAttribute('data-lp-type'), label: li.getAttribute('data-lp-label') }; };
      return { manual: grab(_tlRailRow(manual)), auto: grab(_tlRailRow(auto)) };
    });
    // _tlRow carried the only delete gesture in the app for a time entry.
    // Removing the table it lived on must not remove the ability (§7.2).
    expect(r.manual.id).toBe('91');
    expect(r.manual.type).toBe('timelog');
    expect(r.manual.label).toContain('Riverside');
    // Same _tlCanEdit gate it always had: not on a GPS row, and not on
    // somebody else's, unless this viewer has payroll permission.
    expect(r.auto.id).toBe(null);
  });
});

// The row says WHO, not WHERE (owner 2026-09-01: "a 2950 sw mcculure rd from
// 1:25 pm to 3:42 but that last one should say John Doe"). Two visits to the
// same client on the same day disagreed on screen: the one with no job
// attached said "John Doe", the one that had resolved a job said the street.
test.describe('rail row title: the client name wins', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllExternal(page);
    await page.goto('/index.html');
    await waitForAppBoot(page);
    await mountWeekBars(page);
  });
  test.afterEach(async ({ page }) => { assertNoErrors(page, 'rail title'); });

  test('name beats address, address still fills in when there is no name',
  async ({ page }) => {
    const r = await page.evaluate(() => {
      const base = { source: 'auto', rawSource: 'client', personUid: 'crew-jose',
        personName: 'Jose Ramirez', minutes: 137,
        startTime: '2026-08-27T18:25:00Z', endTime: '2026-08-27T20:42:00Z' };
      const ttl = row => { const d = document.createElement('div');
        d.innerHTML = _tlRailRow(row);
        const el = d.querySelector('.tl-rail-ttl'); return el ? el.textContent : null; };
      return {
        both: ttl({ ...base, clientName: 'John Doe', addr: '2950 SW McClure Rd' }),
        // The same client, no address resolved: unchanged behaviour.
        nameOnly: ttl({ ...base, clientName: 'John Doe', addr: '' }),
        // A supply run has nowhere to look a name up: the address is the only
        // thing that identifies it, so it must still show.
        addrOnly: ttl({ ...base, clientName: '-', addr: '1201 SW Gage Blvd' }),
        // Neither: the kind's own word, never a bare hyphen.
        neither: ttl({ ...base, clientName: '-', addr: '' }),
        manual: ttl({ ...base, source: 'manual', clientName: '-', addr: '' }),
      };
    });
    expect(r.both).toBe('John Doe');
    expect(r.nameOnly).toBe('John Doe');
    expect(r.addrOnly).toBe('1201 SW Gage Blvd');
    expect(r.neither).not.toBe('-');
    expect(r.neither).toBeTruthy();
    expect(r.manual).toBe('Clocked in');
  });
});
