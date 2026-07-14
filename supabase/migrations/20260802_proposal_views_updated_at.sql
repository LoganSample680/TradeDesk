-- Egress fix, round 2: give proposal_views the same change cursor
-- signed_proposals got in 20260714_signed_proposals_updated_at.sql.
--
-- js/cloud.js _fetchProposalViews() re-downloaded the newest 500 rows every 30s
-- from every open contractor tab even when nothing changed. With updated_at the
-- client runs a 1-row "anything newer?" probe first — a steady-state tick
-- transfers at most one tiny row instead of 500 full ones.
--
-- The touch trigger re-surfaces rows on UPDATE (log-proposal-view upserts bump
-- view counts / furthest_step in place), so every mutation the poll cares about
-- crosses the watermark exactly once. Same drift-safety contract as before:
-- clients on a database without this column fall back to the full poll.

alter table proposal_views
  add column if not exists updated_at timestamptz not null default now();

-- Same touch function signed_proposals uses — recreated defensively so this
-- migration stands alone on a fresh database regardless of apply order.
create or replace function td_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists proposal_views_touch_updated_at on proposal_views;
create trigger proposal_views_touch_updated_at
  before update on proposal_views
  for each row execute function td_touch_updated_at();

-- The probe filters + orders on it — index keeps that a sub-ms lookup at any scale.
create index if not exists idx_proposal_views_contractor_updated
  on proposal_views (contractor_user_id, updated_at desc);
