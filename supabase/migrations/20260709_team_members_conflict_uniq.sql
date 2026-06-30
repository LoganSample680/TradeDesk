-- team_members upsert uses `onConflict (contractor_user_id, email)` (e.g. the self-link
-- seed + the app's add/edit-member flow). The hosted Supabase project has a unique index
-- on those columns created via the dashboard, but it was never captured in a migration —
-- so a from-migrations stack lacks it, and the PostgREST upsert aborts with
--   42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
-- which silently drops the insert (the read-back then sees no row). Mirror the hosted index.
--
-- Rows with email IS NULL are not covered by a UNIQUE index (multiple NULL-email members
-- per contractor stay allowed, which is intended). Idempotent + a no-op on the cloud project.

create unique index if not exists team_members_contractor_email_uniq
  on team_members (contractor_user_id, email);
