-- Remote push: one row per phone that signed in.
--
-- WHY THIS EXISTS: td_notify schedules notifications ON the phone, so it can
-- only ever announce something the phone already knew. Everything that happens
-- while nobody is looking happens on a SERVER: a client signs a proposal, a
-- payment lands, a crew member is dispatched somewhere new. Reaching the phone
-- for those needs Apple's push service, and APNs addresses a DEVICE, not a
-- user, so the device tokens have to live somewhere the server can read them.
--
-- DELIBERATELY NOT A td_ TABLE. Every td_ table is account DATA: it syncs to
-- every device, rides get_account_delta, and restores on sign-in. A push token
-- is the opposite of that. It belongs to ONE handset, it is meaningless on any
-- other, and syncing it would hand every device in the account a list of its
-- siblings' tokens. So it stays out of the sync fabric entirely, which also
-- means no change to load_account_data and nothing for this file to recreate.
--
-- Additive only (CLAUDE.md 3.1: one Supabase serves dev, UAT, and production).
-- Nothing here alters an existing table, so production code that has never
-- heard of push is completely unaffected.

create table if not exists device_tokens (
  -- The APNs token is the natural key: iOS reissues it on reinstall and
  -- occasionally on restore, and the same handset must never accumulate rows,
  -- or every message goes out two or three times forever.
  token               text        primary key,
  -- Who is signed in on this handset.
  user_id             uuid        not null references auth.users(id) on delete cascade,
  -- WHOSE events this handset should hear. For an owner these match. For a
  -- crew member signed into their boss's account this is the BOSS's id, which
  -- is what makes "your dispatch changed" reach the right phone. Kept as a
  -- plain uuid with no FK for the same reason the rest of the crew machinery
  -- does: an account can be deleted while a device row is still in flight,
  -- and a dangling token is harmless (APNs rejects it and the sender prunes).
  contractor_user_id  uuid        not null,
  platform            text        not null default 'ios',
  updated_at          timestamptz not null default now(),
  -- APNs tells the sender when a token has died (the app was deleted). The
  -- sender stamps that here and stops trying, rather than burning a request
  -- per send forever on a phone that no longer has TradeDesk on it.
  invalid_at          timestamptz default null
);

create index if not exists device_tokens_contractor_idx
  on device_tokens (contractor_user_id) where invalid_at is null;

alter table device_tokens enable row level security;

-- A signed-in user may only ever see and change their OWN device rows. Nobody
-- reads anyone else's tokens through the client: the sender runs as the
-- service role inside the send-push Edge Function, which bypasses RLS.
-- Both sides cast to text, matching every other policy in this repo (an
-- uncast uuid comparison silently denies every row: see the td_vehicles note).
drop policy if exists "own device" on device_tokens;
create policy "own device" on device_tokens for all to authenticated
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- Explicit, matching td_places / td_equipment. The default-privileges block in
-- 20260704 would cover a new table anyway, but every table since has said so
-- out loud rather than depending on it, and a missing grant reads at runtime as
-- an RLS failure, which is a miserable thing to debug.
grant select, insert, update, delete on device_tokens to authenticated;

-- Keep updated_at honest so a stale-token sweep has something to sort on.
create or replace function device_tokens_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists device_tokens_touch_trg on device_tokens;
create trigger device_tokens_touch_trg
  before update on device_tokens
  for each row execute function device_tokens_touch();
