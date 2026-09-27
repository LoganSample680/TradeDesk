/**
 * send-invite-email: sends a branded HTML employee invite email via Resend.
 *
 * POST body (JSON):
 *   to        string  employee email address
 *   empName   string  employee full name
 *   inviteUrl string  the ?emp_invite= link (carrying a crew_invites token) or the
 *                     contract-sign.html agreement link the app built. It must be
 *                     an invite THIS caller's business issued, to THIS address,
 *                     and it is rebuilt server-side (20261049, H2).
 * businessName and replyTo are no longer read from the request: the business
 * comes from the caller's account and replies go to the caller's login email.
 *
 * Environment secrets (set via `supabase secrets set`):
 *   RESEND_API_KEY: shared with send-proposal-email (re_xxxx...)
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey } from '../_shared/keys.ts';
import { appOrigin, isUuid, parseAgreementKey } from '../_shared/links.ts';
import { businessFor, callerFromRequest, canActFor, logSend, objectExists, underDailyCap, validEmail } from '../_shared/mail-guard.ts';

const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL') || '';
const FROM_ADDRESS    = 'team@tradedeskpro.app';

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function htmlTemplate(empName: string, businessName: string, inviteUrl: string): string {
  const firstName = empName.split(/[\s,]+/)[0] || empName;
  const displayUrl = inviteUrl.replace(/^https?:\/\//, '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>You've been invited to join ${escHtml(businessName)}</title>
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
    <p class="header-title">👷 ${escHtml(businessName)}</p>
  </div>
  <div class="body">
    <h1>Hey ${escHtml(firstName)} — you've been invited!</h1>
    <p>${escHtml(businessName)} has added you to their crew on TradeDesk. Tap the button below to set up your account and get started.</p>
    <a class="cta" href="${escHtml(inviteUrl)}">Accept Invite &amp; Create Account →</a>
    <hr class="divider">
    <p>Looking forward to working with you,<br><strong>${escHtml(businessName)}</strong></p>
  </div>
  <div class="footer">
    <p>If the button above doesn't work, copy and paste this link into your browser:</p>
    <p><a class="plain-link" href="${escHtml(inviteUrl)}">${escHtml(displayUrl)}</a></p>
    <hr class="divider">
    <p>This invite was sent to you by ${escHtml(businessName)} via TradeDeskPro. If you weren't expecting this, you can safely ignore it.</p>
  </div>
</div>
</td></tr>
</table>
</body>
</html>`;
}

const svc = createClient(SUPABASE_URL, getServiceRoleKey());
const DAILY_CAP = 30;

function b64Json(o: Record<string, unknown>): string {
  const text = JSON.stringify(o);
  // The app decodes with atob(), which is Latin-1: keep the payload Latin-1.
  return btoa(text.replace(/[^\x00-\xff]/g, ''));
}

// The invite link the app built, checked against what the caller's business
// really issued, and rebuilt server-side. Returns the link and the one address
// it may be sent to, or null.
async function verifiedInvite(uid: string, raw: unknown, to: string, empName: string, bname: string):
  Promise<{ url: string } | null> {
  let u: URL;
  try { u = new URL(String(raw || '')); } catch { return null; }
  const origin = appOrigin(u.origin);
  const page = u.pathname.replace(/^.*\//, '');

  // The crew invite: ?emp_invite=<payload> carrying a server-minted token.
  const payloadRaw = u.searchParams.get('emp_invite');
  if (payloadRaw) {
    let payload: any = null;
    try { payload = JSON.parse(atob(payloadRaw)); } catch { return null; }
    const tok = String(payload?.tok || '');
    if (!isUuid(tok)) return null;          // no token, no email: the email-only join is gone (H4)
    const { data: inv } = await svc.from('crew_invites')
      .select('contractor_user_id,email,used_at,expires_at').eq('token', tok).maybeSingle();
    if (!inv || inv.used_at || (inv.expires_at && Date.parse(inv.expires_at) < Date.now())) return null;
    if (!(await canActFor(svc, uid, String(inv.contractor_user_id)))) return null;
    if (String(inv.email || '').trim().toLowerCase() !== to.toLowerCase()) return null;
    const eid = /^[A-Za-z0-9-]{1,40}$/.test(String(payload?.eid || '')) ? String(payload.eid) : '';
    const link = `${origin}/?emp_invite=` + encodeURIComponent(b64Json({
      cid: String(inv.contractor_user_id), eid, email: String(inv.email), bname, ename: empName, tok,
    }));
    return { url: link };
  }

  // The employment agreement: contract-sign.html?t&u&a, filed under the business.
  if (page === 'contract-sign.html') {
    const q = u.searchParams;
    const ak = parseAgreementKey(`agreements/${q.get('u')}/${q.get('a')}_${q.get('t')}.json`);
    if (!ak || !(await canActFor(svc, uid, ak.uid)) || !(await objectExists(svc, ak.key))) return null;
    // Only to somebody on this business's roster.
    const { data: tm } = await svc.from('team_members').select('id')
      .eq('contractor_user_id', ak.uid).ilike('email', to.replace(/[%_\\]/g, (m) => '\\' + m)).limit(1);
    if (!Array.isArray(tm) || !tm.length) return null;
    return { url: `${origin}/contract-sign.html?t=${encodeURIComponent(ak.token)}&u=${ak.uid}&a=${encodeURIComponent(ak.id)}` };
  }
  return null;
}

Deno.serve(async (req) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  const reply = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const caller = await callerFromRequest(svc, req);
  if (!caller) return reply({ error: 'Unauthorized' }, 401);

  if (!RESEND_API_KEY) return reply({ error: 'RESEND_API_KEY not configured' }, 503);

  let body: { to?: string; empName?: string; inviteUrl?: string };
  try { body = await req.json(); } catch { return reply({ error: 'Invalid JSON' }, 400); }

  const to = String(body.to || '').trim();
  const empName = String(body.empName || '').replace(/[<>]/g, '').trim().slice(0, 80);
  if (!validEmail(to) || !empName || !body.inviteUrl) {
    return reply({ error: 'Missing required fields: to, empName, inviteUrl' }, 400);
  }

  const { name: businessName } = await businessFor(svc, caller.id);
  const verified = await verifiedInvite(caller.id, body.inviteUrl, to, empName, businessName);
  if (!verified) return reply({ error: 'That invite is not one your business issued to this address.' }, 403);

  if (!(await underDailyCap(svc, caller.id, 'invite', DAILY_CAP))) {
    return reply({ error: 'Daily invite limit reached. Try again tomorrow.' }, 429);
  }

  const inviteUrl = verified.url;
  const html = htmlTemplate(empName, businessName, inviteUrl);
  const firstName = empName.split(/[\s,]+/)[0] || empName;
  const subject = `${firstName}, you've been invited to join ${businessName} on TradeDesk`;
  const replyTo = validEmail(caller.email) ? caller.email : '';

  const resendPayload = {
    from: `${businessName.replace(/[<>"]/g, '')} via TradeDeskPro <${FROM_ADDRESS}>`,
    to: [to],
    subject,
    html,
    ...(replyTo ? { reply_to: replyTo } : {}),
  };

  let resendRes: Response;
  try {
    resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendPayload),
    });
  } catch (err) {
    return reply({ error: 'Resend network error', detail: String(err) }, 502);
  }

  const resendData = await resendRes.json().catch(() => ({}));

  if (!resendRes.ok) {
    console.error('Resend error:', resendRes.status, resendData);
    return reply({ error: 'Resend API error', status: resendRes.status, detail: resendData }, 502);
  }
  await logSend(svc, caller.id, 'invite', to);

  return reply({ ok: true, id: resendData.id });
});
