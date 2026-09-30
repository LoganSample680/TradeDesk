/**
 * send-proposal-email — sends a branded HTML proposal email via Resend.
 *
 * POST body (JSON):
 *   to            string   client email address
 *   clientName    string   full client name (used for personalisation)
 *   proposalUrl   string   the sign.html / client.html link the app generated.
 *                          It must be a link this caller's business issued; it is
 *                          checked and REBUILT server-side (20261049, H2).
 *   customSubject string?  override default subject line (links removed)
 *   customBody    string?  plain-text body override (newlines to HTML paragraphs;
 *                          the proposal link is swapped for the verified one and
 *                          any other link is removed)
 * businessName and replyTo are no longer read from the request: the business
 * comes from the caller's account and replies go to the caller's login email.
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

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey } from '../_shared/keys.ts';
import { stripLinks } from '../_shared/links.ts';
import { businessFor, callerFromRequest, logSend, rebuildClientLink, underDailyCap, validEmail } from '../_shared/mail-guard.ts';

const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL') || '';
const FROM_ADDRESS    = 'proposals@tradedeskpro.app';

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function bodyToHtml(text: string): string {
  // Convert plain text paragraphs (double newline) and lines (single newline) to HTML
  return text
    .split(/\n\n+/)
    .map(para => '<p>' + para.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '</p>')
    .join('');
}

// What the email is about. Proposals, change orders and invoices all go out
// through the app's one send screen (js/proposals.js tdSendSheet) and this one
// function; only the headline and the button words change. Anything unknown
// reads as a proposal, which is what every caller before this sent.
const KINDS: Record<string, { noun: string; cta: string }> = {
  proposal:     { noun: 'proposal',     cta: 'View &amp; Sign Proposal →' },
  change_order: { noun: 'change order', cta: 'View &amp; Sign Change Order →' },
  invoice:      { noun: 'invoice',      cta: 'View &amp; Pay Invoice →' },
};

function htmlTemplate(
  clientName: string,
  businessName: string,
  proposalUrl: string,
  customBody?: string,
  kind = 'proposal',
): string {
  const K = KINDS[kind] || KINDS.proposal;
  const firstName = clientName.split(/[\s,&]+/)[0] || clientName;
  const displayUrl = proposalUrl.replace(/^https?:\/\//, '');

  const bodyHtml = customBody
    ? bodyToHtml(customBody)
    : `<p>It was great meeting with you. I've put together your full proposal — everything we went over is laid out in detail and you can sign directly from the page when you're ready to move forward.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your ${K.noun} from ${escHtml(businessName)}</title>
<style>
  body{margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;}
  .wrap{max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08);}
  .header{background:#1a1a1a;padding:28px 32px;text-align:center;}
  .header-title{color:#fff;font-size:20px;font-weight:700;letter-spacing:-.02em;margin:0;}
  .body{padding:36px 32px 28px;}
  h1{margin:0 0 16px;font-size:22px;font-weight:700;color:#111;letter-spacing:-.02em;}
  p{margin:0 0 16px;font-size:15px;line-height:1.6;color:#444;}
  .cta{display:block;margin:28px auto;background:#0070f3;color:#fff;font-size:17px;font-weight:700;text-align:center;text-decoration:none;padding:16px 36px;border-radius:12px;max-width:280px;letter-spacing:-.01em;}
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
<!-- Table wrapper: margin:auto is unreliable in mobile email clients; align="center" on td is the industry-standard fix -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background:#f5f5f5">
<tr><td align="center" valign="top" style="padding:32px 16px">
<div class="wrap">
  <div class="header">
    <p class="header-title">📋 ${escHtml(businessName)}</p>
  </div>
  <div class="body">
    <h1>Hey ${escHtml(firstName)}, your ${K.noun} is ready!</h1>
    ${bodyHtml}
    <a class="cta" href="${escHtml(proposalUrl)}">${K.cta}</a>
    <hr class="divider">
    <p>Looking forward to working with you,<br><strong>${escHtml(businessName)}</strong></p>
  </div>
  <div class="footer">
    <p>If the button above doesn't work, copy and paste this link into your browser:</p>
    <p><a class="plain-link" href="${escHtml(proposalUrl)}">${escHtml(displayUrl)}</a></p>
    <hr class="divider">
    <p>This proposal was sent to you by ${escHtml(businessName)} via TradeDeskPro. If you weren't expecting this, you can safely ignore it.</p>
  </div>
</div>
</td></tr>
</table>
</body>
</html>`;
}

const svc = createClient(SUPABASE_URL, getServiceRoleKey());
const DAILY_CAP = 200;

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

  // 1. A real session.
  const caller = await callerFromRequest(svc, req);
  if (!caller) return reply({ error: 'Unauthorized' }, 401);

  if (!RESEND_API_KEY) {
    // Resend key not configured — caller falls back to mailto:
    return reply({ error: 'RESEND_API_KEY not configured' }, 503);
  }

  let body: { to?: string; clientName?: string; proposalUrl?: string; customSubject?: string; customBody?: string; kind?: string };
  try { body = await req.json(); } catch { return reply({ error: 'Invalid JSON' }, 400); }

  const to = String(body.to || '').trim();
  const clientName = String(body.clientName || '').replace(/[<>]/g, '').trim().slice(0, 120);
  if (!validEmail(to) || !clientName || !body.proposalUrl) {
    return reply({ error: 'Missing required fields: to, clientName, proposalUrl' }, 400);
  }

  // 2. The link must be one this business issued; it is rebuilt server-side.
  const proposalUrl = await rebuildClientLink(svc, caller.id, body.proposalUrl);
  if (!proposalUrl) return reply({ error: 'That link is not one of your proposals. Generate the proposal link again.' }, 403);

  // 3. The name the email goes out under is the caller's business, never the request's.
  const { name: businessName } = await businessFor(svc, caller.id);

  // 4. A daily cap per login.
  if (!(await underDailyCap(svc, caller.id, 'proposal', DAILY_CAP))) {
    return reply({ error: 'Daily email limit reached. Try again tomorrow or text the link.' }, 429);
  }

  // The contractor's own words stay. The link they were shown is swapped for the
  // verified one; any OTHER link in the text is removed.
  const MARK = '\u0000TDLINK\u0000';
  const rawBody = String(body.customBody || '').split(String(body.proposalUrl)).join(MARK);
  const customBody = rawBody ? stripLinks(rawBody).split(MARK).join(proposalUrl) : '';
  const customSubject = stripLinks(body.customSubject || '', 200).trim();

  const kind = Object.prototype.hasOwnProperty.call(KINDS, String(body.kind)) ? String(body.kind) : 'proposal';
  const html = htmlTemplate(clientName, businessName, proposalUrl, customBody || undefined, kind);
  const firstName = clientName.split(/[\s,&]+/)[0] || clientName;
  const subject = customSubject || `Your ${businessName} Proposal is Ready, ${firstName}!`;
  const replyTo = validEmail(caller.email) ? caller.email : '';

  const resendPayload = {
    from: `${businessName.replace(/[<>"]/g, '')} via TradeDeskPro <${FROM_ADDRESS}>`,
    to: [to],
    subject,
    html,
    // reply_to → client replies land in the contractor's inbox (the login's own
    //            address, never one the request names)
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
    return reply({ error: 'Resend network error', detail: String(err) }, 502);
  }

  const resendData = await resendRes.json().catch(() => ({}));

  if (!resendRes.ok) {
    console.error('Resend error:', resendRes.status, resendData);
    return reply({ error: 'Resend API error', status: resendRes.status, detail: resendData }, 502);
  }
  await logSend(svc, caller.id, 'proposal', to);

  return reply({ ok: true, id: resendData.id });
});
