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

\set uid '11111111-1111-4111-8111-111111111111'
\set day '2026-06-15'

do $$
declare
  u uuid := '11111111-1111-4111-8111-111111111111';
  d text := '2026-06-15';
  a timestamptz := '2026-06-15T12:00:00Z';
  b timestamptz := '2026-06-16T12:00:00Z';
  leg jsonb;
  got numeric;
  method text;
  n int;
begin
  delete from td_mileage where user_id = u;

  -- The phone's row: a router answered, so this is the good number.
  insert into td_mileage (id, user_id, data, deleted_at) values (
    'j-test-aaa', u,
    jsonb_build_object('id','j-test-aaa','legKey','j-test-aaa','gps',true,'date',d,
                       'miles',3.1,'calc_method','derived-routed','routeMiles',3.1,
                       'from_name','Shop','to_name','John Doe',
                       'startedIso','2026-06-15T13:00:00Z','endedIso','2026-06-15T13:10:00Z','mins',10),
    null);

  -- A server derive of the same leg: thinner fixes, no router, 2.9.
  leg := jsonb_build_array(jsonb_build_object(
    'id','j-test-aaa','legKey','j-test-aaa','gps',true,'date',d,
    'miles',2.9,'calc_method','derived-path',
    'from_name','Shop','to_name','John Doe',
    'startedIso','2026-06-15T13:00:00Z','endedIso','2026-06-15T13:10:00Z','mins',10));

  -- ── 1. The service role may call it at all (20261001) ────────────────────
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  perform geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, leg, false);

  select (data->>'miles')::numeric, data->>'calc_method' into got, method
    from td_mileage where id = 'j-test-aaa' and user_id = u;
  if got is distinct from 3.1 or method is distinct from 'derived-routed' then
    raise exception 'a non-sweeping derive rewrote an existing leg: % / %', got, method;
  end if;

  -- ── 2. A leg nobody has a row for is still added ─────────────────────────
  perform geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'id','j-test-bbb','legKey','j-test-bbb','gps',true,'date',d,
      'miles',4.2,'calc_method','derived-path','from_name','John Doe','to_name','Shop',
      'startedIso','2026-06-15T17:00:00Z','endedIso','2026-06-15T17:12:00Z','mins',12)), false);
  select count(*) into n from td_mileage where id = 'j-test-bbb' and user_id = u and deleted_at is null;
  if n <> 1 then
    raise exception 'a non-sweeping derive failed to add a leg that had no row: % rows', n;
  end if;

  -- ── 3. The phone, which CAN see the whole day, still rewrites it ─────────
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', u), false);
  perform geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, leg, true);
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
