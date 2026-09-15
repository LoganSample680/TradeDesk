-- The drawn road rides with the distance (owner 2026-09-14).
--
-- geo_route_miles has cached the MILES for a pair of ends since 20260930, and
-- that was all the phone needed: MapKit JS was re-asked for the geometry each
-- time the map opened, on the handset, for free.
--
-- The Apple Maps Server API answers with both at once (distanceMeters and
-- stepPaths in one response), and the server is now the first to ask. Throwing
-- the geometry away would mean a second call to draw what the first already
-- returned, against a 25,000-a-day quota shared with every phone on the team.
--
-- Additive, and nullable, per CLAUDE.md 3.1: every existing row keeps working
-- and production code that only reads `miles` never notices.
alter table geo_route_miles add column if not exists path jsonb;

comment on column geo_route_miles.path is
  'Road geometry for this pair of ends: [[lat,lng],...] as returned by the Apple Maps Server API stepPaths, or null when only the distance was available (Valhalla and OSRM are asked with overview=false and answer with no line).';
