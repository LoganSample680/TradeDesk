-- Add viewer_type tracking to proposal_views so the contractor can see
-- whether it was THEM or the actual CLIENT who last opened the proposal link.
--
-- viewer_type: 'client' (default) or 'contractor'
-- client_opened_at: only set when a real client (no matching auth session) opens
-- contractor_opened_at: only set when the contractor opens (session matches contractorUserId)

alter table proposal_views
  add column if not exists viewer_type        text        default 'client',
  add column if not exists client_opened_at   timestamptz,
  add column if not exists contractor_opened_at timestamptz;

-- Back-fill existing rows: assume all historic opens were by the client
-- (since we had no way to distinguish before this migration).
update proposal_views
  set client_opened_at = opened_at,
      viewer_type = 'client'
  where client_opened_at is null
    and opened_at is not null;
