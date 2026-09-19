// ── WHAT A ROW'S SOURCE MEANS: four predicates, one home ─────────────────────
//
// A job_time_entries row carries a `source` string and every screen in the app
// asks the same four questions about it: is this a drive, is it time nobody is
// paid for, did the day vouch for it, is it a named place rather than a job.
// The answers used to live in js/geo-track.js, which is the tracking ENGINE:
// eleven thousand lines of fences, plugins and queues that a page has to be
// running the whole app to load.
//
// timesheet.html is not running the whole app. It loads js/timelog.js and
// nothing else, and js/timelog.js asks all four of these through
// `typeof _geoIsDriveSource === 'function'` guards, which on that page were
// all FALSE. So every drive on a shared timesheet was silently counted as
// time on site: the boss opened the link and saw 12h 50m of On site with no
// Driving in the breakdown at all, on a week with fifty minutes of it. Found
// 2026-09-19 by driving the real page against the real rows, and the reason
// it had never shown up in a test is that the page's spec fed it a fixture
// instead of the database.
//
// The page had already hand-copied ONE of the four into itself, which is the
// shape of the same mistake: four copies drift, and the copy that drifts is
// the one nobody is looking at. They live here now, in a file small enough
// for any page to load, and geo-track.js loads it like everybody else (7.3).

// ONE place decides what a job_time_entries row means. Three call sites in
// finance.js tested `source==='drive'` exactly, so a personal-vehicle leg
// ('drive-personal') fell through their else branch and was counted as ON-SITE
// job labor: it inflated Job Profit's labor cost and the crew report's job-site
// hours with time the person spent behind the wheel.
function _geoIsDriveSource(s){return /^drive/.test(String(s||''));}

// A named destination that is not a job: a supply house, the yard, a home
// office. 'place-supply', 'place-load' and 'place-office' are separate rows on
// purpose, and an exact match would have let them fall through every money
// view's else branch and be counted as ON-SITE JOB LABOR. That is precisely
// the bug above, which is why that one is /^drive/ and this is /^place/: one
// predicate owns what a source MEANS, and a new variant joins the family by
// being named into it rather than by every caller learning a new string.
function _geoIsPlaceSource(s){return /^place/.test(String(s||''));}

// ── SHOWN, NEVER CLAIMED ──────────────────────────────────────────────────
// A `-held` suffix means the deriver wrote this row but nothing in the day
// vouched for it (js/geo-derive.js rules 13, 15 and 18): a visit at a family
// address, a drive out to somewhere nobody saved, the stop at the far end of
// it. The row exists so the log has no hole in it and so the map can draw
// where the truck went; it earns no minutes anywhere.
//
// A SUFFIX, so it composes with the prefix families rather than replacing
// them. 'drive-held' is still a drive to _geoIsDriveSource and still reads
// "Drive time" on the rail, which is what it was; it is simply not paid.
// 'client-held' has been in this family since rule 13 shipped and now has a
// name for what it is instead of one string every reader had to memorise.
function _geoIsHeldSource(s){return /-held$/.test(String(s||''));}

// ── OFFICE TIME IS NEVER RUNNING TIME (owner rule 2026-09-19) ────────────
// "Office time should never add itself to a table as running time, right now
// it does ... important to leave it but need to mark it as unpaid since
// office time goes a part of the bill."
//
// Section 9.11 has said half of this since 2026-08-30 ("home office time only
// counts when the app is open") and the deriver already enforces that half:
// rule 10 writes an Office row only for app-open minutes inside a home fence,
// and only OUTSIDE the working day. What nothing said was what the row is
// worth once written, so it fell through to paid and added itself to the
// day, the week and the overtime like a job site.
//
// It is overhead, not payroll: it belongs on the bill and in the record, and
// not in the hours anybody is paid for. Said HERE rather than in a reader
// because this one predicate is what every total already asks (the Time Log's
// paid minutes and OT, Crew Cost's labour bucket), so one answer moves all of
// them at once and cannot drift between screens.
//
// Nothing is deleted and nothing is rebuilt: the row keeps its place on the
// rail, greyed, and because this is a question about the SOURCE it re-grades
// every row already written, on every account, the moment this ships.
//
// 'place-home' rides along: the deriver stopped writing it (rule 12) but the
// rows it wrote are still there and js/timelog.js still reads them on purpose.
const _GEO_OFFICE_SOURCES={'place-office':1,'place-home':1};
function _geoIsOffJobSource(s){const k=String(s||'');return k==='stop'||_GEO_OFFICE_SOURCES[k]===1;}
