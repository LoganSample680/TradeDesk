-- Fix RLS on signed_proposals: enable enforcement and clean up duplicate policies
-- Also enable RLS on county_assessor_registry (write-only via service role Edge Function)

-- ── signed_proposals ──────────────────────────────────────────────────────────

ALTER TABLE public.signed_proposals ENABLE ROW LEVEL SECURITY;

-- Drop all conflicting/duplicate policies (created via dashboard over time)
DROP POLICY IF EXISTS "allow_anon_insert" ON public.signed_proposals;
DROP POLICY IF EXISTS "allow_anon_update" ON public.signed_proposals;
DROP POLICY IF EXISTS "allow_auth_select" ON public.signed_proposals;
DROP POLICY IF EXISTS "allow_auth_update" ON public.signed_proposals;
DROP POLICY IF EXISTS "anon_insert_signed_proposals" ON public.signed_proposals;
DROP POLICY IF EXISTS "anon_update_signed_proposals" ON public.signed_proposals;
DROP POLICY IF EXISTS "contractor_read_signed_proposals" ON public.signed_proposals;
DROP POLICY IF EXISTS "Contractor reads own signed proposals" ON public.signed_proposals;
DROP POLICY IF EXISTS "Anyone can submit signature" ON public.signed_proposals;
DROP POLICY IF EXISTS "Contractor updates own records" ON public.signed_proposals;

-- Anon (client): sign.html needs SELECT (check if signed), INSERT (submit sig), UPDATE (notified_at)
CREATE POLICY "anon_select" ON public.signed_proposals
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_insert" ON public.signed_proposals
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_update" ON public.signed_proposals
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Authenticated (contractor): read and update only their own proposals
CREATE POLICY "auth_select_own" ON public.signed_proposals
  FOR SELECT TO authenticated
  USING (contractor_user_id = auth.uid());

CREATE POLICY "auth_update_own" ON public.signed_proposals
  FOR UPDATE TO authenticated
  USING (contractor_user_id = auth.uid())
  WITH CHECK (contractor_user_id = auth.uid());


-- ── county_assessor_registry ──────────────────────────────────────────────────
-- Only accessed by property-lookup Edge Function (SUPABASE_SERVICE_ROLE_KEY, bypasses RLS)
-- No browser/anon policies needed — service role is exempt from RLS

ALTER TABLE public.county_assessor_registry ENABLE ROW LEVEL SECURITY;
