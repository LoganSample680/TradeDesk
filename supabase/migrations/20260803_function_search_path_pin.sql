-- Supabase advisor: "Function Search Path Mutable" (lint 0011) on 9 functions.
--
-- A role-mutable search_path lets a caller's search_path influence which
-- tables/functions an unqualified reference inside the function resolves to.
-- Pinning it closes that off. Pinned to `public, extensions` — the same schemas
-- the hosted default resolves — so every unqualified reference inside these
-- functions resolves EXACTLY as it does today. Zero behavior change; several of
-- these functions were created via the dashboard (never in a migration), so
-- ALTER ... SET is the only fix that doesn't require knowing their bodies.
--
-- Each ALTER is wrapped so a database where the function doesn't exist (fresh
-- local stack, drift) skips it instead of failing the whole migration.

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.prevent_undeletion()',
    'public.td_reject_stale_update()',
    'public.block_anon_cancel()',
    'public._capture_bid_history()',
    'public.td_set_updated_at()',
    'public.log_proposal_view_with_count(uuid, text, text, text)',
    'public.get_account_delta(timestamptz, text)',
    'public._sign_step_rank(text)',
    'public.log_proposal_step(uuid, text, text)'
  ]
  loop
    begin
      execute format('alter function %s set search_path = public, extensions', fn);
    exception
      when undefined_function then null;  -- not present on this database — skip
      when undefined_object then null;    -- extensions schema absent (local stack) — retry below
    end;
  end loop;
end $$;

-- Local-stack fallback: if the extensions schema doesn't exist, pin to public
-- alone for any function the loop above skipped for that reason.
do $$
declare
  fn text;
begin
  if exists (select 1 from pg_namespace where nspname = 'extensions') then return; end if;
  foreach fn in array array[
    'public.prevent_undeletion()',
    'public.td_reject_stale_update()',
    'public.block_anon_cancel()',
    'public._capture_bid_history()',
    'public.td_set_updated_at()',
    'public.log_proposal_view_with_count(uuid, text, text, text)',
    'public.get_account_delta(timestamptz, text)',
    'public._sign_step_rank(text)',
    'public.log_proposal_step(uuid, text, text)'
  ]
  loop
    begin
      execute format('alter function %s set search_path = public', fn);
    exception when undefined_function then null;
    end;
  end loop;
end $$;
