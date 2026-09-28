// ── WAKE A PHONE THAT JUST WENT DARK (owner 2026-09-28: "do the swipe fix") ──
//
// Jack's phone closed nine times in one workday, and each time it stayed dead
// until something happened to wake it: the half-hour silent push, or driving
// out of a fence. 18 minutes at worst. The phone now sends its close as it
// dies (TdGeoPlugin.appTerminate), so the server knows within seconds, and
// this decides whether that close earns one silent push to bring the app
// back. Apple relaunches a closed app for a silent push unless the person
// swiped it away themselves; for that case the fence and significant-change
// wakes are still the net, exactly as before.
//
// Plain ESM, like derive-day.mjs, so Deno and the Node test harness load the
// same file. Pure: no clock, no network, no database.

// A close older than this is history, not news: a batch that arrives with a
// close in it hours later (the phone was dead until now) must not wake it.
export const WAKE_FRESH_MS = 3 * 60000;
// At most one wake per person per this long. Apple throttles silent pushes
// that come too often, and a throttled push is worth nothing.
export const WAKE_GAP_MS = 10 * 60000;

const DEFAULT_HOURS = { start: "06:00", end: "20:00", days: [1, 2, 3, 4, 5, 6] };

// The account's working hours from its settings row, the same shape and the
// same defaults deriveDayServer reads. One reading of the setting, two users.
export function workHoursFromSettings(raw) {
  try {
    const s = typeof raw === "string" ? JSON.parse(raw) : raw;
    const w = s && s.workHours;
    if (!w) return { ...DEFAULT_HOURS };
    const ok = (v) => /^\d{1,2}:\d{2}$/.test(String(v || ""));
    return {
      start: ok(w.start) ? w.start : DEFAULT_HOURS.start,
      end: ok(w.end) ? w.end : DEFAULT_HOURS.end,
      days: Array.isArray(w.days) && w.days.length ? w.days.map(Number) : DEFAULT_HOURS.days.slice(),
    };
  } catch {
    return { ...DEFAULT_HOURS };
  }
}

const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const minOf = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };

// Is this instant inside the working day, in Central time?
export function inWorkHours(ms, workHours) {
  if (!Number.isFinite(ms)) return false;
  const wh = workHours || DEFAULT_HOURS;
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const day = DOW[parts.weekday];
  if (!Array.isArray(wh.days) || !wh.days.includes(day)) return false;
  const now = Number(parts.hour) * 60 + Number(parts.minute);
  return now >= minOf(wh.start) && now < minOf(wh.end);
}

// Does this batch earn one wake-up push? Only for a close that is fresh,
// inside the working day, and not within WAKE_GAP_MS of the last wake.
export function terminateWakeDue(evs, nowMs, workHours, lastWakeMs) {
  if (!Array.isArray(evs) || !Number.isFinite(nowMs)) return false;
  let last = -Infinity;
  for (const e of evs) {
    if (e && e.type === "app-terminate" && Number.isFinite(e.ts) && e.ts > last) last = e.ts;
  }
  if (!Number.isFinite(last)) return false;
  const age = nowMs - last;
  if (age < -60000 || age > WAKE_FRESH_MS) return false;   // a minute of clock skew is allowed
  if (Number.isFinite(lastWakeMs) && nowMs - lastWakeMs < WAKE_GAP_MS) return false;
  return inWorkHours(last, workHours);
}
