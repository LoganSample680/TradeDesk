import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey } from '../_shared/keys.ts';

// CORS headers — called from intake.html and the functions/q/[[code]].js
// redirect, neither of which shares this function's origin.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Service-role key bypasses RLS. qr_events has deliberately NO anon/authenticated
// insert policy (see 20260808_qr_lead_tracking.sql) — this function is the ONLY
// way a scan/open/submit event can land, so a scanner's own browser can never
// forge or inflate its funnel numbers.
const supa = createClient(
  Deno.env.get('SUPABASE_URL')!,
  getServiceRoleKey()
);

const VALID_EVENTS = new Set(['scan', 'form_opened', 'submitted', 'field_dropoff']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const { code, event, field } = await req.json();

    if (!code || !event) {
      return json({ error: 'code and event required' }, 400);
    }
    if (!VALID_EVENTS.has(String(event))) {
      return json({ error: 'unknown event' }, 400);
    }

    // Resolve the code to its source row. A code that doesn't exist (bad
    // print, typo, expired) is a normal, expected case, not an error — the
    // caller (redirect function / intake.html) should never see a failure
    // just because a physical code was mistyped or is no longer registered.
    const { data: source } = await supa
      .from('qr_sources')
      .select('id')
      .eq('code', String(code))
      .maybeSingle();
    if (!source) {
      return json({ ok: true, matched: false }, 200);
    }

    // Audit capture: real IP/UA read server-side from the request headers,
    // same pattern as log-proposal-view — the browser can't spoof these.
    const ip = ((req.headers.get('x-forwarded-for') || '').split(',')[0].trim())
             || req.headers.get('cf-connecting-ip') || null;
    const ua = req.headers.get('user-agent') || null;

    const { error } = await supa.from('qr_events').insert({
      qr_source_id: source.id,
      event: String(event),
      field_name: event === 'field_dropoff' && field ? String(field) : null,
      ip_address: ip,
      user_agent: ua,
    });
    if (error) {
      console.error('qr_events insert error:', error.message);
      return json({ error: error.message }, 500);
    }

    return json({ ok: true, matched: true }, 200);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('log-qr-event error:', msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
