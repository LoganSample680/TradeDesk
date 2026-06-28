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

// ── Stripe key selection by mode ──────────────────────────────────────────────
// Set STRIPE_MODE=test to use the *_TEST Stripe secrets, so live and test keys can
// live side-by-side in one project and you flip a single flag to test — your live
// keys (STRIPE_SECRET_KEY / _PUBLISHABLE_KEY / _WEBHOOK_SECRET) are never overwritten.
// Any other value (or unset) = live. In test mode we deliberately do NOT fall back to
// the live keys — a missing *_TEST secret returns '' (fails loudly) rather than
// silently charging real cards during a test.
function _stripeTestMode(): boolean {
  return (Deno.env.get('STRIPE_MODE') ?? '').toLowerCase() === 'test';
}
export function getStripeSecretKey(): string {
  return (_stripeTestMode() ? Deno.env.get('STRIPE_SECRET_KEY_TEST') : Deno.env.get('STRIPE_SECRET_KEY')) ?? '';
}
export function getStripePublishableKey(): string {
  return (_stripeTestMode() ? Deno.env.get('STRIPE_PUBLISHABLE_KEY_TEST') : Deno.env.get('STRIPE_PUBLISHABLE_KEY')) ?? '';
}
export function getStripeWebhookSecret(): string {
  return (_stripeTestMode() ? Deno.env.get('STRIPE_WEBHOOK_SECRET_TEST') : Deno.env.get('STRIPE_WEBHOOK_SECRET')) ?? '';
}
