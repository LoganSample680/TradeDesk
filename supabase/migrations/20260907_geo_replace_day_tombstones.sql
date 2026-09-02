-- ════════════════════════════════════════════════════════════════════════
-- geo_replace_day, revision 2: a re-derived leg replaces its own tombstone.
--
-- Same function as 20260906_geo_replace_day.sql with one change in step 6,
-- marked inline. Additive per CLAUDE.md 3.1: same signature, same rows,
-- same keys; only a soft-deleted derived leg now comes back when the day
-- is derived again, instead of staying dead behind prevent_undeletion.
-- ════════════════════════════════════════════════════════════════════════

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
  pres       tstzrange[];
  keys_t     text[] := '{}';
  keys_s     text[] := '{}';
  keys_m     text[] := '{}';
  n_pairs    int;
  n_time     int := 0;
  n_shop     int := 0;
  n_miles    int := 0;
  n_dropped  int := 0;
  n_del_t    int := 0;
  n_del_s    int := 0;
  n_del_m    int := 0;
  old_data   jsonb;
  new_data   jsonb;
  keep       jsonb;
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

  -- 1. THE INVARIANT. No two incoming rows may overlap, across both tables.
  with x as (
    select coalesce(e->>'client_key','') k,
           tstzrange((e->>'arrived_at')::timestamptz, (e->>'departed_at')::timestamptz, '[)') s
    from jsonb_array_elements(coalesce(p_time,'[]'::jsonb) || coalesce(p_shop,'[]'::jsonb)) e
  )
  select count(*) into n_pairs from x a join x b on a.k < b.k and a.s && b.s;
  if n_pairs > 0 then
    raise exception 'geo_replace_day: % overlapping pair(s) in the derived set', n_pairs;
  end if;

  -- 2. What a person wrote or corrected stands. Collected once.
  select coalesce(array_agg(tstzrange(arrived_at, departed_at, '[)')), '{}')
    into pres
  from job_time_entries
  where employee_user_id = p_employee and deleted_at is null
    and arrived_at >= p_day_start and arrived_at < p_day_end
    and (source = 'manual' or client_key like 'fixed-%');

  -- 3. Time rows (jobs, clients, places, drives).
  for r in select * from jsonb_array_elements(coalesce(p_time,'[]'::jsonb)) loop
    sp := tstzrange((r->>'arrived_at')::timestamptz, (r->>'departed_at')::timestamptz, '[)');
    if isempty(sp) or (r->>'client_key') is null then continue; end if;
    if exists (select 1 from unnest(pres) p where p && sp) then
      n_dropped := n_dropped + 1; continue;
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
      minutes     = excluded.minutes,
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
    if exists (select 1 from unnest(pres) p where p && sp) then
      n_dropped := n_dropped + 1; continue;
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
      minutes     = excluded.minutes,
      deleted_at  = null;
    keys_s := keys_s || (r->>'client_key');
    n_shop := n_shop + 1;
  end loop;

  -- 5. Everything else automatic in the window goes. Soft, so it can be
  --    looked at, never dropped from the table.
  update job_time_entries set deleted_at = now()
  where employee_user_id = p_employee and deleted_at is null
    and arrived_at >= p_day_start and arrived_at < p_day_end
    and not (source = 'manual' or client_key like 'fixed-%')
    and (client_key is null or not (client_key = any(keys_t)));
  get diagnostics n_del_t = row_count;

  update shop_time_entries set deleted_at = now()
  where employee_user_id = p_employee and deleted_at is null
    and arrived_at >= p_day_start and arrived_at < p_day_end
    and not (client_key like 'fixed-%')
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
    'dropped_for_human_rows', n_dropped,
    'retired', jsonb_build_object('time', n_del_t, 'shop', n_del_s, 'miles', n_del_m));
end $$;

grant execute on function geo_replace_day(uuid, uuid, text, timestamptz, timestamptz, jsonb, jsonb, jsonb) to authenticated;
