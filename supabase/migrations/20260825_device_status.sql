-- What each phone can actually DO: one row per handset, per user.
--
-- WHY THIS EXISTS (owner, 2026-08-25). Permission state has only ever lived in
-- localStorage on the handset. Nothing synced it, so nothing on the server
-- could answer "why is this account logging no drives", and the honest answer
-- to "what does Supabase say about Jack's location permission" was: nothing at
-- all, we never asked.
--
-- Worse, the one reporting path that DID exist wrote to team_members and began
-- `if(!_isEmployee)return`, so an OWNER, which is most of the customer base,
-- could never report anything even in principle. And there was no motion
-- column anywhere, for anybody, despite the plugin being able to answer it.
--
-- DELIBERATELY NOT A td_ TABLE, same reasoning as device_tokens: this is not
-- account data. It describes ONE handset, it is meaningless on another, and
-- syncing it would hand every device a list of its siblings' permission state.
-- So it stays out of the sync fabric, and load_account_data never sees it.
--
-- NOT ON team_members either. Owners have no row there, which is exactly the
-- hole this closes.
--
-- Additive only (CLAUDE.md 3.1: one Supabase serves dev, UAT and production).
-- Nothing here alters an existing table, so production code that has never
-- heard of this is unaffected.

create table if not exists device_status (
  -- One row per handset per user. A shared phone signed into two accounts is
  -- two rows, because the permission is the same but the account it serves is
  -- not, and each account should see its own answer.
  user_id             uuid        not null references auth.users(id) on delete cascade,
  -- The app's own per-device id (S.devices[].id), not the APNs token: this row
  -- must exist for a phone that never registered for push, which today is
  -- every phone.
  device_id           text        not null,
  -- Friendly label from S.devices, purely so a human reading the table can
  -- tell "iPhone" from "iPad" without joining anything.
  device_label        text,
  -- WHOSE account this handset was serving when it reported. Owner and crew
  -- differ here exactly the way device_tokens does. Plain uuid, no FK, same
  -- reason: an account can be deleted while a row is in flight.
  contractor_user_id  uuid,
  -- granted / denied / prompt / unsupported, as the app already models it.
  -- 'always' and 'wheninuse' are reserved for when the native layer can tell
  -- them apart (CLLocationManager.authorizationStatus), which needs an iOS
  -- build and is deliberately not required for this table to be useful.
  location_status     text,
  -- granted / denied / prompt / restricted / unsupported, from
  -- TdGeo.motionPermStatus, which the phone could always answer and was never
  -- asked for anywhere it could be stored.
  motion_status       text,
  -- True when this row was INFERRED from behaviour rather than reported by the
  -- handset (background pings can only arrive under Always, so an existing
  -- user's history proves their state without them opening anything). Kept
  -- explicit so a derived guess is never mistaken for the phone's own answer.
  derived             boolean     not null default false,
  app_version         text,
  platform            text        not null default 'ios',
  checked_at          timestamptz not null default now(),
  primary key (user_id, device_id)
);

create index if not exists device_status_contractor_idx
  on device_status (contractor_user_id);

alter table device_status enable row level security;

-- A signed-in user may see and change their OWN handset rows. Both sides cast
-- to text, matching every other policy in this repo (an uncast uuid comparison
-- silently denies every row: see the td_vehicles note).
drop policy if exists "own device status" on device_status;
create policy "own device status" on device_status for all to authenticated
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- An owner reads the handsets of the crew on their own account, the same
-- visibility they already have over team_members. Read only: nobody edits
-- somebody else's phone's permission state, they can only look at it.
drop policy if exists "contractor reads crew device status" on device_status;
create policy "contractor reads crew device status" on device_status for select to authenticated
  using (auth.uid()::text = contractor_user_id::text);

-- Explicit, matching device_tokens / td_places / td_equipment: a missing grant
-- reads at runtime as an RLS failure, which is a miserable thing to debug.
grant select, insert, update, delete on device_status to authenticated;
