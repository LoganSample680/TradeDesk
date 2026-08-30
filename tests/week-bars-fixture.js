// Shared fixture for the week bars: the owner's real week of 08/23 to 08/29.
// Wednesday 08/27 is his actual day, row for row, off the live tables (the
// re-timed CoreMotion tape, 9h 54m), so both the assertions and the screenshot
// are looking at the same thing he is.
//
// Columns: date, startZ, endZ, minutes, source, rawSource, label, unpaid.
const WEEK_ROWS_RAW = [
  // Tue 8/25
  ['2026-08-25', '13:05:00Z', '13:22:00Z',  17, 'auto',        'place-load', 'TradeDesk shop',    0],
  ['2026-08-25', '13:22:00Z', '13:41:00Z',  19, 'auto',        'drive',      'Drive time',        0],
  ['2026-08-25', '13:41:00Z', '20:10:00Z', 389, 'auto',        'client',     'John Doe',          0],
  ['2026-08-25', '20:10:00Z', '20:26:00Z',  16, 'auto',        'drive',      'Drive time',        0],
  ['2026-08-25', '20:26:00Z', '22:04:00Z',  98, 'shop',        'shop',       'TradeDesk shop',    0],
  // Wed 8/26, carries the unanswered hole
  ['2026-08-26', '14:12:00Z', '14:33:00Z',  21, 'auto',        'drive',      'Drive time',        0],
  ['2026-08-26', '14:33:00Z', '17:40:00Z', 187, 'auto',        'client',     'Ridgeline Remodel', 0],
  ['2026-08-26', '17:40:00Z', '18:25:00Z',  45, 'unaccounted', '',           'Unaccounted for',   1],
  ['2026-08-26', '18:25:00Z', '21:02:00Z', 157, 'auto',        'client',     'Ridgeline Remodel', 0],
  // Thu 8/27, the real one
  ['2026-08-27', '12:43:54Z', '12:49:43Z',   6, 'auto',        'place-load', 'TradeDesk shop',    0],
  ['2026-08-27', '12:49:43Z', '12:59:06Z',   9, 'auto',        'drive',      'Drive time',        0],
  ['2026-08-27', '12:59:06Z', '17:01:35Z', 242, 'auto',        'client',     'John Doe',          0],
  ['2026-08-27', '17:01:35Z', '17:13:03Z',  11, 'auto',        'drive',      'Drive time',        0],
  ['2026-08-27', '17:13:03Z', '17:48:05Z',  35, 'shop',        'shop',       'TradeDesk shop',    0],
  ['2026-08-27', '17:48:05Z', '17:57:43Z',  10, 'auto',        'drive',      'Drive time',        0],
  ['2026-08-27', '17:57:43Z', '22:26:48Z', 269, 'auto',        'client',     'John Doe',          0],
  ['2026-08-27', '22:26:48Z', '22:38:57Z',  12, 'auto',        'drive',      'Drive time',        0],
  // Fri 8/28, the long one: sets the right edge of the shared axis
  ['2026-08-28', '11:50:00Z', '12:04:00Z',  14, 'auto',        'place-load', 'TradeDesk shop',    0],
  ['2026-08-28', '12:04:00Z', '12:31:00Z',  27, 'auto',        'drive',      'Drive time',        0],
  ['2026-08-28', '12:31:00Z', '23:15:00Z', 644, 'auto',        'client',     'Maple St duplex',   0],
  ['2026-08-28', '23:15:00Z', '23:44:00Z',  29, 'auto',        'drive',      'Drive time',        0],
  // Sat 8/29, short
  ['2026-08-29', '14:30:00Z', '14:47:00Z',  17, 'auto',        'drive',      'Drive time',        0],
  ['2026-08-29', '14:47:00Z', '17:05:00Z', 138, 'auto',        'client',     'Harbor View',       0],
];

const WEEK_ROWS = WEEK_ROWS_RAW.map((w, i) => ({
  id: 'wr' + i, date: w[0],
  startTime: '2026-' + w[0].slice(5) + 'T' + w[1],
  endTime: '2026-' + w[0].slice(5) + 'T' + w[2],
  minutes: w[3], source: w[4], rawSource: w[5],
  clientName: w[6], detail: w[6], addr: '',
  personName: 'Logan Sample', personUid: 'me', unpaid: !!w[7],
}));

// Sun 8/23 and Mon 8/24 carry nothing on purpose: an empty lane is a real
// state and it has broken before (a global `.empty` class blew one lane up to
// 126px), so it is in the fixture rather than left to chance.
const WEEK_DAYS = ['2026-08-23','2026-08-24','2026-08-25','2026-08-26',
                   '2026-08-27','2026-08-28','2026-08-29'];

// A full month for the month-level shot and its assertions: three more weeks
// of August ahead of the real 08/23 one, so the chart shows what a month
// actually looks like (four bars, a light week, a heavy one) instead of one
// bar spanning the page.
function _wk(startDay, mins) {
  return mins.map((m, i) => {
    const d = '2026-08-' + String(startDay + i).padStart(2, '0');
    return { id: 'm' + startDay + i, date: d,
      startTime: d + 'T13:00:00Z', endTime: d + 'T21:00:00Z',
      minutes: m, source: i % 4 === 1 ? 'shop' : 'auto',
      rawSource: i % 4 === 1 ? 'shop' : (i % 3 === 0 ? 'drive' : 'client'),
      clientName: 'Earlier work', detail: 'Earlier work', addr: '',
      personName: 'Logan Sample', personUid: 'me', unpaid: false };
  });
}
// September carries ONE week on purpose: a month with a single bar used to
// hand that week the whole page and it read as a slab, not a bar (owner
// 2026-08-30, "one week looks awful"). It is in the fixture so the capped
// column is exercised and screenshotted rather than trusted.
function _sep(startDay, mins) {
  return mins.map((m, i) => {
    const d = '2026-09-' + String(startDay + i).padStart(2, '0');
    return { id: 's' + startDay + i, date: d,
      startTime: d + 'T13:00:00Z', endTime: d + 'T19:00:00Z',
      minutes: m, source: 'auto', rawSource: i % 3 === 0 ? 'drive' : 'client',
      clientName: 'September work', detail: 'September work', addr: '',
      personName: 'Logan Sample', personUid: 'me', unpaid: false };
  });
}
const MONTH_ROWS = [].concat(
  _wk(3,  [430, 96, 512, 44, 380]),     // Aug 2 to 8
  _wk(10, [505, 120, 468, 60, 442]),    // Aug 9 to 15
  _wk(17, [188, 40, 210]),              // Aug 16 to 22, a light week
  WEEK_ROWS,
  _sep(1, [402, 88, 455]));             // Sep, a single week

// Seeds the store the page reads and lets the app render itself. Nothing is
// injected: the drill builds the DOM, so a test and a screenshot are both
// looking at what actually ships.
//
// personUid null is an owner-logged row, which is what isMine() lets through
// in Me scope; 'me' is nobody's uid and got filtered out, which is how the
// first attempt at this produced an empty month.
// Waits for the bars to finish growing before anything measures them.
//
// The entrance animation is a scaleY from 0, staggered per column, so a
// getBoundingClientRect() taken while it runs reports a FRACTION of the real
// height: on CI that showed up as a tallest bar of 63 where 61 was expected,
// an 8-hour guide that did not cross Friday, and segment heights of zero.
// Waiting on the animations themselves rather than sleeping a guessed number
// of milliseconds keeps it deterministic on a slow runner.
async function settleBars(page) {
  await page.evaluate(async () => {
    if (typeof document.getAnimations !== 'function') return;
    await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})));
  });
}
async function _seed(page, rows) {
  await page.evaluate((rs) => {
    try { S.bizTz = 'America/Chicago'; } catch (_e) {}
    window._timeLogRows = async () => rs.map(r => ({ ...r, personUid: null }));
    if (typeof goPg === 'function') goPg('pg-timelog');
  }, rows);
  await page.waitForTimeout(200);
  await page.evaluate(() => { setTimeLogYear(2026); });
  await page.waitForTimeout(500);
}
// The MONTH level, which is where the drill lands.
async function mountMonth(page) {
  await _seed(page, MONTH_ROWS);
  await page.evaluate(() => _tlDrillTo('month', '2026-08'));
  await page.waitForTimeout(250);
  await settleBars(page);
}
// One level down: the week of 08/23, the owner's real one.
async function mountWeekBars(page) {
  await _seed(page, MONTH_ROWS);
  await page.evaluate(() => { _tlDrillTo('month', '2026-08'); });
  await page.waitForTimeout(200);
  await page.evaluate(() => _tlDrillTo('week', '2026-08-23'));
  await page.waitForTimeout(250);
  await settleBars(page);
}
// Two levels down: Thursday 08/27.
async function mountDay(page) {
  await mountWeekBars(page);
  await page.evaluate(() => _tlDrillTo('day', '2026-08-27'));
  await page.waitForTimeout(250);
  await settleBars(page);
}

// ── Team: the same August, three people ────────────────────────────────────
// The owner's own rows (personUid null, which is how an owner-logged row
// actually arrives) plus two crew members, so the accordion has something to
// sort and the per-person drill has somebody to be wrong about. Jose carries a
// hole he has not answered, which is the case that proves an owner is shown
// the question and not the buttons.
const _CREW = [
  { uid: 'crew-jose',  name: 'Jose Ramirez' },
  { uid: 'crew-danny', name: 'Danny Fisher' },
];
function _crewRows(uid, name, startDay, mins, gapDay) {
  const out = mins.map((m, i) => {
    const d = '2026-08-' + String(startDay + i).padStart(2, '0');
    return { id: uid + startDay + i, date: d,
      startTime: d + 'T13:00:00Z', endTime: d + 'T20:00:00Z',
      minutes: m, source: i % 4 === 1 ? 'shop' : 'auto',
      rawSource: i % 4 === 1 ? 'shop' : (i % 3 === 0 ? 'drive' : 'client'),
      clientName: name + ' job', detail: name + ' job', addr: '',
      personName: name, personUid: uid, unpaid: false };
  });
  if (gapDay) out.push({ id: uid + 'gap', date: gapDay,
    startTime: gapDay + 'T17:40:00Z', endTime: gapDay + 'T18:25:00Z',
    minutes: 45, source: 'unaccounted', rawSource: '',
    clientName: 'Unaccounted for', detail: 'Unaccounted for', addr: '',
    personName: name, personUid: uid, unpaid: true });
  return out;
}
const TEAM_ROWS = [].concat(
  MONTH_ROWS.filter(r => (r.date || '').startsWith('2026-08'))
            .map(r => ({ ...r, personUid: null, personName: 'Logan Sample' })),
  _crewRows('crew-jose',  'Jose Ramirez',  3,  [402, 96, 455, 60, 388], '2026-08-26'),
  _crewRows('crew-jose',  'Jose Ramirez',  24, [430, 110, 470, 55]),
  _crewRows('crew-danny', 'Danny Fisher', 10, [300, 88, 322, 44]),
  _crewRows('crew-danny', 'Danny Fisher', 25, [510, 120, 495]));

// Team seeds real personUids, so it cannot go through _seed (which flattens
// every row onto the owner). Payroll permission is stubbed on, because without
// it renderTimeLog clamps scope straight back to Me.
async function mountTeam(page) {
  await page.evaluate((rs) => {
    try { S.bizTz = 'America/Chicago'; } catch (_e) {}
    window._canViewComp = () => true;
    window._timeLogRows = async () => rs;
    if (typeof goPg === 'function') goPg('pg-timelog');
  }, TEAM_ROWS);
  await page.waitForTimeout(200);
  await page.evaluate(() => { setTimeLogYear(2026); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { _tlDrill.uid = null; setTimeLogScope('team'); });
  await page.waitForTimeout(300);
  await page.evaluate(() => _tlDrillTo('month', '2026-08'));
  await page.waitForTimeout(300);
  await settleBars(page);
}
// One crew card open, so its weekly bars are on screen.
async function mountTeamCard(page, uid) {
  await mountTeam(page);
  await page.evaluate((u) => {
    const cards = [...document.querySelectorAll('.bk-week')];
    const hit = cards.find(c => c.querySelector('.tl-wbar-col button[onclick*="' + u + '"]'));
    if (hit) hit.querySelector('.bk-week-hd').click();
  }, uid);
  await page.waitForTimeout(300);
  await settleBars(page);
}

module.exports = { WEEK_ROWS, WEEK_DAYS, MONTH_ROWS, TEAM_ROWS, _CREW,
  mountWeekBars, mountMonth, mountDay, mountTeam, mountTeamCard, settleBars };
