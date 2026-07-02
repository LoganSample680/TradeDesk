-- crew_member_of / crew_perm (20260715) look up team_members by employee_user_id on
-- EVERY crew-scoped query, policy evaluation, and realtime delivery check. Without an
-- index that's a sequential scan of the whole roster table — invisible at 20 crew,
-- a real tax at 1000 crew under one owner (and across many owners the table is large).
-- Partial on active links: inactive rows never authorize anything.
create index if not exists idx_team_members_employee_active
  on team_members (employee_user_id, contractor_user_id)
  where active;
