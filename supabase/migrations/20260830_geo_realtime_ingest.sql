-- Real-time geofence ingest (owner directive 2026-08-27: mileage and time
-- logs land in Supabase the moment a fence trips, app force-closed or not).
--
-- The phone's native layer gets ~10s of background runtime on every fence
-- crossing / significant-change wake, even from force-quit. Build 39 teaches
-- it to background-URLSession POST its event buffer to the ingest-geo edge
-- function within that window. This migration is the storage that function
-- writes to:
--
--   geo_events        raw native events, the durable server-side truth. One
--                     row per (employee, type, ts, region), deduped by index
--                     so re-flushes of the same buffer are free no-ops.
--   geo_device_state  the tiny per-device state machine cursor (open dwell,
--                     open leg, last processed ts) that lets ingest-geo turn
--                     the event stream into rows incrementally.
--
-- The DERIVED rows go into the tables the app already reads
-- (job_time_entries, shop_time_entries, td_mileage), with the SAME
-- deterministic client_key / legKey shapes the JS engine mints
-- (js/geo-track.js _geoLegKey / _geoVisitKey), so the client's own replay
-- upserts (ignoreDuplicates on contractor_user_id,client_key) and its
-- legKey checks dedupe against server writes in both directions for free.
-- No changes to those tables are needed here.
--
-- Additive only (§3.1): nothing renamed, nothing dropped, production code
-- that never heard of these tables is unaffected.

create table if not exists geo_events (
  id                 bigint generated always as identity primary key,
  contractor_user_id uuid not null references auth.users(id) on delete cascade,
  employee_user_id   uuid references auth.users(id) on delete set null,
  device_id          text default '',
  type               text not null,           -- regionEnter|regionExit|fix|visit|relaunch
  ts                 timestamptz not null,    -- native CAPTURE moment (__tdTs), never receipt time
  lat                numeric,
  lon                numeric,
  -- '' rather than null so the dedupe index below is plain-column and
  -- PostgREST's on_conflict can target it (expression indexes cannot be).
  region_id          text not null default '', -- 'job-<id>'|'place-<id>'|'client-<id>'|'shop'|'fence'|''
  arrival_ts         timestamptz,             -- visits only: iOS's own arrivalDate
  created_at         timestamptz default now()
);

create index if not exists geo_events_contractor_ts_idx
  on geo_events(contractor_user_id, ts desc);

-- A buffered event can be flushed more than once (flush succeeded, ack lost,
-- next wake re-sends the tail). Identity is the event itself, not the flush.
create unique index if not exists geo_events_dedupe_uq
  on geo_events(employee_user_id, type, ts, region_id);

create table if not exists geo_device_state (
  employee_user_id   uuid not null,
  device_id          text not null default '',
  contractor_user_id uuid,
  -- {dwell:{regionId,arrivedTs,lat,lon}, leg:{startTs,lat,lon,regionId}, lastTs}
  state              jsonb not null default '{}'::jsonb,
  updated_at         timestamptz default now(),
  primary key (employee_user_id, device_id)
);

-- Deny-all to clients on both: only the ingest-geo function (service role)
-- reads or writes them. The app consumes the DERIVED rows through the
-- existing tables and their existing RLS; raw events are ops data.
alter table geo_events       enable row level security;
alter table geo_device_state enable row level security;

-- ── Device flush keys ────────────────────────────────────────────────────────
-- The native layer cannot hold a Supabase session: refreshing the JWT from
-- Swift would ROTATE the refresh token out from under the JS client and sign
-- the user out (Supabase refresh tokens are single-use). So each device gets
-- a dedicated random key, minted by JS while signed in, handed to the plugin,
-- and validated by ingest-geo via the service role. Possession of the key
-- authorizes exactly one thing: posting THIS device's location events for
-- THIS user. Revoke by deleting the row.
create table if not exists geo_flush_keys (
  user_id    uuid not null references auth.users(id) on delete cascade,
  device_id  text not null,
  key        text not null,
  created_at timestamptz default now(),
  primary key (user_id, device_id)
);
alter table geo_flush_keys enable row level security;
-- Owner-only: a signed-in user manages keys for their own devices; nobody
-- else (managers included) can read them.
drop policy if exists geo_flush_keys_own on geo_flush_keys;
create policy geo_flush_keys_own on geo_flush_keys
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
