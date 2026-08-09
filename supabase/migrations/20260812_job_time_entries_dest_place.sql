-- job_time_entries.dest_place: the non-job destination a drive leg ended at.
--
-- The app has been WRITING this column since the drive-attribution work (a leg
-- ending at a supply house names the place rather than a job), but the column
-- was never captured in a migration. It exists on the hosted Dev project, added
-- through the dashboard, so Dev worked and a from-migrations stack did not:
-- exactly the drift that 20260709_team_members_conflict_uniq.sql documents for
-- the team_members unique index. On a clean stack every drive insert naming a
-- place would be rejected outright (PostgREST refuses unknown columns), so the
-- feature would silently record nothing at all.
--
-- Two flow specs carried a `if (/dest_place|column/.test(err)) return ok` escape
-- hatch for precisely this. That escape hatch is removed in the same commit:
-- with the column in a migration, a missing column is a real failure again
-- rather than a green test that asserted nothing.
--
-- Idempotent, and a no-op on the cloud project that already has it.
alter table if exists job_time_entries
  add column if not exists dest_place text;

-- Widen the `source` documentation to the full set the fence machine writes.
-- 'stop' is new here: time parked OUTSIDE every fence (lunch, an errand, waiting
-- on a gate). It is captured so a day reconciles, but it is neither job labor
-- nor drive time, and finance.js/timelog.js exclude it from paid hours. Before
-- it existed those minutes stayed on the open drive leg, so an hour at lunch was
-- written as an hour of driving with compensable time and mileage attached.
comment on column job_time_entries.source is
  'geofence | geofence-gap | manual | drive | drive-personal | stop';
comment on column job_time_entries.dest_place is
  'Name of the non-job destination a drive leg ended at (a supply house, the shop). Null when the leg ended at a job.';
