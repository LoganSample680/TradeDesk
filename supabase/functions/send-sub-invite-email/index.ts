/**
 * send-sub-invite-email — auto-sends the 1099 sub referral invite via Resend.
 *
 * This is MARKETING email (pitching the sub their own TradeDesk account), not
 * transactional like send-invite-email — so it carries the CAN-SPAM required
 * pieces the employee invite doesn't need: a physical postal address in the
 * footer, a working unsubscribe link, a suppression list that is checked
 * before every send, and hard send limits (max 3 per address, 7 days apart)
 * so "Re-invite" can never become a drip campaign.
 *
 * (Email only, on purpose: auto-sending the TEXT version would make TradeDesk
 * the TCPA "initiator" — the exact fact pattern the FCC ruled against in
 * Glide (2015). Texts stay person-to-person from the contractor's own phone.)
 *
 * POST (JWT-verified) body:
 *   to            string  — sub's email address
 *   subName       string  — sub's name
 *   businessName  string  — inviting contractor's business name
 *   inviteUrl     string  — ?sub_invite=... referral link
 *   trade         string? — sub's trade (personalizes the pitch)
 *   replyTo       string? — contractor's email
 *   postalAddress string? — contractor's business address (CAN-SPAM footer
 *                           fallback when MAIL_POSTAL_ADDRESS isn't set)
 *
 * GET ?unsub=<base64url(email)> — unauthenticated (email links carry no JWT;
 *   verify_jwt=false in config.toml). Adds the address to the suppression
 *   table and returns a tiny confirmation page. Unsigned by design: the worst
 *   an abuser can do is opt someone out of invites, which is harmless.
 *
 * Environment secrets:
 *   RESEND_API_KEY       — shared with send-proposal-email / send-invite-email
 *   MAIL_POSTAL_ADDRESS  — optional; TradeDesk's own postal address for the footer
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey } from '../_shared/keys.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON  = Deno.env.get('SUPABASE_ANON_KEY') || '';
const POSTAL_ENV     = Deno.env.get('MAIL_POSTAL_ADDRESS') || '';
const FROM_ADDRESS   = 'team@tradedeskpro.app';
const MAX_SENDS      = 3;
const MIN_DAYS_BETWEEN = 7;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function b64urlDecode(s: string): string | null {
  try { return atob(s.replace(/-/g, '+').replace(/_/g, '/')); } catch { return null; }
}
function b64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function htmlTemplate(subName: string, businessName: string, trade: string, inviteUrl: string, unsubUrl: string, postal: string): string {
  const firstName = subName.split(/[\s,]+/)[0] || subName;
  const tradeLine = trade ? `${escHtml(trade.toLowerCase())} businesses` : 'trade businesses';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(businessName)} thinks TradeDesk fits your business</title>
<style>
  body{margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;}
  .wrap{max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);}
  .header{background:#1a1a1a;padding:28px 32px;text-align:center;}
  .header-title{color:#fff;font-size:20px;font-weight:700;letter-spacing:-.02em;margin:0;}
  .body{padding:36px 32px 28px;}
  h1{margin:0 0 16px;font-size:22px;font-weight:700;color:#111;letter-spacing:-.02em;}
  p{margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;}
  .cta{display:block;margin:28px auto;background:#0070f3;color:#fff;font-size:17px;font-weight:700;text-align:center;text-decoration:none;padding:16px 36px;border-radius:12px;max-width:300px;letter-spacing:-.01em;}
  .divider{border:none;border-top:1px solid #eee;margin:24px 0;}
  .footer{padding:0 32px 28px;font-size:12px;color:#999;line-height:1.5;}
  .plain-link{color:#0070f3;word-break:break-all;font-size:13px;}
  @media only screen and (max-width:640px){
    .wrap{border-radius:0!important;}
    .body{padding:24px 20px 20px!important;}
    .footer{padding:0 20px 20px!important;}
    h1{font-size:19px!important;}
    .cta{padding:14px 24px!important;font-size:16px!important;}
  }
  @media(prefers-color-scheme:dark){
    .wrap{background:#1c1c1e;box-shadow:0 2px 16px rgba(0,0,0,.4);}
    h1{color:#f5f5f5;}
    p{color:#ccc;}
    .footer{color:#666;}
    .divider{border-color:#333;}
  }
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background:#f5f5f5">
<tr><td align="center" valign="top" style="padding:32px 16px">
<div class="wrap">
  <div class="header">
    <p class="header-title">🔧 TradeDesk</p>
  </div>
  <div class="body">
    <h1>Hey ${escHtml(firstName)} — this one's for your business</h1>
    <p><strong>${escHtml(businessName)}</strong> runs their whole business on TradeDesk and figured you'd want it for yours too. They even gave you a head start — the work they've paid you is already sitting on your books, ready when you are.</p>
    <p>Estimates, invoices, e-sign, getting paid — all built for ${tradeLine} like you. And it's yours, start to finish: your jobs, your clients, your numbers, private to you.</p>
    <a class="cta" href="${escHtml(inviteUrl)}">Claim my free account →</a>
    <hr class="divider">
    <p>See you out there,<br><strong>The TradeDesk team</strong></p>
  </div>
  <div class="footer">
    <p>If the button above doesn't work, copy and paste this link into your browser:</p>
    <p><a class="plain-link" href="${escHtml(inviteUrl)}">${escHtml(inviteUrl.replace(/^https?:\/\//, ''))}</a></p>
    <hr class="divider">
    <p>You received this one-time invite because ${escHtml(businessName)} added you as a subcontractor in TradeDesk. We won't email you again unless they re-invite you.</p>
    <p>${escHtml(postal)}</p>
    <p><a class="plain-link" href="${escHtml(unsubUrl)}">Unsubscribe — never email me invites again</a></p>
  </div>
</div>
</td></tr>
</table>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const supaAdmin = createClient(SUPABASE_URL, getServiceRoleKey());

  // ── Unsubscribe (GET from an email click — no JWT possible) ────────────────
  if (req.method === 'GET') {
    const unsub = new URL(req.url).searchParams.get('unsub');
    const email = unsub ? b64urlDecode(unsub) : null;
    if (!email || !email.includes('@')) return new Response('Bad unsubscribe link.', { status: 400 });
    await supaAdmin.from('sub_invite_optouts').upsert({ email: email.toLowerCase() }, { onConflict: 'email' });
    return new Response(
      '<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Arial,sans-serif;padding:48px 24px;text-align:center;color:#333"><h2>You\'re unsubscribed.</h2><p>TradeDesk won\'t email you invites again.</p></body></html>',
      { headers: { 'Content-Type': 'text/html' } },
    );
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // ── Send (JWT-verified: only signed-in TradeDesk contractors can trigger) ──
  const jwtToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwtToken) return json({ error: 'Unauthorized' }, 401);
  try {
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${jwtToken}`, 'apikey': SUPABASE_ANON },
    });
    if (!authRes.ok) return json({ error: 'Unauthorized' }, 401);
  } catch {
    return json({ error: 'Unauthorized' }, 401);
  }

  if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY not configured' }, 503);

  let body: { to?: string; subName?: string; businessName?: string; inviteUrl?: string; trade?: string; replyTo?: string; postalAddress?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { to, subName, businessName, inviteUrl, trade, replyTo, postalAddress } = body;
  if (!to || !subName || !businessName || !inviteUrl) {
    return json({ error: 'Missing required fields: to, subName, businessName, inviteUrl' }, 400);
  }
  const email = to.toLowerCase().trim();

  // CAN-SPAM requires a valid physical postal address — refuse rather than
  // send a non-compliant marketing email.
  const postal = POSTAL_ENV || postalAddress || '';
  if (!postal) return json({ error: 'postal-address-required', detail: 'Set MAIL_POSTAL_ADDRESS or add a business address in Settings — marketing email legally requires a postal address (CAN-SPAM).' }, 400);

  // Suppression list — opted-out addresses are never emailed again.
  const { data: optout } = await supaAdmin.from('sub_invite_optouts').select('email').eq('email', email).maybeSingle();
  if (optout) return json({ ok: false, suppressed: true });

  // Send limits: max 3 lifetime, 7 days apart — Re-invite can't become spam.
  const { data: log } = await supaAdmin.from('sub_invite_emails').select('send_count,last_sent_at').eq('email', email).maybeSingle();
  if (log) {
    if (log.send_count >= MAX_SENDS) return json({ error: 'send-limit-reached' }, 429);
    if (Date.now() - new Date(log.last_sent_at).getTime() < MIN_DAYS_BETWEEN * 86400000) {
      return json({ error: 'recently-invited' }, 429);
    }
  }

  const unsubUrl = `${SUPABASE_URL}/functions/v1/send-sub-invite-email?unsub=${b64urlEncode(email)}`;
  const html = htmlTemplate(subName, businessName, trade || '', inviteUrl, unsubUrl, postal);
  const firstName = subName.split(/[\s,]+/)[0] || subName;

  let resendRes: Response;
  try {
    resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${businessName} via TradeDeskPro <${FROM_ADDRESS}>`,
        to: [email],
        subject: `${firstName} — ${businessName} thinks TradeDesk fits your business`,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
  } catch (err) {
    return json({ error: 'Resend network error', detail: String(err) }, 502);
  }

  const resendData = await resendRes.json().catch(() => ({}));
  if (!resendRes.ok) {
    console.error('Resend error:', resendRes.status, resendData);
    return json({ error: 'Resend API error', status: resendRes.status, detail: resendData }, 502);
  }

  await supaAdmin.from('sub_invite_emails').upsert(
    { email, last_sent_at: new Date().toISOString(), send_count: (log?.send_count || 0) + 1 },
    { onConflict: 'email' },
  );

  return json({ ok: true, id: resendData.id });
});
