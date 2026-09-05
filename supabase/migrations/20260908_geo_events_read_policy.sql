-- The phone reads its own raw events back (owner 2026-09-02, "mileage route
-- is wrong": a 3-point line for a drive the server held 80 breadcrumbs for).
--
-- 20260830_geo_realtime_ingest made geo_events deny-all: RLS on, no policy,
-- "only the ingest-geo function reads or writes them, raw events are ops
-- data". That was true the day it was written. Since then the day deriver
-- (js/geo-derive.js, wired in js/geo-track.js _geoDeriveServerFixes) became
-- the ONE writer of mileage and time rows, and it rebuilds a day from the
-- server's fixes and app events: what other wakes flushed while the app was
-- dead. Postgres answered every one of those reads with zero rows, silently,
-- so every rebuild ran on the phone's own thin local log plus the
-- once-a-minute crew-map pings, and the router outranked a trace the server
-- could have made dense.
--
-- Reads only. Writes stay with the service role through ingest-geo; a phone
-- never inserts, updates or deletes a raw event. Same three readers as
-- location_pings: the person the events belong to, the account they belong
-- to, and a manager with the team permission on that account.
--
-- Additive (CLAUDE.md 3.1): nothing renamed, nothing dropped, production
-- code that never reads this table is unaffected.

drop policy if exists geo_events_read_own on geo_events;
create policy geo_events_read_own on geo_events
  for select using (auth.uid()::text = employee_user_id::text);

drop policy if exists geo_events_read_account on geo_events;
create policy geo_events_read_account on geo_events
  for select using (
    auth.uid()::text = contractor_user_id::text
    or has_team_perm(contractor_user_id, 'team')
  );
