-- Minimum Supabase surface a migration expects. Without it the very first
-- migration dies on "schema auth does not exist" and every one after it lands
-- in a half-built database, which is how the lint job came to be applying
-- migrations it could not really run.
create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table if not exists auth.users(
  id uuid primary key, email text, raw_user_meta_data jsonb,
  created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select 'authenticated'::text $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon')          then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role')  then create role service_role; end if;
end $$;
