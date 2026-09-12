\set ON_ERROR_STOP on
-- ── The server may add a drive. It may not make one shorter. ────────────────
--
-- Owner 2026-09-11, watching his own drive land server-side with the app force
-- closed: the visit row was written correctly the second he pulled away, and
-- the same call rewrote his morning's 3.1-mile leg to 2.9. Road miles come
-- from a router and routing is device-only, so a server derive can only ever
-- sum breadcrumbs and can only ever hand back a smaller number.
--
-- 20261002 draws the line at p_sweep, which only the phone ever passes true:
-- a caller that cannot see the whole day may fill a leg nobody has a row for
-- and must leave every existing one alone. This proves both halves, and the
-- service-role arm from 20261001 while it is here.

do $$
declare
  u uuid := '11111111-1111-4111-8111-111111111111';
  -- YESTERDAY, NOT A FIXED DATE. geo_replace_day refuses a day whose window
  -- closed more than fourteen days ago and answers quietly rather than
  -- raising, so a check written against 2026-06-15 passed its first assertion
  -- without the function having done anything at all. That is exactly the
  -- vacuous pass this whole file exists to avoid, and it is why every call
  -- below now asserts it was not locked.
  d text := (current_date - 1)::text;
  a timestamptz := (current_date - 1)::timestamptz;
  b timestamptz := (current_date)::timestamptz;
  leg jsonb;
  res jsonb;
  got numeric;
  method text;
  n int;
begin
  -- td_mileage.user_id references auth.users, so the person has to exist
  -- before their drives can. The bootstrap's auth.users is a stub with three
  -- nullable columns; this is the whole of what it needs.
  insert into auth.users (id, email) values (u, 'ci-miles@example.test')
    on conflict (id) do nothing;
  delete from td_mileage where user_id = u;

  -- The phone's row: a router answered, so this is the good number.
  insert into td_mileage (id, user_id, data, deleted_at) values (
    'j-test-aaa', u,
    jsonb_build_object('id','j-test-aaa','legKey','j-test-aaa','gps',true,'date',d,
                       'miles',3.1,'calc_method','derived-routed','routeMiles',3.1,
                       'from_name','Shop','to_name','John Doe',
                       'startedIso', to_char(a + interval '13 hours','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                       'endedIso',   to_char(a + interval '13 hours 10 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                       'mins',10),
    null);

  -- A server derive of the same leg: thinner fixes, no router, 2.9.
  leg := jsonb_build_array(jsonb_build_object(
    'id','j-test-aaa','legKey','j-test-aaa','gps',true,'date',d,
    'miles',2.9,'calc_method','derived-path',
    'from_name','Shop','to_name','John Doe',
    'startedIso', to_char(a + interval '13 hours','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'endedIso',   to_char(a + interval '13 hours 10 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'mins',10));

  -- ── 1. The service role may call it at all (20261001) ────────────────────
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, leg, false);
  if coalesce((res->>'locked')::boolean, false) then
    raise exception 'the day was locked, so nothing below proves anything: %', res;
  end if;

  select (data->>'miles')::numeric, data->>'calc_method' into got, method
    from td_mileage where id = 'j-test-aaa' and user_id = u;
  if got is distinct from 3.1 or method is distinct from 'derived-routed' then
    raise exception 'a non-sweeping derive rewrote an existing leg: % / %', got, method;
  end if;

  -- ── 2. A leg nobody has a row for is still added ─────────────────────────
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'id','j-test-bbb','legKey','j-test-bbb','gps',true,'date',d,
      'miles',4.2,'calc_method','derived-path','from_name','John Doe','to_name','Shop',
      'startedIso', to_char(a + interval '17 hours','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'endedIso',   to_char(a + interval '17 hours 12 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'mins',12)), false);
  if (res->>'miles')::int <> 1 then
    raise exception 'a non-sweeping derive reported % legs written, expected 1: %', res->>'miles', res;
  end if;
  select count(*) into n from td_mileage where id = 'j-test-bbb' and user_id = u and deleted_at is null;
  if n <> 1 then
    raise exception 'a non-sweeping derive failed to add a leg that had no row: % rows', n;
  end if;

  -- ── 3. The phone, which CAN see the whole day, still rewrites it ─────────
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', u), false);
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, leg, true);
  if coalesce((res->>'locked')::boolean, false) then
    raise exception 'the sweeping call was locked: %', res;
  end if;
  select (data->>'miles')::numeric, data->>'calc_method' into got, method
    from td_mileage where id = 'j-test-aaa' and user_id = u;
  if got is distinct from 2.9 or method is distinct from 'derived-path' then
    raise exception 'a sweeping derive failed to rewrite the leg it owns: % / %', got, method;
  end if;

  -- ── 4. And a sweep still retires what it did not find ────────────────────
  select count(*) into n from td_mileage
    where id = 'j-test-bbb' and user_id = u and deleted_at is null;
  if n <> 0 then
    raise exception 'the sweep left a leg it did not derive: % rows', n;
  end if;

  delete from td_mileage where user_id = u;
  raise notice 'geo_replace_day: a partial derive adds legs and never shortens one';
end $$;
