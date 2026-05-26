/**
 * send-proposal-email — sends a branded HTML proposal email via Resend.
 *
 * POST body (JSON):
 *   to          string   — client email address
 *   clientName  string   — full client name (used for personalisation)
 *   businessName string  — contractor business name
 *   proposalUrl string   — signing URL (sign.html?t=…)
 *   replyTo     string   — contractor's email (so client can reply directly)
 *
 * Environment secrets (set via `supabase secrets set`):
 *   RESEND_API_KEY — your Resend API key (re_xxxx...)
 *
 * DNS records required on tradedeskpro.app (one-time setup via Resend dashboard):
 *   SPF   — add "include:_spf.resend.com" to your existing TXT record
 *   DKIM  — Resend generates a TXT record; add it to your DNS provider
 *   DMARC — TXT record: "v=DMARC1; p=quarantine; rua=mailto:dmarc@tradedeskpro.app"
 *
 * Why this matters: when email comes from proposals@tradedeskpro.app with proper
 * DKIM/SPF, corporate spam filters see "link domain = sender domain = passes DMARC"
 * and deliver instead of blocking.
 */

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_ADDRESS   = 'proposals@tradedeskpro.app';

function htmlTemplate(clientName: string, businessName: string, proposalUrl: string): string {
  const firstName = clientName.split(/[\s,&]+/)[0] || clientName;
  // Strip protocol for display (looks cleaner in the link text)
  const displayUrl = proposalUrl.replace(/^https?:\/\//, '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Proposal from ${businessName}</title>
<style>
  body{margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);}
  .header{background:#1a1a1a;padding:28px 32px;text-align:center;}
  .header-title{color:#fff;font-size:20px;font-weight:700;letter-spacing:-.02em;margin:0;}
  .body{padding:36px 32px 28px;}
  h1{margin:0 0 16px;font-size:22px;font-weight:700;color:#111;letter-spacing:-.02em;}
  p{margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;}
  .cta{display:block;margin:28px auto;background:#0070f3;color:#fff;font-size:17px;font-weight:700;text-align:center;text-decoration:none;padding:16px 36px;border-radius:12px;max-width:280px;letter-spacing:-.01em;}
  .divider{border:none;border-top:1px solid #eee;margin:24px 0;}
  .footer{padding:0 32px 28px;font-size:12px;color:#999;line-height:1.5;}
  .plain-link{color:#0070f3;word-break:break-all;font-size:13px;}
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
<div class="wrap">
  <div class="header">
    <p class="header-title">📋 ${businessName}</p>
  </div>
  <div class="body">
    <h1>Hey ${firstName} — your proposal is ready!</h1>
    <p>It was great meeting with you. I've put together your full painting proposal — everything we went over is laid out in detail and you can sign directly from the page when you're ready to move forward.</p>
    <a class="cta" href="${proposalUrl}">View & Sign Proposal →</a>
    <hr class="divider">
    <p>Once you sign I'll get you locked in on the schedule and we'll take it from there. Don't hesitate to reach out if you have any questions — happy to go over anything!</p>
    <p>Looking forward to working with you,<br><strong>${businessName}</strong></p>
  </div>
  <div class="footer">
    <p>If the button above doesn't work, copy and paste this link into your browser:</p>
    <p><a class="plain-link" href="${proposalUrl}">${displayUrl}</a></p>
    <hr class="divider">
    <p>This proposal was sent to you by ${businessName} via TradeDeskPro. If you weren't expecting this, you can safely ignore it.</p>
  </div>
</div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  // CORS preflight
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

  if (!RESEND_API_KEY) {
    // Resend key not configured — caller falls back to mailto:
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 503 });
  }

  let body: { to?: string; clientName?: string; businessName?: string; proposalUrl?: string; replyTo?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { to, clientName, businessName, proposalUrl, replyTo } = body;
  if (!to || !clientName || !businessName || !proposalUrl) {
    return new Response(JSON.stringify({ error: 'Missing required fields: to, clientName, businessName, proposalUrl' }), { status: 400 });
  }

  const html = htmlTemplate(clientName, businessName, proposalUrl);
  const firstName = clientName.split(/[\s,&]+/)[0] || clientName;
  const subject = `Your ${businessName} Proposal is Ready, ${firstName}!`;

  const resendPayload = {
    from: `${businessName} via TradeDeskPro <${FROM_ADDRESS}>`,
    to: [to],
    subject,
    html,
    // reply_to → client replies land in contractor's inbox, not in Resend
    // bcc      → contractor gets a copy for their records (Resend doesn't
    //            store sent mail, so this is the only paper trail they get)
    ...(replyTo ? { reply_to: replyTo, bcc: [replyTo] } : {}),
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
