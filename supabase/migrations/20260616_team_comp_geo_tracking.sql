-- ════════════════════════════════════════════════════════════════════════
-- Team compensation + geo-tracking + job time-on-site
--
-- Adds:
--   • Pay rate / pay type on team_members (salary lives in the DB with RLS,
--     NEVER in the shared S settings blob — a UI permission alone would leak it
--     because every employee downloads the same S payload).
--   • job_time_entries: geofence arrival/departure durations per employee/job.
--   • location_pings: live location breadcrumb during business hours.
--   • has_team_perm(): SECURITY DEFINER helper so a manager (an employee, not the
--     account owner) can be granted read access via their permissions jsonb
--     WITHOUT recursive RLS evaluation on team_members.
--
-- All statements are idempotent (add column if not exists / create if not exists /
-- drop policy if exists + create) so `supabase db push --include-all` is safe.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Compensation + consent columns on team_members ───────────────────────
-- Defensive: the original `create table if not exists team_members` will not add
-- a missing column to a table that predates it, so guarantee the columns
-- has_team_perm() and the policies below depend on actually exist first.
alter table team_members add column if not exists permissions      jsonb   default '{}';
alter table team_members add column if not exists active           boolean default true;
alter table team_members add column if not exists pay_type         text    default 'hourly';   -- 'hourly' | 'salary'
alter table team_members add column if not exists pay_rate         numeric default 0;          -- hourly $/hr OR annual salary
alter table team_members add column if not exists location_consent boolean default false;      -- employee's explicit opt-in

-- ── 2. SECURITY DEFINER permission helper ───────────────────────────────────
-- Bypasses RLS so checking "is the caller a permitted team member" does not
-- recurse into the team_members policies it is being used by.
create or replace function has_team_perm(_contractor uuid, _perm text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from team_members
    where contractor_user_id = _contractor
      and employee_user_id::text = auth.uid()::text
      and active             = true
      and coalesce((permissions->>_perm)::boolean, false) = true
  );
$$;

-- ── 3. job_time_entries — geofence time-on-site ─────────────────────────────
create table if not exists job_time_entries (
  id                 uuid primary key default gen_random_uuid(),
  contractor_user_id uuid references auth.users(id) on delete cascade,
  employee_user_id   uuid references auth.users(id) on delete set null,
  job_id             text,
  arrived_at         timestamptz,
  departed_at        timestamptz,
  minutes            numeric default 0,
  source             text    default 'geofence',  -- 'geofence' | 'manual'
  created_at         timestamptz default now()
);
create index if not exists job_time_entries_contractor_idx on job_time_entries(contractor_user_id);
create index if not exists job_time_entries_job_idx        on job_time_entries(job_id);

-- ── 4. location_pings — live breadcrumb (business hours only) ────────────────
create table if not exists location_pings (
  id                 uuid primary key default gen_random_uuid(),
  contractor_user_id uuid references auth.users(id) on delete cascade,
  employee_user_id   uuid references auth.users(id) on delete set null,
  lat                numeric,
  lon                numeric,
  accuracy           numeric,
  job_id             text,
  ts                 timestamptz default now()
);
create index if not exists location_pings_contractor_idx on location_pings(contractor_user_id);
create index if not exists location_pings_emp_ts_idx      on location_pings(employee_user_id, ts);

alter table job_time_entries enable row level security;
alter table location_pings   enable row level security;

-- ── 5. Policies ─────────────────────────────────────────────────────────────
do $$ begin
  -- team_members: a payroll-permitted manager may read the team (incl. pay_rate).
  -- Owner already covered by "Contractor manages own team"; employee self by
  -- "Employee reads own record". This adds the manager path.
  if not exists (select 1 from pg_policies where tablename='team_members' and policyname='Payroll manager reads team') then
    execute $p$ create policy "Payroll manager reads team" on team_members for select
      using (has_team_perm(contractor_user_id, 'payroll')) $p$;
  end if;

  -- job_time_entries
  if not exists (select 1 from pg_policies where tablename='job_time_entries' and policyname='Contractor manages job time') then
    execute $p$ create policy "Contractor manages job time" on job_time_entries for all
      using (contractor_user_id::text = auth.uid()::text)
      with check (contractor_user_id::text = auth.uid()::text) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='job_time_entries' and policyname='Employee writes own job time') then
    execute $p$ create policy "Employee writes own job time" on job_time_entries for insert
      with check (employee_user_id::text = auth.uid()::text) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='job_time_entries' and policyname='Employee reads own job time') then
    execute $p$ create policy "Employee reads own job time" on job_time_entries for select
      using (employee_user_id::text = auth.uid()::text) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='job_time_entries' and policyname='Payroll manager reads job time') then
    execute $p$ create policy "Payroll manager reads job time" on job_time_entries for select
      using (has_team_perm(contractor_user_id, 'payroll')) $p$;
  end if;

  -- location_pings
  if not exists (select 1 from pg_policies where tablename='location_pings' and policyname='Contractor reads team location') then
    execute $p$ create policy "Contractor reads team location" on location_pings for all
      using (contractor_user_id::text = auth.uid()::text)
      with check (contractor_user_id::text = auth.uid()::text) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='location_pings' and policyname='Employee writes own location') then
    execute $p$ create policy "Employee writes own location" on location_pings for insert
      with check (employee_user_id::text = auth.uid()::text) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='location_pings' and policyname='Employee reads own location') then
    execute $p$ create policy "Employee reads own location" on location_pings for select
      using (employee_user_id::text = auth.uid()::text) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='location_pings' and policyname='Location manager reads team') then
    execute $p$ create policy "Location manager reads team" on location_pings for select
      using (has_team_perm(contractor_user_id, 'team')) $p$;
  end if;
end $$;
