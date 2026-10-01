\set ON_ERROR_STOP on
-- ── 30 days of raw GPS events, and not one saved row lost ───────────────────
--
-- Owner 2026-10-01: "30 days, each rolling day replaces the oldest day 31 and
-- only that day. Can't have any data loss." (20261062_geo_events_retention)
--
-- Proves, against the real function:
--   1. The line is midnight Central at the start of day 30. Day 30 is kept to
--      the first second; day 31 is gone to the last second.
--   2. Everything older goes too (a missed night is caught up), in batches.
--   3. It deletes geo_events and nothing else: a saved mileage leg from two
--      months ago is still there, and the time tables hold the same rows.
--   4. Running it twice deletes nothing the second time.
--   5. geo_replace_day still refuses to rebuild the oldest KEPT day. That
--      lock is what makes deleting raw events safe, so if anyone ever widens
--      it toward the prune line this fails before it ships.
--   6. Nobody signed in can call it.

do $$
declare
  u uuid := '22222222-2222-4222-8222-222222222222';
  t date := (now() at time zone 'America/Chicago')::date;
  -- Midnight Central at the start of a Central day.
  day_start_30 timestamptz := ((t - 30)::timestamp) at time zone 'America/Chicago';
  day_start_31 timestamptz := ((t - 31)::timestamp) at time zone 'America/Chicago';
  n int;
  n_jte int; n_ste int; n_jte2 int; n_ste2 int;
  res jsonb;
begin
  insert into auth.users (id, email) values (u, 'ci-retention@example.test')
    on conflict (id) do nothing;
  delete from geo_events where employee_user_id = u;
  delete from td_mileage where user_id = u;

  insert into geo_events (contractor_user_id, employee_user_id, type, ts, region_id) values
    (u, u, 'fix', day_start_30,                          'keep-day30-first-second'),
    (u, u, 'fix', day_start_30 + interval '12 hours',    'keep-day30-noon'),
    (u, u, 'fix', now(),                                 'keep-today'),
    (u, u, 'fix', day_start_30 - interval '1 second',    'gone-day31-last-second'),
    (u, u, 'fix', day_start_31,                          'gone-day31-first-second'),
    (u, u, 'fix', day_start_31 - interval '14 days',     'gone-day45');
  -- A backlog bigger than one batch, so the loop has to go round.
  insert into geo_events (contractor_user_id, employee_user_id, type, ts, region_id)
  select u, u, 'radio', day_start_31 - interval '20 days' + g * interval '1 second', ''
    from generate_series(1, 25000) g;

  -- A saved drive from two months ago. It must outlive its raw events.
  insert into td_mileage (id, user_id, data, deleted_at) values (
    'j-retention-old', u,
    jsonb_build_object('id','j-retention-old','date',(t - 60)::text,'miles',4.2,'gps',true),
    null);
  select count(*) into n_jte from job_time_entries;
  select count(*) into n_ste from shop_time_entries;

  -- ── 1 + 2. The line, and everything behind it ────────────────────────────
  n := geo_events_prune();
  if n < 25003 then
    raise exception 'prune deleted % rows, expected at least the 25,003 behind the line', n;
  end if;
  select count(*) into n from geo_events where employee_user_id = u;
  if n <> 3 then
    raise exception 'expected the 3 kept events, found %', n;
  end if;
  if not exists (select 1 from geo_events where employee_user_id = u and region_id = 'keep-day30-first-second') then
    raise exception 'the first second of day 30 was deleted: the line is a day early';
  end if;
  if exists (select 1 from geo_events where employee_user_id = u and region_id like 'gone-%') then
    raise exception 'an event from day 31 or older survived: the line is a day late';
  end if;

  -- ── 3. Nothing but geo_events ────────────────────────────────────────────
  if not exists (select 1 from td_mileage where id = 'j-retention-old' and user_id = u and deleted_at is null) then
    raise exception 'a saved mileage leg was removed with its raw events';
  end if;
  select count(*) into n_jte2 from job_time_entries;
  select count(*) into n_ste2 from shop_time_entries;
  if n_jte2 <> n_jte or n_ste2 <> n_ste then
    raise exception 'time rows changed: job % -> %, shop % -> %', n_jte, n_jte2, n_ste, n_ste2;
  end if;

  -- ── 4. Twice is the same as once ─────────────────────────────────────────
  n := geo_events_prune();
  if n <> 0 then
    raise exception 'a second run deleted % more rows', n;
  end if;

  -- ── 5. The oldest kept day can no longer be rebuilt ──────────────────────
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  res := geo_replace_day(u, u, (t - 30)::text, day_start_30, day_start_30 + interval '1 day',
                         '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, true);
  if not coalesce((res->>'locked')::boolean, false) then
    raise exception 'geo_replace_day would rebuild day 30, whose raw events are one night from deletion: %', res;
  end if;
  perform set_config('request.jwt.claims', '', false);

  -- ── 6. Scheduler only ────────────────────────────────────────────────────
  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and has_function_privilege('authenticated', 'geo_events_prune()', 'execute') then
    raise exception 'a signed-in user can delete raw GPS events';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_function_privilege('anon', 'geo_events_prune()', 'execute') then
    raise exception 'an anonymous caller can delete raw GPS events';
  end if;

  delete from td_mileage where user_id = u;
  delete from geo_events where employee_user_id = u;
  raise notice '✅ geo_events retention: day 30 kept, day 31 gone, saved rows untouched, rebuild locked';
end
$$;
