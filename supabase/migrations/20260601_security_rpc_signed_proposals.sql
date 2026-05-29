-- Security hardening: replace permissive anon RLS on signed_proposals with
-- security-definer RPCs. Clients (sign.html, client.html) call named
-- functions instead of querying the table directly, preventing the full
-- cross-tenant data-dump and client-side payment_status injection.
--
-- Also adds missing columns (portfolio_accepted, portfolio_pct, notified_at),
-- adds a UNIQUE constraint required by ON CONFLICT upsert semantics, and fixes
-- the proposal_views INSERT policy so authenticated contractors cannot forge
-- view records for other contractors.

-- ── 1. Add missing columns ───────────────────────────────────────────────────
ALTER TABLE public.signed_proposals
  ADD COLUMN IF NOT EXISTS signing_token      text,
  ADD COLUMN IF NOT EXISTS portfolio_accepted boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS portfolio_pct      numeric,
  ADD COLUMN IF NOT EXISTS notified_at        timestamptz;

-- ── 2. Backfill signing_token from storage_key ──────────────────────────────
-- storage_key format: proposals/UUID/BIDID_TOKEN.json
-- Token is everything after the last underscore, before .json
UPDATE public.signed_proposals
SET signing_token = REGEXP_REPLACE(
  SUBSTRING(storage_key FROM POSITION('_' IN REVERSE(storage_key)) * -1 + LENGTH(storage_key) + 2),
  '\.json$', '', 'i'
)
WHERE signing_token IS NULL
  AND storage_key   IS NOT NULL
  AND storage_key LIKE 'proposals/%_%_.json';

-- ── 3. Deduplicate — keep most-recent row per (bid_id, contractor_user_id) ──
-- No unique constraint existed previously; duplicates may exist.
DELETE FROM public.signed_proposals
WHERE id NOT IN (
  SELECT DISTINCT ON (bid_id, contractor_user_id) id
  FROM public.signed_proposals
  ORDER BY bid_id, contractor_user_id,
           COALESCE(created_at, '-infinity'::timestamptz) DESC, id DESC
);

-- ── 4. Add unique constraint (enables ON CONFLICT in submit RPC) ─────────────
ALTER TABLE public.signed_proposals
  DROP CONSTRAINT IF EXISTS signed_proposals_bid_contractor_unique;
ALTER TABLE public.signed_proposals
  ADD  CONSTRAINT signed_proposals_bid_contractor_unique
  UNIQUE (bid_id, contractor_user_id);

-- ── 5. Drop permissive anon policies ────────────────────────────────────────
DROP POLICY IF EXISTS "anon_select"  ON public.signed_proposals;
DROP POLICY IF EXISTS "anon_insert"  ON public.signed_proposals;
DROP POLICY IF EXISTS "anon_update"  ON public.signed_proposals;

-- Also drop auth_insert_any (had a permissive check clause) — any authenticated contractor
-- could previously INSERT rows with any contractor_user_id, poisoning another
-- contractor's data. Replaced by auth_insert_own below.
DROP POLICY IF EXISTS "auth_insert_any" ON public.signed_proposals;

-- ── 6. Authenticated contractor may pre-register the signing token ───────────
DROP POLICY IF EXISTS "auth_insert_own" ON public.signed_proposals;
CREATE POLICY "auth_insert_own" ON public.signed_proposals
  FOR INSERT TO authenticated
  WITH CHECK (contractor_user_id::text = auth.uid()::text);

-- ── 7. RPC: get_signed_proposal_status ──────────────────────────────────────
-- sign.html calls this to check whether a proposal is already signed.
-- Returns empty when the signing_token doesn't match — prevents data exposure
-- to callers who only know the bid_id but not the secret token.
CREATE OR REPLACE FUNCTION public.get_signed_proposal_status(
  p_bid_id             text,
  p_contractor_user_id uuid,
  p_signing_token      text
) RETURNS TABLE (
  signed_at          timestamptz,
  client_signed_name text,
  payment_method     text,
  payment_status     text,
  deposit            numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT signed_at, client_signed_name, payment_method, payment_status, deposit
  FROM public.signed_proposals
  WHERE bid_id             = p_bid_id
    AND contractor_user_id = p_contractor_user_id
    AND signing_token      = p_signing_token;
$$;
GRANT EXECUTE ON FUNCTION public.get_signed_proposal_status(text, uuid, text) TO anon;

-- ── 8. RPC: submit_signed_proposal ──────────────────────────────────────────
-- Client (anon) calls this to sign or decline a proposal.
-- payment_status is computed server-side — the client cannot inject 'paid'.
CREATE OR REPLACE FUNCTION public.submit_signed_proposal(
  p_bid_id             text,
  p_contractor_user_id uuid,
  p_signing_token      text,
  p_client_name        text,
  p_client_signed_name text,
  p_amount             numeric,
  p_deposit            numeric,
  p_payment_method     text,
  p_notify_email       text,
  p_storage_key        text,
  p_portfolio_accepted boolean DEFAULT false,
  p_portfolio_pct      numeric DEFAULT null,
  p_is_decline         boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _safe_status text;
BEGIN
  -- Server computes payment_status; client-supplied values are ignored here.
  IF p_is_decline THEN
    _safe_status := 'declined';
  ELSE
    _safe_status := 'pending_' || lower(p_payment_method);
  END IF;

  INSERT INTO public.signed_proposals (
    bid_id, contractor_user_id, signing_token,
    client_name, client_signed_name,
    amount, deposit,
    payment_method, payment_status, signed_at,
    notify_email, storage_key,
    portfolio_accepted, portfolio_pct
  ) VALUES (
    p_bid_id, p_contractor_user_id, p_signing_token,
    p_client_name, p_client_signed_name,
    p_amount, p_deposit,
    p_payment_method, _safe_status, now(),
    p_notify_email, p_storage_key,
    COALESCE(p_portfolio_accepted, false), p_portfolio_pct
  )
  ON CONFLICT (bid_id, contractor_user_id) DO UPDATE SET
    signing_token       = EXCLUDED.signing_token,
    client_name         = EXCLUDED.client_name,
    client_signed_name  = EXCLUDED.client_signed_name,
    amount              = EXCLUDED.amount,
    deposit             = EXCLUDED.deposit,
    payment_method      = EXCLUDED.payment_method,
    payment_status      = EXCLUDED.payment_status,
    signed_at           = EXCLUDED.signed_at,
    notify_email        = EXCLUDED.notify_email,
    storage_key         = EXCLUDED.storage_key,
    portfolio_accepted  = EXCLUDED.portfolio_accepted,
    portfolio_pct       = EXCLUDED.portfolio_pct;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_signed_proposal(
  text, uuid, text, text, text, numeric, numeric, text, text, text, boolean, numeric, boolean
) TO anon;

-- ── 9. RPC: update_proposal_notified ────────────────────────────────────────
-- Token-gated notified_at update. Prevents unauthenticated blanket UPDATE.
CREATE OR REPLACE FUNCTION public.update_proposal_notified(
  p_bid_id             text,
  p_contractor_user_id uuid,
  p_signing_token      text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.signed_proposals
  SET notified_at = now()
  WHERE bid_id             = p_bid_id
    AND contractor_user_id = p_contractor_user_id
    AND signing_token      = p_signing_token;
$$;
GRANT EXECUTE ON FUNCTION public.update_proposal_notified(text, uuid, text) TO anon;

-- ── 10. RPC: get_hub_proposal_statuses ──────────────────────────────────────
-- client.html calls this to show payment status per proposal in the hub.
-- Returns only non-PII fields (no client_name, notify_email, signed_name).
-- Caller must know the contractor_user_id AND the specific bid_ids — these
-- can only be obtained from the hub JSON (which requires a valid hub token
-- to download from storage), providing implicit token scoping.
CREATE OR REPLACE FUNCTION public.get_hub_proposal_statuses(
  p_contractor_user_id uuid,
  p_bid_ids            text[]
) RETURNS TABLE (
  bid_id         text,
  payment_status text,
  payment_method text,
  signed_at      timestamptz,
  deposit        numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bid_id, payment_status, payment_method, signed_at, deposit
  FROM public.signed_proposals
  WHERE contractor_user_id = p_contractor_user_id
    AND bid_id = ANY(p_bid_ids);
$$;
GRANT EXECUTE ON FUNCTION public.get_hub_proposal_statuses(uuid, text[]) TO anon;

-- ── 11. Fix proposal_views INSERT — require contractor ownership ─────────────
-- Previously the policy had a permissive check clause (always true) that allowed
-- any authenticated user to insert view records for any contractor_user_id (analytics poisoning).
DROP POLICY IF EXISTS "auth insert views" ON public.proposal_views;
CREATE POLICY "auth insert views" ON public.proposal_views
  FOR INSERT TO authenticated
  WITH CHECK (contractor_user_id::text = auth.uid()::text);

-- ── 12. Deduplicate proposal_views anon INSERT policies ──────────────────────
-- Four policies were accumulated over time all doing the same thing.
-- Keep "anon can insert proposal views" as the canonical one; drop the rest.
DROP POLICY IF EXISTS "anon_insert_proposal_views" ON public.proposal_views;
DROP POLICY IF EXISTS "anon insert views"           ON public.proposal_views;
DROP POLICY IF EXISTS "anon can insert views"       ON public.proposal_views;
-- Also drop the stale duplicate SELECT policy (case-variant of the same rule).
DROP POLICY IF EXISTS "contractor reads own views"  ON public.proposal_views;

-- ── 13. Deduplicate inbound_leads anon INSERT policies ───────────────────────
-- "anon can insert" and "Anon can submit lead" are identical; drop the older one.
DROP POLICY IF EXISTS "anon can insert" ON public.inbound_leads;
