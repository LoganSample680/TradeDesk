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
  const host = document.createElement('div');
  host.id = 'wrail-host';
  host.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;' +
    'background:var(--paper);padding:14px 12px 24px';
  host.innerHTML = '<div class="card" style="padding:14px 12px">' +
    '<div id="wrail-body">' + _tlRenderWeekBody(key) + '</div></div>';
  document.body.appendChild(host);
}

module.exports = { WEEK_ROWS, WEEK_DAYS, renderWeekRail };
