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

// Runs INSIDE the page. Drives the REAL week body (_tlRenderWeekBody, Me
// scope, week pick) rather than assembling the chart by hand, so the picture
// under review and the assertions are both looking at what actually ships.
function renderWeekRail({ rows, days }) {
  try { S.bizTz = 'America/Chicago'; } catch (_e) {}
  const key = 'wr|' + days[0];
  _tlWeekCache[key] = { mo: '2026-08', wk: days[0], rows,
                        scope: 'me', cid: 'me', selfUid: 'me', domId: 'wrail-body' };
  _tlPickerSel[key] = 'week';
  // Mounted into the REAL page, not a floating overlay. Twice now a shot has
  // hidden something that was on the actual screen (the accordion header the
  // body was duplicating, then the page's own title), because the harness
  // rendered the component on a blank ground. It goes in #tl-list on
  // pg-timelog, so a screenshot shows the page chrome exactly as he sees it.
  const host = document.getElementById('tl-list') || document.createElement('div');
  host.id = 'tl-list';
  // The .bk-week accordion is rendered too, not just the body. Without it the
  // screenshot could not show that the body's own header repeated the week
  // label and total the accordion button already prints, which is exactly the
  // duplication the owner spotted on the real screen (2026-08-30).
  const fm = typeof _fmtMin === 'function' ? _fmtMin : (m => m + 'm');
  const total = _tlPaidMin(rows);
  host.innerHTML = '<div class="card" style="padding:0;overflow:hidden">' +
    '<div class="bk-week open"><button class="bk-week-hd">' +
      '<div style="flex:1;text-align:left">' +
        '<div class="bk-week-title">' + _tlWeekLabel(days[0]) + '</div>' +
        '<div class="bk-week-sub">' + rows.length + ' entries</div></div>' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<div style="font-size:12.5px;font-weight:800;color:var(--text)">' + fm(total) + '</div>' +
        '<div class="bk-week-chev">▾</div></div>' +
    '</button>' +
    '<div class="bk-week-body"><div id="wrail-body" style="padding:10px 14px 14px">' +
      _tlRenderWeekBody(key) + '</div></div></div></div>';
  if (!host.isConnected) document.body.appendChild(host);
}

// ONE mount sequence, used by the assertions and by the screenshot, so the
// two can never be looking at different DOM. The page's own render has to
// land BEFORE the injection or renderTimeLog simply overwrites it, which is
// how the first attempt at mounting on the real page produced a shot of an
// empty Time Log.
async function mountWeekBars(page) {
  await page.evaluate(() => { if (typeof goPg === 'function') goPg('pg-timelog'); });
  await page.waitForTimeout(400);
  await page.evaluate(renderWeekRail, { rows: WEEK_ROWS, days: WEEK_DAYS });
  await page.waitForTimeout(200);
}

module.exports = { WEEK_ROWS, WEEK_DAYS, renderWeekRail, mountWeekBars };
