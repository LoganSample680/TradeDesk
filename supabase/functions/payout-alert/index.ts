// payout-alert: tell the owner, by email, every time where their money goes changes.
//
// The database writes a payout_change_log row whenever venmoUser (Settings) or
// stripe_account_id (account_config) changes, from any path, and kicks this
// function (20261049, H7). It takes no input and trusts no caller: it emails
// the ACCOUNT OWNER about each row not yet notified, then stamps it. Calling it
// with nothing pending does nothing, so it needs no secret; the worst a
// stranger can do is make it send a real alert a few seconds sooner.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey } from '../_shared/keys.ts';
import { validEmail } from '../_shared/mail-guard.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const svc = createClient(Deno.env.get('SUPABASE_URL')!, getServiceRoleKey());
const FROM_ADDRESS = 'team@tradedeskpro.app';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Show enough to recognise, not enough to copy.
const hint = (v: unknown) => {
  const s = String(v || '');
  if (!s) return 'none';
  return s.length <= 4 ? s : s.slice(0, 2) + '***' + s.slice(-2);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  if (!RESEND_API_KEY) return new Response(JSON.stringify({ ok: false, error: 'RESEND_API_KEY not configured' }), { status: 503 });
  const { data: rows } = await svc.from('payout_change_log')
    .select('id,account_owner,kind,old_value,new_value,changed_by,created_at')
    .is('notified_at', null).order('created_at').limit(50);
  let sent = 0;
  for (const r of rows || []) {
    let to = '';
    try {
      const { data: u } = await svc.auth.admin.getUserById(String(r.account_owner));
      to = String(u?.user?.email || '');
    } catch { to = ''; }
    const byOwner = r.changed_by && String(r.changed_by) === String(r.account_owner);
    const byServer = !r.changed_by;
    const what = r.kind === 'stripe' ? 'The Stripe account your card payments go to' : 'The Venmo account on your proposals and invoices';
    const who = byServer ? 'by TradeDesk (Stripe connect or disconnect)' : byOwner ? 'from your login' : 'from ANOTHER login on your business';
    if (validEmail(to)) {
      const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 12px">Where your money goes just changed</h2>
<p>${esc(what)} was changed ${esc(who)} at ${esc(String(r.created_at))}.</p>
<p>Before: <b>${esc(hint(r.old_value))}</b><br>After: <b>${esc(hint(r.new_value))}</b></p>
<p>If this was you, there is nothing to do. If it was not, open TradeDesk, check Settings and Get paid, and change your password.</p>
</div>`;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `TradeDeskPro <${FROM_ADDRESS}>`, to: [to], subject: 'Your payout details changed', html }),
      }).catch(() => null);
      if (!res || !res.ok) continue;   // leave it pending; the next kick retries
      sent++;
    }
    await svc.from('payout_change_log').update({ notified_at: new Date().toISOString() }).eq('id', r.id);
  }
  return new Response(JSON.stringify({ ok: true, sent }), { headers: { 'Content-Type': 'application/json' } });
});
