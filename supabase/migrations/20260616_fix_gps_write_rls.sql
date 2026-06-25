-- Fix: employee GPS writes must be associated with the employee's actual employer.
-- The original policies only checked employee_user_id = auth.uid() but did NOT
-- verify that the contractor_user_id the employee sends matches the contractor
-- they actually work for. A malicious employee could write pings / time entries
-- under any contractor's account, polluting their crew map and job cost reports.
--
-- The corrected WITH CHECK adds an exists() subquery through team_members so
-- contractor_user_id must be a contractor who has this employee on their team.

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
