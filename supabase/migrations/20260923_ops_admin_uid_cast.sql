-- ════════════════════════════════════════════════════════════════════════
-- analytics_admins: cast both sides of the auth.uid() comparison.
--
-- 20260919 shipped `user_id = auth.uid()` in the allowlist policy and in
-- is_ops_admin(). tests/e2e-flow-coverage.spec.js has a guard against exactly
-- that and caught it on the PR: a bare comparison against auth.uid() is the
-- text-equals-uuid bug, and the repo's convention everywhere else is to cast
-- both sides to text.
--
-- On THIS project auth.uid() returns uuid, so the uncast form runs correctly
-- today and nothing is broken in production. That is why the guard is a guard
-- and not an incident: it is the environment where auth.uid() comes back text
-- that fails, and a migration history is supposed to be replayable into one.
--
-- 20260919 is already recorded on the live project and will not run again, so
-- fixing the file alone would leave the database holding one definition and
-- the repo another. That is the same class of drift as the undeclared
-- trade_lines column this PR just had to repair, so it gets repaired here
-- rather than left for whoever hits it next.
-- ════════════════════════════════════════════════════════════════════════

drop policy if exists analytics_admins_self on analytics_admins;
create policy analytics_admins_self on analytics_admins
  for select to authenticated
  using (user_id::text = auth.uid()::text);

create or replace function is_ops_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from analytics_admins where user_id::text = auth.uid()::text);
$$;

comment on function is_ops_admin() is
  'True when the caller is on the ops-dashboard allowlist. The only gate on the ops_* reporting functions.';

revoke execute on function is_ops_admin() from public, anon;
grant execute on function is_ops_admin() to authenticated;
