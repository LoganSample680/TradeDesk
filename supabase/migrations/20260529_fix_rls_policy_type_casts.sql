-- Fix RLS policies: add explicit ::text casts to every auth.uid() comparison.
--
-- ROOT CAUSE: PostgreSQL requires explicit casting when comparing text columns
-- to the uuid returned by auth.uid(). The initial schema (20200101000000)
-- was applied to production without these casts. On fresh databases the
-- policy CREATE fails immediately with:
--   ERROR: operator does not exist: text = uuid (SQLSTATE 42883)
-- On existing databases the old policies persist (if not exists skips them)
-- and the comparison silently fails at query time — no rows returned.
--
-- WHAT THIS MIGRATION DOES:
--   For every affected policy: DROP IF EXISTS (removes old broken version),
--   then CREATE (installs new version with ::text casts).
--   DROP POLICY never touches table data — zero data loss risk.
--   Policies are structural metadata only.
--
-- WHAT IS NOT TOUCHED:
--   • account_users write policies — already fixed in 20260526 with casts
--   • anon/public policies (using (true)) — no auth.uid() comparison, fine as-is
--   • Table structure, indexes, data — completely unchanged
--
-- SAFE TO RUN ON ANY DB STATE:
--   DROP IF EXISTS is a no-op when the policy doesn't exist.
--   Idempotent — running twice is safe.

-- ── zj_data ─────────────────────────────────────────────────────────────────

drop policy if exists "Users manage own data" on zj_data;
create policy "Users manage own data" on zj_data
  for all
  using     (user_id::text = auth.uid()::text)
  with check (user_id::text = auth.uid()::text);

-- ── accounts ─────────────────────────────────────────────────────────────────

drop policy if exists "Account members can read" on accounts;
create policy "Account members can read" on accounts
  for select
  using (id::text in (
    select account_id::text from account_users
    where user_id::text = auth.uid()::text
  ));

drop policy if exists "Account owner can insert" on accounts;
create policy "Account owner can insert" on accounts
  for insert
  with check (owner_id::text = auth.uid()::text);

drop policy if exists "Account owner can update" on accounts;
create policy "Account owner can update" on accounts
  for update
  using (owner_id::text = auth.uid()::text);

-- ── users ────────────────────────────────────────────────────────────────────

drop policy if exists "Users read own row" on users;
create policy "Users read own row" on users
  for select
  using (id::text = auth.uid()::text);

drop policy if exists "Users insert own row" on users;
create policy "Users insert own row" on users
  for insert
  with check (id::text = auth.uid()::text);

drop policy if exists "Users update own row" on users;
create policy "Users update own row" on users
  for update
  using (id::text = auth.uid()::text);

-- ── account_users ────────────────────────────────────────────────────────────
-- NOTE: write policies (insert/update/delete) were already fixed in
-- 20260526_fix_account_users_recursion.sql. Only the SELECT policy is here.

drop policy if exists "Members read own membership" on account_users;
create policy "Members read own membership" on account_users
  for select
  using (user_id::text = auth.uid()::text);

-- ── vehicles ─────────────────────────────────────────────────────────────────

drop policy if exists "Account members read vehicles" on vehicles;
create policy "Account members read vehicles" on vehicles
  for select
  using (account_id::text in (
    select account_id::text from account_users
    where user_id::text = auth.uid()::text
  ));

drop policy if exists "Account owner manages vehicles" on vehicles;
create policy "Account owner manages vehicles" on vehicles
  for all
  using (account_id::text in (
    select account_id::text from account_users
    where user_id::text = auth.uid()::text and role = 'owner'
  ));

-- ── account_config ───────────────────────────────────────────────────────────

drop policy if exists "Account members read config" on account_config;
create policy "Account members read config" on account_config
  for select
  using (account_id::text in (
    select account_id::text from account_users
    where user_id::text = auth.uid()::text
  ));

drop policy if exists "Account owner manages config" on account_config;
create policy "Account owner manages config" on account_config
  for all
  using (account_id::text in (
    select account_id::text from account_users
    where user_id::text = auth.uid()::text and role = 'owner'
  ));

-- ── team_members ─────────────────────────────────────────────────────────────

drop policy if exists "Contractor manages own team" on team_members;
create policy "Contractor manages own team" on team_members
  for all
  using (contractor_user_id::text = auth.uid()::text);

drop policy if exists "Employee reads own record" on team_members;
create policy "Employee reads own record" on team_members
  for select
  using (employee_user_id::text = auth.uid()::text);

drop policy if exists "Employee updates own record" on team_members;
create policy "Employee updates own record" on team_members
  for update
  using (employee_user_id::text = auth.uid()::text);

-- ── signed_proposals ─────────────────────────────────────────────────────────

drop policy if exists "auth_select_own" on signed_proposals;
create policy "auth_select_own" on signed_proposals
  for select to authenticated
  using (contractor_user_id::text = auth.uid()::text);

drop policy if exists "auth_update_own" on signed_proposals;
create policy "auth_update_own" on signed_proposals
  for update to authenticated
  using     (contractor_user_id::text = auth.uid()::text)
  with check (contractor_user_id::text = auth.uid()::text);

-- ── inbound_leads ────────────────────────────────────────────────────────────

drop policy if exists "Contractor reads own leads" on inbound_leads;
create policy "Contractor reads own leads" on inbound_leads
  for select
  using (account_id::text in (
    select id::text from accounts
    where owner_id::text = auth.uid()::text
  ));

drop policy if exists "Contractor updates own leads" on inbound_leads;
create policy "Contractor updates own leads" on inbound_leads
  for update
  using (account_id::text in (
    select id::text from accounts
    where owner_id::text = auth.uid()::text
  ));

-- ── push_subscriptions ───────────────────────────────────────────────────────

drop policy if exists "owner" on push_subscriptions;
create policy "owner" on push_subscriptions
  for all
  using     (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- ── proposal_views ───────────────────────────────────────────────────────────

drop policy if exists "Contractor reads own views" on proposal_views;
create policy "Contractor reads own views" on proposal_views
  for select
  using (contractor_user_id::text = auth.uid()::text);

drop policy if exists "auth update views" on proposal_views;
create policy "auth update views" on proposal_views
  for update to authenticated
  using (contractor_user_id::text = auth.uid()::text);
