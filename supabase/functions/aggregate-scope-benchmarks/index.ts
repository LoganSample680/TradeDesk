import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface BenchmarkRow {
  scope_id: string
  trade: string
  actual_hrs: number
}

interface RateRow {
  scope_id: string
  trade: string
  median_min: number
  p25_min: number
  p75_min: number
  sample_count: number
  updated_at: string
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor(sorted.length * p)
  return sorted[Math.min(idx, sorted.length - 1)]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: records, error } = await supabase
    .from('td_scope_benchmarks')
    .select('scope_id, trade, actual_hrs')

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  if (!records?.length) {
    return new Response(JSON.stringify({ rates: [] }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Group minutes by scope_id:trade
  const groups = new Map<string, number[]>()
  for (const r of records as BenchmarkRow[]) {
    const key = `${r.scope_id}:${r.trade}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r.actual_hrs * 60)
  }

  const upserts: RateRow[] = []
  for (const [key, minutes] of groups) {
    const [scope_id, trade] = key.split(':')
    const sorted = [...minutes].sort((a, b) => a - b)
    const n = sorted.length
    upserts.push({
      scope_id,
      trade,
      median_min: Math.round(percentile(sorted, 0.5)),
      p25_min: Math.round(percentile(sorted, 0.25)),
      p75_min: Math.round(percentile(sorted, 0.75)),
      sample_count: n,
      updated_at: new Date().toISOString(),
    })
  }

  const { error: upsertErr } = await supabase
    .from('td_scope_rates')
    .upsert(upserts, { onConflict: 'scope_id,trade' })

  if (upsertErr) {
    return new Response(JSON.stringify({ error: upsertErr.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Return fresh rates so the client can update its cache immediately
  const { data: rates } = await supabase.from('td_scope_rates').select('*')

  return new Response(JSON.stringify({ rates: rates ?? [] }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
