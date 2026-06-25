/**
 * send-invite-email — sends a branded HTML employee invite email via Resend.
 *
 * POST body (JSON):
 *   to           string   — employee email address
 *   empName      string   — employee full name
 *   businessName string   — contractor business name
 *   inviteUrl    string   — ?emp_invite=... link
 *   replyTo      string?  — contractor's email (so employee can reply directly)
 *
 * Environment secrets (set via `supabase secrets set`):
 *   RESEND_API_KEY — shared with send-proposal-email (re_xxxx...)
 */

const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON   = Deno.env.get('SUPABASE_ANON_KEY') || '';
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  // Verify caller is an authenticated Supabase user
  const authHeader = req.headers.get('Authorization') || '';
  const jwtToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwtToken) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  try {
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${jwtToken}`, 'apikey': SUPABASE_ANON },
    });
    if (!authRes.ok) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 503 });
  }

  let body: {
    to?: string;
    empName?: string;
    businessName?: string;
    inviteUrl?: string;
    replyTo?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { to, empName, businessName, inviteUrl, replyTo } = body;
  if (!to || !empName || !businessName || !inviteUrl) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: to, empName, businessName, inviteUrl' }),
      { status: 400 }
    );
  }

  const html = htmlTemplate(empName, businessName, inviteUrl);
  const firstName = empName.split(/[\s,]+/)[0] || empName;
  const subject = `${firstName}, you've been invited to join ${businessName} on TradeDesk`;

  const resendPayload = {
    from: `${businessName} via TradeDeskPro <${FROM_ADDRESS}>`,
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
    return new Response(JSON.stringify({ error: 'Resend network error', detail: String(err) }), { status: 502 });
  }

  const resendData = await resendRes.json().catch(() => ({}));

  if (!resendRes.ok) {
    console.error('Resend error:', resendRes.status, resendData);
    return new Response(
      JSON.stringify({ error: 'Resend API error', status: resendRes.status, detail: resendData }),
      { status: 502 }
    );
  }

  return new Response(JSON.stringify({ ok: true, id: resendData.id }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
