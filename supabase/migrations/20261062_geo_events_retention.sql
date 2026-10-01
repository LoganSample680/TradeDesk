-- Keep 30 days of raw GPS events (owner 2026-10-01: "30 days, each rolling day
-- replaces the oldest day 31 and only that day. Can't have any data loss").
--
-- geo_events had no retention at all: 122k rows and 63 MB after five weeks
-- from a handful of phones, growing with every person tracked.
--
-- WHAT GOES. Raw events whose event time (ts) falls on a Central day more than
-- 30 days before today. On Oct 31 that is Sep 30 and older; Oct 1 through
-- today stay. Run nightly, that is exactly one day per night. A missed night
-- is caught up by the next one rather than leaving a day behind forever,
-- which is why the test is "older than day 30" and not "equal to day 31".
--
-- WHAT DOES NOT. Nothing but geo_events. The time rows, mileage legs and shop
-- time built from these events live in their own tables and are untouched.
--
-- WHY THAT IS NO DATA LOSS. The one thing that rebuilds rows from raw events
-- is geo_replace_day, and it already refuses any day whose window closed more
-- than 14 days ago (step 0, "THE PAST IS READ-ONLY", 20261060). So a day loses
-- its raw events sixteen days after the last moment anything could rebuild it.
-- scripts/ci/geo-events-retention.sql proves both halves on every PR,
-- including that the lock still holds at the prune line, so the two can never
-- drift past each other unnoticed.
--
-- Late uploads measured the same day arrived at most 14.6 days after the event
-- (a phone that was off), so nothing still in flight is deleted.

create or replace function geo_events_prune()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Named once. The CI check reads this function's result, not this number.
  c_keep_days constant integer := 30;
  c_batch constant integer := 10000;
  v_cutoff timestamptz;
  v_batch integer;
  v_total integer := 0;
begin
  -- Midnight Central at the start of the oldest kept day. Computed from the
  -- Central calendar, not now() - 30 days, so the line falls on a day boundary
  -- and a day is either kept whole or gone whole, across DST too.
  v_cutoff := (((now() at time zone 'America/Chicago')::date - c_keep_days)::timestamp)
              at time zone 'America/Chicago';
  -- In batches, so the first run (ten days of backlog) and any catch-up never
  -- hold one long lock against the ingest path writing new events.
  loop
    delete from geo_events
     where id in (select id from geo_events where ts < v_cutoff limit c_batch);
    get diagnostics v_batch = row_count;
    v_total := v_total + v_batch;
    exit when v_batch < c_batch;
  end loop;
  return v_total;
end
$$;

-- Nobody calls this but the scheduler. Not the app, not a signed-in user.
revoke all on function geo_events_prune() from public;
do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function geo_events_prune() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function geo_events_prune() from authenticated';
  end if;
end
$do$;

-- Nightly at 09:17 UTC: 4:17am Central in summer, 3:17am in winter, when no
-- crew is driving. pg_cron runs in GMT on this project. Guarded like
-- 20261052: a plain Postgres (the migration lint runner) has no pg_cron.
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('geo-events-prune');
    exception when others then null;
    end;
    perform cron.schedule('geo-events-prune', '17 9 * * *', 'select geo_events_prune()');
  end if;
end
$do$;
