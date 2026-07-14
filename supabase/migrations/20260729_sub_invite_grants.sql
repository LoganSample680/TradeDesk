-- Sub referral grants: when a contractor invites a sub, a snapshot of what
-- they've already shared with that sub in real life (their business card +
-- the payments they've logged to them) is stored server-side under a random
-- single-use token. The invite link carries only the token — never the data —
-- so a forwarded link can't leak payment history to whoever reads it in
-- transit, and redemption requires an authenticated (just-signed-up) session.
-- On signup the sub's new account seeds: inviter becomes their first client/
-- lead, payments become their opening income ledger.

create table if not exists sub_invite_grants (
  token              text primary key check (char_length(token) between 16 and 64),
  contractor_user_id uuid not null,
  -- 256KB ceiling: the app caps the snapshot at 500 payment rows, so a real
  -- payload is a few KB — anything near the cap is a hand-rolled call.
  payload            jsonb not null check (pg_column_size(payload) < 262144),
  created_at         timestamptz not null default now(),
  redeemed_at        timestamptz,
  expires_at         timestamptz not null default now() + interval '30 days'
);

alter table sub_invite_grants enable row level security;

-- The inviter may create grants for their own account. No select/update/delete
-- policies: reading a grant is ONLY possible through the redemption RPC below,
-- so even a leaked token can't be queried directly.
create policy sub_invite_grants_insert on sub_invite_grants
  for insert to authenticated
  with check (contractor_user_id::text = auth.uid()::text);

-- Atomic single-use redemption: first authenticated caller with a live,
-- unredeemed token gets the payload; everyone after gets null. SECURITY
-- DEFINER because the redeemer (the sub's brand-new account) has no RLS
-- path to the inviter's row.
create or replace function redeem_sub_invite_grant(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare g sub_invite_grants;
begin
  select * into g from sub_invite_grants
    where token = p_token and redeemed_at is null and expires_at > now()
    for update;
  if not found then return null; end if;
  update sub_invite_grants set redeemed_at = now() where token = g.token;
  return g.payload;
end $$;

revoke all on function redeem_sub_invite_grant(text) from public;
grant execute on function redeem_sub_invite_grant(text) to authenticated;
