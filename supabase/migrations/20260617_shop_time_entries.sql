-- Workforce Time Intelligence — shop / office time tracking
--
-- Adds shop_time_entries table so geo-track.js can log when employees are
-- inside the contractor's office/shop geofence. Combined with job_time_entries
-- (geofence + drive sources), the Crew Cost report can show:
--   On-site hours · Drive hours · Shop hours · Unaccounted hours · OT flag
--
-- RLS mirrors job_time_entries exactly:
--   Contractor: full control.
--   Employee: INSERT only for their own uid, validated through team_members.
--   Payroll manager: SELECT via has_team_perm('payroll').

create table if not exists shop_time_entries (
  id                 uuid primary key default gen_random_uuid(),
  contractor_user_id uuid references auth.users(id) on delete cascade,
  employee_user_id   uuid references auth.users(id) on delete set null,
  arrived_at         timestamptz,
  departed_at        timestamptz,
  minutes            numeric default 0,
  created_at         timestamptz default now()
);
create index if not exists shop_time_entries_contractor_idx on shop_time_entries(contractor_user_id);
create index if not exists shop_time_entries_emp_idx        on shop_time_entries(employee_user_id, arrived_at);

alter table shop_time_entries enable row level security;

drop policy if exists "Contractor manages shop time" on shop_time_entries;
create policy "Contractor manages shop time" on shop_time_entries for all
  using  (contractor_user_id::text = auth.uid()::text)
  with check (contractor_user_id::text = auth.uid()::text);

-- Employee INSERT validated through team_members (same hardening as GPS write RLS)
drop policy if exists "Employee writes own shop time" on shop_time_entries;
create policy "Employee writes own shop time" on shop_time_entries for insert
  with check (
    employee_user_id::text = auth.uid()::text
    and exists (
      select 1 from team_members tm
      where tm.employee_user_id::text = auth.uid()::text
        and tm.contractor_user_id = shop_time_entries.contractor_user_id
        and tm.active             = true
    )
  );

drop policy if exists "Employee reads own shop time" on shop_time_entries;
create policy "Employee reads own shop time" on shop_time_entries for select
  using (employee_user_id::text = auth.uid()::text);

-- has_team_perm() is created in 20260619 (runs after this on a fresh --include-all
-- apply). Skip this policy when the function doesn't exist yet;
-- 20260625_fix_idempotent_policies.sql re-creates it once has_team_perm() exists.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'has_team_perm') then
    drop policy if exists "Payroll manager reads shop time" on shop_time_entries;
    execute $p$
      create policy "Payroll manager reads shop time" on shop_time_entries for select
        using (has_team_perm(contractor_user_id, 'payroll'))
    $p$;
  end if;
end $$;
