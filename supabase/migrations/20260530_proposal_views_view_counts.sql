-- Add view count columns to proposal_views.
-- These are incremented atomically by the log_proposal_view_with_count() function below.
-- hub_view_count   — number of times client opened the shared hub link (client.html)
-- client_view_count — number of times client opened a specific proposal (sign.html)

ALTER TABLE proposal_views
  ADD COLUMN IF NOT EXISTS hub_view_count    int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_view_count int NOT NULL DEFAULT 0;

-- Backfill: any row that already has hub_opened_at set gets a count of 1
-- (we know it was opened at least once — we just never counted before)
UPDATE proposal_views
   SET hub_view_count = 1
 WHERE hub_opened_at IS NOT NULL
   AND hub_view_count = 0;

UPDATE proposal_views
   SET client_view_count = 1
 WHERE client_opened_at IS NOT NULL
   AND client_view_count = 0;

-- ────────────────────────────────────────────────────────────────────────────────
-- Atomic upsert-with-increment function.
--
-- Called by the log-proposal-view Edge Function (service role).
-- Uses INSERT ... ON CONFLICT DO UPDATE so the counter increment and the
-- timestamp update are a single atomic statement — no race condition between
-- a separate SELECT + UPDATE.
-- ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION log_proposal_view_with_count(
  p_contractor_user_id uuid,
  p_bid_id             text,
  p_viewer_type        text,
  p_client_id          uuid DEFAULT NULL
) RETURNS void
LANGUAGE sql
SECURITY DEFINER   -- runs as the function owner (postgres), bypasses RLS
AS $$
  INSERT INTO proposal_views (
    contractor_user_id,
    bid_id,
    client_id,
    opened_at,
    viewer_type,
    hub_opened_at,
    hub_view_count,
    client_opened_at,
    client_view_count,
    contractor_opened_at
  ) VALUES (
    p_contractor_user_id,
    p_bid_id,
    p_client_id,
    now(),
    CASE WHEN p_viewer_type = 'contractor' THEN 'contractor' ELSE 'client' END,
    CASE WHEN p_viewer_type = 'client-hub'  THEN now() ELSE NULL END,
    CASE WHEN p_viewer_type = 'client-hub'  THEN 1     ELSE 0    END,
    CASE WHEN p_viewer_type = 'client'      THEN now() ELSE NULL END,
    CASE WHEN p_viewer_type = 'client'      THEN 1     ELSE 0    END,
    CASE WHEN p_viewer_type = 'contractor'  THEN now() ELSE NULL END
  )
  ON CONFLICT (contractor_user_id, bid_id) DO UPDATE SET
    opened_at            = now(),
    viewer_type          = CASE WHEN p_viewer_type = 'contractor' THEN 'contractor' ELSE 'client' END,
    -- Hub open: update timestamp + increment count
    hub_opened_at        = CASE WHEN p_viewer_type = 'client-hub'
                                THEN now()
                                ELSE proposal_views.hub_opened_at END,
    hub_view_count       = CASE WHEN p_viewer_type = 'client-hub'
                                THEN COALESCE(proposal_views.hub_view_count, 0) + 1
                                ELSE proposal_views.hub_view_count END,
    -- Proposal open: update timestamp + increment count
    client_opened_at     = CASE WHEN p_viewer_type = 'client'
                                THEN now()
                                ELSE proposal_views.client_opened_at END,
    client_view_count    = CASE WHEN p_viewer_type = 'client'
                                THEN COALESCE(proposal_views.client_view_count, 0) + 1
                                ELSE proposal_views.client_view_count END,
    -- Contractor preview: update timestamp only, no count
    contractor_opened_at = CASE WHEN p_viewer_type = 'contractor'
                                THEN now()
                                ELSE proposal_views.contractor_opened_at END,
    -- Update client_id if supplied and not already set
    client_id            = COALESCE(proposal_views.client_id, p_client_id);
$$;

-- Grant execute to service_role (used by the Edge Function)
GRANT EXECUTE ON FUNCTION log_proposal_view_with_count(uuid, text, text, uuid) TO service_role;
