-- Fix: employee GPS writes must be associated with the employee's actual employer.
-- The original policies only checked employee_user_id = auth.uid() but did NOT
-- verify that the contractor_user_id the employee sends matches the contractor
-- they actually work for. A malicious employee could write pings / time entries
-- under any contractor's account, polluting their crew map and job cost reports.
--
-- The corrected WITH CHECK adds an exists() subquery through team_members so
-- contractor_user_id must be a contractor who has this employee on their team.

-- job_time_entries and location_pings are created in 20260619_team_comp_geo_tracking.sql
-- which runs after this file. Guard with DO blocks so this migration is safe when the
-- tables don't exist yet. 20260625_fix_idempotent_policies.sql re-applies the hardened
-- policies after all tables exist.
do $$
begin
  if to_regclass('public.job_time_entries') is not null then
    drop policy if exists "Employee writes own job time" on job_time_entries;
    execute $p$
      create policy "Employee writes own job time" on job_time_entries for insert
        with check (
          employee_user_id::text = auth.uid()::text
          and exists (
            select 1 from team_members tm
            where tm.employee_user_id::text = auth.uid()::text
              and tm.contractor_user_id = job_time_entries.contractor_user_id
              and tm.active = true
          )
        )
    $p$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.location_pings') is not null then
    drop policy if exists "Employee writes own location" on location_pings;
    execute $p$
      create policy "Employee writes own location" on location_pings for insert
        with check (
          employee_user_id::text = auth.uid()::text
          and exists (
            select 1 from team_members tm
            where tm.employee_user_id::text = auth.uid()::text
              and tm.contractor_user_id = location_pings.contractor_user_id
              and tm.active = true
          )
        )
    $p$;
  end if;
end $$;
