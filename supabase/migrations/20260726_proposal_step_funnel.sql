-- Sign-flow step funnel — capture how far a client gets through sign.html.
--
-- proposal_views already records the two ENDS of the funnel (opened, and the
-- terminal signed/declined via signed_proposals). Everything between was a
-- black box: a client who reached the payment screen and bailed looked
-- identical to one who never scrolled past the scope. Those are completely
-- different follow-up calls — one is a hot lead with a money objection.
--
-- furthest_step is MONOTONIC per (contractor_user_id, bid_id): steps only
-- ratchet forward (rank below), so a client re-opening the proposal later
-- never erases the fact that they once reached payment.
--
-- Every step ping also lands one anonymized row in analytics_events
-- (event='sign_step'), so the developer funnel ("what % of ALL clients drop
-- at each stage") aggregates across accounts without touching per-account
-- data. contractor_hash matches ingest-telemetry's scheme exactly —
-- 'c' + first 8 bytes of SHA-256('tdh:' || uid) — so funnel rows join with
-- the rest of the analytics store instead of fragmenting into a second id
-- space. pgcrypto provides digest(); available on hosted Supabase and the
-- lint runner alike.

create extension if not exists pgcrypto;

alter table proposal_views
  add column if not exists furthest_step    text,
  add column if not exists furthest_step_at timestamptz;

create or replace function _sign_step_rank(p_step text) returns int
language sql immutable as $$
  select case p_step
    when 'opened'          then 1
    when 'approved'        then 2  -- tapped Approve & Sign, moved past the proposal
    when 'signature_ready' then 3  -- name/signature entered + agreement checked
    when 'payment_viewed'  then 4  -- reached the payment screen
    when 'method_selected' then 5  -- picked how to pay (hot — bailed at the finish line)
    when 'signed'          then 6  -- terminal: completes the per-proposal timeline, so
                                   -- opened→signed elapsed time is computable per bid
                                   -- and as a community median (group analytics_events
                                   -- by meta->>'bid_hash', diff first/last ts)
    else 0 end;
$$;

create or replace function log_proposal_step(
  p_contractor_user_id uuid,
  p_bid_id             text,
  p_step               text
) returns void
language plpgsql
security definer  -- called via the log-proposal-view edge fn (service role pattern)
as $$
begin
  if _sign_step_rank(p_step) = 0 then return; end if;

  insert into proposal_views (contractor_user_id, bid_id, opened_at, viewer_type, furthest_step, furthest_step_at)
  values (p_contractor_user_id, p_bid_id, now(), 'client', p_step, now())
  on conflict (contractor_user_id, bid_id) do update set
    furthest_step    = case when _sign_step_rank(excluded.furthest_step) > _sign_step_rank(coalesce(proposal_views.furthest_step,''))
                            then excluded.furthest_step else proposal_views.furthest_step end,
    furthest_step_at = case when _sign_step_rank(excluded.furthest_step) > _sign_step_rank(coalesce(proposal_views.furthest_step,''))
                            then now() else proposal_views.furthest_step_at end;

  -- Developer funnel: anonymized — contractor and bid are both one-way hashes.
  -- bid_hash lets step events STITCH into a per-proposal timeline (so "median
  -- time from opened → signed across the whole community" is computable by
  -- grouping on it) without any way to recover the real account or bid.
  insert into analytics_events (contractor_hash, session_id, event, ctx, value, meta)
  values (
    'c' || substr(encode(digest('tdh:' || p_contractor_user_id::text, 'sha256'), 'hex'), 1, 16),
    null, 'sign_step', p_step, 1,
    jsonb_build_object(
      'rank', _sign_step_rank(p_step),
      'bid_hash', 'b' || substr(encode(digest('tdb:' || p_contractor_user_id::text || ':' || p_bid_id, 'sha256'), 'hex'), 1, 16)
    )
  );
end;
$$;
