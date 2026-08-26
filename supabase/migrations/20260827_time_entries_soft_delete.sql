-- Time entries get an undo, the same one mileage already has.
--
-- Owner, 2026-08-26: "the logic should match time logs where they are only
-- soft deleted, that should share so we can bring things back."
--
-- The premise was inverted, and the truth is worse. td_mileage HAS deleted_at
-- and its rows are recoverable. job_time_entries and shop_time_entries have no
-- such column at all, so every sweep that touched them called a real DELETE.
-- Six call sites in js/geo-track.js: the dedup, the drive-time hygiene, the
-- reconciled-row verifier, the stop repair, the merge and the shop dedup. Every
-- row any of them ever removed is gone, including the ones removed tonight
-- while chasing a rule that turned out to be wrong.
--
-- Mileage is not innocent either: _mileWorkdaySweep, _mileFlightSweep and
-- _mileDedupTrips bypass the soft-delete path with a direct DELETE, which is
-- how two real 3.2-mile legs from 08-18 and 08-19 were destroyed on 08-25 with
-- nothing to restore. Both sides now go through one shared helper.
--
-- Nullable, no default, no backfill. Existing rows keep null, which is correct:
-- they are live. Nothing that already happened can be recovered by this, it
-- only means the next wrong sweep is survivable.
--
-- Every reader must filter `deleted_at is null` or a swept row walks straight
-- back into the Time Log, payroll and Crew Cost. That is 17 select sites across
-- 6 files and they are changed in the same commit as this migration.
alter table job_time_entries  add column if not exists deleted_at timestamptz;
alter table shop_time_entries add column if not exists deleted_at timestamptz;

-- The readers all filter on deleted_at alongside contractor_user_id + a time
-- range, so the partial index matches the actual query shape and stays small:
-- only live rows are ever indexed.
create index if not exists job_time_entries_live_idx
  on job_time_entries (contractor_user_id, arrived_at)
  where deleted_at is null;
create index if not exists shop_time_entries_live_idx
  on shop_time_entries (contractor_user_id, arrived_at)
  where deleted_at is null;
