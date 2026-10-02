\set ON_ERROR_STOP on
-- ── A Personal place outranks an old answer (20261058) ─────────────────────
--
-- Jack, 2026-09-29 5:34am: the stop was derived as Don's (a customer with a
-- job), its question was answered "work", and answered_at froze the source at
-- 'geofence'. Re-derived as Colaw gym (a Personal place), the rail showed the
-- gym as a job site. Replayed here in order, with the answers that must still
-- be carried proved at the end.

do $$
declare
  u uuid := '33333333-3333-4333-8333-333333333333';
  d text := (current_date - 1)::text;
  a timestamptz := (current_date - 1)::timestamptz;
  b timestamptz := (current_date)::timestamptz;
  t0 text := to_char(a + interval '10 hours 34 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  t1 text := to_char(a + interval '11 hours 19 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  t2 text := to_char(a + interval '14 hours','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  t3 text := to_char(a + interval '15 hours','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  res jsonb;
  r record;
begin
  insert into auth.users (id, email) values (u, 'ci-personal@example.test') on conflict (id) do nothing;
  delete from job_time_entries where employee_user_id = u;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);

  -- 1. Derived as Don's job site.
  res := geo_replace_day(u, u, d, a, b, jsonb_build_array(jsonb_build_object(
    'client_key','d-gym','arrived_at',t0,'departed_at',t1,'minutes',45,'source','geofence','dest_place','Don Ixshu')),
    '[]'::jsonb, '[]'::jsonb, false);
  if coalesce((res->>'locked')::boolean, false) then raise exception 'day locked, nothing below proves anything: %', res; end if;

  -- 2. Somebody answers its question: work.
  update job_time_entries set answered_at = now() where client_key = 'd-gym' and employee_user_id = u;

  -- 3. Re-derived as the gym, a Personal place. The answer was about Don's.
  res := geo_replace_day(u, u, d, a, b, jsonb_build_array(jsonb_build_object(
    'client_key','d-gym','arrived_at',t0,'departed_at',t1,'minutes',45,'source','place-personal','dest_place','Colaw gym')),
    '[]'::jsonb, '[]'::jsonb, false);
  select source, dest_place, answered_at into r from job_time_entries where client_key = 'd-gym' and employee_user_id = u and deleted_at is null;
  if r.source is distinct from 'place-personal' then raise exception 'the gym still reads as %: the old answer followed it', r.source; end if;
  if r.dest_place is distinct from 'Colaw gym' then raise exception 'wrong name: %', r.dest_place; end if;
  if r.answered_at is not null then raise exception 'the answer about Don''s was not cleared'; end if;

  -- 4. Every other answer is still carried: answered "Personal" (dismissed) at a
  --    client, re-derived as the same client, stays Personal.
  res := geo_replace_day(u, u, d, a, b, jsonb_build_array(jsonb_build_object(
    'client_key','d-cl','arrived_at',t2,'departed_at',t3,'minutes',60,'source','client','dest_place','Bill Lorson')),
    '[]'::jsonb, '[]'::jsonb, false);
  update job_time_entries set source = 'dismissed', answered_at = now() where client_key = 'd-cl' and employee_user_id = u;
  res := geo_replace_day(u, u, d, a, b, jsonb_build_array(jsonb_build_object(
    'client_key','d-cl','arrived_at',t2,'departed_at',t3,'minutes',60,'source','client','dest_place','Bill Lorson')),
    '[]'::jsonb, '[]'::jsonb, false);
  select source, answered_at into r from job_time_entries where client_key = 'd-cl' and employee_user_id = u and deleted_at is null;
  if r.source is distinct from 'dismissed' or r.answered_at is null then raise exception 'an ordinary answer was not carried: %', r.source; end if;

  -- 5. A hand-fixed row is never touched, even by a Personal place.
  update job_time_entries set source = 'client', fixed_at = now(), answered_at = null where client_key = 'd-cl' and employee_user_id = u;
  res := geo_replace_day(u, u, d, a, b, jsonb_build_array(jsonb_build_object(
    'client_key','d-cl','arrived_at',t2,'departed_at',t3,'minutes',60,'source','place-personal','dest_place','Colaw gym')),
    '[]'::jsonb, '[]'::jsonb, false);
  select source into r from job_time_entries where client_key = 'd-cl' and employee_user_id = u and deleted_at is null;
  if r.source is distinct from 'client' then raise exception 'a hand-fixed row was overwritten: %', r.source; end if;

  delete from job_time_entries where employee_user_id = u;
  raise notice 'personal place outranks an old answer: 5 cases green';
end $$;
