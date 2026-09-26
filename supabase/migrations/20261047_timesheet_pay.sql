-- A TIMESHEET CARRIES ITS PAY (owner 2026-09-26): "timesheet for Jack needs
-- to show hourly rate of $25 that can be updated and when the link gets sent
-- out that shows his weekly payout down to the exact minute as a total."
--
-- The rate is stored ON THE SUBMITTED WEEK, not read live from team_members,
-- so a raise next month never rewrites a week that was already approved at
-- the old rate. The person sets it on their own week when they submit
-- (timesheet_set_pay); the boss reading the link sees minutes x rate.
--
-- This reverses one line of 20260913_timesheets.sql ("never the pay rate") for
-- the people it was written about: the owner asked for it by name, for an
-- owner-level employee, and the link goes to the boss who pays him.
--
-- Additive only (CLAUDE.md 3.1): one nullable column, one new function, and
-- timesheet_public re-declared with the same signature and one more field.

alter table td_timesheets add column if not exists pay_rate numeric(10,2);

create or replace function timesheet_set_pay(p_week_start date, p_pay_rate numeric)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid()::text is null then raise exception 'timesheet_set_pay: not signed in'; end if;
  update td_timesheets
     set pay_rate = case when coalesce(p_pay_rate, 0) > 0 then round(p_pay_rate, 2) else null end,
         updated_at = now()
   where employee_user_id::text = auth.uid()::text and week_start = p_week_start;
end $$;

grant execute on function timesheet_set_pay(date, numeric) to authenticated;

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
      'minutes', e.minutes, 'source', e.source, 'client_key', e.client_key,
      -- BOTH ENDS OF A DRIVE, added 2026-09-19. js/timelog.js titles a drive
      -- row "the yard -> John Doe" only when it holds origin_place AND
      -- dest_place; with one end it falls back to the destination alone, and
      -- with neither it prints "Destination not saved". This select sent
      -- dest_place and never origin_place, so no drive on a shared timesheet
      -- could ever name where it started. The app has the column, the boss
      -- reading the link did not.
      'origin_place', e.origin_place, 'dest_place', e.dest_place,
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
    -- The week's pay rate, as it was when the week was submitted (2026-09-26).
    'pay_rate', ts.pay_rate,
    'time', t_rows, 'shop', s_rows, 'manual', m_rows);
end $$;

grant execute on function timesheet_public(text, text) to anon, authenticated;
