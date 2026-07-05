-- Complete the hosted-parity grants from 20260704_local_grants_and_storage.sql:
-- that migration mirrored the hosted auto-grants for `anon` + `authenticated` but
-- left out `service_role`. On a from-migrations stack (the self-hosted flow-test
-- runner) every admin-key seed insert then 403'd with 42501 "permission denied" —
-- the per-worker account provisioning (accounts/users/account_config/vehicles/
-- zj_data/team_members) silently failed, the app booted with _account = null, and
-- the public-intake flow spec skipped on "dev account has no accounts row".
--
-- SECURITY: no-op on the hosted project (service_role already holds these grants
-- there) and no loosening anywhere — service_role is the server-side admin role
-- that already bypasses RLS by design; it is never exposed to clients.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- Future objects inherit the same, so new tables never re-break the seeding.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
