-- Idempotency fixes for policies that failed with "already exists" on db push.
--
-- 20260617_shop_time_entries and 20260616_fix_gps_write_rls could not be made
-- idempotent in-place because Supabase branching tracks applied migrations by
-- version number — modifying an already-applied file causes a duplicate-key
-- conflict in schema_migrations. All fixes live here instead, after 20260624,
-- so every table (job_time_entries, location_pings, shop_time_entries) and the
-- has_team_perm() function already exist when these statements run.

-- ── shop_time_entries policies ────────────────────────────────────────────────
drop policy if exists "Contractor manages shop time"   on shop_time_entries;
create policy "Contractor manages shop time" on shop_time_entries for all
  using  (contractor_user_id::text = auth.uid()::text)
  with check (contractor_user_id::text = auth.uid()::text);

drop policy if exists "Employee writes own shop time"  on shop_time_entries;
create policy "Employee writes own shop time" on shop_time_entries for insert
  with check (
    employee_user_id::text = auth.uid()::text
    and exists (
      select 1 from team_members tm
      where tm.employee_user_id::text  = auth.uid()::text
        and tm.contractor_user_id = shop_time_entries.contractor_user_id
        and tm.active = true
    )
  );

drop policy if exists "Employee reads own shop time"   on shop_time_entries;
create policy "Employee reads own shop time" on shop_time_entries for select
  using (employee_user_id::text = auth.uid()::text);

drop policy if exists "Payroll manager reads shop time" on shop_time_entries;
create policy "Payroll manager reads shop time" on shop_time_entries for select
  using (has_team_perm(contractor_user_id, 'payroll'));

-- ── GPS write RLS hardening (originally in 20260616) ─────────────────────────
drop policy if exists "Employee writes own job time" on job_time_entries;
create policy "Employee writes own job time" on job_time_entries for insert
  with check (
    employee_user_id::text = auth.uid()::text
    and exists (
      select 1 from team_members tm
      where tm.employee_user_id::text = auth.uid()::text
        and tm.contractor_user_id = job_time_entries.contractor_user_id
        and tm.active = true
    )
  );

drop policy if exists "Employee writes own location" on location_pings;
create policy "Employee writes own location" on location_pings for insert
  with check (
    employee_user_id::text = auth.uid()::text
    and exists (
      select 1 from team_members tm
      where tm.employee_user_id::text = auth.uid()::text
        and tm.contractor_user_id = location_pings.contractor_user_id
        and tm.active = true
    )
  );
