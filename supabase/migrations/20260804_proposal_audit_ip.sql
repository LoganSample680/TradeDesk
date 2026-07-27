-- Audit trail: capture the client's IP address + user-agent at the two legally
-- important moments — when the client OPENS the proposal/hub, and when they SIGN.
-- This is the evidence a contractor needs to win a chargeback or contract dispute
-- ("I never opened it", "I never signed that"). Captured server-side in the
-- log-proposal-view Edge Function from the request's x-forwarded-for header, so
-- the browser can't spoof it. IP capture starts now; historical rows stay null.

-- Per-open IP/UA on the aggregate views row: the client-open pair and the
-- hub-open pair are stored separately so the audit report can show each.
ALTER TABLE proposal_views
  ADD COLUMN IF NOT EXISTS client_ip text,
  ADD COLUMN IF NOT EXISTS client_ua text,
  ADD COLUMN IF NOT EXISTS hub_ip    text,
  ADD COLUMN IF NOT EXISTS hub_ua    text;

-- The signature IP/UA — the single most important audit fact.
ALTER TABLE signed_proposals
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS user_agent text;

-- Recreate log_proposal_view_with_count with two extra params (p_ip, p_ua).
-- Different arg list than the old 4-arg version, so drop the old one first to
-- avoid a PostgREST overload ambiguity. Fully-qualified names + empty search_path
-- keep the SECURITY DEFINER function injection-safe (matches the hardening pin).
DROP FUNCTION IF EXISTS log_proposal_view_with_count(uuid, text, text, text);

CREATE OR REPLACE FUNCTION log_proposal_view_with_count(
  p_contractor_user_id uuid,
  p_bid_id             text,
  p_viewer_type        text,
  p_client_id          text DEFAULT NULL,
  p_ip                 text DEFAULT NULL,
  p_ua                 text DEFAULT NULL
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.proposal_views (
    contractor_user_id, bid_id, client_id, opened_at, viewer_type,
    hub_opened_at, hub_view_count, hub_ip, hub_ua,
    client_opened_at, client_view_count, client_ip, client_ua,
    contractor_opened_at
  ) VALUES (
    p_contractor_user_id, p_bid_id, p_client_id, now(),
    CASE WHEN p_viewer_type = 'contractor' THEN 'contractor' ELSE 'client' END,
    CASE WHEN p_viewer_type = 'client-hub' THEN now() ELSE NULL END,
    CASE WHEN p_viewer_type = 'client-hub' THEN 1 ELSE 0 END,
    CASE WHEN p_viewer_type = 'client-hub' THEN p_ip ELSE NULL END,
    CASE WHEN p_viewer_type = 'client-hub' THEN p_ua ELSE NULL END,
    CASE WHEN p_viewer_type = 'client' THEN now() ELSE NULL END,
    CASE WHEN p_viewer_type = 'client' THEN 1 ELSE 0 END,
    CASE WHEN p_viewer_type = 'client' THEN p_ip ELSE NULL END,
    CASE WHEN p_viewer_type = 'client' THEN p_ua ELSE NULL END,
    CASE WHEN p_viewer_type = 'contractor' THEN now() ELSE NULL END
  )
  ON CONFLICT (contractor_user_id, bid_id) DO UPDATE SET
    opened_at            = now(),
    viewer_type          = CASE WHEN p_viewer_type = 'contractor' THEN 'contractor' ELSE 'client' END,
    hub_opened_at        = CASE WHEN p_viewer_type = 'client-hub' THEN now() ELSE public.proposal_views.hub_opened_at END,
    hub_view_count       = CASE WHEN p_viewer_type = 'client-hub' THEN COALESCE(public.proposal_views.hub_view_count, 0) + 1 ELSE public.proposal_views.hub_view_count END,
    hub_ip               = CASE WHEN p_viewer_type = 'client-hub' THEN p_ip ELSE public.proposal_views.hub_ip END,
    hub_ua               = CASE WHEN p_viewer_type = 'client-hub' THEN p_ua ELSE public.proposal_views.hub_ua END,
    client_opened_at     = CASE WHEN p_viewer_type = 'client' THEN now() ELSE public.proposal_views.client_opened_at END,
    client_view_count    = CASE WHEN p_viewer_type = 'client' THEN COALESCE(public.proposal_views.client_view_count, 0) + 1 ELSE public.proposal_views.client_view_count END,
    client_ip            = CASE WHEN p_viewer_type = 'client' THEN p_ip ELSE public.proposal_views.client_ip END,
    client_ua            = CASE WHEN p_viewer_type = 'client' THEN p_ua ELSE public.proposal_views.client_ua END,
    contractor_opened_at = CASE WHEN p_viewer_type = 'contractor' THEN now() ELSE public.proposal_views.contractor_opened_at END,
    client_id            = COALESCE(public.proposal_views.client_id, p_client_id);
$$;

GRANT EXECUTE ON FUNCTION log_proposal_view_with_count(uuid, text, text, text, text, text) TO service_role;
