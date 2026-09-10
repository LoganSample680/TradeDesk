-- ════════════════════════════════════════════════════════════════════════
-- geo_replace_day, revision 3: THE CLOCK BRACKETS, THE TAPE FILLS.
--
-- Owner 2026-09-04: "look at the clock in as the trigger for the ones who
-- dont have automatic fences and addresses saved, from there we know what
-- was between clock in and out, everything in between still comes over
-- with the new way we want it ... we need to merge manual and automatic
-- and it fits."
--
-- What was wrong. Revision 2 collected every human row on the day into
-- `pres` and then DROPPED any derived row that overlapped one of them. It
-- was written for "somebody corrected one visit's clock, do not undo it",
-- and that intent is right. But a correction is a fact about ONE ROW, and
-- this made it a veto over the whole window it happened to span.
--
-- Jack's 3 September is what it costs. He opened an automatic row and used
-- Fix clock times to set 7:45am to 4:45pm, because that was the only edit
-- surface in front of him. The row was a home-office 'place' row (rule 12
-- means today's deriver would never write it at all), so it claims he sat
-- at his own house for nine hours. Sixteen of the seventeen rows his tape
-- produces that day, every drive, the shop time and every unsaved stop,
-- were thrown away because they overlapped it.
--
-- What changes, and it is one idea: a human row keeps its own times and
-- stops deleting anything else. The derived rows land alongside it. Where
-- a person corrected the times of a row the deriver still produces, those
-- times ride across onto the same row, exactly the way step 6 already
-- carries a hand-set vehicle and purpose across a re-derived mileage leg.
--
-- Additive per CLAUDE.md 3.1: same signature, same keys, same tables. Two
-- behaviours change and both only ever ADD rows a device would have
-- dropped. `dropped_for_human_rows` stays in the result for callers that
-- read it; it is now always 0.
-- ════════════════════════════════════════════════════════════════════════

-- The mark that replaces the 'fixed-' key rename (js/timelog.js
-- _saveFixedAutoEntry). Renaming client_key to 'fixed-<uuid>' severed the
-- row from the derived row it corrected, so a rebuild could never find it
-- again and had to protect it by span instead. The row keeps its key now
-- and carries this stamp, which is what lets the times ride across.
alter table job_time_entries add column if not exists fixed_at timestamptz;
alter table shop_time_entries add column if not exists fixed_at timestamptz;

create or replace function geo_replace_day(
  p_contractor uuid,
  p_employee   uuid,
  p_day        text,
  p_day_start  timestamptz,
  p_day_end    timestamptz,
  p_time       jsonb default '[]'::jsonb,
  p_shop       jsonb default '[]'::jsonb,
  p_miles      jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  me         uuid := (auth.uid()::text)::uuid;   -- the cast convention every RPC here follows
  r          jsonb;
  sp         tstzrange;
  keys_t     text[] := '{}';
  keys_s     text[] := '{}';
  keys_m     text[] := '{}';
  n_pairs    int;
  n_time     int := 0;
  n_shop     int := 0;
  n_miles    int := 0;
  n_del_t    int := 0;
  n_del_s    int := 0;
  n_del_m    int := 0;
  old_data   jsonb;
  new_data   jsonb;
  keep       jsonb;
  fx_a       timestamptz;
  fx_b       timestamptz;
begin
  if me is null then
    raise exception 'geo_replace_day: not signed in';
  end if;
  if p_employee is null or p_contractor is null then
    raise exception 'geo_replace_day: employee and contractor required';
  end if;
  -- A phone derives its own person's day; the account owner may rebuild a
  -- crew member's. Nobody else.
  if me <> p_employee and me <> p_contractor then
    raise exception 'geo_replace_day: not your day';
  end if;
  if p_day_start is null or p_day_end is null or p_day_end <= p_day_start then
    raise exception 'geo_replace_day: bad day window';
  end if;

  -- 1. THE INVARIANT, unchanged. No two incoming rows may overlap, across
  --    both tables. This is about the DERIVED set being internally sound
  --    and has nothing to do with human rows.
  with x as (
    select coalesce(e->>'client_key','') k,
           tstzrange((e->>'arrived_at')::timestamptz, (e->>'departed_at')::timestamptz, '[)') s
    from jsonb_array_elements(coalesce(p_time,'[]'::jsonb) || coalesce(p_shop,'[]'::jsonb)) e
  )
  select count(*) into n_pairs from x a join x b on a.k < b.k and a.s && b.s;
  if n_pairs > 0 then
    raise exception 'geo_replace_day: % overlapping pair(s) in the derived set', n_pairs;
  end if;

  -- 2. (was: collect human rows to veto by span. Deleted, not disabled: the
  --    veto is the thing this revision exists to remove.)

  -- 3. Time rows (jobs, clients, places, drives).
  for r in select * from jsonb_array_elements(coalesce(p_time,'[]'::jsonb)) loop
    sp := tstzrange((r->>'arrived_at')::timestamptz, (r->>'departed_at')::timestamptz, '[)');
    if isempty(sp) or (r->>'client_key') is null then continue; end if;
    -- A CORRECTION RIDES ACROSS. If this exact row was hand-corrected, the
    -- person's times win and everything else about the row is refreshed
    -- from the evidence. Same shape as the mileage carry-across in step 6.
    fx_a := null; fx_b := null;
    select arrived_at, departed_at into fx_a, fx_b
      from job_time_entries
      where contractor_user_id = p_contractor and client_key = r->>'client_key'
        and fixed_at is not null and deleted_at is null;
    if fx_a is not null and fx_b is not null and fx_b > fx_a then
      sp := tstzrange(fx_a, fx_b, '[)');
    end if;
    insert into job_time_entries
      (contractor_user_id, employee_user_id, job_id, arrived_at, departed_at, minutes,
       source, client_key, dest_place, deleted_at)
    values
      (p_contractor, p_employee, nullif(r->>'job_id',''), lower(sp), upper(sp),
       coalesce((r->>'minutes')::numeric, extract(epoch from (upper(sp)-lower(sp)))/60),
       coalesce(r->>'source','geofence'), r->>'client_key', r->>'dest_place', null)
    on conflict (contractor_user_id, client_key) where client_key is not null
    do update set
      employee_user_id = excluded.employee_user_id,
      job_id      = excluded.job_id,
      arrived_at  = excluded.arrived_at,
      departed_at = excluded.departed_at,
      minutes     = case when job_time_entries.fixed_at is not null
                         then extract(epoch from (excluded.departed_at - excluded.arrived_at))/60
                         else excluded.minutes end,
      source      = excluded.source,
      dest_place  = excluded.dest_place,
      deleted_at  = null;
    keys_t := keys_t || (r->>'client_key');
    n_time := n_time + 1;
  end loop;

  -- 4. Shop rows.
  for r in select * from jsonb_array_elements(coalesce(p_shop,'[]'::jsonb)) loop
    sp := tstzrange((r->>'arrived_at')::timestamptz, (r->>'departed_at')::timestamptz, '[)');
    if isempty(sp) or (r->>'client_key') is null then continue; end if;
    fx_a := null; fx_b := null;
    select arrived_at, departed_at into fx_a, fx_b
      from shop_time_entries
      where contractor_user_id = p_contractor and client_key = r->>'client_key'
        and fixed_at is not null and deleted_at is null;
    if fx_a is not null and fx_b is not null and fx_b > fx_a then
      sp := tstzrange(fx_a, fx_b, '[)');
    end if;
    insert into shop_time_entries
      (contractor_user_id, employee_user_id, arrived_at, departed_at, minutes, client_key, deleted_at)
    values
      (p_contractor, p_employee, lower(sp), upper(sp),
       coalesce((r->>'minutes')::numeric, extract(epoch from (upper(sp)-lower(sp)))/60),
       r->>'client_key', null)
    on conflict (contractor_user_id, client_key) where client_key is not null
    do update set
      employee_user_id = excluded.employee_user_id,
      arrived_at  = excluded.arrived_at,
      departed_at = excluded.departed_at,
      minutes     = case when shop_time_entries.fixed_at is not null
                         then extract(epoch from (excluded.departed_at - excluded.arrived_at))/60
                         else excluded.minutes end,
      deleted_at  = null;
    keys_s := keys_s || (r->>'client_key');
    n_shop := n_shop + 1;
  end loop;

  -- 5. Everything else automatic in the window goes. Soft, so it can be
  --    looked at, never dropped from the table. A manual row, a legacy
  --    'fixed-' row and a row carrying fixed_at all survive: what a person
  --    wrote or corrected is never retired by a rebuild.
  update job_time_entries set deleted_at = now()
  where employee_user_id = p_employee and deleted_at is null
    and arrived_at >= p_day_start and arrived_at < p_day_end
    and not (source = 'manual' or client_key like 'fixed-%' or fixed_at is not null)
    and (client_key is null or not (client_key = any(keys_t)));
  get diagnostics n_del_t = row_count;

  update shop_time_entries set deleted_at = now()
  where employee_user_id = p_employee and deleted_at is null
    and arrived_at >= p_day_start and arrived_at < p_day_end
    and not (client_key like 'fixed-%' or fixed_at is not null)
    and (client_key is null or not (client_key = any(keys_s)));
  get diagnostics n_del_s = row_count;

  -- 6. Mileage. A GPS leg is the drive segment's own record: same id as the
  --    drive row's key. What a person set on the old copy rides across.
  for r in select * from jsonb_array_elements(coalesce(p_miles,'[]'::jsonb)) loop
    if (r->>'id') is null then continue; end if;
    select data into old_data from td_mileage
      where id = r->>'id' and user_id = p_employee;
    -- A TOMBSTONE CANNOT COME BACK BY UPDATE (2026-09-02, the owner's four
    -- trips). td_mileage carries prevent_undeletion, a BEFORE UPDATE trigger
    -- that returns OLD for any soft-deleted row, so the upsert below was
    -- silently discarded whenever a leg had been retired once: same journey
    -- id every rebuild, same wall every time. The trigger still guards
    -- hand-typed trips against a stale cache; a derived leg is owned by this
    -- function alone, so its tombstone is cleared and the leg inserted fresh.
    -- What a person set on it was read above and rides across.
    delete from td_mileage
      where id = r->>'id' and user_id = p_employee and deleted_at is not null;
    keep := '{}'::jsonb;
    if old_data is not null then
      keep := jsonb_strip_nulls(jsonb_build_object(
        'vehicle',   old_data->'vehicle',
        'vehicleId', old_data->'vehicleId',
        'purpose',   old_data->'purpose',
        'notes',     old_data->'notes',
        'receiptId', old_data->'receiptId',
        'deductible',old_data->'deductible'));
    end if;
    new_data := (r || keep) || jsonb_build_object('gps', true, 'legKey', r->>'id');
    insert into td_mileage (id, user_id, data, deleted_at)
    values (r->>'id', p_employee, new_data, null)
    on conflict (id, user_id) do update set data = excluded.data, deleted_at = null;
    keys_m := keys_m || (r->>'id');
    n_miles := n_miles + 1;
  end loop;

  update td_mileage set deleted_at = now()
  where user_id = p_employee and deleted_at is null
    and data->>'gps' = 'true' and data->>'date' = p_day
    and not (id = any(keys_m));
  get diagnostics n_del_m = row_count;

  return jsonb_build_object(
    'day', p_day,
    'time', n_time, 'shop', n_shop, 'miles', n_miles,
    -- Kept in the shape callers already read. Always 0 now: nothing is
    -- dropped for a human row any more, which is the point of revision 3.
    'dropped_for_human_rows', 0,
    'retired', jsonb_build_object('time', n_del_t, 'shop', n_del_s, 'miles', n_del_m));
end $$;

grant execute on function geo_replace_day(uuid, uuid, text, timestamptz, timestamptz, jsonb, jsonb, jsonb) to authenticated;
