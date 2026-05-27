-- Fix log_proposal_view_with_count: p_client_id was declared uuid but
-- client IDs in the app are numeric integers stored as text (e.g. "901").
-- This caused "COALESCE types text and uuid cannot be matched" when the
-- migration tried to compile the function.
--
-- Drop the old signature first (different parameter types = different function
-- in PostgreSQL), then recreate with the correct types.

DROP FUNCTION IF EXISTS log_proposal_view_with_count(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION log_proposal_view_with_count(
  p_contractor_user_id uuid,
  p_bid_id             text,
  p_viewer_type        text,
  p_client_id          text DEFAULT NULL   -- numeric client ID stored as text, e.g. "901"
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
GRANT EXECUTE ON FUNCTION log_proposal_view_with_count(uuid, text, text, text) TO service_role;

-- Ensure the client_id column accepts text (numeric IDs like "901")
-- If it was created as uuid, alter it to text.
-- IF it's already text this is a no-op (ALTER TYPE to same type).
DO $$
BEGIN
  -- Only alter if the column is currently uuid
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'proposal_views'
      AND column_name = 'client_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE proposal_views ALTER COLUMN client_id TYPE text USING client_id::text;
  END IF;
END $$;
