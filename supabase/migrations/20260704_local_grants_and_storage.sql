-- Make a from-migrations database (local test stack / future self-hosted prod)
-- behave like the hosted Supabase project, which the app was built against.
--
-- WHY: hosted Supabase auto-grants the `anon` and `authenticated` roles on public
-- tables and relies on ROW-LEVEL SECURITY as the real gate. A database built purely
-- from these migrations never received those role grants, so every authenticated
-- REST call 403'd ("permission denied for table") — zj_data writes, team_members,
-- *_time_entries, proposal_views, signed_proposals, user_prefs, td_scope_* … — which
-- cascaded into nearly every "persisted to cloud" test failure.
--
-- SECURITY: this does NOT loosen anything. Every table's RLS still enforces row
-- access exactly as written — including the deny-all policies on error_log and
-- analytics_events (a table GRANT with a deny-all RLS policy yields zero rows). This
-- merely mirrors the hosted default. It is idempotent and a no-op on the existing
-- cloud project (those grants already exist there).

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- Future tables/sequences in public inherit the same grants automatically.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;

-- The `proposals` storage bucket backs every proposal artifact + client-hub snapshot
-- + signing JSON (anon read/write governed by the storage.objects policies created in
-- 20260609_portfolio_cols_signed_proposals.sql). It exists on the cloud project but was
-- never created by a migration, so a fresh stack 400s with "Bucket not found".
insert into storage.buckets (id, name, public)
values ('proposals', 'proposals', true)
on conflict (id) do nothing;
