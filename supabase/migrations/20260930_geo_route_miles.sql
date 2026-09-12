-- The road miles the phone already worked out, somewhere other than the phone.
--
-- Owner 2026-09-11, on a server-side replay of a day his phone got right:
-- "I just want to be able to compare what has already happened correctly in
-- the past and something on the server side writes the exact same shit."
-- Everything matched except the miles, and the miles could never match,
-- because routing lives on the handset: MapKit Directions first (device-only,
-- _mapkitReady), then Valhalla and OSRM raced. Off the phone a leg falls back
-- to summing its breadcrumbs, and a thin trace undercounts badly: his
-- 10 September came out 11.3 miles against the 13.3 his phone wrote, and
-- Jack's drive home read 3.6 against a routed 6.3.
--
-- The answer is not a second router. The phone ALREADY computes the right
-- number and already caches it, in localStorage, per device, capped at 400
-- and evicted (_GEO_ROUTE_CACHE_KEY, js/geo-track.js). It is the correct
-- answer sitting where nothing else can read it. This is that same cache, in
-- the one place both a phone and a scheduled job can reach.
--
-- THE KEY IS THE PHONE'S OWN KEY, byte for byte: _geoRouteKey's
-- "lat,lng>via>lat,lng" rounded to 1e-4. Same rounding, same via points, same
-- string, or the two halves cache different things under different names and
-- the whole point is lost.
--
-- Scoped per contractor, not global. A route key is a pair of coordinates,
-- which is a pair of somebody's addresses; a shared pool would be both a
-- cross-tenant read and something a stranger could poison with a wrong
-- number. Per account it is neither, and the hit rate that matters (the same
-- shop-to-client run, every day) is entirely within one account anyway.

create table if not exists geo_route_miles (
  contractor_user_id uuid not null,
  route_key          text not null,
  miles              numeric not null,
  updated_at         timestamptz not null default now(),
  primary key (contractor_user_id, route_key)
);

alter table geo_route_miles enable row level security;

-- Same three-policy shape job_time_entries already uses: the owner manages
-- the account's rows, an active crew member may read them and add to them,
-- and nobody may reach another account's.
drop policy if exists "Contractor manages route miles" on geo_route_miles;
create policy "Contractor manages route miles" on geo_route_miles
  for all using (contractor_user_id::text = auth.uid()::text)
  with check (contractor_user_id::text = auth.uid()::text);

drop policy if exists "Crew reads route miles" on geo_route_miles;
create policy "Crew reads route miles" on geo_route_miles
  for select using (exists (
    select 1 from team_members tm
     where tm.employee_user_id::text = auth.uid()::text
       and tm.contractor_user_id = geo_route_miles.contractor_user_id
       and tm.active = true));

drop policy if exists "Crew writes route miles" on geo_route_miles;
create policy "Crew writes route miles" on geo_route_miles
  for insert with check (exists (
    select 1 from team_members tm
     where tm.employee_user_id::text = auth.uid()::text
       and tm.contractor_user_id = geo_route_miles.contractor_user_id
       and tm.active = true));

grant select, insert, update, delete on geo_route_miles to authenticated;
