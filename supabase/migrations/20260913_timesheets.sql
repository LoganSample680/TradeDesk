-- Timesheets (owner 2026-09-05): "Submit and send."
--
-- The week chart's Send button used to share a text and lock nothing. Now
-- it opens a review of the week, the person SUBMITS it, and the text that
-- goes out carries a stamp (who, when) and a link. The link opens
-- timesheet.html: the same bars and the same day rail, read only, with
-- Approve and Reject for whoever runs the crew, app or no app, login or no
-- login. Submitted days refuse every rebuild (geo_replace_day revision 7,
-- below). The person can still fix a day by hand and submit again: a new
-- version at the same link, marked corrected. Rejected reopens the week.
--
-- One row per person per week. The token is the whole secret of the public
-- page: 16 random bytes, unguessable, never listed anywhere anon can read.

create extension if not exists pgcrypto;

create table if not exists td_timesheets (
  id                 uuid primary key default gen_random_uuid(),
  token              text not null unique
                     default translate(encode(gen_random_bytes(16), 'base64'), '+/=', '-_'),
  contractor_user_id uuid not null references auth.users(id) on delete cascade,
  employee_user_id   uuid not null references auth.users(id) on delete cascade,
  week_start         date not null,
  status             text not null default 'submitted'
                     check (status in ('submitted', 'approved', 'rejected')),
  version            int  not null default 1,
  total_min          int  not null default 0,
  business_name      text not null default '',
  person_name        text not null default '',
  biz_tz             text not null default 'America/Chicago',
  submitted_at       timestamptz not null default now(),
  approved_at        timestamptz,
  approved_name      text,
  rejected_at        timestamptz,
  reject_note        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (employee_user_id, week_start)
);

alter table td_timesheets enable row level security;

-- Reads: the person and the account. Writes only through the RPCs below.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='td_timesheets' and policyname='Person reads own timesheets') then
    execute $p$ create policy "Person reads own timesheets" on td_timesheets for select
      using (employee_user_id::text = auth.uid()::text) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='td_timesheets' and policyname='Account reads crew timesheets') then
    execute $p$ create policy "Account reads crew timesheets" on td_timesheets for select
      using (contractor_user_id::text = auth.uid()::text) $p$;
  end if;
end $$;

-- The week's window on the business clock. A date plus a zone name, so DST is
-- the zone's problem and never a hand-kept offset.
create or replace function timesheet_window(p_week_start date, p_tz text)
returns tstzrange
language sql immutable
as $$
  select tstzrange(
    (p_week_start)::timestamp at time zone coalesce(nullif(p_tz, ''), 'America/Chicago'),
    (p_week_start + 7)::timestamp at time zone coalesce(nullif(p_tz, ''), 'America/Chicago'),
    '[)');
$$;

-- SUBMIT. The person submits their own week on an account they belong to
-- (the owner is a member of their own). A week with a held visit still
-- unanswered cannot be submitted: a locked week never carries an unknown.
-- Submitting again is a new version at the same token; the answers on the
-- old version are cleared because the numbers may have changed.
create or replace function timesheet_submit(
  p_contractor    uuid,
  p_week_start    date,
  p_total_min     int,
  p_business_name text default '',
  p_person_name   text default '',
  p_biz_tz        text default 'America/Chicago'
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  me    uuid := (auth.uid()::text)::uuid;
  win   tstzrange;
  row   td_timesheets%rowtype;
begin
  if me is null then raise exception 'timesheet_submit: not signed in'; end if;
  if p_contractor is null or p_week_start is null then
    raise exception 'timesheet_submit: account and week required';
  end if;
  if me <> p_contractor and not exists (
    select 1 from team_members
    where contractor_user_id = p_contractor and employee_user_id = me and active is not false
  ) then
    raise exception 'timesheet_submit: not your account';
  end if;
  win := timesheet_window(p_week_start, p_biz_tz);
  if exists (
    select 1 from job_time_entries
    where employee_user_id = me and contractor_user_id = p_contractor
      and deleted_at is null and source = 'client-held'
      and arrived_at >= lower(win) and arrived_at < upper(win)
  ) then
    raise exception 'timesheet_submit: answer the held visits first';
  end if;
  insert into td_timesheets
    (contractor_user_id, employee_user_id, week_start, status, version, total_min,
     business_name, person_name, biz_tz, submitted_at)
  values
    (p_contractor, me, p_week_start, 'submitted', 1, coalesce(p_total_min, 0),
     left(coalesce(p_business_name, ''), 120), left(coalesce(p_person_name, ''), 80),
     coalesce(nullif(p_biz_tz, ''), 'America/Chicago'), now())
  on conflict (employee_user_id, week_start) do update set
    contractor_user_id = excluded.contractor_user_id,
    status        = 'submitted',
    version       = td_timesheets.version + 1,
    total_min     = excluded.total_min,
    business_name = excluded.business_name,
    person_name   = excluded.person_name,
    biz_tz        = excluded.biz_tz,
    submitted_at  = now(),
    approved_at   = null, approved_name = null,
    rejected_at   = null, reject_note   = null,
    updated_at    = now()
  returning * into row;
  return jsonb_build_object(
    'token', row.token, 'version', row.version, 'status', row.status,
    'submitted_at', row.submitted_at, 'week_start', row.week_start);
end $$;

grant execute on function timesheet_submit(uuid, date, int, text, text, text) to authenticated;

-- THE PUBLIC PAGE reads by token, as anon. Everything the page draws comes
-- from here and nothing else: the rows the app's own reader would draw for
-- that person and week (the manual clocks, the derived visits and drives,
-- the shop time), each named the way the app names them, plus the status.
-- Never the phone number, never the pay rate, never another person's rows.
create or replace function timesheet_public(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  ts    td_timesheets%rowtype;
  win   tstzrange;
  t_rows jsonb;
  s_rows jsonb;
  m_rows jsonb;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select * into ts from td_timesheets where token = p_token;
  if ts.id is null then return null; end if;
  win := timesheet_window(ts.week_start, ts.biz_tz);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'job_id', e.job_id, 'arrived_at', e.arrived_at, 'departed_at', e.departed_at,
      'minutes', e.minutes, 'source', e.source, 'dest_place', e.dest_place, 'client_key', e.client_key,
      'job_name', j.data->>'name', 'client_name', c.data->>'name',
      'addr', coalesce(j.data->>'addr', c.data->>'addr', '')
    ) order by e.arrived_at), '[]'::jsonb) into t_rows
  from job_time_entries e
  left join td_jobs j on j.id = e.job_id and j.user_id = ts.contractor_user_id and j.deleted_at is null
  left join td_clients c on c.id = (j.data->>'client_id') and c.user_id = ts.contractor_user_id and c.deleted_at is null
  where e.employee_user_id = ts.employee_user_id and e.contractor_user_id = ts.contractor_user_id
    and e.deleted_at is null and coalesce(e.source, '') <> 'dismissed'
    and e.arrived_at >= lower(win) and e.arrived_at < upper(win);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'arrived_at', s.arrived_at, 'departed_at', s.departed_at,
      'minutes', s.minutes, 'client_key', s.client_key
    ) order by s.arrived_at), '[]'::jsonb) into s_rows
  from shop_time_entries s
  where s.employee_user_id = ts.employee_user_id and s.contractor_user_id = ts.contractor_user_id
    and s.deleted_at is null
    and s.arrived_at >= lower(win) and s.arrived_at < upper(win);

  -- The manual clocks live in the account's synced table; the owner's own
  -- carry no logged_by_uid, a crew member's carry theirs.
  select coalesce(jsonb_agg(m.data order by m.data->>'start_time'), '[]'::jsonb) into m_rows
  from td_time_entries m
  where m.user_id = ts.contractor_user_id and m.deleted_at is null
    and coalesce(m.data->>'open', 'false') <> 'true'
    and (m.data->>'date') >= ts.week_start::text and (m.data->>'date') <= (ts.week_start + 6)::text
    and ((m.data->>'logged_by_uid') = ts.employee_user_id::text
         or ((m.data->>'logged_by_uid') is null and ts.employee_user_id = ts.contractor_user_id));

  return jsonb_build_object(
    'business_name', ts.business_name, 'person_name', ts.person_name,
    'week_start', ts.week_start, 'biz_tz', ts.biz_tz,
    'status', ts.status, 'version', ts.version, 'total_min', ts.total_min,
    'submitted_at', ts.submitted_at,
    'approved_at', ts.approved_at, 'approved_name', ts.approved_name,
    'rejected_at', ts.rejected_at, 'reject_note', ts.reject_note,
    'time', t_rows, 'shop', s_rows, 'manual', m_rows);
end $$;

grant execute on function timesheet_public(text) to anon, authenticated;

-- APPROVE or REJECT, from the public page, by token. Reject carries one
-- line. Either answer applies to the version on the page; a resubmission
-- clears both (timesheet_submit).
create or replace function timesheet_decide(p_token text, p_decision text, p_note text default null, p_name text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  ts td_timesheets%rowtype;
begin
  if p_token is null or length(p_token) < 16 then raise exception 'timesheet_decide: no such timesheet'; end if;
  select * into ts from td_timesheets where token = p_token;
  if ts.id is null then raise exception 'timesheet_decide: no such timesheet'; end if;
  if p_decision = 'approve' then
    update td_timesheets set status = 'approved', approved_at = now(),
      approved_name = left(coalesce(p_name, ''), 80),
      rejected_at = null, reject_note = null, updated_at = now()
      where id = ts.id;
  elsif p_decision = 'reject' then
    update td_timesheets set status = 'rejected', rejected_at = now(),
      reject_note = left(coalesce(p_note, ''), 300),
      approved_at = null, approved_name = null, updated_at = now()
      where id = ts.id;
  else
    raise exception 'timesheet_decide: decision must be approve or reject';
  end if;
  select * into ts from td_timesheets where id = ts.id;
  return jsonb_build_object('status', ts.status, 'version', ts.version,
    'approved_at', ts.approved_at, 'rejected_at', ts.rejected_at, 'reject_note', ts.reject_note);
end $$;

grant execute on function timesheet_decide(text, text, text, text) to anon, authenticated;

-- geo_replace_day, revision 7: revision 6 word for word, plus step 0b, the
-- submitted-week lock. Everything else about the writer is unchanged.
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

  -- 0b. A SUBMITTED WEEK IS LOCKED (owner 2026-09-05: the timesheet). Once the
  --    person has submitted the week, no rebuild, phone swap or re-derive
  --    may move a number on it. Same quiet answer as the 14-day lock. A hand
  --    edit never comes through here, so the person can still fix a day and
  --    submit again; a rejected week is open again by design.
  if exists (
    select 1 from td_timesheets t
    where t.employee_user_id = p_employee
      and t.status in ('submitted', 'approved')
      and p_day_start >= ((t.week_start)::timestamp at time zone coalesce(t.biz_tz, 'America/Chicago'))
      and p_day_start <  ((t.week_start + 7)::timestamp at time zone coalesce(t.biz_tz, 'America/Chicago'))
  ) then
    return jsonb_build_object(
      'day', p_day, 'locked', true, 'submitted', true,
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
