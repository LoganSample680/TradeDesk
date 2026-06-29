-- ─────────────────────────────────────────────────────────────────────────────
-- "Request access to estimates" — permission-request flow.
--
-- An employee WITHOUT the `estimate` team permission has the estimate entry
-- points greyed out; tapping one opens a popup that inserts a row here, asking
-- the owner for access. The owner approves (flips team_members.permissions.estimate
-- = true) or denies. v1 covers perm='estimate' but the table is generic.
--
-- Keyed by contractor_user_id (NOT user_id) — it must NOT be added to _TD_TABLES
-- (that record-sync loop assumes user_id keying). Realtime is wired separately.
--
-- Bare-DB / migration-lint safe: every policy behind a pg_policies existence
-- guard, and the publication add wrapped in an exception-swallowing DO block
-- (mirrors 20260627). psql -f on an empty DB applies it without aborting.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists td_permission_requests (
  id                 uuid primary key default gen_random_uuid(),
  contractor_user_id uuid not null references auth.users(id) on delete cascade,
  employee_user_id   uuid not null references auth.users(id) on delete cascade,
  employee_email     text,
  employee_name      text,
  perm               text not null default 'estimate',
  status             text not null default 'pending',   -- 'pending'|'approved'|'denied'
  note               text,
  created_at         timestamptz default now(),
  resolved_at        timestamptz,
  resolved_by        uuid references auth.users(id) on delete set null
);

create index if not exists tpr_contractor_idx on td_permission_requests(contractor_user_id, status);
create index if not exists tpr_employee_idx    on td_permission_requests(employee_user_id);
-- At most one pending request per (contractor, employee, perm) — a repeat tap is a no-op.
create unique index if not exists tpr_pending_uniq
  on td_permission_requests(contractor_user_id, employee_user_id, perm)
  where status = 'pending';

alter table td_permission_requests enable row level security;

do $$ begin
  -- Owner sees & resolves all requests addressed to them.
  if not exists (select 1 from pg_policies where tablename='td_permission_requests' and policyname='Contractor manages requests') then
    execute $p$ create policy "Contractor manages requests" on td_permission_requests for all
      using (contractor_user_id::text = auth.uid()::text)
      with check (contractor_user_id::text = auth.uid()::text) $p$;
  end if;
  -- Employee inserts a request for themselves, only against a contractor they are
  -- an active team member of.
  if not exists (select 1 from pg_policies where tablename='td_permission_requests' and policyname='Employee inserts own request') then
    execute $p$ create policy "Employee inserts own request" on td_permission_requests for insert
      with check (
        employee_user_id::text = auth.uid()::text
        and exists (select 1 from team_members tm
                    where tm.contractor_user_id = td_permission_requests.contractor_user_id
                      and tm.employee_user_id::text = auth.uid()::text
                      and tm.active = true)
      ) $p$;
  end if;
  -- Employee reads their own requests (to reflect approved/denied state).
  if not exists (select 1 from pg_policies where tablename='td_permission_requests' and policyname='Employee reads own request') then
    execute $p$ create policy "Employee reads own request" on td_permission_requests for select
      using (employee_user_id::text = auth.uid()::text) $p$;
  end if;
end $$;

-- Realtime so the owner gets pending requests without a reload (bare-DB safe).
do $$ begin
  execute 'alter publication supabase_realtime add table td_permission_requests';
exception when others then
  raise notice 'realtime add td_permission_requests skipped: %', sqlerrm;
end $$;
