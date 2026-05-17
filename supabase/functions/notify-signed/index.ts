// Triggered by Supabase Database Webhook on signed_proposals INSERT.
// Sends a Web Push notification to the contractor's device(s).
//
// Required env vars (set in Supabase Dashboard → Settings → Edge Functions):
//   VAPID_PRIVATE_KEY  = iz7cLAjYpLNlPu_LjZ9LnKUurpZdTjcDN7XxMRC1V-Y
//   VAPID_SUBJECT      = mailto:support@tradedeskpro.app
//   WEBHOOK_SECRET     = (any random string you choose — must match webhook config)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VAPID_PUBLIC_KEY  = 'BEq_Ly35TQZL3U-6i8x4HD_csk12QxgPvoX4yBU7nU6ao_z7TE7zmjd3UyCL3mptc-mGEajzauwD-9K5YTW82dA';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT     = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@tradedeskpro.app';
const WEBHOOK_SECRET    = Deno.env.get('WEBHOOK_SECRET');

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// ── VAPID JWT signing (no external library — uses Web Crypto built into Deno) ─

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function strToB64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function makeVapidAuth(endpoint: string): Promise<string> {
  const origin = new URL(endpoint).origin;
  const exp    = Math.floor(Date.now() / 1000) + 12 * 3600;
  const header = strToB64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = strToB64url(JSON.stringify({ aud: origin, exp, sub: VAPID_SUBJECT }));
  const unsigned = `${header}.${payload}`;

  const rawPriv = Uint8Array.from(atob(VAPID_PRIVATE_KEY.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw', rawPriv,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  );
  return `vapid t=${unsigned}.${b64url(sig)},k=${VAPID_PUBLIC_KEY}`;
}

// ── Web Push encryption (RFC 8291 + RFC 8188) ────────────────────────────────

async function encryptPayload(
  payload: string,
  p256dh: string,
  auth: string
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPub: Uint8Array }> {
  const clientPubRaw = Uint8Array.from(atob(p256dh.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const authRaw      = Uint8Array.from(atob(auth.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

  const clientPub = await crypto.subtle.importKey(
    'raw', clientPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, true, []
  );

  const serverKP = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKP.publicKey));

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPub }, serverKP.privateKey, 256
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF-SHA-256 helper
  async function hkdf(ikm: Uint8Array, saltBuf: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
    const ikmKey = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
    const prk = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: saltBuf, info: new Uint8Array(0) },
      ikmKey, 256
    ));
    const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const okm = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, concat(info, new Uint8Array([1]))));
    return okm.slice(0, len);
  }

  function concat(...bufs: Uint8Array[]): Uint8Array {
    const total = bufs.reduce((n, b) => n + b.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const b of bufs) { out.set(b, off); off += b.length; }
    return out;
  }

  function lengthPrefix(b: Uint8Array): Uint8Array {
    const out = new Uint8Array(2 + b.length);
    new DataView(out.buffer).setUint16(0, b.length);
    out.set(b, 2);
    return out;
  }

  const authInfo    = new TextEncoder().encode('WebPush: info\x00');
  const prkInfo     = concat(authInfo, clientPubRaw, serverPubRaw);
  const prk         = await hkdf(new Uint8Array(sharedBits), authRaw, prkInfo, 32);

  const cekInfo     = concat(new TextEncoder().encode('Content-Encoding: aes128gcm\x00\x01'));
  const nonceInfo   = concat(new TextEncoder().encode('Content-Encoding: nonce\x00\x01'));
  const cek         = await hkdf(prk, salt, cekInfo, 16);
  const nonce       = await hkdf(prk, salt, nonceInfo, 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const padded = concat(new TextEncoder().encode(payload), new Uint8Array([2])); // padding delimiter
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded);

  // Build RFC 8188 header: salt(16) + rs(4) + idLen(1) + serverPub(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  const header = concat(salt, rs, new Uint8Array([serverPubRaw.length]), serverPubRaw);
  const ciphertext = concat(header, new Uint8Array(encrypted));

  return { ciphertext, salt, serverPub: serverPubRaw };
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Verify webhook secret
  if (WEBHOOK_SECRET && req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await req.json();
  const record = body.record;

  // Only process INSERT events where we have a contractor
  if (!record?.contractor_user_id || !record?.signed_at) {
    return new Response('OK', { status: 200 });
  }

  const userId     = record.contractor_user_id as string;
  const clientName = (record.client_signed_name || record.client_name || 'Your client') as string;
  const amount     = record.amount ? `$${Number(record.amount).toLocaleString('en-US', { minimumFractionDigits: 0 })}` : null;
  const title      = '✍️ Proposal signed!';
  const body_text  = amount
    ? `${clientName} signed — ${amount}. You're booked.`
    : `${clientName} just signed their proposal.`;

  // Fetch all push subscriptions for this contractor
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (error || !subs?.length) {
    return new Response('No subscriptions', { status: 200 });
  }

  const payload = JSON.stringify({ title, body: body_text });
  const results = await Promise.allSettled(subs.map(async (sub) => {
    const authHeader = await makeVapidAuth(sub.endpoint);
    const { ciphertext } = await encryptPayload(payload, sub.p256dh, sub.auth);

    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Authorization':    authHeader,
        'Content-Type':     'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL':              '86400',
      },
      body: ciphertext,
    });

    // 410 Gone = subscription expired — clean it up
    if (res.status === 410) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    }
    return res.status;
  }));

  return new Response(JSON.stringify({ sent: results.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
