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

  // ── Raw interaction telemetry (analytics_events, last 24h) — clicks per page,
  // page views, and flow-test step costs land beside the live-user data so UX
  // hotspots show up in one place. Scope carries the page/step id. ──
  try {
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString()
    const { data: evts } = await sb.from('analytics_events')
      .select('event, ctx, value').gte('ts', since).limit(20000)
    const byKey = new Map<string, number[]>()
    for (const e of (evts ?? [])) {
      const k = String(e.event) + '|' + String(e.ctx ?? '')
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k)!.push(Number(e.value) || 0)
    }
    const totals: Record<string, number> = { click: 0, page: 0 }
    for (const [k, vals] of byKey) {
      const event = k.slice(0, k.indexOf('|'))
      const ctx = k.slice(k.indexOf('|') + 1)
      const sum = vals.reduce((s, x) => s + x, 0)
      if (event === 'click' || event === 'page') {
        totals[event] = (totals[event] || 0) + sum
        if (ctx) rows.push({ day, metric: event === 'click' ? 'clicks_page' : 'views_page', scope: ctx.slice(0, 60), n: vals.length, median: null, p25: null, p75: null, avg: null, value: sum, updated_at: now })
      } else if ((event === 'flow_step' || event === 'flow_total') && ctx) {
        const d = dist(vals)
        rows.push({ day, metric: event + '_clicks', scope: ctx.slice(0, 60), n: d?.n ?? 0, median: d?.median ?? null, p25: d?.p25 ?? null, p75: d?.p75 ?? null, avg: d?.avg ?? null, value: null, updated_at: now })
      }
    }
    put('clicks_total_24h', null, totals.click || 0)
    put('page_views_24h', null, totals.page || 0)
  } catch (e) { log.raw_events = String(e) }

  // ── Sign-flow funnel (sign_step events, last 24h) — one row per step so
  // Jarvis can chart drop-off, plus in-proposal time-to-sign stitched per
  // anonymized bid_hash (approved → signed elapsed hours). The broader
  // opened→signed timing already ships above as time_to_sign_from_open_hrs. ──
  try {
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString()
    const { data: steps } = await sb.from('analytics_events')
      .select('ctx, ts, meta').eq('event', 'sign_step').gte('ts', since).limit(20000)
    const stepCounts: Record<string, number> = {}
    const byBid = new Map<string, { step: string; ts: string }[]>()
    for (const s of (steps ?? [])) {
      const step = String(s.ctx || ''); if (!step) continue
      stepCounts[step] = (stepCounts[step] || 0) + 1
      const bh = (s as any).meta?.bid_hash
      if (bh) { if (!byBid.has(bh)) byBid.set(bh, []); byBid.get(bh)!.push({ step, ts: s.ts as string }) }
    }
    for (const step of Object.keys(stepCounts)) {
      rows.push({ day, metric: 'sign_funnel_24h', scope: step, n: stepCounts[step], median: null, p25: null, p75: null, avg: null, value: stepCounts[step], updated_at: now })
    }
    const inProposalHrs: number[] = []
    for (const evs of byBid.values()) {
      const done = evs.find((e) => e.step === 'signed'); if (!done) continue
      const first = evs.reduce((a, b) => (a.ts < b.ts ? a : b))
      const h = HOURS(first.ts, done.ts); if (h >= 0) inProposalHrs.push(h)
    }
    put('approved_to_signed_hrs', dist(inProposalHrs))
  } catch (e) { log.sign_funnel = String(e) }

  // ── Funnel state snapshot — where every proposal currently sits (furthest
  // step ever reached, from proposal_views). Guarded separately: the columns
  // arrive with migration 20260726 and may lag in some environments. ──
  try {
    const { data: fs } = await sb.from('proposal_views')
      .select('furthest_step').not('furthest_step', 'is', null)
    const counts: Record<string, number> = {}
    for (const r of (fs ?? [])) { const s = String((r as any).furthest_step); counts[s] = (counts[s] || 0) + 1 }
    for (const step of Object.keys(counts)) {
      rows.push({ day, metric: 'sign_funnel_state', scope: step, n: counts[step], median: null, p25: null, p75: null, avg: null, value: counts[step], updated_at: now })
    }
  } catch (e) { log.sign_funnel_state = String(e) }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLISHED BENCHMARKS (metric prefix 'bench_')
  //
  // Everything above is internal ops telemetry the owner reads. Everything in
  // this block is written to be READ BY CONTRACTORS, so their own numbers in
  // Books have a TradeDesk-wide figure to sit beside.
  //
  // Two rules make that safe, and they are enforced here AND again in the RLS
  // policy (20260807), so neither one alone is load-bearing:
  //   - only 'bench_' rows are readable by contractors;
  //   - a bucket with fewer than MIN_ACCOUNTS distinct businesses behind it is
  //     not written at all. With a small platform, "the average for HVAC" drawn
  //     from one account IS that account's number, and a competitor could read
  //     it straight off. Withholding a thin bucket is the whole guard.
  // No account id, business name, client name, or dollar figure is published:
  // a count, a median, quartiles, an average.
  // ═══════════════════════════════════════════════════════════════════════════
  const MIN_ACCOUNTS = 5
  const held: string[] = []   // buckets withheld for being too thin, reported in the response

  // Publish a bucket only if enough distinct accounts stand behind it.
  const putBench = (
    metric: string,
    scope: string,
    accounts: Set<string>,
    d: ReturnType<typeof dist> | null,
    value: number | null = null,
  ) => {
    if (accounts.size < MIN_ACCOUNTS) { held.push(`${metric}/${scope} (${accounts.size} accounts)`); return }
    rows.push({ day, metric, scope, n: d?.n ?? (value !== null ? accounts.size : 0), median: d?.median ?? null, p25: d?.p25 ?? null, p75: d?.p75 ?? null, avg: d?.avg ?? null, value, updated_at: now })
  }

  // ── Close rate by lead source, and by trade. ──
  // A lead counts as closed when any of its proposals reached Closed Won. The
  // denominator is every lead from that source, not just decided ones: the app's
  // own Lead sources card made that mistake once and overstated every rate.
  try {
    const { data: cRows } = await sb.from('td_clients')
      .select('id, user_id, data').is('deleted_at', null)
    const { data: bRows } = await sb.from('td_bids')
      .select('user_id, data').is('deleted_at', null)
    const { data: uRows } = await sb.from('users').select('id, business_type')

    const tradeOf = new Map<string, string>()
    for (const u of (uRows ?? [])) {
      const t = String((u as any).business_type || '').trim().toLowerCase()
      if (t) tradeOf.set(String((u as any).id), t)
    }

    // Which (account, client) pairs won at least one proposal.
    const wonPairs = new Set<string>()
    for (const b of (bRows ?? [])) {
      const d: any = (b as any).data || {}
      if (String(d.status || '') !== 'Closed Won') continue
      if (d.client_id == null) continue
      wonPairs.add(`${(b as any).user_id}|${d.client_id}`)
    }

    // Per bucket: leads, wins, and the distinct accounts contributing.
    type Bucket = { leads: number; won: number; accounts: Set<string> }
    const bySource = new Map<string, Bucket>()
    const byTrade = new Map<string, Bucket>()
    const bump = (m: Map<string, Bucket>, key: string, uid: string, won: boolean) => {
      let b = m.get(key); if (!b) { b = { leads: 0, won: 0, accounts: new Set() }; m.set(key, b) }
      b.leads++; if (won) b.won++; b.accounts.add(uid)
    }

    for (const c of (cRows ?? [])) {
      const uid = String((c as any).user_id)
      const d: any = (c as any).data || {}
      const won = wonPairs.has(`${uid}|${d.id ?? (c as any).id}`)
      const src = String(d.source || '').trim()
      if (src) bump(bySource, src, uid, won)
      const trade = tradeOf.get(uid)
      if (trade) bump(byTrade, trade, uid, won)
    }

    for (const [src, b] of bySource) {
      putBench('bench_close_rate_source', `source:${src}`, b.accounts, null, Math.round((b.won / b.leads) * 1000) / 10)
    }
    for (const [trade, b] of byTrade) {
      putBench('bench_close_rate_trade', `trade:${trade}`, b.accounts, null, Math.round((b.won / b.leads) * 1000) / 10)
    }
    log.bench_close_rate = { sources: bySource.size, trades: byTrade.size }
  } catch (e) { log.bench_close_rate = String(e) }

  // ── Funnel stage durations, platform-wide. ──
  // Same stages the contractor sees for themselves in Books, computed here across
  // every account so the two can sit side by side. Reads the same two event
  // tables the per-contractor RPC does.
  try {
    const { data: le } = await sb.from('lifecycle_events')
      .select('contractor_user_id, bid_id, client_id, event, ts')
    const { data: ae } = await sb.from('proposal_audit_events')
      .select('contractor_user_id, bid_id, client_id, event, ts')

    // First occurrence of each event per entity: a proposal is opened many times,
    // but "time to first open" is the number that means something.
    const first = new Map<string, { ts: string; uid: string }>()
    for (const r of [...(le ?? []), ...(ae ?? [])] as any[]) {
      const entity = r.bid_id ?? r.client_id; if (entity == null || !r.ts) continue
      const k = `${r.contractor_user_id}|${entity}|${r.event}`
      const prev = first.get(k)
      if (!prev || r.ts < prev.ts) first.set(k, { ts: r.ts, uid: String(r.contractor_user_id) })
    }

    // These pairs must stay identical to the stages in lifecycle_funnel (see
    // 20260806), because the app pairs a contractor's own row with the matching
    // benchmark on from_event/to_event, NOT on the display label. Keying on the
    // events means a wording change to either side can never silently mismatch
    // a contractor's number against the wrong benchmark.
    const STAGES: [string, string][] = [
      ['lead_created', 'proposal_saved'],
      ['proposal_started', 'proposal_saved'],
      ['proposal_saved', 'proposal_sent'],
      ['proposal_sent', 'proposal_opened'],
      ['proposal_opened', 'signed'],
      ['proposal_sent', 'signed'],
      ['signed', 'job_scheduled'],
      ['job_scheduled', 'job_completed'],
      ['job_completed', 'balance_settled'],
    ]
    // Regroup by entity so a stage is a lookup rather than a scan per pair.
    const byEntity = new Map<string, Map<string, { ts: string; uid: string }>>()
    for (const [k, v] of first) {
      const [uid, entity, event] = k.split('|')
      const ek = `${uid}|${entity}`
      let m = byEntity.get(ek); if (!m) { m = new Map(); byEntity.set(ek, m) }
      m.set(event, v)
    }
    for (const [fromEv, toEv] of STAGES) {
      const hrs: number[] = []
      const accounts = new Set<string>()
      for (const [, m] of byEntity) {
        const a = m.get(fromEv), b = m.get(toEv)
        if (!a || !b) continue
        const h = HOURS(a.ts, b.ts)
        if (h < 0) continue          // clock skew or out-of-order: not a duration
        hrs.push(h); accounts.add(a.uid)
      }
      putBench('bench_stage_hours', `stage:${fromEv}>${toEv}`, accounts, dist(hrs))
    }
    log.bench_stage_hours = { entities: byEntity.size }
  } catch (e) { log.bench_stage_hours = String(e) }

  if (held.length) log.benchmarks_withheld = held

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
