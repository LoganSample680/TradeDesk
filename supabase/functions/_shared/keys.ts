// Reads Supabase keys from the new env vars (SUPABASE_PUBLISHABLE_KEYS /
// SUPABASE_SECRET_KEYS) which replaced the deprecated SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY in 2026. Falls back to legacy names so the
// functions keep working during any transition period.

function _parseKeyDict(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    // JSON-encoded plain string: "sb_publishable_xxx"
    if (typeof parsed === 'string') return parsed || undefined;
    // JSON object or array: {"default":"sb_xxx"} or ["sb_xxx"]
    const first = Object.values(parsed as Record<string, unknown>)[0];
    if (typeof first === 'string' && first) return first;
  } catch { /* not JSON at all — use raw value as-is */ }
  return raw || undefined;
}

export function getAnonKey(): string {
  return (
    _parseKeyDict(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')) ??
    Deno.env.get('SUPABASE_ANON_KEY') ??
    ''
  );
}

export function getServiceRoleKey(): string {
  return (
    _parseKeyDict(Deno.env.get('SUPABASE_SECRET_KEYS')) ??
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
    ''
  );
}

// ── Stripe key selection by mode (AUTOMATIC) ──────────────────────────────────
// Live and test keys live side-by-side in one project; the mode is chosen per request
// so you never flip a flag and never overwrite your live keys:
//   • Production origin (tradedeskpro.app) → live keys.
//   • Anything else (preview *.pages.dev, localhost flow tests, unknown) → TEST keys.
//   • The webhook can't see an origin, so it passes Stripe's event.livemode directly.
//   • STRIPE_MODE=live|test is an explicit manual OVERRIDE that wins when set.
// Safe default is test — a misroute can only ever AVOID charging a real card, never
// accidentally charge one. In test mode we never fall back to live keys: a missing
// *_TEST secret returns '' and fails loudly.
export type StripeMode = 'live' | 'test';

export function resolveStripeMode(req?: Request): StripeMode {
  const override = (Deno.env.get('STRIPE_MODE') ?? '').toLowerCase();
  if (override === 'live' || override === 'test') return override;
  const origin = (req?.headers.get('origin') ?? req?.headers.get('referer') ?? '').toLowerCase();
  return origin.includes('tradedeskpro.app') ? 'live' : 'test';
}
export function stripeSecretKey(mode: StripeMode): string {
  return (mode === 'test' ? Deno.env.get('STRIPE_SECRET_KEY_TEST') : Deno.env.get('STRIPE_SECRET_KEY')) ?? '';
}
export function stripePublishableKey(mode: StripeMode): string {
  return (mode === 'test' ? Deno.env.get('STRIPE_PUBLISHABLE_KEY_TEST') : Deno.env.get('STRIPE_PUBLISHABLE_KEY')) ?? '';
}
export function stripeWebhookSecret(mode: StripeMode): string {
  return (mode === 'test' ? Deno.env.get('STRIPE_WEBHOOK_SECRET_TEST') : Deno.env.get('STRIPE_WEBHOOK_SECRET')) ?? '';
}
