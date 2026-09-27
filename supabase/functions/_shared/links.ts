// The secret links TradeDesk hands out, parsed and checked in ONE place.
//
// Every public page is authorized by a name nobody can list: a proposal lives
// at proposals/<uid>/<bid>_<token>.json, a client hub at
// client-hub/<uid>/<clientId>_<token>.json, an employment agreement at
// agreements/<uid>/<id>_<token>.json. Since 20261049 nobody can list the
// proposals bucket, so an object existing at that exact name proves the caller
// holds the link. These helpers only PARSE; the caller proves existence by
// downloading the object with the service role.
//
// Links that go into an email are rebuilt here from an allowlisted origin, so
// no caller can make TradeDesk's sending domain carry somebody else's URL.

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PART = /^[A-Za-z0-9.-]{1,64}$/;          // a bid id or client id: no slash, no underscore
const TOKEN = /^[A-Za-z0-9-]{8,128}$/;

export type ProposalKey = { key: string; uid: string; bid: string; token: string };
export type HubKey = { key: string; uid: string; client: string; token: string };
export type AgreementKey = { key: string; uid: string; id: string; token: string };

export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID.test(s);
}

export function parseProposalKey(key: unknown): ProposalKey | null {
  const m = /^proposals\/([^/]+)\/([^/_]+)_([^/]+)\.json$/.exec(String(key || ''));
  if (!m || !UUID.test(m[1]) || !PART.test(m[2]) || !TOKEN.test(m[3])) return null;
  return { key: String(key), uid: m[1], bid: m[2], token: m[3] };
}

export function hubKey(u: unknown, c: unknown, t: unknown): HubKey | null {
  const uid = String(u || ''), client = String(c || ''), token = String(t || '');
  if (!UUID.test(uid) || !PART.test(client) || !TOKEN.test(token)) return null;
  return { key: `client-hub/${uid}/${client}_${token}.json`, uid, client, token };
}

export function parseAgreementKey(key: unknown): AgreementKey | null {
  const m = /^agreements\/([^/]+)\/([^/_]+)_([^/]+)\.json$/.exec(String(key || ''));
  if (!m || !UUID.test(m[1]) || !PART.test(m[2]) || !TOKEN.test(m[3])) return null;
  return { key: String(key), uid: m[1], id: m[2], token: m[3] };
}

// Where TradeDesk is served. Production, the Pages previews and UAT (the
// TestFlight shell), and localhost for the flow tests. Anything else falls
// back to production.
const DEFAULT_ORIGIN = 'https://tradedeskpro.app';
const ORIGIN_OK = [
  /^https:\/\/(www\.)?tradedeskpro\.app$/,
  /^https:\/\/([a-z0-9-]+\.)?tradedesk-cyp\.pages\.dev$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

export function appOrigin(candidate: unknown): string {
  let o = '';
  try { o = new URL(String(candidate || '')).origin; } catch { o = ''; }
  return ORIGIN_OK.some((re) => re.test(o)) ? o : DEFAULT_ORIGIN;
}

// The origin a request came from, falling back to a URL the caller sent.
export function requestOrigin(req: Request, fallbackUrl?: unknown): string {
  return appOrigin(req.headers.get('origin') || fallbackUrl || '');
}

// Plain text that goes into an email body or subject: no links, no markup.
// A contractor's own words stay; a URL they (or a stolen login) typed does not.
export function stripLinks(s: unknown, max = 4000): string {
  return String(s || '')
    .slice(0, max)
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link removed]')
    .replace(/<[^>]*>/g, '');
}
