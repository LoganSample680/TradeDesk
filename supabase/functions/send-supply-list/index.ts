/**
 * send-supply-list: emails a contractor's materials list to their supply house.
 *
 * Same sender and domain as send-proposal-email (Resend, proposals@tradedeskpro.app,
 * DKIM/SPF already set up there). The PDF is built on the phone
 * (_supPdfBytes, js/supply-list.js) and attached here. reply_to is the
 * contractor, so the supply house's quote lands in THEIR inbox, which is
 * where the owner's flow picks it up: "he gets it back, approves, then shares
 * it into TradeDesk."
 *
 * POST { to, supplierName, businessName, replyTo, reference, itemCount, pdfBase64 }
 */
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const FROM_ADDRESS = 'proposals@tradedeskpro.app';
const MAX_PDF_B64 = 4 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Unauthorized' }, 401);
  try {
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${jwt}`, 'apikey': SUPABASE_ANON },
    });
    if (!authRes.ok) return json({ error: 'Unauthorized' }, 401);
  } catch {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY not configured' }, 503);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const to = String(body.to || '').trim();
  const supplierName = String(body.supplierName || '').trim();
  const businessName = String(body.businessName || '').trim() || 'A contractor';
  const replyTo = String(body.replyTo || '').trim();
  const reference = String(body.reference || '').trim();
  const itemCount = Math.max(0, Math.floor(Number(body.itemCount) || 0));
  const pdfBase64 = String(body.pdfBase64 || '').replace(/\s+/g, '');

  if (!EMAIL_RE.test(to)) return json({ error: 'Invalid recipient' }, 400);
  if (!pdfBase64 || pdfBase64.length > MAX_PDF_B64) return json({ error: 'Missing or oversized PDF' }, 400);
  // Only ever a PDF: the header of any PDF base64-encodes to "JVBERi0".
  if (!pdfBase64.startsWith('JVBERi0')) return json({ error: 'Attachment is not a PDF' }, 400);

  const subject = `Quote request: ${reference || 'materials'} (${businessName})`;
  const safeRef = reference.replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 60) || 'materials';
  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;line-height:1.5">
<p>Hi${supplierName ? ' ' + esc(supplierName) : ''},</p>
<p>Please quote the ${itemCount ? itemCount + ' item' + (itemCount === 1 ? '' : 's') : 'materials'} on the attached list.</p>
<p><b>Job reference:</b> ${esc(reference || 'see attached')}<br>Please put this on your quote as the customer order number.</p>
<p>Reply to this email with your quote. Thank you,<br>${esc(businessName)}</p>
</body></html>`;

  const payload = {
    from: `${businessName} via TradeDeskPro <${FROM_ADDRESS}>`,
    to: [to],
    subject,
    html,
    attachments: [{ filename: `Materials ${safeRef}.pdf`, content: pdfBase64 }],
    ...(EMAIL_RE.test(replyTo) ? { reply_to: replyTo, bcc: [replyTo] } : {}),
  };

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return json({ error: 'Resend network error', detail: String(err) }, 502);
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: 'Resend API error', status: res.status }, 502);
  return json({ ok: true, id: (out as { id?: string }).id || null });
});
