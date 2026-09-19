-- The shared timesheet link belongs to ONE device (owner 2026-09-19):
-- "the link that is shared I need some security on it, only the person who
-- receives it can open it, if it's resent again that person can't see it."
--
-- Offered three shapes; he picked this one by number: "bound by device that
-- opens first." So the link is claimed on first open and refused everywhere
-- else, and a resend mints a new link that kills the old one dead.
--
-- Why this and not a code or a login: the boss in a two-truck shop has no
-- app, no account and no patience, and a one-time code in a second text is
-- one more thing to lose at 6am. Trust on first use costs the recipient
-- nothing at all, which is the only kind of security that actually gets used.
--
-- What it does NOT claim to be: the window between the text going out and
-- the boss tapping it is open by definition, because nothing has claimed the
-- link yet. That is what "first use" means. It closes the case that actually
-- happens, which is a link forwarded on, screenshotted into a group chat, or
-- still sitting in a thread on a phone that changed hands.

alter table td_timesheets add column if not exists bound_device text;
alter table td_timesheets add column if not exists bound_at     timestamptz;

-- SUBMIT, revision 2: the on-conflict arm is revision 1 word for word plus
-- the two lines marked below. A resubmission is a NEW LINK: new token, no
-- binding. The old link stops resolving the moment this runs, which is the
-- half of the owner's rule about resending, and the new one goes out in the
-- new text (js/timesheet.js reads the token straight off this answer).
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
    -- A RESEND IS A NEW LINK (owner 2026-09-19). Same two uuids the column
    -- default uses, so there is one idea of what a token is.
    token         = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    bound_device  = null,
    bound_at      = null,
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

-- THE CLAIM. One function, because both public RPCs ask the same question and
-- two copies of it would drift (CLAUDE.md 7.3). Returns true when this device
-- may see this sheet, and claims it on the way past if nobody has.
--
--   bound to nobody + a device  -> claim it, allow
--   bound to nobody + no device -> allow, claim NOTHING (an older page that
--                                  does not know to send one still works, and
--                                  the real recipient's open still claims it)
--   bound to this device        -> allow
--   bound to another device     -> refuse, for ever, resend or nothing
create or replace function timesheet_claim(p_id uuid, p_device text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  dev text := left(nullif(btrim(coalesce(p_device, '')), ''), 80);
  cur text;
begin
  select bound_device into cur from td_timesheets where id = p_id for update;
  -- `is not distinct from`, never `=`. A device-less call leaves dev NULL, and
  -- `cur = null` is NULL, which `if not ...` does not fire on: the sheet would
  -- have served itself to anybody who simply omitted the argument. Caught on
  -- the first local run of this file, which is the entire reason it was run.
  if cur is not null then return cur is not distinct from dev; end if;
  if dev is null then return true; end if;
  update td_timesheets set bound_device = dev, bound_at = now(), updated_at = now()
    where id = p_id and bound_device is null;
  return true;
end $$;

-- THE PUBLIC PAGE, revision 2. The body is revision 1 unchanged; what is new
-- is the claim above it and the one refusal shape below. A refusal is an
-- ANSWER, not an error: the page has something true to say ("it was opened
-- somewhere else") and an error would only say "could not load", which is
-- what a bad connection says and sends the boss looking at his signal.
create or replace function timesheet_public(p_token text, p_device text default '')
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
  if not timesheet_claim(ts.id, p_device) then
    return jsonb_build_object('refused', 'bound');
  end if;
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

-- ONE FUNCTION, NOT TWO. p_device defaults, so every call the old signature
-- could make still lands here: one shared Supabase serves dev, UAT and
-- production (CLAUDE.md 3.1), and the timesheet.html live in production right
-- now still calls this with p_token alone. An overload would have been worse
-- than useless, because a defaulted argument makes the two-argument form
-- callable with one and Postgres then refuses the call outright as ambiguous.
-- So the old signature is dropped and its shape absorbed.
--
-- A device-less call is not a hole. It is refused the moment anything has
-- claimed the sheet, so it can only ever serve a link nobody has opened yet,
-- which is the window trust-on-first-use leaves open by definition.
drop function if exists timesheet_public(text);

grant execute on function timesheet_public(text, text) to anon, authenticated;
grant execute on function timesheet_claim(uuid, text) to anon, authenticated;

-- DECIDE, revision 2. Approving is the part that actually costs money, so it
-- takes the same lock, from the same function. A device that may not READ the
-- week must certainly not approve it.
create or replace function timesheet_decide(p_token text, p_decision text, p_note text default null,
                                            p_name text default null, p_device text default '')
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
  if not timesheet_claim(ts.id, p_device) then
    raise exception 'timesheet_decide: this link was opened on another device';
  end if;
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

-- Same absorption, same reason: production's page approves through the
-- four-argument shape and must keep working across the version gap.
drop function if exists timesheet_decide(text, text, text, text);

grant execute on function timesheet_decide(text, text, text, text, text) to anon, authenticated;
