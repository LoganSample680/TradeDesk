// reconcile-drive-legs: nightly safety net for the live client-side drive
// tracker (js/geo-track.js), which derives every drive leg from fence
// crossings observed in real time on the device. That is good enough for the
// common case, but a killed app, a stale local geocode cache
// (zp3_nearby_geo, see js/jobs.js), or a missed ping can all mean a real
// drive never gets a job_time_entries row: raw location_pings are written
// fire-and-forget and, until now, never read back.
//
// This does NOT attempt to re-derive origin/destination fences server-side
// (that would require re-geocoding every client/job/place address nightly,
// and getting it wrong risks writing a WRONG destination into payroll data,
// worse than writing nothing). Instead it works off movement alone: any
// maximal run of same-employee pings showing sustained GPS movement that has
// NO overlapping drive-source job_time_entries row is a drive the live
// engine missed. It backfills the TIME only (job_id/dest_place left null,
// same "claim time, not a destination we can't verify" principle as the
// day-rollover salvage in js/geo-track.js's _geoRestoreOpen), tagged
// source:'drive-reconciled' so it is never confused with a live-derived row
// and is still picked up by every existing drive-time money view
// (_geoIsDriveSource matches /^drive/).
//
// Idempotent by construction: client_key is deterministic from
// (employee, segment start), and job_time_entries has a unique index on
// (contractor_user_id, client_key) (20260719_geo_time_entry_idempotency.sql),
// so re-running this for the same day/account is always a no-op on rows it
// already wrote. The 'recon-' key namespace never collides with a live
// client-minted key, so it can never accidentally merge with (or shadow) a
// real client-logged row for the same leg; coverage is checked separately.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Tuned to the client's own thresholds (js/geo-track.js): a drive is real
// movement, not GPS jitter or a walk across a jobsite.
const MOVING_MPH = 5           // sustained speed above this = driving, not on-site
const MIN_SEGMENT_MILES = 0.5  // or enough total displacement to be a real trip
const MAX_PING_GAP_MIN = 12    // pings further apart than this can't be chained into one segment
const MIN_SEGMENT_MINUTES = 2  // same floor the live engine uses (mins<2 = pass-through, not a stop)

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8
  const dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Deterministic, namespaced separately from the client's own _geoLegKey so a
// reconciled row can never collide with (or be mistaken for) a live one.
function reconKey(employeeId: string, startedIso: string): string {
  return (employeeId || 'anon').slice(0, 8) + '-recon-' + (Date.parse(startedIso) || 0).toString(36)
}

type Ping = { lat: number; lon: number; ts: string; employee_user_id: string | null }
type Segment = { start: string; end: string; minutes: number }

// Walks one employee's day of pings and returns maximal runs of sustained
// movement. Two pings more than MAX_PING_GAP_MIN apart never chain (that gap
// could be a stop with tracking paused, not driving through it).
function findMovingSegments(pings: Ping[]): Segment[] {
  const segments: Segment[] = []
  let runStart: string | null = null, runMiles = 0
  let prev: Ping | null = null
  const flush = (endTs: string) => {
    if (runStart && runMiles >= MIN_SEGMENT_MILES) {
      const minutes = Math.round((Date.parse(endTs) - Date.parse(runStart)) / 60000)
      if (minutes >= MIN_SEGMENT_MINUTES) segments.push({ start: runStart, end: endTs, minutes })
    }
    runStart = null; runMiles = 0
  }
  for (const p of pings) {
    if (!prev) { prev = p; continue }
    const dtMin = (Date.parse(p.ts) - Date.parse(prev.ts)) / 60000
    if (dtMin <= 0 || dtMin > MAX_PING_GAP_MIN) { flush(prev.ts); prev = p; continue }
    const miles = haversineMiles(prev.lat, prev.lon, p.lat, p.lon)
    const mph = miles / (dtMin / 60)
    const moving = mph >= MOVING_MPH
    if (moving) {
      if (!runStart) runStart = prev.ts
      runMiles += miles
    } else if (runStart) {
      flush(prev.ts)
    }
    prev = p
  }
  if (prev) flush(prev.ts)
  return segments
}

function overlaps(seg: Segment, covered: { start: number; end: number }[]): boolean {
  const s = Date.parse(seg.start), e = Date.parse(seg.end)
  return covered.some(c => s < c.end && e > c.start)
}

// PostgREST defaults to a 1000-row cap per request; a single tracked device
// pinging every ~10s already clears that inside one workday, and any query
// left unpaged here silently truncates (still returns 200, still reports
// ok:true) instead of erroring, so the gap would look like a clean run. Pages
// until a page comes back short of the limit.
const PAGE_SIZE = 1000
async function selectAllPages<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return all
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Deployed --no-verify-jwt like rollup-analytics (a cron job has no user
  // session to hold a JWT), but unlike that read-only aggregate, this one
  // WRITES payroll-relevant job_time_entries rows. A public, unauthenticated
  // URL invoking it in a loop could burn service-role DB load and (worse)
  // seed junk time entries. RECONCILE_SHARED_SECRET is a function secret set
  // via `supabase secrets set`, checked against the same value the workflow
  // sends as a header (RECONCILE_SHARED_SECRET repo secret).
  const expectedSecret = Deno.env.get('RECONCILE_SHARED_SECRET')
  if (expectedSecret && req.headers.get('x-recon-secret') !== expectedSecret) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Reconciles "yesterday" by default (the day just fully closed out);
  // ?day=YYYY-MM-DD lets a manual run target any specific day.
  const url = new URL(req.url)
  const dayParam = url.searchParams.get('day')
  const day = dayParam || new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const dayStart = day + 'T00:00:00.000Z'
  const dayEnd = day + 'T23:59:59.999Z'
  // One day of slack on the early side only: a live drive can start the
  // evening before and cross into this day (an overlap, not contained by
  // either day alone), but a segment built from THIS day's pings can never
  // start before dayStart, so the coverage query only needs to look back.
  const dayStartMinus1 = new Date(Date.parse(dayStart) - 86400000).toISOString()

  const log: Record<string, unknown> = { day }
  let written = 0, accountsScanned = 0

  try {
    const pings = await selectAllPages<{ contractor_user_id: string; employee_user_id: string | null; lat: number; lon: number; ts: string }>(
      (from, to) => sb.from('location_pings')
        .select('contractor_user_id, employee_user_id, lat, lon, ts')
        .gte('ts', dayStart).lte('ts', dayEnd)
        .order('ts', { ascending: true })
        .range(from, to)
    )
    if (!pings.length) return new Response(JSON.stringify({ ok: true, ...log, written: 0, note: 'no pings for this day' }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

    // Group by (contractor, employee): each is an independent driving stream.
    const streams = new Map<string, { contractor: string; employee: string; pings: Ping[] }>()
    for (const p of pings) {
      if (p.lat == null || p.lon == null || !p.contractor_user_id) continue
      const empId = p.employee_user_id || p.contractor_user_id
      const key = p.contractor_user_id + '|' + empId
      if (!streams.has(key)) streams.set(key, { contractor: p.contractor_user_id, employee: empId, pings: [] })
      streams.get(key)!.pings.push({ lat: Number(p.lat), lon: Number(p.lon), ts: p.ts, employee_user_id: empId })
    }
    accountsScanned = new Set([...streams.values()].map(s => s.contractor)).size

    // Overlap, not containment: a live-logged drive that starts the evening
    // before (US-Central evening = late UTC, routinely crosses the day
    // boundary) must still count as covering this day's segment, or the
    // reconciler writes a duplicate on top of it. Bounded on the early side
    // by dayStartMinus1 (a segment built from this day's own pings can never
    // start earlier) so this stays a real day-scoped query, not a full-table
    // scan.
    const existing = await selectAllPages<{ contractor_user_id: string; employee_user_id: string | null; arrived_at: string; departed_at: string; source: string }>(
      (from, to) => sb.from('job_time_entries')
        .select('contractor_user_id, employee_user_id, arrived_at, departed_at, source')
        .gte('arrived_at', dayStartMinus1).lte('arrived_at', dayEnd)
        .gte('departed_at', dayStart)
        .like('source', 'drive%')
        .range(from, to)
    )

    const coveredByStream = new Map<string, { start: number; end: number }[]>()
    for (const e of existing) {
      const empId = e.employee_user_id || e.contractor_user_id
      const key = e.contractor_user_id + '|' + empId
      if (!coveredByStream.has(key)) coveredByStream.set(key, [])
      if (e.arrived_at && e.departed_at) coveredByStream.get(key)!.push({ start: Date.parse(e.arrived_at), end: Date.parse(e.departed_at) })
    }

    const rows: Record<string, unknown>[] = []
    for (const [key, stream] of streams) {
      const segs = findMovingSegments(stream.pings)
      const covered = coveredByStream.get(key) || []
      for (const seg of segs) {
        if (overlaps(seg, covered)) continue
        rows.push({
          contractor_user_id: stream.contractor,
          employee_user_id: stream.employee,
          job_id: null,
          arrived_at: seg.start,
          departed_at: seg.end,
          minutes: seg.minutes,
          source: 'drive-reconciled',
          client_key: reconKey(stream.employee, seg.start),
        })
      }
    }

    if (rows.length) {
      // Idempotent: (contractor_user_id, client_key) is uniquely indexed, so a
      // re-run of the same day is a no-op on anything already written, by this
      // job OR (harmlessly, different key namespace) by the live client.
      const { error: upErr } = await sb.from('job_time_entries').upsert(rows, { onConflict: 'contractor_user_id,client_key', ignoreDuplicates: true })
      if (upErr) throw upErr
      written = rows.length
    }

    return new Response(JSON.stringify({ ok: true, ...log, accountsScanned, streamsScanned: streams.size, written }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    log.error = String(e)
    return new Response(JSON.stringify({ ok: false, ...log }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
