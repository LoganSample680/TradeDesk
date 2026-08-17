-- Live Activity push tokens: how the server changes a lock-screen card.
--
-- Distinct from device_tokens on purpose. A device token addresses a PHONE and
-- lives for months; an activity token addresses ONE Live Activity (one card on
-- one lock screen), exists only while that card is showing, and rotates at
-- iOS's whim. Keyed (user_id, channel) because that is exactly the question
-- the server ever asks: "the clock card on this person's phone, wherever it
-- is." A fresh card's token simply overwrites the dead card's row.
--
-- First consumer: force clock-out. A manager closing a forgotten clock from
-- Time Log now also ends the CREW PHONE'S lock-screen card, which until this
-- kept saying CLOCKED IN until the app was next opened, the exact lie the
-- card exists to prevent.
--
-- Additive only (CLAUDE.md 3.1), and NOT a td_ sync table for the same reason
-- device_tokens is not: it belongs to one handset, syncing it would be
-- meaningless everywhere else.

create table if not exists live_activity_tokens (
  user_id             uuid        not null references auth.users(id) on delete cascade,
  -- Which card: 'clock' or 'drive' today; new cards get new channels.
  channel             text        not null,
  token               text        not null,
  -- Whose account's events may target this card (the boss's id for a crew
  -- member on the boss's account). Plain uuid, no FK, same reasoning as
  -- device_tokens: a dangling row is harmless, APNs just rejects it.
  contractor_user_id  uuid        not null,
  updated_at          timestamptz not null default now(),
  primary key (user_id, channel)
);

create index if not exists live_activity_tokens_contractor_idx
  on live_activity_tokens (contractor_user_id);

alter table live_activity_tokens enable row level security;

-- Only the signed-in user touches their own rows from the client; the sender
-- reads as service role inside the Edge Function, which bypasses RLS. Both
-- sides cast to text (see the td_vehicles lint note: an uncast uuid
-- comparison silently denies every row).
drop policy if exists "own activity" on live_activity_tokens;
create policy "own activity" on live_activity_tokens for all to authenticated
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

grant select, insert, update, delete on live_activity_tokens to authenticated;

create or replace function live_activity_tokens_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists live_activity_tokens_touch_trg on live_activity_tokens;
create trigger live_activity_tokens_touch_trg
  before update on live_activity_tokens
  for each row execute function live_activity_tokens_touch();
