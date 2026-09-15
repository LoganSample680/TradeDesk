-- ── v_time_day: a held row is held, whatever kind of row it is ─────────────
--
-- js/geo-derive.js rule 18 (owner 2026-09-13) widened the held family. A visit
-- the day could not vouch for has been written 'client-held' since rule 13;
-- the drive out to an address nobody saved, and the stop at the end of it, are
-- now written 'drive-held' and 'unsaved-held' for the same reason and with the
-- same meaning: shown so the log has no hole in it, counted by nobody.
--
-- This view read the three plain sources by exact string, so those rows fell
-- out of drive_min and unnamed_min (correct, they are not counted) and into
-- nothing at all (wrong, the day stopped adding up). held_min is the column
-- that already means "still a question", so the whole family belongs in it.
--
-- Suffix match, not a list, for the same reason the app has one predicate
-- rather than one string per reader: a future held variant joins by being
-- named into the family.
create or replace view v_time_day as
select day, employee_user_id, contractor_user_id,
       sum(minutes) filter (where source = 'drive')                         as drive_min,
       sum(minutes) filter (where source in ('client','geofence','place'))   as site_min,
       sum(minutes) filter (where source = 'unsaved')                        as unnamed_min,
       sum(minutes) filter (where source like '%-held')                      as held_min,
       count(*)     filter (where source = 'drive')                          as drives,
       count(*)     filter (where source in ('client','geofence','place'))   as visits
from (
  select (arrived_at at time zone 'America/Chicago')::date as day,
         employee_user_id, contractor_user_id, source, minutes
  from job_time_entries
  where departed_at is not null
) r
where employee_user_id not in (select user_id from analytics_internal_accounts)
group by day, employee_user_id, contractor_user_id;
