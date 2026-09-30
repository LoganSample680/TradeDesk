// What every email TradeDesk sends on a contractor's behalf must prove first
// (20261049, H2). Before this, send-invite-email and send-proposal-email took
// any link, any business name and any recipient from any signed-in caller, so
// one throwaway login could send "Your proposal from <any company>" with any
// link, from TradeDesk's own verified domain. Now:
//   1. the caller is a real session,
//   2. the link is one the caller's business actually issued (the object exists
//      under their folder), rebuilt server-side on an allowlisted origin,
//   3. the business name is read from the caller's account, never the request,
//   4. each login has a daily cap, counted in email_send_log (server-only).
import { appOrigin, hubKey, isUuid, parseProposalKey } from './links.ts';

// deno-lint-ignore no-explicit-any
type Svc = any;

export async function callerFromRequest(svc: Svc, req: Request): Promise<{ id: string; email: string } | null> {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return null;
  try {
    const { data, error } = await svc.auth.getUser(jwt);
    if (error || !data?.user?.id) return null;
    return { id: String(data.user.id), email: String(data.user.email || '') };
  } catch { return null; }
}

// May this login act for the business owned by `boss`? The owner, or an
// active crew member of that business (a co-owner, or crew with send rights).
export async function canActFor(svc: Svc, uid: string, boss: string): Promise<boolean> {
  if (!isUuid(uid) || !isUuid(boss)) return false;
  if (uid === boss) return true;
  const { data } = await svc.from('team_members').select('id,role,permissions')
    .eq('contractor_user_id', boss).eq('employee_user_id', uid).eq('active', true).limit(1);
  return Array.isArray(data) && data.length > 0;
}

// The business a login sends as: its own account, else the business it is
// active crew on.
export async function businessFor(svc: Svc, uid: string): Promise<{ boss: string; name: string }> {
  const own = await svc.from('accounts').select('business_name').eq('owner_id', uid).maybeSingle();
  if (own?.data?.business_name) return { boss: uid, name: String(own.data.business_name) };
  const { data: tm } = await svc.from('team_members').select('contractor_user_id')
    .eq('employee_user_id', uid).eq('active', true).order('joined_at', { ascending: false }).limit(1);
  const boss = Array.isArray(tm) && tm[0] ? String(tm[0].contractor_user_id) : uid;
  const acc = await svc.from('accounts').select('business_name').eq('owner_id', boss).maybeSingle();
  return { boss, name: String(acc?.data?.business_name || 'Your contractor') };
}

export async function objectExists(svc: Svc, key: string): Promise<boolean> {
  try {
    const { data, error } = await svc.storage.from('proposals').download(key);
    return !error && !!data;
  } catch { return false; }
}

// A daily cap per login and kind. Counting and logging are separate so a
// failed send does not use up the day.
export async function underDailyCap(svc: Svc, uid: string, kind: string, cap: number): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error } = await svc.from('email_send_log').select('id', { count: 'exact', head: true })
    .eq('user_id', uid).eq('kind', kind).gte('created_at', since);
  if (error) return false;   // cannot count: fail closed
  return (count || 0) < cap;
}
export async function logSend(svc: Svc, uid: string, kind: string, recipient: string) {
  await svc.from('email_send_log').insert({ user_id: uid, kind, recipient: recipient.slice(0, 200) });
}

export function validEmail(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/.test(s);
}

// A client-facing link (sign.html or client.html) the caller's business
// issued, rebuilt on an allowlisted origin with only the parameters the page
// reads. Returns null when the link is not theirs or does not exist.
export async function rebuildClientLink(svc: Svc, uid: string, raw: unknown, depth = 0): Promise<string | null> {
  let u: URL;
  try { u = new URL(String(raw || '')); } catch { return null; }
  const origin = appOrigin(u.origin);
  const page = u.pathname.replace(/^.*\//, '') || 'index.html';
  const q = u.searchParams;
  if (page === 'sign.html') {
    let key = q.get('key') || '';
    if (!key && q.get('t') && q.get('u') && q.get('b')) key = `proposals/${q.get('u')}/${q.get('b')}_${q.get('t')}.json`;
    const pk = parseProposalKey(key);
    if (!pk || !(await canActFor(svc, uid, pk.uid)) || !(await objectExists(svc, pk.key))) return null;
    let out = `${origin}/sign.html?t=${encodeURIComponent(pk.token)}&u=${pk.uid}&b=${encodeURIComponent(pk.bid)}`;
    const hub = q.get('hub');
    if (hub && depth === 0) {
      const h = await rebuildClientLink(svc, uid, hub, 1);
      if (h && /\/client\.html\?/.test(h)) out += '&hub=' + encodeURIComponent(h);
    }
    return out;
  }
  if (page === 'client.html') {
    const hk = hubKey(q.get('u'), q.get('c'), q.get('t'));
    if (!hk || !(await canActFor(svc, uid, hk.uid))) return null;
    const onboard = q.get('mode') === 'onboard';
    // An onboarding link is sent before the hub file exists; it only opens
    // the business's own intake form, so owning the uid is the proof.
    if (!onboard && !(await objectExists(svc, hk.key))) return null;
    // An invoice link opens its own invoice in the hub (#invoice-<id>); that
    // one exact shape is kept, anything else after the # is dropped.
    const inv = /^#invoice-\d{1,20}$/.test(u.hash) ? u.hash : '';
    return `${origin}/client.html?${onboard ? 'mode=onboard&' : ''}t=${encodeURIComponent(hk.token)}&u=${hk.uid}&c=${encodeURIComponent(hk.client)}${inv}`;
  }
  return null;
}
