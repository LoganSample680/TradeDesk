-- The deriver's day of evidence, compact, and only what is new (2026-09-28).
--
-- Second cause of the 2026-09-28 egress cutoff (the first, the logo in the
-- settings row, is 20261053). derive-day re-reads a person's whole day of
-- geo_events on every flush that carries a trigger event, as pages of 1,000
-- objects that repeat every key name on every row, about 161 bytes each. On
-- 2026-09-27 one phone sent a GPS fix every second for four hours of highway
-- and the server pulled 6.4 million rows that day, about 1 GB.
--
-- Two changes, neither of which touches what the deriver decides (§17):
--
-- 1. HOW the rows travel. Each row is a short array
--      [epoch ms, type, kind, lat, lon, region_id, detail, id]
--    so the key names are not repeated, and it is one call instead of up to
--    twelve. Same filter, same order, same cap as the paged read.
--
-- 2. WHICH rows travel. derive-day keeps the day it last read in memory
--    while its worker stays warm, and asks only for rows added since: a row
--    whose id is past the last one it saw, or which was stored within an
--    overlap window before its last read. The window is what catches a row
--    that another upload inserted first but committed later, with a lower id.
--    With both p_after_id and p_since null this is the full day read.
--
-- service_role only: it is for edge functions. Additive.
create or replace function public.geo_day_evidence(
  p_uid uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_types text[],
  p_limit int default 12000,
  p_after_id bigint default null,
  p_since timestamptz default null
)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_array(
           floor(extract(epoch from e.ts) * 1000)::bigint,
           e.type, e.kind, e.lat, e.lon, e.region_id, e.detail, e.id
         ) order by e.ts, e.id), '[]'::json)
  from (
    select id, ts, type, kind, lat, lon, region_id, detail
    from geo_events
    where employee_user_id = p_uid
      and type = any(p_types)
      and ts >= p_from and ts < p_to
      and (
        (p_after_id is null and p_since is null)
        or (p_after_id is not null and id > p_after_id)
        or (p_since is not null and created_at >= p_since)
      )
    order by ts asc, id asc
    limit greatest(coalesce(p_limit, 12000), 0)
  ) e;
$$;

revoke all on function public.geo_day_evidence(uuid, timestamptz, timestamptz, text[], int, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.geo_day_evidence(uuid, timestamptz, timestamptz, text[], int, bigint, timestamptz) to service_role;
