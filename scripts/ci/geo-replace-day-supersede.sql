\set ON_ERROR_STOP on
-- ── A newer answer retires the older one it contradicts (20261038) ──────────
--
-- Owner 2026-09-23: "the app had double counted time and was all fucked up."
--
-- Jack's 23 September, replayed. The 08:29 derive wrote his morning from the
-- tape it had. At 10:26 his phone handed over two hours of CoreMotion it had
-- been holding, the drive now began at 08:09:30 instead of 08:10:21, and every
-- key minted from that flip changed. Ingest never sweeps, so the fuller answer
-- landed BESIDE the old one: two drives to Treyton's, two 8:13 to 8:53 visits,
-- two rows from 9:10. This proves the newer write retires the older rows it
-- overlaps, and that it touches nothing else: not a person's row, not a row it
-- did not re-describe, not another person's day, and not a leg somebody
-- answered.

do $$
declare
  u  uuid := '22222222-2222-4222-8222-222222222222';
  u2 uuid := '33333333-3333-4333-8333-333333333333';
  d  text := (current_date - 1)::text;
  a  timestamptz := (current_date - 1)::timestamptz;
  b  timestamptz := (current_date)::timestamptz;
  t  jsonb; s jsonb; m jsonb;
  res jsonb;
  n int;
  iso text := 'YYYY-MM-DD"T"HH24:MI:SS"Z"';
begin
  insert into auth.users (id, email) values (u, 'ci-sup@example.test'), (u2, 'ci-sup2@example.test')
    on conflict (id) do nothing;
  delete from job_time_entries where employee_user_id in (u, u2);
  delete from shop_time_entries where employee_user_id in (u, u2);
  delete from td_mileage where user_id in (u, u2);
  -- Called exactly the way ingest-geo calls it: the service role, no
  -- signed-in user, on behalf of the employee.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);

  -- ── The 08:29 derive: the tape as it stood then ────────────────────────
  t := jsonb_build_array(
    jsonb_build_object('client_key','j-A','source','drive',
      'arrived_at', a + interval '13h 10m 21s', 'departed_at', a + interval '13h 13m 41s'),
    jsonb_build_object('client_key','d-j-A','source','client',
      'arrived_at', a + interval '13h 13m 41s', 'departed_at', a + interval '13h 53m 51s'),
    jsonb_build_object('client_key','d-j-B','source','open',
      'arrived_at', a + interval '14h 10m 15s', 'departed_at', null));
  m := jsonb_build_array(jsonb_build_object('id','j-A','gps',true,'date',d,'miles',1.6,
      'startedIso', to_char(a + interval '13h 10m 21s', iso), 'endedIso', to_char(a + interval '13h 13m 41s', iso)));
  res := geo_replace_day(u, u, d, a, b, t, '[]'::jsonb, m, false, null);
  if (res->>'locked') = 'true' then raise exception 'supersede: day unexpectedly locked'; end if;

  -- Things this test must NOT lose. A person's clock, a hand-fixed row, an
  -- answered row, a row outside anything the next write re-describes, another
  -- person's row at the same minutes, and a leg somebody put a purpose on.
  insert into job_time_entries (contractor_user_id, employee_user_id, arrived_at, departed_at, minutes, source, client_key)
    values (u, u, a + interval '13h 20m', a + interval '13h 40m', 20, 'manual', 'man-1');
  insert into job_time_entries (contractor_user_id, employee_user_id, arrived_at, departed_at, minutes, source, client_key, fixed_at)
    values (u, u, a + interval '13h 00m', a + interval '13h 12m', 12, 'client', 'fix-1', now());
  insert into job_time_entries (contractor_user_id, employee_user_id, arrived_at, departed_at, minutes, source, client_key, answered_at)
    values (u, u, a + interval '14h 30m', a + interval '14h 40m', 10, 'dismissed', 'ans-1', now());
  insert into job_time_entries (contractor_user_id, employee_user_id, arrived_at, departed_at, minutes, source, client_key)
    values (u, u, a + interval '20h', a + interval '21h', 60, 'client', 'far-1');
  insert into job_time_entries (contractor_user_id, employee_user_id, arrived_at, departed_at, minutes, source, client_key)
    values (u2, u2, a + interval '13h 10m', a + interval '13h 50m', 40, 'client', 'other-1');
  -- An old row with its end before its start: it must not be able to make
  -- the next write raise.
  insert into job_time_entries (contractor_user_id, employee_user_id, arrived_at, departed_at, minutes, source, client_key)
    values (u, u, a + interval '13h 30m', a + interval '13h 29m', 0, 'client', 'bad-1');
  insert into td_mileage (id, user_id, data, deleted_at) values ('j-ANSWERED', u,
    jsonb_build_object('id','j-ANSWERED','gps',true,'date',d,'miles',1.6,'purpose','Business',
      'startedIso', to_char(a + interval '13h 10m 00s', iso), 'endedIso', to_char(a + interval '13h 13m 00s', iso)), null);
  insert into td_mileage (id, user_id, data, deleted_at) values ('j-JUNK', u,
    jsonb_build_object('id','j-JUNK','gps',true,'date',d,'miles',1,'startedIso','not a date','endedIso','nope'), null);

  -- ── The 10:26 derive: the fuller tape, new keys ────────────────────────
  t := jsonb_build_array(
    jsonb_build_object('client_key','j-A2','source','drive',
      'arrived_at', a + interval '13h 09m 30s', 'departed_at', a + interval '13h 13m 41s'),
    jsonb_build_object('client_key','d-j-A2','source','client',
      'arrived_at', a + interval '13h 13m 41s', 'departed_at', a + interval '13h 53m 51s'),
    jsonb_build_object('client_key','j-B','source','drive',
      'arrived_at', a + interval '13h 53m 51s', 'departed_at', a + interval '13h 59m 35s'),
    jsonb_build_object('client_key','j-C','source','drive',
      'arrived_at', a + interval '14h 05m 55s', 'departed_at', a + interval '14h 10m 15s'),
    jsonb_build_object('client_key','d-j-C','source','client',
      'arrived_at', a + interval '14h 10m 15s', 'departed_at', a + interval '16h 02m 27s'));
  s := jsonb_build_array(
    jsonb_build_object('client_key','d-j-B',
      'arrived_at', a + interval '13h 59m 35s', 'departed_at', a + interval '14h 05m 55s'));
  m := jsonb_build_array(jsonb_build_object('id','j-A2','gps',true,'date',d,'miles',1.6,
      'startedIso', to_char(a + interval '13h 09m 30s', iso), 'endedIso', to_char(a + interval '13h 13m 41s', iso)));
  res := geo_replace_day(u, u, d, a, b, t, s, m, false, null);
  raise notice 'supersede result: %', res;

  -- The three old copies are gone...
  select count(*) into n from job_time_entries
    where employee_user_id = u and deleted_at is null and client_key in ('j-A','d-j-A','d-j-B');
  if n <> 0 then raise exception 'supersede: % stale automatic row(s) still live', n; end if;
  if (res->'superseded'->>'time')::int <> 3 then
    raise exception 'supersede: expected 3 superseded time rows, got %', res->'superseded'->>'time';
  end if;
  -- ...the new answer is all there...
  select count(*) into n from job_time_entries
    where employee_user_id = u and deleted_at is null and client_key in ('j-A2','d-j-A2','j-B','j-C','d-j-C');
  if n <> 5 then raise exception 'supersede: expected the 5 new time rows live, got %', n; end if;
  select count(*) into n from shop_time_entries where employee_user_id = u and deleted_at is null and client_key = 'd-j-B';
  if n <> 1 then raise exception 'supersede: the shop stop did not land'; end if;
  -- ...and no two automatic rows overlap any more.
  select count(*) into n from job_time_entries x join job_time_entries y
    on x.id < y.id and x.employee_user_id = u and y.employee_user_id = u
   and x.deleted_at is null and y.deleted_at is null
   and x.source <> 'manual' and y.source <> 'manual'
   and x.fixed_at is null and y.fixed_at is null and x.answered_at is null and y.answered_at is null
   and x.departed_at >= x.arrived_at and y.departed_at >= y.arrived_at
   and tstzrange(x.arrived_at, x.departed_at) && tstzrange(y.arrived_at, y.departed_at);
  if n <> 0 then raise exception 'supersede: % overlapping automatic pair(s) left', n; end if;

  -- What a person wrote, fixed or answered survives; so does what the new
  -- write never re-described, the malformed row, and the other person.
  select count(*) into n from job_time_entries
    where deleted_at is null and client_key in ('man-1','fix-1','ans-1','far-1','bad-1','other-1');
  if n <> 6 then raise exception 'supersede: retired something it must not (% of 6 left)', n; end if;

  -- Mileage: the unanswered old leg is superseded, the answered one and the
  -- unreadable one are left alone.
  select count(*) into n from td_mileage where user_id = u and id = 'j-A' and deleted_at is null;
  if n <> 0 then raise exception 'supersede: the stale leg is still live'; end if;
  select count(*) into n from td_mileage where user_id = u and id in ('j-ANSWERED','j-JUNK','j-A2') and deleted_at is null;
  if n <> 3 then raise exception 'supersede: an answered, unreadable or new leg went missing (% of 3)', n; end if;

  -- The same call again changes nothing: the writer agrees with itself.
  res := geo_replace_day(u, u, d, a, b, t, s, m, false, null);
  if (res->'superseded'->>'time')::int <> 0 or (res->'superseded'->>'shop')::int <> 0
     or (res->'superseded'->>'miles')::int <> 0 then
    raise exception 'supersede: a repeat write retired something: %', res->'superseded';
  end if;

  raise notice 'geo_replace_day: a newer write retires exactly the rows it re-describes';
end $$;
