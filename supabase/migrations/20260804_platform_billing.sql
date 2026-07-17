-- Platform billing: subscriptions + invoices mirrored from Stripe, a
-- never-charge allowlist, and the export-gate check the app reads.
--
-- Owner spec 2026-07-17: TradeDesk bills contractors $99/mo directly, on the
-- PLATFORM Stripe account (separate from Stripe Connect, which is
-- client-to-contractor payment money and never platform revenue, see
-- supabase/functions/stripe-webhook for that side). Books exports and Time
-- Log exports stay locked until a contractor completes 2 CONSECUTIVE,
-- unbroken monthly billing cycles — any failed/lapsed invoice resets the
-- streak to zero. A small allowlist of UUIDs (dev accounts, early testers)
-- is never charged and always reads unlocked.

create table if not exists td_subscriptions (
  user_id                  uuid primary key,
  stripe_customer_id       text not null,
  stripe_subscription_id   text not null,
  status                   text not null default 'incomplete'
                             check (status in ('incomplete','trialing','active','past_due','canceled','unpaid')),
  consecutive_paid_cycles  int not null default 0 check (consecutive_paid_cycles >= 0),
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create unique index if not exists idx_td_subscriptions_stripe_sub on td_subscriptions (stripe_subscription_id);
create index if not exists idx_td_subscriptions_customer on td_subscriptions (stripe_customer_id);

-- Reuses the touch function signed_proposals/proposal_views already defined
-- (20260714/20260802) — recreated defensively so this migration stands alone
-- on a fresh database regardless of apply order.
create or replace function td_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists td_subscriptions_touch_updated_at on td_subscriptions;
create trigger td_subscriptions_touch_updated_at
  before update on td_subscriptions
  for each row execute function td_touch_updated_at();

alter table td_subscriptions enable row level security;

-- Contractor reads only their own row. All writes are server-side (the
-- Stripe webhook, service_role) — never the client, a contractor can't
-- forge their own paid-cycle count.
create policy td_subscriptions_select on td_subscriptions
  for select to authenticated
  using (user_id::text = auth.uid()::text);

revoke insert, update, delete on td_subscriptions from anon, authenticated;

-- One row per completed Stripe invoice event — the audit trail the running
-- consecutive_paid_cycles counter above is derived from, and can be
-- recomputed from if that counter ever needs rebuilding.
create table if not exists td_subscription_invoices (
  id                      bigint generated always as identity primary key,
  user_id                 uuid not null,
  stripe_invoice_id       text not null,
  stripe_subscription_id  text not null,
  status                  text not null check (status in ('paid','payment_failed')),
  amount_paid             numeric not null default 0,
  period_start            timestamptz,
  period_end              timestamptz,
  created_at              timestamptz not null default now()
);

create unique index if not exists idx_td_sub_invoices_stripe_id on td_subscription_invoices (stripe_invoice_id);
create index if not exists idx_td_sub_invoices_user on td_subscription_invoices (user_id, created_at desc);

alter table td_subscription_invoices enable row level security;

create policy td_subscription_invoices_select on td_subscription_invoices
  for select to authenticated
  using (user_id::text = auth.uid()::text);

revoke insert, update, delete on td_subscription_invoices from anon, authenticated;

-- Never-charge allowlist. Checked BEFORE a checkout session is ever created
-- (create-billing-checkout refuses these UUIDs outright, server-side, not
-- just hidden in the UI) AND by the export gate below (always unlocked).
-- Data, not code — adding someone later is one INSERT, no redeploy.
create table if not exists billing_exempt_users (
  user_id   uuid primary key,
  note      text not null default '',
  added_at  timestamptz not null default now()
);

alter table billing_exempt_users enable row level security;

-- No client policies at all: this table is never client-readable. A
-- contractor probing whether they personally are exempt isn't a legitimate
-- use case — td_exports_unlocked() below reads it as the function owner
-- (SECURITY DEFINER) on the caller's behalf instead.
revoke all on billing_exempt_users from anon, authenticated;

insert into billing_exempt_users (user_id, note) values
  ('30a2b589-e081-4351-9f18-b1efba238c2d', 'Logan Sample — owner dev account'),
  ('e0b84aea-ab47-4740-a1a7-4ff1a836c71f', 'TradeDesk dev account'),
  ('6201cb8c-c4de-4bf2-bdf7-0376f0577cc4', 'Zach — tester')
on conflict (user_id) do nothing;

-- The single source of truth the app reads to decide whether Books/Time Log
-- exports are unlocked: exempt OR 2+ consecutive unbroken paid cycles.
-- SECURITY DEFINER so it can read billing_exempt_users (locked to
-- service_role above) on the caller's behalf — but it takes no parameter and
-- always resolves to auth.uid(), so there is no way to probe another user's
-- billing status through it.
create or replace function td_exports_unlocked()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := auth.uid();
  _exempt boolean;
  _cycles int;
begin
  if _uid is null then return false; end if;

  select exists(select 1 from public.billing_exempt_users where user_id = _uid) into _exempt;
  if _exempt then return true; end if;

  select coalesce(consecutive_paid_cycles, 0) into _cycles
    from public.td_subscriptions where user_id = _uid;
  return coalesce(_cycles, 0) >= 2;
end;
$$;

revoke all on function td_exports_unlocked() from public;
grant execute on function td_exports_unlocked() to authenticated;

-- UI-only helper: distinguishes "unlocked because exempt" from "unlocked
-- because you've paid 2 cycles" for the Settings billing status message.
-- Never used for the actual gate — td_exports_unlocked() above is the only
-- function real gating logic reads.
create or replace function td_billing_exempt()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists(select 1 from public.billing_exempt_users where user_id = auth.uid());
$$;

revoke all on function td_billing_exempt() from public;
grant execute on function td_billing_exempt() to authenticated;
