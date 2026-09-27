// proposal-sign: the ONE door a signed-out client writes through.
//
// Until 20261049 sign.html, client.html and contract-sign.html wrote straight
// into signed_proposals and the proposals bucket as anon, and the database let
// them because it could not tell a client from a stranger: anon could read and
// rewrite every business's signed proposals and overwrite any proposal file,
// including the amount create-checkout checked payments against. Those anon
// grants are gone. Every public write now comes here, and this function proves
// the caller holds the link before it touches anything: the object named by the
// link must exist (nobody can list the bucket any more), which only someone who
// was sent the link can know.
//
// The AMOUNT and every business field come from the stored proposal the
// contractor wrote, never from the request. The client supplies only what is
// genuinely theirs: their name, their drawn signature, their choices.
//
// POST { action, ... }
//   action 'sign'       { key, signerName, method, signatureData?, portfolioAccepted?,
//                         colorChoices?, buyerSenior? }
//   action 'decline'    { key, reason? }
//   action 'co'         { u, c, t, bidId, coNum, decision: 'sign'|'decline',
//                         signerName?, signatureData?, note? }
//   action 'agreement'  { key, signerName, signatureData }
// Replies { ok:true, ... } or { error } with a 4xx.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey } from '../_shared/keys.ts';
import { hubKey, isUuid, parseAgreementKey, parseProposalKey } from '../_shared/links.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, getServiceRoleKey());

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const MAX_SIG = 2 * 1024 * 1024;

function cleanName(s: unknown): string {
  return String(s || '').replace(/[<>]/g, '').trim().slice(0, 120);
}
function cleanSig(s: unknown): string | null {
  const v = String(s || '');
  if (!v) return null;
  if (v.length > MAX_SIG || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) return null;
  return v;
}
function cleanChoices(a: unknown): { room: string; colorName: string; swCode: string }[] {
  if (!Array.isArray(a)) return [];
  return a.slice(0, 100).map((c: any) => ({
    room: String(c?.room || '').slice(0, 80),
    colorName: String(c?.colorName || '').slice(0, 80),
    swCode: String(c?.swCode || '').slice(0, 20),
  }));
}
const round2 = (n: number) => Math.round(n * 100) / 100;

async function readJson(key: string): Promise<any | null> {
  const { data, error } = await supabase.storage.from('proposals').download(key);
  if (error || !data) return null;
  try { return JSON.parse(await data.text()); } catch { return null; }
}
async function writeJson(key: string, obj: unknown) {
  return await supabase.storage.from('proposals').upload(key, JSON.stringify(obj), {
    contentType: 'application/json', upsert: true, cacheControl: '0',
  });
}

function signedRowState(row: any): 'none' | 'signed' | 'declined' {
  if (!row) return 'none';
  if (row.payment_status === 'declined' || row.payment_method === 'declined') return 'declined';
  return row.signed_at ? 'signed' : 'none';
}

async function doSign(req: Request, body: any) {
  const pk = parseProposalKey(body.key);
  if (!pk) return json({ error: 'Invalid link' }, 400);
  const prop = await readJson(pk.key);
  if (!prop) return json({ error: 'Invalid link' }, 401);
  if (String(prop.id) !== pk.bid) return json({ error: 'Invalid link' }, 401);
  if (prop.status === 'voided') return json({ error: 'This proposal was updated. Ask for the new link.', code: 'voided' }, 409);
  const contractor = String(prop.contractorUserId || '');
  if (!isUuid(contractor)) return json({ error: 'Invalid proposal' }, 409);

  const name = cleanName(body.signerName);
  if (name.length < 2) return json({ error: 'Type your full name to sign.' }, 400);
  const method = String(body.method || '').toLowerCase();
  if (!/^[a-z_]{2,20}$/.test(method) || method === 'declined') return json({ error: 'Invalid payment method' }, 400);

  const { data: existing } = await supabase.from('signed_proposals')
    .select('bid_id,signed_at,client_signed_name,payment_method,payment_status,signing_token')
    .eq('bid_id', pk.bid).maybeSingle();
  const state = signedRowState(existing);
  if (state === 'declined') return json({ error: 'This proposal was declined.', code: 'declined' }, 409);
  if (state === 'signed') {
    // The one change a signed row takes (Earl audit 2026-09-27): sign.html
    // saves the signature the moment he signs, as Pay Later, so a homeowner
    // who closes the payment screen has still signed. When he then picks how
    // to pay, that pick replaces Pay Later. Only from Pay Later, only while
    // nothing has been paid, and only on the same link that signed. The
    // signature, name, amount and time stay exactly as first written.
    const fromLater = existing.payment_method === 'later' && existing.payment_status === 'pending_later';
    const sameLink = !!existing.signing_token && existing.signing_token === pk.token;
    if (fromLater && sameLink && method !== 'later') {
      const { error: mErr } = await supabase.from('signed_proposals')
        .update({ payment_method: method, payment_status: 'pending_' + method })
        .eq('bid_id', pk.bid).eq('payment_method', 'later').eq('payment_status', 'pending_later');
      if (mErr) { console.error('sign method update:', mErr.message); return json({ error: 'Could not save the payment choice' }, 500); }
      const { error: jErr } = await writeJson(pk.key, { ...prop, paymentMethod: method });
      if (jErr) console.warn('sign json method update:', jErr.message);
      return json({ ok: true, methodUpdated: true, signedAt: existing.signed_at });
    }
    return json({ ok: true, alreadySigned: true, row: { bid_id: existing.bid_id, signed_at: existing.signed_at, client_signed_name: existing.client_signed_name, payment_method: existing.payment_method, payment_status: existing.payment_status } });
  }

  const portfolio = !!body.portfolioAccepted && Number(prop.discountedPrice) > 0;
  const amount = portfolio ? Number(prop.discountedPrice) : Number(prop.amount) || 0;
  const depFrac = (Number(prop.amount) > 0 && Number(prop.deposit) > 0) ? Number(prop.deposit) / Number(prop.amount) : 0.25;
  const deposit = round2(amount * depFrac);
  const sig = cleanSig(body.signatureData);
  const ts = new Date().toISOString();
  const epa = !!prop.epaRequired;

  const row: Record<string, unknown> = {
    bid_id: pk.bid, contractor_user_id: contractor, signing_token: pk.token,
    client_name: String(prop.clientName || '').slice(0, 200), client_signed_name: name,
    amount, deposit, payment_method: method, payment_status: 'pending_' + method,
    signed_at: ts, notified_at: ts, notify_email: prop.notifyEmail || null, storage_key: pk.key,
    portfolio_accepted: portfolio, portfolio_pct: portfolio ? (prop.portfolioPct ?? null) : null,
    epa_required: epa, epa_ack_at: epa ? ts : null,
    rrp_firm_cert: epa ? (prop.rrpFirmCertNum || null) : null,
    rrp_renovator_name: epa ? (prop.rrpRenovatorName || null) : null,
    signature_data: sig, buyer_senior: !!body.buyerSenior,
    ip_address: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 64) || null,
    user_agent: (req.headers.get('user-agent') || '').slice(0, 300) || null,
  };
  const { error: upErr } = await supabase.from('signed_proposals').upsert(row, { onConflict: 'bid_id' });
  if (upErr) { console.error('sign upsert:', upErr.message); return json({ error: 'Could not save the signature' }, 500); }

  // The stored proposal carries the drawn signature and the color choices the
  // contractor's app reads. A failure here never loses the signature: the row
  // above is the source of truth and carries signature_data too.
  const updated = {
    ...prop, status: 'signed', signedAt: ts, signerName: name, paymentMethod: method,
    signatureDataUrl: sig, portfolioAccepted: portfolio, finalAmount: amount,
    colorChoices: cleanChoices(body.colorChoices), buyerSenior: !!body.buyerSenior,
  };
  const { error: jErr } = await writeJson(pk.key, updated);
  if (jErr) console.warn('sign json update:', jErr.message);
  return json({ ok: true, signedAt: ts, amount, deposit });
}

async function doDecline(body: any) {
  const pk = parseProposalKey(body.key);
  if (!pk) return json({ error: 'Invalid link' }, 400);
  const prop = await readJson(pk.key);
  if (!prop || String(prop.id) !== pk.bid) return json({ error: 'Invalid link' }, 401);
  const contractor = String(prop.contractorUserId || '');
  if (!isUuid(contractor)) return json({ error: 'Invalid proposal' }, 409);
  const { data: existing } = await supabase.from('signed_proposals')
    .select('signed_at,payment_status,payment_method').eq('bid_id', pk.bid).maybeSingle();
  if (signedRowState(existing) === 'signed') return json({ error: 'This proposal is already signed.', code: 'signed' }, 409);
  const reason = String(body.reason || '').replace(/[<>]/g, '').trim().slice(0, 300) || null;
  const ts = new Date().toISOString();
  const { error } = await supabase.from('signed_proposals').upsert({
    bid_id: pk.bid, contractor_user_id: contractor, signing_token: pk.token,
    client_name: String(prop.clientName || '').slice(0, 200),
    client_signed_name: String(prop.clientName || 'Client').slice(0, 200),
    amount: Number(prop.amount) || 0, deposit: Number(prop.deposit) || 0,
    payment_method: 'declined', payment_status: 'declined',
    signed_at: ts, notify_email: prop.notifyEmail || null, storage_key: pk.key,
    portfolio_accepted: false, decline_reason: reason,
  }, { onConflict: 'bid_id' });
  if (error) { console.error('decline upsert:', error.message); return json({ error: 'Could not save' }, 500); }
  const { error: jErr } = await writeJson(pk.key, { ...prop, status: 'declined', declinedAt: ts, declineReason: reason });
  if (jErr) console.warn('decline json update:', jErr.message);
  return json({ ok: true, declinedAt: ts });
}

async function doChangeOrder(body: any) {
  const hk = hubKey(body.u, body.c, body.t);
  if (!hk) return json({ error: 'Invalid link' }, 400);
  const hub = await readJson(hk.key);
  if (!hub || !Array.isArray(hub.bids)) return json({ error: 'Unauthorized' }, 401);
  const bidId = String(body.bidId || '');
  const coNum = Number(body.coNum);
  const bid = hub.bids.find((b: any) => String(b.id) === bidId);
  if (!bid || !Number.isFinite(coNum)) return json({ error: 'Change order not found for this hub' }, 403);
  const decision = body.decision === 'decline' ? 'decline' : 'sign';
  const name = cleanName(body.signerName);
  const sig = cleanSig(body.signatureData);
  if (decision === 'sign' && name.length < 3) return json({ error: 'Type your full name to sign this change order.' }, 400);

  const { data: row } = await supabase.from('signed_proposals')
    .select('id,change_orders,contractor_user_id').eq('bid_id', bidId).maybeSingle();
  if (!row || String(row.contractor_user_id) !== hk.uid) return json({ error: 'Change order not found' }, 404);
  const hubCos = Array.isArray(bid.changeOrders) ? bid.changeOrders : [];
  const arr: any[] = Array.isArray(row.change_orders) && row.change_orders.length
    ? row.change_orders
    : hubCos.map((c: any) => ({ coNum: c.coNum, desc: c.desc, type: c.type, amount: c.amount, delta: c.delta,
        originalAmount: c.originalAmount, newAmount: c.newAmount, sentAt: c.sentAt || '', signedAt: c.signedAt || null,
        signerName: c.signerName || null, signatureData: c.sigData || c.signatureData || null, overrun: c.overrun || null }));
  let entry = arr.find((x) => x && Number(x.coNum) === coNum);
  if (!entry) {
    const co = hubCos.find((c: any) => Number(c.coNum) === coNum);
    if (!co) return json({ error: 'Change order not found' }, 404);
    entry = { coNum, desc: co.desc, type: co.type, amount: co.amount, delta: co.delta, originalAmount: co.originalAmount,
      newAmount: co.newAmount, overrun: co.overrun || null, sentAt: co.sentAt || '' };
    arr.push(entry);
  }
  if (entry.signedAt) return json({ ok: true, alreadySigned: true });
  const ts = new Date().toISOString();
  if (decision === 'sign') { entry.signedAt = ts; entry.signerName = name; entry.signatureData = sig; }
  else { entry.declinedAt = ts; entry.declineNote = String(body.note || '').replace(/[<>]/g, '').trim().slice(0, 300); }
  const { error } = await supabase.from('signed_proposals').update({ change_orders: arr }).eq('id', row.id);
  if (error) { console.error('co update:', error.message); return json({ error: 'Could not save' }, 500); }
  return json({ ok: true, at: ts });
}

async function doAgreement(body: any) {
  const ak = parseAgreementKey(body.key);
  if (!ak) return json({ error: 'Invalid link' }, 400);
  const doc = await readJson(ak.key);
  if (!doc) return json({ error: 'Invalid link' }, 401);
  if (doc.status === 'signed') return json({ ok: true, alreadySigned: true });
  const name = cleanName(body.signerName);
  const sig = cleanSig(body.signatureData);
  if (name.length < 2 || !sig) return json({ error: 'Sign with your name and signature.' }, 400);
  const ts = new Date().toISOString();
  const updated = { ...doc, status: 'signed', signedAt: ts, signerName: name, sigData: sig };
  const { error } = await writeJson(ak.key, updated);
  if (error) { console.error('agreement write:', error.message); return json({ error: 'Could not save' }, 500); }
  return json({ ok: true, signedAt: ts });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let body: any = null;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  try {
    switch (body?.action) {
      case 'sign': return await doSign(req, body);
      case 'decline': return await doDecline(body);
      case 'co': return await doChangeOrder(body);
      case 'agreement': return await doAgreement(body);
      default: return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    console.error('proposal-sign:', (e as Error).message);
    return json({ error: 'Something went wrong' }, 500);
  }
});
