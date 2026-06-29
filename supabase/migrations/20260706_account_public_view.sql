-- Public branding projection of `accounts` for the QR intake page.
--
-- intake.html runs as ANON and reads the contractor's branding (business name,
-- phone, logo, brand color) to render the lead-capture form. But `accounts` has
-- RLS that only lets ACCOUNT MEMBERS read — so anon got nothing and the intake form
-- never showed (#f-name stayed hidden). That means the public intake page is broken
-- for real prospects, not just the test.
--
-- Fix: a definer view exposing ONLY the public branding columns (never owner_id,
-- billing, or anything sensitive), readable by anon. This is the contractor's
-- public-facing info (already on proposals + the public site), so exposing it by id
-- is intended. RLS on `accounts` itself is untouched. Idempotent + prod-safe.

-- `logo_data` + `brand_color` exist on the cloud `accounts` table (added via the
-- dashboard, never a migration), so a migrations-only DB lacks them and the view
-- below 42703's. Add them idempotently first — a no-op on the cloud project, and it
-- finally captures these columns in version control.
alter table public.accounts add column if not exists logo_data   text;
alter table public.accounts add column if not exists brand_color text;

create or replace view public.account_public
  with (security_invoker = false) as
  select id, business_name, phone, logo_data, brand_color
  from public.accounts;

grant select on public.account_public to anon, authenticated;
