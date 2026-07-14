-- The live pipe: a standing link between a GC's account and a sub's account,
-- forged automatically at the moment a sub-invite grant is redeemed (both
-- identities are known exactly then, and only then). Payments the GC logs to
-- a linked sub become OFFERS the sub explicitly accepts into their own books
-- — the GC never writes into the sub's ledger directly, so record ownership
-- stays clean (an accountant's ledger can never be mutated by a third party).

create table if not exists business_links (
  id                bigint generated always as identity primary key,
  gc_user_id        uuid not null,
  sub_user_id       uuid not null,
  sub_roster_id     bigint,          -- the sub row's id inside the GC's roster (S.subcontractors)
  gc_business_name  text not null default '' check (char_length(gc_business_name) <= 120),
  sub_business_name text not null default '' check (char_length(sub_business_name) <= 120),
  created_at        timestamptz not null default now(),
  unique (gc_user_id, sub_user_id)
);

alter table business_links enable row level security;

-- Both ends may see the link; NOBODY inserts directly — links are created
-- only inside redeem_sub_invite_grant (security definer), which is the one
-- moment both identities are provably real.
create policy business_links_select on business_links
  for select to authenticated
  using (gc_user_id::text = auth.uid()::text or sub_user_id::text = auth.uid()::text);

-- Scope is deliberately minimal — the columns ARE the privacy contract: what
-- crosses the pipe is amount + date + job ADDRESS (for the sub's mileage
-- records) + who paid. No job names/descriptions (they can carry the GC's
-- client details), no notes field, nothing else. Everything beyond this is
-- the sub's own bookkeeping. CHECK constraints bound every field so a
-- hand-rolled API call can't stuff garbage past the app's client-side clamps.
create table if not exists payment_offers (
  id               bigint generated always as identity primary key,
  gc_user_id       uuid not null,
  sub_user_id      uuid not null,
  amount           numeric not null check (amount > 0 and amount < 100000000),
  paid_date        text not null default '' check (char_length(paid_date) <= 10),
  job_addr         text not null default '' check (char_length(job_addr) <= 200),
  gc_business_name text not null default '' check (char_length(gc_business_name) <= 120),
  status           text not null default 'pending' check (status in ('pending','accepted','dismissed')),
  created_at       timestamptz not null default now(),
  decided_at       timestamptz
);

alter table payment_offers enable row level security;

-- The GC may offer payments ONLY to subs they hold a standing link with.
create policy payment_offers_gc_insert on payment_offers
  for insert to authenticated
  with check (
    gc_user_id::text = auth.uid()::text
    and status = 'pending'
    and exists (
      select 1 from business_links l
      where l.gc_user_id::text = auth.uid()::text
        and l.sub_user_id = payment_offers.sub_user_id
    )
  );

create policy payment_offers_select on payment_offers
  for select to authenticated
  using (gc_user_id::text = auth.uid()::text or sub_user_id::text = auth.uid()::text);

-- Only the SUB decides an offer (accept/dismiss). The GC can't retract or
-- edit — same one-way-offer principle as a check in the mail. A decision is
-- also one-way: with check pins status to a decided value, so an offer can
-- never be flipped back to pending and re-accepted.
create policy payment_offers_sub_decide on payment_offers
  for update to authenticated
  using (sub_user_id::text = auth.uid()::text and status = 'pending')
  with check (sub_user_id::text = auth.uid()::text and status in ('accepted','dismissed'));

-- Column-level lockdown: the ONLY columns anyone can ever update are the
-- decision fields. Amount, address, date, and identities are immutable after
-- insert — the sub can't rewrite what the GC offered, and vice versa. Nobody
-- deletes (no delete grant, no delete policy): offers are an audit trail.
revoke update, delete on payment_offers from anon, authenticated;
grant update (status, decided_at) on payment_offers to authenticated;

-- Job assignments: when the GC assigns a linked sub to a job, the sub gets
-- the job ADDRESS + start date (that's when they need it — mileage, routing)
-- landing automatically on their calendar. Same minimal-columns privacy
-- contract and the same hardening pattern as payment_offers.
create table if not exists job_assignments (
  id               bigint generated always as identity primary key,
  gc_user_id       uuid not null,
  sub_user_id      uuid not null,
  job_addr         text not null default '' check (char_length(job_addr) <= 200),
  start_date       text not null default '' check (char_length(start_date) <= 10),
  gc_business_name text not null default '' check (char_length(gc_business_name) <= 120),
  status           text not null default 'pending' check (status in ('pending','received')),
  created_at       timestamptz not null default now(),
  received_at      timestamptz
);

alter table job_assignments enable row level security;

create policy job_assignments_gc_insert on job_assignments
  for insert to authenticated
  with check (
    gc_user_id::text = auth.uid()::text
    and status = 'pending'
    and exists (
      select 1 from business_links l
      where l.gc_user_id::text = auth.uid()::text
        and l.sub_user_id = job_assignments.sub_user_id
    )
  );

create policy job_assignments_select on job_assignments
  for select to authenticated
  using (gc_user_id::text = auth.uid()::text or sub_user_id::text = auth.uid()::text);

-- Only the SUB claims an assignment (its client marks it received when it
-- lands on their calendar); one-way, immutable payload, no delete path.
create policy job_assignments_sub_receive on job_assignments
  for update to authenticated
  using (sub_user_id::text = auth.uid()::text and status = 'pending')
  with check (sub_user_id::text = auth.uid()::text and status = 'received');

revoke update, delete on job_assignments from anon, authenticated;
grant update (status, received_at) on job_assignments to authenticated;

-- Referral rewards: when an invited sub actually SIGNS UP (redeems the grant),
-- the REFERRER (the GC who invited them) earns a reward. Recorded here, at the
-- one verified conversion event — the redemption RPC — so a reward can't be
-- claimed without a real, distinct new account on the other end. The reward is
-- deliberately generic (type + value + status): today it accrues a free-month
-- credit that applies once subscription billing launches; the same ledger can
-- pay cash later by changing what the app writes, no schema change.
create table if not exists referral_rewards (
  id                     bigint generated always as identity primary key,
  referrer_user_id       uuid not null,
  referred_sub_user_id   uuid not null,
  referred_business_name text not null default '' check (char_length(referred_business_name) <= 120),
  reward_type            text not null default 'free_month' check (reward_type in ('free_month','account_credit','cash')),
  reward_value           numeric not null default 1 check (reward_value >= 0 and reward_value < 1000000),
  status                 text not null default 'pending' check (status in ('pending','applied','void')),
  created_at             timestamptz not null default now(),
  applied_at             timestamptz,
  -- one reward per (referrer, referred sub) — a re-redeem (already blocked by the
  -- single-use token) still can't double-credit.
  unique (referrer_user_id, referred_sub_user_id)
);

alter table referral_rewards enable row level security;

-- The referrer may SEE their own rewards. Nobody inserts directly — rows are
-- created only inside the redemption RPC (security definer), at the one moment
-- a real signup is proven. No update/delete grant: the ledger is append-only
-- from the app's side (redemption applies them server-side when billing lands).
create policy referral_rewards_select on referral_rewards
  for select to authenticated
  using (referrer_user_id::text = auth.uid()::text);

revoke insert, update, delete on referral_rewards from anon, authenticated;

-- Extend redemption: same atomic single-use semantics as before, now also
-- forging the standing business link AND accruing the referrer's reward.
-- p_sub_business carries the sub's just-entered business name (onboarding runs
-- redemption right after the account row is created). Old single-arg signature
-- dropped FIRST — with the new default-param version live, both existing at
-- once would make a one-argument rpc() call ambiguous.
drop function if exists redeem_sub_invite_grant(text);
create or replace function redeem_sub_invite_grant(p_token text, p_sub_business text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g sub_invite_grants;
  v_sub uuid := (auth.uid()::text)::uuid;
  v_roster bigint;
begin
  select * into g from sub_invite_grants
    where token = p_token and redeemed_at is null and expires_at > now()
    for update;
  if not found then return null; end if;
  update sub_invite_grants set redeemed_at = now() where token = g.token;

  -- Self-redemption guard: a contractor opening their OWN invite link while
  -- signed in must not forge a me→me link (their payments would then land
  -- back in their own inbox as duplicate income) or seed their own books
  -- with themselves as a lead. Token still consumed — single-use holds.
  if g.contractor_user_id = v_sub then return null; end if;

  begin
    v_roster := nullif(g.payload->'sub'->>'rosterId','')::bigint;
  exception when others then
    v_roster := null;
  end;

  -- left(…,120) so an oversized name can never fail the redemption itself
  insert into business_links (gc_user_id, sub_user_id, sub_roster_id, gc_business_name, sub_business_name)
  values (g.contractor_user_id, v_sub, v_roster,
          left(coalesce(g.payload->'business'->>'name',''), 120),
          left(coalesce(p_sub_business,''), 120))
  on conflict (gc_user_id, sub_user_id) do nothing;

  -- Accrue the referrer's reward for this verified signup. One free month by
  -- default; on conflict do nothing so it's credited exactly once per referred
  -- account, even if this ever runs twice.
  insert into referral_rewards (referrer_user_id, referred_sub_user_id, referred_business_name, reward_type, reward_value)
  values (g.contractor_user_id, v_sub, left(coalesce(p_sub_business,''), 120), 'free_month', 1)
  on conflict (referrer_user_id, referred_sub_user_id) do nothing;

  -- Stamp the inviter's account id into the returned payload: the client uses
  -- it (gcLinkId) as the payer card's stable identity — rename-proof, and two
  -- same-name GCs can never be merged into one card.
  return jsonb_set(g.payload, '{gcUserId}', to_jsonb(g.contractor_user_id::text));
end $$;

revoke all on function redeem_sub_invite_grant(text, text) from public;
grant execute on function redeem_sub_invite_grant(text, text) to authenticated;
