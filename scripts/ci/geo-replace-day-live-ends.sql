\set ON_ERROR_STOP on
-- ── A live row the day no longer carries has ended (20261060, step 5c) ──────
--
-- Jack drives home from the shop. The live drive row goes up the second the
-- drive starts; at home the drive is his commute (rule 20) and closes into no
-- row, and the house writes nothing. Before 5c the live row read "On the road"
-- for the rest of the evening. Replayed in order, with what must survive.

do $$
declare
  u uuid := '44444444-4444-4444-8444-444444444444';
  d text := (current_date - 1)::text;
  a timestamptz := (current_date - 1)::timestamptz;
  b timestamptz := (current_date)::timestamptz;
  t0 text := to_char(a + interval '12 hours','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  t1 text := to_char(a + interval '21 hours 35 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  t2 text := to_char(a + interval '21 hours 36 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  shop jsonb;
  res jsonb;
  n int;
begin
  insert into auth.users (id, email) values (u, 'ci-live-ends@example.test') on conflict (id) do nothing;
  delete from job_time_entries where employee_user_id = u;
  delete from shop_time_entries where employee_user_id = u;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  shop := jsonb_build_array(jsonb_build_object('client_key','d-shop','arrived_at',t0,'departed_at',t1,'minutes',575,'source','shop'));

  -- 1. He leaves the shop: the shop row closes and the drive goes up live.
  res := geo_replace_day(u, u, d, a, b,
    jsonb_build_array(jsonb_build_object('client_key','j-home','arrived_at',t1,'departed_at',null,'minutes',null,'source','drive')),
    shop, '[]'::jsonb, false);
  if coalesce((res->>'locked')::boolean, false) then raise exception 'day locked, nothing below proves anything: %', res; end if;
  select count(*) into n from job_time_entries where employee_user_id = u and client_key = 'j-home' and deleted_at is null and departed_at is null;
  if n <> 1 then raise exception 'the live drive did not go up: %', n; end if;

  -- 2. A manual clock and a hand-fixed open row the day must never touch.
  insert into job_time_entries (contractor_user_id, employee_user_id, client_key, arrived_at, departed_at, source)
    values (u, u, 'live-man-1', t0::timestamptz, null, 'manual');
  insert into job_time_entries (contractor_user_id, employee_user_id, client_key, arrived_at, departed_at, source, fixed_at)
    values (u, u, 'live-fx-1', t0::timestamptz, null, 'client', now());

  -- 3. Home: the commute closes into no row. The day now carries only the shop.
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, shop, '[]'::jsonb, false);
  select count(*) into n from job_time_entries where employee_user_id = u and client_key = 'j-home' and deleted_at is null;
  if n <> 0 then raise exception 'the live drive is still on the road after the commute closed into nothing'; end if;
  if coalesce((res->'ended'->>'time')::int, -1) <> 1 then raise exception 'ended count wrong: %', res; end if;
  select count(*) into n from job_time_entries where employee_user_id = u and client_key in ('live-man-1','live-fx-1') and deleted_at is null;
  if n <> 2 then raise exception 'a person''s open row was ended: %', n; end if;
  select count(*) into n from shop_time_entries where employee_user_id = u and client_key = 'd-shop' and deleted_at is null;
  if n <> 1 then raise exception 'the closed shop row was touched'; end if;

  -- 4. A paid drive closes onto its own key and stays.
  res := geo_replace_day(u, u, d, a, b,
    jsonb_build_array(jsonb_build_object('client_key','j-paid','arrived_at',t1,'departed_at',null,'minutes',null,'source','drive')),
    shop, '[]'::jsonb, false);
  res := geo_replace_day(u, u, d, a, b,
    jsonb_build_array(jsonb_build_object('client_key','j-paid','arrived_at',t1,'departed_at',t2,'minutes',1,'source','drive')),
    shop, '[]'::jsonb, false);
  select count(*) into n from job_time_entries where employee_user_id = u and client_key = 'j-paid' and deleted_at is null and departed_at is not null;
  if n <> 1 then raise exception 'the paid drive did not close onto its own row: %', n; end if;

  raise notice 'geo-replace-day-live-ends: a live row the day no longer carries has ended, and nothing a person wrote was touched';
end $$;
