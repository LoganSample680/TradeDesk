-- Add hub_opened_at to proposal_views so we can distinguish between
-- "client opened the hub link" (client.html) and "client opened the proposal"
-- (sign.html / clicked Review & Sign on a specific bid).
--
-- hub_opened_at:    set when client.html fires log-proposal-view with viewerType:'client-hub'
-- client_opened_at: set when sign.html fires log-proposal-view with viewerType:'client'
--                   (i.e. the client clicked into a specific proposal)
--
-- This gives the contractor two distinct timestamps per bid on the dashboard.
-- Self-contained and idempotent — safe to run on any DB state.

alter table proposal_views
  add column if not exists hub_opened_at timestamptz;
