\set ON_ERROR_STOP on
-- ── A leg written at the crossing is a draft (20261065) ─────────────────────
--
-- Owner 2026-10-02: "it all needs to be at 100 percent in 10 seconds." The
-- server now writes a mileage leg the moment the fence is crossed, marked
-- provisional, instead of four minutes later. The partial-derive rule that
-- protects road miles must let the settled derive replace it, must let a
-- drive that kept going replace it, and must keep protecting every leg that
-- is not marked. Each step is one derive, in order.

do $$
declare
  u uuid := '33333333-3333-4333-8333-333333333333';
  d text := (current_date - 1)::text;
  a timestamptz := (current_date - 1)::timestamptz;
  b timestamptz := (current_date)::timestamptz;
  s text := to_char(a + interval '13 hours','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  e1 text := to_char(a + interval '13 hours 9 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  e2 text := to_char(a + interval '13 hours 21 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"');
  res jsonb;
  r record;
begin
  insert into auth.users (id, email) values (u, 'ci-provisional@example.test') on conflict (id) do nothing;
  delete from td_mileage where user_id = u;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);

  -- 1. The crossing: a draft leg lands at once.
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, jsonb_build_array(jsonb_build_object(
    'id','j-pv','date',d,'from','Shop','to','2950 SW McClure Rd','to_name','John Doe','miles',3.1,
    'provisional',true,'startedIso',s,'endedIso',e1)), false);
  if coalesce((res->>'locked')::boolean, false) then raise exception 'day locked, nothing below proves anything: %', res; end if;
  select data into r from td_mileage where id = 'j-pv' and user_id = u;
  if (r.data->>'provisional') is distinct from 'true' then raise exception 'the draft was not written: %', r.data; end if;

  -- A person sets a vehicle on it while it is still a draft.
  update td_mileage set data = data || '{"vehicle":"2013 Ford F150"}'::jsonb where id = 'j-pv' and user_id = u;

  -- 2. He drove on: the same journey now ends somewhere else, still a draft.
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, jsonb_build_array(jsonb_build_object(
    'id','j-pv','date',d,'from','Shop','to','3313 NW Topeka Blvd','to_name','Bill Lorson','miles',5.6,
    'provisional',true,'startedIso',s,'endedIso',e2)), false);
  select data into r from td_mileage where id = 'j-pv' and user_id = u;
  if (r.data->>'to_name') is distinct from 'Bill Lorson' or (r.data->>'endedIso') is distinct from e2 then
    raise exception 'a draft did not take the later draft: %', r.data;
  end if;

  -- 3. Gate 4: the settled leg replaces the draft and the mark goes.
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, jsonb_build_array(jsonb_build_object(
    'id','j-pv','date',d,'from','Shop','to','3313 NW Topeka Blvd','to_name','Bill Lorson','miles',5.7,
    'startedIso',s,'endedIso',e2)), false);
  select data into r from td_mileage where id = 'j-pv' and user_id = u;
  if r.data ? 'provisional' or (r.data->>'miles') is distinct from '5.7' then
    raise exception 'the settled derive did not replace the draft: %', r.data;
  end if;
  if (r.data->>'vehicle') is distinct from '2013 Ford F150' then
    raise exception 'what the person set did not ride across: %', r.data;
  end if;

  -- 4. Settled is settled: a later partial derive, draft or not, leaves it.
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, jsonb_build_array(jsonb_build_object(
    'id','j-pv','date',d,'from','Shop','to','','miles',1.0,'provisional',true,'startedIso',s,'endedIso',e1)), false);
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, jsonb_build_array(jsonb_build_object(
    'id','j-pv','date',d,'from','Shop','to','3313 NW Topeka Blvd','miles',5.1,'startedIso',s,'endedIso',e2)), false);
  select data into r from td_mileage where id = 'j-pv' and user_id = u;
  if r.data ? 'provisional' or (r.data->>'miles') is distinct from '5.7' then
    raise exception 'a partial derive rewrote a settled leg: %', r.data;
  end if;

  delete from td_mileage where user_id = u;
  raise notice 'provisional leg: all four cases hold';
end $$;
