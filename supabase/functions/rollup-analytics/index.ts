// rollup-analytics (Phase 1) — derive the funnel metrics the ops dashboard reads
// from data the app ALREADY captures, and write them to analytics_metrics_daily.
//
// Sources (all existing): proposal_views (open timestamps + view counts),
// signed_proposals (signed_at), td_liens + td_bids (liens-filed rate). NO client
// changes required — this just aggregates what's there. Runs as the service role
// (bypasses RLS) on a schedule or via workflow_dispatch. Every metric block is
// independently try/caught so one missing/empty table never kills the whole run.
//
// Each metric becomes one analytics_metrics_daily row for (today, metric, 'global')
// with a distribution (n/median/p25/p75/avg) and/or a single `value`.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const pct = (sorted: number[], p: number): number =>
  sorted.length ? sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)] : 0

function dist(values: number[]) {
  const v = values.filter((x) => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const sum = v.reduce((s, x) => s + x, 0)
  return {
    n: v.length,
    median: Math.round(pct(v, 0.5) * 100) / 100,
    p25: Math.round(pct(v, 0.25) * 100) / 100,
    p75: Math.round(pct(v, 0.75) * 100) / 100,
    avg: Math.round((sum / v.length) * 100) / 100,
  }
}

const HOURS = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const day = new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()
  const rows: Record<string, unknown>[] = []
  const log: Record<string, unknown> = {}
  const put = (metric: string, d: ReturnType<typeof dist> | null, value: number | null = null) => {
    rows.push({ day, metric, scope: 'global', n: d?.n ?? 0, median: d?.median ?? null, p25: d?.p25 ?? null, p75: d?.p75 ?? null, avg: d?.avg ?? null, value, updated_at: now })
  }

  // ── Pull the source tables once. ──
  let views: any[] = [], signed: any[] = []
  try { const { data } = await sb.from('proposal_views').select('bid_id, opened_at, hub_opened_at, hub_view_count, client_opened_at, client_view_count'); views = data ?? [] } catch (_) { log.views = 'unavailable' }
  try { const { data } = await sb.from('signed_proposals').select('bid_id, signed_at, status'); signed = data ?? [] } catch (_) { log.signed = 'unavailable' }

  // signed bid_ids that are genuinely signed (not declined). Schema-tolerant: if a
  // status column exists, exclude decline-ish values; otherwise count any signed_at.
  const isDecline = (s: any) => typeof s === 'string' && /declin|reject|cancel/i.test(s)
  const signedAt = new Map<string, string>()
  for (const r of signed) {
    if (r.signed_at && !isDecline(r.status)) {
      const k = String(r.bid_id)
      if (!signedAt.has(k)) signedAt.set(k, r.signed_at)
    }
  }

  // ── Open counts (engagement). ──
  try { put('hub_open_count', dist(views.map((v) => Number(v.hub_view_count) || 0).filter((n) => n > 0))) } catch (e) { log.hub_open_count = String(e) }
  try { put('proposal_open_count', dist(views.map((v) => Number(v.client_view_count) || 0).filter((n) => n > 0))) } catch (e) { log.proposal_open_count = String(e) }

  // ── Time-to-sign distributions (join views → signed by bid_id). ──
  try {
    const fromHub: number[] = [], fromOpen: number[] = []
    for (const v of views) {
      const sAt = signedAt.get(String(v.bid_id)); if (!sAt) continue
      if (v.hub_opened_at) { const h = HOURS(v.hub_opened_at, sAt); if (h >= 0) fromHub.push(h) }
      if (v.client_opened_at) { const h = HOURS(v.client_opened_at, sAt); if (h >= 0) fromOpen.push(h) }
    }
    put('time_to_sign_from_hub_hrs', dist(fromHub))
    put('time_to_sign_from_open_hrs', dist(fromOpen))
  } catch (e) { log.time_to_sign = String(e) }

  // ── Sign rate: signed / opened proposals. ──
  try {
    const openedBids = new Set(views.filter((v) => v.opened_at || v.hub_opened_at || v.client_opened_at).map((v) => String(v.bid_id)))
    const signedOpened = [...openedBids].filter((b) => signedAt.has(b)).length
    const rate = openedBids.size ? Math.round((signedOpened / openedBids.size) * 1000) / 10 : null
    put('sign_rate_pct', null, rate)
  } catch (e) { log.sign_rate = String(e) }

  // ── Liens filed rate: filed liens / completed (Closed Won) jobs. td_* are jsonb. ──
  try {
    let lienCount = 0, completed = 0
    try { const { count } = await sb.from('td_liens').select('id', { count: 'exact', head: true }); lienCount = count ?? 0 } catch (_) { log.liens = 'unavailable' }
    try {
      const { data } = await sb.from('td_bids').select('data').is('deleted_at', null)
      for (const r of (data ?? [])) {
        let d: any = (r as any).data; if (typeof d === 'string') { try { d = JSON.parse(d) } catch (_) { d = {} } }
        if (d && (d.status === 'Closed Won' || d.completion_date)) completed++
      }
    } catch (_) { log.bids = 'unavailable' }
    const rate = completed ? Math.round((lienCount / completed) * 1000) / 10 : null
    put('liens_filed_rate_pct', null, rate)
  } catch (e) { log.liens_filed_rate = String(e) }

  // ── Write the day's rollup. ──
  let writeErr: string | null = null
  if (rows.length) {
    const { error } = await sb.from('analytics_metrics_daily').upsert(rows, { onConflict: 'day,metric,scope' })
    if (error) writeErr = error.message
  }

  return new Response(JSON.stringify({ day, written: writeErr ? 0 : rows.length, metrics: rows.map((r) => r.metric), notes: log, error: writeErr }), {
    status: writeErr ? 500 : 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
