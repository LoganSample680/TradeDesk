-- ── A newer answer retires the older one it contradicts (owner 2026-09-23) ──
--
-- "the app had double counted time and was all fucked up."
--
-- An automatic derive (ingest-geo, on every batch that lands) may add rows but
-- never retire them: only a Rebuild passes p_sweep. That is right for rows it
-- cannot see the evidence for, and wrong for rows it has just re-described.
-- When late CoreMotion moves the flip a drive began on, the drive's key
-- changes, so the same drive, visit and arrival come back as NEW rows beside
-- the old ones and the day counts twice until somebody presses Rebuild.
--
-- Steps 5b and 6b retire an older automatic row, in any of the three tables,
-- whose span a row written in THIS call overlaps under a different key. Only
-- inside the spans actually written; never a manual, fixed or answered row;
-- never a mileage leg carrying a person's answer. Same signature, so every
-- caller picks it up unchanged, and the result gains a 'superseded' count.

create or replace function geo_replace_day(
  p_contractor uuid,
  p_employee   uuid,
  p_day        text,
  p_day_start  timestamptz,
  p_day_end    timestamptz,
  p_time       jsonb default '[]'::jsonb,
  p_shop       jsonb default '[]'::jsonb,
  p_miles      jsonb default '[]'::jsonb,
  p_sweep      boolean default true,
  -- The instant past which this derive has no answer yet. Null = the whole
  -- day, which is the normal case and every caller that is not mid-drive.
  p_sweep_until timestamptz default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  -- The signed-in caller, or, when there is none, the employee this call is
  -- FOR, but only for a caller holding the service role. See the guard below.
  me         uuid := (auth.uid()::text)::uuid;
  svc        boolean := coalesce(
                 nullif(current_setting('request.jwt.claim.role', true), ''),
                 (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
                 '') = 'service_role';
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
  n_sup_t    int := 0;
  n_sup_s    int := 0;
  n_sup_m    int := 0;
  old_data   jsonb;
  new_data   jsonb;
  keep       jsonb;
  fx_a       timestamptz;
  fx_b       timestamptz;
begin
  -- ── THE SERVER DERIVES TOO NOW (owner 2026-09-11) ──────────────────────
  -- ingest-geo runs the real deriver on the events as they land, so a day
  -- gets its rows whether or not anybody has the app open. It calls this
  -- function with the service role, which has no auth.uid(), and until this
  -- arm existed every one of those calls came back 'not signed in'.
  --
  -- It still has to say WHOSE day it is writing, and that is checked below
  -- exactly as it is for a phone.
  if me is null and svc then
    me := p_employee;
  end if;
  if me is null then
    raise exception 'geo_replace_day: not signed in';
  end if;
  -- THE WRITER MAY TAKE BACK ITS OWN TOMBSTONE. prevent_undeletion() freezes a
  -- soft-deleted td_ row for good, which is right for a record a PERSON
  -- deleted and wrong for a mileage leg, which no person ever deleted: this
  -- function wrote it and this function retired it. Transaction-local, so it
  -- is on for exactly the rows below and nothing else.
  perform set_config('app.geo_rederive', 'on', true);
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
  -- ── AN OPEN ROW IS UNBOUNDED, SO IT CANNOT BE PAIRED (owner 2026-09-18) ──
  -- "arrivals on site, current time on site." A dwell with no departure yet is
  -- a row now, and its range runs to infinity, which overlaps every bounded
  -- row that starts after it. Pairing it against the others would refuse every
  -- day that ends with somebody still standing somewhere, which is most days.
  --
  -- So the invariant splits rather than loosens. The bounded rows are checked
  -- exactly as before, and the open row is checked against the only thing that
  -- can actually be wrong about it: there may be at most ONE, and it may not
  -- begin before a closed row ends. Anything else is a derive that has lost
  -- track of time, and it still raises.
  with x as (
    select coalesce(e->>'client_key','') k,
           (e->>'arrived_at')::timestamptz a,
           (e->>'departed_at')::timestamptz z
    from jsonb_array_elements(coalesce(p_time,'[]'::jsonb) || coalesce(p_shop,'[]'::jsonb)) e
  ),
  closed as (select k, tstzrange(a, z, '[)') s from x where z is not null),
  opens  as (select k, a from x where z is null)
  select (select count(*) from closed a join closed b on a.k < b.k and a.s && b.s)
       + greatest((select count(*) from opens) - 1, 0)
       + (select count(*) from opens o join closed c on c.s && tstzrange(o.a, null, '[)'))
    into n_pairs;
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
       source, client_key, dest_place, origin_place, deleted_at)
    values
      (p_contractor, p_employee, nullif(r->>'job_id',''), lower(sp), upper(sp),
       coalesce((r->>'minutes')::numeric, round(extract(epoch from (upper(sp)-lower(sp)))/60)),
       coalesce(r->>'source','geofence'), r->>'client_key', r->>'dest_place',
       r->>'origin_place', null)
    on conflict (contractor_user_id, client_key) where client_key is not null
    do update set
      employee_user_id = excluded.employee_user_id,
      job_id      = excluded.job_id,
      arrived_at  = excluded.arrived_at,
      -- A HAND-FIXED ROW IS NEVER RE-OPENED. The open row carries a null
      -- departure, and letting that land on a row somebody corrected by hand
      -- would erase their end time and their minutes in one write. The
      -- person's times already win below; this is the same rule said for the
      -- one shape that can now arrive empty.
      departed_at = case when job_time_entries.fixed_at is not null and excluded.departed_at is null
                         then job_time_entries.departed_at else excluded.departed_at end,
      minutes     = case when job_time_entries.fixed_at is not null and excluded.departed_at is null
                         then job_time_entries.minutes
                         when job_time_entries.fixed_at is not null
                         then round(extract(epoch from (excluded.departed_at - excluded.arrived_at))/60)
                         else excluded.minutes end,
      -- THE PERSON'S ANSWER WINS. Both of these are what a human told us
      -- about this stop, and a re-derive must not talk over them.
      source      = case when job_time_entries.fixed_at is not null
                          or job_time_entries.answered_at is not null
                         then job_time_entries.source else excluded.source end,
      dest_place  = case when job_time_entries.fixed_at is not null
                         then job_time_entries.dest_place else excluded.dest_place end,
      origin_place = case when job_time_entries.fixed_at is not null
                         then job_time_entries.origin_place else excluded.origin_place end,
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
       coalesce((r->>'minutes')::numeric, round(extract(epoch from (upper(sp)-lower(sp)))/60)),
       r->>'client_key', null)
    on conflict (contractor_user_id, client_key) where client_key is not null
    do update set
      employee_user_id = excluded.employee_user_id,
      arrived_at  = excluded.arrived_at,
      -- A HAND-FIXED ROW IS NEVER RE-OPENED. The open row carries a null
      -- departure, and letting that land on a row somebody corrected by hand
      -- would erase their end time and their minutes in one write. The
      -- person's times already win below; this is the same rule said for the
      -- one shape that can now arrive empty.
      departed_at = case when shop_time_entries.fixed_at is not null and excluded.departed_at is null
                         then shop_time_entries.departed_at else excluded.departed_at end,
      minutes     = case when shop_time_entries.fixed_at is not null and excluded.departed_at is null
                         then shop_time_entries.minutes
                         when shop_time_entries.fixed_at is not null
                         then round(extract(epoch from (excluded.departed_at - excluded.arrived_at))/60)
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
      and (p_sweep_until is null or arrived_at < p_sweep_until)
      and not (source = 'manual' or client_key like 'fixed-%'
               or fixed_at is not null or answered_at is not null)
      and (client_key is null or not (client_key = any(keys_t)));
    get diagnostics n_del_t = row_count;

    update shop_time_entries set deleted_at = now()
    where employee_user_id = p_employee and deleted_at is null
      and arrived_at >= p_day_start and arrived_at < p_day_end
      and (p_sweep_until is null or arrived_at < p_sweep_until)
      and not (client_key like 'fixed-%' or fixed_at is not null)
      and (client_key is null or not (client_key = any(keys_s)));
    get diagnostics n_del_s = row_count;
  end if;

  -- 5b. A ROW THIS WRITE CONTRADICTS IS RETIRED, SWEEP OR NOT (owner
  --     2026-09-23: "the app had double counted time and was all fucked up").
  --
  --     Jack's 23 September. His phone held two hours of CoreMotion and
  --     handed it over at 10:26, when he opened the app. The server derived
  --     the day again from the fuller tape, which moved the start of his
  --     first drive from 08:10:21 to 08:09:30, and a row's key is minted from
  --     the flip that began it. So the same drive, the same visit and the
  --     same arrival came back under new keys and were INSERTED beside the
  --     old ones. Ingest never passes p_sweep, so nothing retired the old
  --     copies: two drives to Treyton's, two 8:13 to 8:53 visits and two rows
  --     from 9:10, until somebody pressed Rebuild at 11:52.
  --
  --     p_sweep still means what it meant: "this caller saw the whole day and
  --     may retire what it did not find." That is not needed here. A row this
  --     call just wrote is itself the evidence: an older automatic row that
  --     occupies the same minutes under a different key is a previous answer
  --     to the same question, and this call has just given a newer one.
  --     Nothing outside the spans actually written is touched, which is
  --     exactly the boundary that keeps a partial derive safe.
  --
  --     What a person wrote or answered is never superseded, the same
  --     exclusions as the sweep. Across tables on purpose: a stop that was a
  --     client visit and is now shop time is still one stop.
  with fresh as (
    select tstzrange((e->>'arrived_at')::timestamptz, (e->>'departed_at')::timestamptz, '[)') s
    from jsonb_array_elements(coalesce(p_time,'[]'::jsonb) || coalesce(p_shop,'[]'::jsonb)) e
    where (e->>'client_key') is not null and (e->>'arrived_at') is not null
  )
  update job_time_entries t set deleted_at = now()
  where t.employee_user_id = p_employee and t.deleted_at is null
    and not (t.source = 'manual' or t.client_key like 'fixed-%'
             or t.fixed_at is not null or t.answered_at is not null)
    and (t.client_key is null or not (t.client_key = any(keys_t)))
    -- A malformed old row (an end before its start) cannot be a range, and
    -- building one would raise and throw away this whole write. Left alone.
    and t.arrived_at is not null
    and (t.departed_at is null or t.departed_at >= t.arrived_at)
    and exists (select 1 from fresh f where not isempty(f.s)
                  and f.s && tstzrange(t.arrived_at, t.departed_at, '[)'));
  get diagnostics n_sup_t = row_count;

  with fresh as (
    select tstzrange((e->>'arrived_at')::timestamptz, (e->>'departed_at')::timestamptz, '[)') s
    from jsonb_array_elements(coalesce(p_time,'[]'::jsonb) || coalesce(p_shop,'[]'::jsonb)) e
    where (e->>'client_key') is not null and (e->>'arrived_at') is not null
  )
  update shop_time_entries t set deleted_at = now()
  where t.employee_user_id = p_employee and t.deleted_at is null
    and not (t.client_key like 'fixed-%' or t.fixed_at is not null)
    and (t.client_key is null or not (t.client_key = any(keys_s)))
    and t.arrived_at is not null
    and (t.departed_at is null or t.departed_at >= t.arrived_at)
    and exists (select 1 from fresh f where not isempty(f.s)
                  and f.s && tstzrange(t.arrived_at, t.departed_at, '[)'));
  get diagnostics n_sup_s = row_count;

  -- 6. Mileage. A GPS leg is the drive segment's own record: same id as the
  --    drive row's key. What a person set on the old copy rides across.
  for r in select * from jsonb_array_elements(coalesce(p_miles,'[]'::jsonb)) loop
    if (r->>'id') is null then continue; end if;
    -- ── A PARTIAL DERIVE MAY ADD A LEG. IT MAY NOT REWRITE ONE ────────────
    --
    -- Measured live the hour this was written. The owner drove away from a
    -- client with the app force-closed; ingest-geo derived the day from the
    -- events as they landed, which is exactly what it is for, and wrote his
    -- morning leg down from 3.1 miles to 2.9.
    --
    -- Nothing was wrong with the derive. Road miles come from a router, and
    -- routing is device-only: MapKit first, then Valhalla and OSRM raced, all
    -- of them on the handset. Off the phone a leg can only ever sum its
    -- breadcrumbs, and the server's copy of those is thinner than the phone's.
    -- So the server's number is not a better answer arriving late, it is a
    -- worse answer by construction, and it had just overwritten the good one.
    --
    -- This is the one place the two sides genuinely differ, which is why the
    -- rule is here and narrow. p_sweep already means "this caller can see the
    -- whole day and may retire what it does not find"; only the phone ever
    -- passes it true. A caller that cannot say that may fill a leg nobody has
    -- a row for and must leave every existing one exactly as it is.
    --
    -- TIME ROWS ARE DELIBERATELY NOT COVERED. A stamp comes from the tape,
    -- and the tape now reaches the server whole, so both sides converge on
    -- the same evidence there and a server refine partway through a day is
    -- worth having. Miles are the only figure the server can never compute as
    -- well, no matter how complete its evidence gets.
    if not p_sweep and exists (
      select 1 from td_mileage m
       where m.id = r->>'id' and m.user_id = p_employee and m.deleted_at is null) then
      keys_m := keys_m || (r->>'id');
      continue;
    end if;
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
    -- ── RULE 15'S ANSWER RIDES ACROSS TOO (owner 2026-09-12) ─────────────
    -- A drive with no business end is held and asks (js/geo-derive.js
    -- _gdHeldLegs). The deriver re-sets that hold on every rebuild, because it
    -- is pure and cannot know what anybody answered, so without this the
    -- answer is wiped every time the day is derived again: exactly the bug the
    -- receipt hold hit on 2026-09-05 and the same fix.
    --
    -- Two answers end the question, and both are already preserved above.
    -- "Personal" is the same flag the receipt card sets. "It was work" is the
    -- person putting a PURPOSE on the row, which is the natural action on the
    -- mileage log and rides across in `keep`; the deriver only ever writes an
    -- empty purpose on a held leg, so a non-empty one can only have come from
    -- a person.
    if (new_data->>'personal') = 'true'
       or nullif(btrim(coalesce(new_data->>'purpose','')), '') is not null then
      new_data := new_data - 'pendingPurpose';
    end if;
    insert into td_mileage (id, user_id, data, deleted_at)
    values (r->>'id', p_employee, new_data, null)
    on conflict (id, user_id) do update set data = excluded.data, deleted_at = null;
    keys_m := keys_m || (r->>'id');
    n_miles := n_miles + 1;
  end loop;

  -- 6b. The same rule for a leg: an older automatic leg whose drive this
  --     call just re-described under a new id is retired. Only a leg with no
  --     person's answer on it, because that answer would go with it (the
  --     carry-across in step 6 is keyed by id, and the id is what changed);
  --     an answered leg stays until a Rebuild, visible, rather than losing
  --     what somebody told us.
  -- Every stamp goes through a CASE, not an AND: Postgres does not promise to
  -- test the pattern before it attempts the cast, and one legacy leg holding
  -- something that is not a timestamp would otherwise raise and lose the
  -- whole write.
  with fresh as (
    select tstzrange(a, z, '[)') s from (
      select case when (e->>'startedIso') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
                  then (e->>'startedIso')::timestamptz end a,
             case when (e->>'endedIso') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
                  then (e->>'endedIso')::timestamptz end z
      from jsonb_array_elements(coalesce(p_miles,'[]'::jsonb)) e
      where (e->>'id') is not null) x
    where a is not null and z is not null and z >= a
  ),
  old as (
    select m.id, a, z from (
      select m.id,
             case when (m.data->>'startedIso') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
                  then (m.data->>'startedIso')::timestamptz end a,
             case when (m.data->>'endedIso') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
                  then (m.data->>'endedIso')::timestamptz end z
      from td_mileage m
      where m.user_id = p_employee and m.deleted_at is null
        and m.data->>'gps' = 'true'
        and not (m.id = any(keys_m))
        and nullif(btrim(coalesce(m.data->>'purpose','')), '') is null
        and nullif(btrim(coalesce(m.data->>'notes','')), '') is null
        and coalesce(m.data->>'personal','') <> 'true'
        and coalesce(m.data->>'noReceipt','') <> 'true'
        and not (m.data ? 'receiptExpenseId') and not (m.data ? 'receiptId')
        and not (m.data ? 'fixedAt')) m
    where a is not null and z is not null and z >= a
  )
  update td_mileage t set deleted_at = now()
  where t.user_id = p_employee and t.id in (
    select o.id from old o
    where exists (select 1 from fresh f where not isempty(f.s)
                    and f.s && tstzrange(o.a, o.z, '[)')));
  get diagnostics n_sup_m = row_count;

  if p_sweep then
    update td_mileage set deleted_at = now()
    where user_id = p_employee and deleted_at is null
      and data->>'gps' = 'true' and data->>'date' = p_day
      -- Same line, read off the leg's own start. A leg with no startedIso
      -- cannot be placed against it and is left alone.
      and (p_sweep_until is null
           or ((data->>'startedIso') is not null
               and (data->>'startedIso')::timestamptz < p_sweep_until))
      and not (id = any(keys_m));
    get diagnostics n_del_m = row_count;
  end if;

  return jsonb_build_object(
    'day', p_day,
    'time', n_time, 'shop', n_shop, 'miles', n_miles,
    -- Kept in the shape callers already read. Always 0 now: nothing is
    -- dropped for a human row any more, which is the point of revision 3.
    'dropped_for_human_rows', 0,
    'retired', jsonb_build_object('time', n_del_t, 'shop', n_del_s, 'miles', n_del_m),
    'superseded', jsonb_build_object('time', n_sup_t, 'shop', n_sup_s, 'miles', n_sup_m));
end $$;

revoke all on function geo_replace_day(uuid, uuid, text, timestamptz, timestamptz, jsonb, jsonb, jsonb, boolean, timestamptz) from anon;
grant execute on function geo_replace_day(uuid, uuid, text, timestamptz, timestamptz, jsonb, jsonb, jsonb, boolean, timestamptz) to authenticated, service_role;
