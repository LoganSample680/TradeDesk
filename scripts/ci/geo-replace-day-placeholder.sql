\set ON_ERROR_STOP on
-- ── A leg that never knew where it was going may be re-described ────────────
--
-- Jack, 2026-09-29: a derive that ran mid-trip wrote his drive as ending at an
-- unsaved stop (traced, addressUnknown), and the partial-derive rule then
-- refused every later derive that resolved the same journey to Bill Lorson.
-- 20261056 lets a resolved leg replace that placeholder, and nothing else.
-- Each step below is Jack's morning in order; the road-miles guard the rule
-- exists for is proved again at the end.

do $$
declare
  u uuid := '22222222-2222-4222-8222-222222222222';
  d text := (current_date - 1)::text;
  a timestamptz := (current_date - 1)::timestamptz;
  b timestamptz := (current_date)::timestamptz;
  s text := to_char(a + interval '15 hours 3 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  res jsonb;
  r record;
begin
  insert into auth.users (id, email) values (u, 'ci-placeholder@example.test') on conflict (id) do nothing;
  delete from td_mileage where user_id = u;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);

  -- 1. Mid-trip: the chain ends at the 10:14 stop. A placeholder is written.
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, jsonb_build_array(jsonb_build_object(
    'id','j-ph','date',d,'from','Shop','to','','to_name','','miles',2.9,'traced',true,
    'addressUnknown',true,'unsavedTo',true,'startedIso',s)), false);
  if coalesce((res->>'locked')::boolean, false) then raise exception 'day locked, nothing below proves anything: %', res; end if;
  select data into r from td_mileage where id = 'j-ph' and user_id = u;
  if (r.data->>'addressUnknown') is distinct from 'true' then raise exception 'the placeholder was not written: %', r.data; end if;

  -- A person sets a purpose and a vehicle on it.
  update td_mileage set data = data || '{"purpose":"Business","vehicle":"2013 Ford F150"}'::jsonb
   where id = 'j-ph' and user_id = u;

  -- 2. Arrived at Bill's: the same journey, both ends known. It replaces the placeholder.
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, jsonb_build_array(jsonb_build_object(
    'id','j-ph','date',d,'from','Shop','to','3313 NW Topeka Blvd','to_name','Bill Lorson','miles',5.6,'startedIso',s)), false);
  select data into r from td_mileage where id = 'j-ph' and user_id = u;
  if r.data ? 'addressUnknown' or (r.data->>'to_name') is distinct from 'Bill Lorson' then
    raise exception 'a resolved derive did not replace the placeholder: %', r.data;
  end if;
  if (r.data->>'purpose') is distinct from 'Business' or (r.data->>'vehicle') is distinct from '2013 Ford F150' then
    raise exception 'what the person set did not ride across: %', r.data;
  end if;

  -- The phone routes it.
  update td_mileage set data = data || '{"miles":8.9,"routeMiles":8.9,"calc_method":"derived-routed"}'::jsonb
   where id = 'j-ph' and user_id = u;

  -- 3. A thinner server sum of the resolved leg never overwrites the road miles.
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, jsonb_build_array(jsonb_build_object(
    'id','j-ph','date',d,'from','Shop','to','3313 NW Topeka Blvd','to_name','Bill Lorson','miles',5.1,'startedIso',s)), false);
  select data into r from td_mileage where id = 'j-ph' and user_id = u;
  if (r.data->>'miles') is distinct from '8.9' then raise exception 'road miles were overwritten: %', r.data; end if;

  -- 4. A resolved leg is never turned back into a placeholder by a partial derive.
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, jsonb_build_array(jsonb_build_object(
    'id','j-ph','date',d,'from','Shop','to','','miles',2.0,'traced',true,'addressUnknown',true,'unsavedTo',true,'startedIso',s)), false);
  select data into r from td_mileage where id = 'j-ph' and user_id = u;
  if r.data ? 'addressUnknown' or (r.data->>'miles') is distinct from '8.9' then
    raise exception 'a placeholder undid a resolved leg: %', r.data;
  end if;

  -- 5. A placeholder facing another placeholder stays exactly as it is.
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, jsonb_build_array(jsonb_build_object(
    'id','j-ph2','date',d,'from','Shop','to','','miles',1.0,'traced',true,'addressUnknown',true,'unsavedTo',true,'startedIso',s)), false);
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, jsonb_build_array(jsonb_build_object(
    'id','j-ph2','date',d,'from','Shop','to','','miles',1.4,'traced',true,'addressUnknown',true,'unsavedTo',true,'startedIso',s)), false);
  select data into r from td_mileage where id = 'j-ph2' and user_id = u;
  if (r.data->>'miles') is distinct from '1.0' then raise exception 'a placeholder rewrote a placeholder: %', r.data; end if;

  delete from td_mileage where user_id = u;
  raise notice 'placeholder leg: all five cases hold';
end $$;
