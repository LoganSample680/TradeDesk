-- geo_replace_day, revision 6: a person's answer to a held visit outranks
-- the re-guess. Plus geo_answer_visit, the one door that answers one.
--
-- Rule 13 (js/geo-derive.js, owner 2026-09-04/05): a stop at a customer's
-- address the day cannot vouch for (nothing scheduled there, no clock
-- running, outside working hours) is written 'client-held': on the rail as
-- a question, in no total, asked on the Home screen. Working -> 'client',
-- Personal -> 'dismissed'. Either answer sets fixed_at, and step 3 below
-- keeps the answered source across every rebuild after that, exactly as it
-- already keeps hand-set times. Body otherwise identical to revision 5.

create or replace function geo_replace_day(
  p_contractor uuid,
  p_employee   uuid,
  p_day        text,
  p_day_start  timestamptz,
  p_day_end    timestamptz,
  p_time       jsonb default '[]'::jsonb,
  p_shop       jsonb default '[]'::jsonb,
  p_miles      jsonb default '[]'::jsonb,
  p_sweep      boolean default true
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

  -- 0. THE PAST IS READ-ONLY (owner 2026-09-04: "cant risk data going away
  --    ever ... contractors dont want to do this shit and would rather have
  --    fucked up books then fix it"). Nobody approves a time card in a
  --    two-truck shop, so the lock has to be automatic and it has to live
  --    here, where no phone, iPad or laptop can get around it. A day whose
  --    window closed more than fourteen days ago is not the deriver's to
  --    touch, whatever it thinks it knows now. Fourteen, not seven: the
  --    phone's own version-bump rebuild reaches seven days back and has to
  --    be able to land on its last day. A hand edit never comes through
  --    here, so a person can still correct a locked row.
  --    Answered quietly rather than raised: the phone's queue drops a
  --    refusal and the person sees an error line for a day it was never
  --    going to change.
  if p_day_end < now() - interval '14 days' then
    return jsonb_build_object(
      'day', p_day, 'locked', true,
      'time', 0, 'shop', 0, 'miles', 0, 'dropped_for_human_rows', 0,
      'retired', jsonb_build_object('time', 0, 'shop', 0, 'miles', 0));
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
      -- A PERSON'S ANSWER OUTRANKS THE RE-GUESS (rule 13, js/geo-derive.js).
      -- The deriver re-emits a held visit as 'client-held' on every rebuild;
      -- once somebody answered it (fixed_at set by geo_answer_visit, or by
      -- a hand edit) the source they chose stays, the same way their times
      -- already do. A row nobody touched still takes the deriver's word.
      source      = case when job_time_entries.fixed_at is not null
                         then job_time_entries.source else excluded.source end,
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
  --    NO TAPE, NO SWEEP (owner 2026-09-04). A derive that ran without the
  --    phone's own motion history for this day, a laptop, a new phone, a
  --    shared iPad before this person's claim on it, may add what it can
  --    prove from the app log but may never retire a row it cannot see the
  --    evidence for. The phone says which kind of derive this was.
  if p_sweep then
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
  end if;

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
        'deductible',old_data->'deductible',
        -- THE RECEIPT ANSWER RIDES ACROSS (owner 2026-09-05). A held supply
        -- run answered on the card must not come back held on the next
        -- rebuild. The three answers are positive marks; any of them present
        -- means the hold the deriver just set is dropped below.
        'noReceipt',        old_data->'noReceipt',
        'receiptExpenseId', old_data->'receiptExpenseId',
        'personal',         old_data->'personal'));
    end if;
    new_data := (r || keep) || jsonb_build_object('gps', true, 'legKey', r->>'id');
    if (new_data->>'noReceipt') = 'true' or (new_data->>'personal') = 'true'
       or new_data ? 'receiptExpenseId' then
      new_data := new_data - 'pendingReceipt';
    end if;
    insert into td_mileage (id, user_id, data, deleted_at)
    values (r->>'id', p_employee, new_data, null)
    on conflict (id, user_id) do update set data = excluded.data, deleted_at = null;
    keys_m := keys_m || (r->>'id');
    n_miles := n_miles + 1;
  end loop;

  if p_sweep then
    update td_mileage set deleted_at = now()
    where user_id = p_employee and deleted_at is null
      and data->>'gps' = 'true' and data->>'date' = p_day
      and not (id = any(keys_m));
    get diagnostics n_del_m = row_count;
  end if;

  return jsonb_build_object(
    'day', p_day,
    'time', n_time, 'shop', n_shop, 'miles', n_miles,
    -- Kept in the shape callers already read. Always 0 now: nothing is
    -- dropped for a human row any more, which is the point of revision 3.
    'dropped_for_human_rows', 0,
    'retired', jsonb_build_object('time', n_del_t, 'shop', n_del_s, 'miles', n_del_m));
end $$;

grant execute on function geo_replace_day(uuid, uuid, text, timestamptz, timestamptz, jsonb, jsonb, jsonb, boolean) to authenticated;

-- The one door that answers a held visit. Security definer because a crew
-- member answers their OWN visit from their own phone, and the table's
-- employee policies were written for inserts; the check here is the same
-- one geo_replace_day makes: the row's own person, or the account.
create or replace function geo_answer_visit(p_id uuid, p_mode text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  me   uuid := (auth.uid()::text)::uuid;
  row  job_time_entries%rowtype;
  src  text;
begin
  if me is null then raise exception 'geo_answer_visit: not signed in'; end if;
  select * into row from job_time_entries where id = p_id and deleted_at is null;
  if row.id is null then raise exception 'geo_answer_visit: no such visit'; end if;
  if me <> row.employee_user_id and me <> row.contractor_user_id then
    raise exception 'geo_answer_visit: not your visit';
  end if;
  if row.source not in ('client-held', 'client', 'dismissed') then
    raise exception 'geo_answer_visit: not a held visit';
  end if;
  src := case p_mode when 'working' then 'client' when 'personal' then 'dismissed' else null end;
  if src is null then raise exception 'geo_answer_visit: mode must be working or personal'; end if;
  update job_time_entries set source = src, fixed_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'source', src);
end $$;

grant execute on function geo_answer_visit(uuid, text) to authenticated;
