// timesheet-notify: the APPROVE link goes to the boss, never through the worker.
//
// Until 20261049 the worker's phone received the one token that could both
// view AND approve their week, and texted it on. Whoever held that text could
// approve it, including the worker. Now timesheet_submit still hands the worker
// a VIEW link to text (it shows the week and cannot decide it), and this
// function emails the separate APPROVE link, which no browser can read, to the
// business owner's login email. Jack's dad needs no app and no password: he
// taps the link in his email.
//
// POST { weekStart: 'YYYY-MM-DD' } with the WORKER's session.
// Replies { ok:true, sentTo:'d***@example.com' } | { ok:true, skipped:'own' } | { error }.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey } from '../_shared/keys.ts';
import { requestOrigin } from '../_shared/links.ts';
import { callerFromRequest, logSend, underDailyCap, validEmail } from '../_shared/mail-guard.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const svc = createClient(Deno.env.get('SUPABASE_URL')!, getServiceRoleKey());
const FROM_ADDRESS = 'team@tradedeskpro.app';
const DAILY_CAP = 20;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mask = (e: string) => e.replace(/^(.)[^@]*(@.*)$/, '$1***$2');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const caller = await callerFromRequest(svc, req);
  if (!caller) return json({ error: 'Unauthorized' }, 401);
  if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY not configured' }, 503);

  let body: any = null;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const week = String(body?.weekStart || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return json({ error: 'weekStart required' }, 400);

  // Only the worker's own submitted week.
  const { data: ts } = await svc.from('td_timesheets')
    .select('id,contractor_user_id,employee_user_id,status,version,business_name,person_name,total_min,pay_rate')
    .eq('employee_user_id', caller.id).eq('week_start', week).maybeSingle();
  if (!ts) return json({ error: 'No submitted timesheet for that week' }, 404);
  if (ts.status !== 'submitted') return json({ ok: true, skipped: 'decided' });
  // An owner's own sheet has nobody above them to approve it.
  if (String(ts.contractor_user_id) === String(ts.employee_user_id)) return json({ ok: true, skipped: 'own' });

  const { data: ap } = await svc.from('td_timesheet_approvers').select('token').eq('timesheet_id', ts.id).maybeSingle();
  if (!ap?.token) return json({ error: 'No approve link for this week' }, 409);

  // The business owner's login email: set by the owner, never by the worker.
  let to = '';
  try {
    const { data: u } = await svc.auth.admin.getUserById(String(ts.contractor_user_id));
    to = String(u?.user?.email || '');
  } catch { to = ''; }
  if (!validEmail(to)) return json({ error: 'The business owner has no email on file' }, 409);

  if (!(await underDailyCap(svc, caller.id, 'timesheet', DAILY_CAP))) {
    return json({ error: 'Daily limit reached. Try again tomorrow.' }, 429);
  }

  const link = `${requestOrigin(req)}/timesheet.html?t=${encodeURIComponent(ap.token)}`;
  const person = String(ts.person_name || 'Your crew member').slice(0, 80);
  const biz = String(ts.business_name || 'your business').slice(0, 120);
  const min = Number(ts.total_min) || 0;
  const hours = `${Math.floor(min / 60)}h ${min % 60}m`;
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:28px">
<p style="font-size:13px;color:#888;margin:0 0 6px">${esc(biz)}</p>
<h1 style="font-size:20px;margin:0 0 12px;color:#111">${esc(person)} sent a timesheet to approve</h1>
<p style="font-size:15px;color:#444;margin:0 0 18px">Week of ${esc(week)}, ${esc(hours)}${Number(ts.version) > 1 ? ', corrected' : ''}. Review the days and approve or send it back.</p>
<a href="${esc(link)}" style="display:block;text-align:center;background:#111;color:#fff;text-decoration:none;font-weight:700;padding:14px 20px;border-radius:10px">Review and approve</a>
<p style="font-size:12px;color:#999;margin:18px 0 0">This link approves the timesheet, so it came to your email and not in the text ${esc(person)} sent. It works on the first phone or computer that opens it.</p>
</div></body></html>`;

  let r: Response;
  try {
    r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `TradeDeskPro <${FROM_ADDRESS}>`, to: [to],
        subject: `Approve ${person}'s timesheet, week of ${week}`, html,
      }),
    });
  } catch (e) {
    return json({ error: 'Email network error', detail: String(e) }, 502);
  }
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    console.error('Resend error:', r.status, d);
    return json({ error: 'Email provider error' }, 502);
  }
  await logSend(svc, caller.id, 'timesheet', to);
  return json({ ok: true, sentTo: mask(to) });
});
