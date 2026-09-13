-- ════════════════════════════════════════════════════════════════════════
-- One question, one answer: everything about ONE business, in one call.
--
-- Two readers want the same numbers. A person opens the portal and drills into
-- a business; an agent is asked "how well is J's Solutions using TradeDesk" and
-- should not have to call five functions and stitch them together, nor should
-- it be able to arrive at a different answer than the screen shows. So the page
-- and the agent call the SAME function, and it composes the rollups that already
-- exist rather than re-deriving anything (§7.3): ops_by_contractor,
-- usage_by_contractor, funnel_by_contractor and money_by_contractor, filtered to
-- one account, plus the per-account timings, which had no per-account reader.
--
-- Returns jsonb rather than a wide row on purpose: an agent gets a shape it can
-- read without knowing thirty column names, and adding a metric later does not
-- change the function's signature (the lesson from 20261006, where widening a
-- returns-table meant dropping the function first).
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.ops_account_brief(p_target uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ops   record;
  v_use   record;
  v_fun   record;
  v_money record;
  v_time  jsonb;
  v_biz   text;
  v_trade text;
begin
  if not public.is_ops_admin() then
    raise exception 'ops brief: not authorized' using errcode = '42501';
  end if;

  select * into v_ops   from public.ops_by_contractor(p_from, p_to)   r where r.contractor_user_id = p_target;
  select * into v_use   from public.usage_by_contractor(p_from, p_to) r where r.contractor_user_id = p_target;
  select * into v_fun   from public.funnel_by_contractor(p_from, p_to) r where r.contractor_user_id = p_target;
  select * into v_money from public.money_by_contractor(p_from, p_to) r where r.contractor_user_id = p_target;

  select d.business, d.trade into v_biz, v_trade
    from public.v_account_dim d where d.contractor_user_id = p_target;

  -- The timings, for THIS account. funnel_timing answers for everyone at once
  -- and starts at saved→sent, so it can say how fast a proposal goes out but
  -- never how long the proposal took to write. Both of those stages are logged
  -- (js/lifecycle.js names 'proposal_started>proposal_saved' "Time to write a
  -- proposal"), they were simply never read.
  with b as (
    select f.* from public.v_funnel_bid f where f.contractor_user_id = p_target
  ),
  starts as (
    select l.bid_id,
           min(l.ts) filter (where l.event = 'proposal_started') as started_at,
           min(l.ts) filter (where l.event = 'lead_created')     as lead_at
      from public.lifecycle_events l
     where l.contractor_user_id = p_target and l.bid_id is not null
     group by l.bid_id
  ),
  stages as (
    select 'lead to proposal'::text as stage, 1 as n,
           extract(epoch from (b.saved_at - s.lead_at))/60 as mins
      from b join starts s on s.bid_id = b.bid_id
     where b.saved_at is not null and s.lead_at is not null and b.saved_at::date between p_from and p_to
    union all
    select 'writing the proposal', 2, extract(epoch from (b.saved_at - s.started_at))/60
      from b join starts s on s.bid_id = b.bid_id
     where b.saved_at is not null and s.started_at is not null and b.saved_at::date between p_from and p_to
    union all
    select 'saved to sent', 3, extract(epoch from (b.sent_at - b.saved_at))/60
      from b where b.sent_at is not null and b.saved_at is not null and b.sent_at::date between p_from and p_to
    union all
    select 'sent to opened', 4, extract(epoch from (b.opened_at - b.sent_at))/60
      from b where b.opened_at is not null and b.sent_at is not null and b.sent_at::date between p_from and p_to
    union all
    select 'opened to signed', 5, extract(epoch from (b.signed_at - b.opened_at))/60
      from b where b.signed_at is not null and b.opened_at is not null and b.signed_at::date between p_from and p_to
    union all
    select 'signed to paid', 6, extract(epoch from (b.paid_at - b.signed_at))/60
      from b where b.paid_at is not null and b.signed_at is not null and b.paid_at::date between p_from and p_to
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'stage', t.stage, 'n', t.n_count,
           'median_min', t.median_min, 'p25_min', t.p25_min, 'p75_min', t.p75_min
         ) order by t.n), '[]'::jsonb)
    into v_time
    from (
      select stage, n,
             count(*)                                                              as n_count,
             round(percentile_cont(0.5)  within group (order by mins)::numeric, 1) as median_min,
             round(percentile_cont(0.25) within group (order by mins)::numeric, 1) as p25_min,
             round(percentile_cont(0.75) within group (order by mins)::numeric, 1) as p75_min
        from stages
       where mins is not null and mins >= 0
       group by stage, n
    ) t;

  return jsonb_build_object(
    'contractor_user_id', p_target,
    'business', coalesce(v_biz, v_ops.business, v_use.business),
    'trade',    coalesce(v_trade, v_use.trade),
    'range',    jsonb_build_object('from', p_from, 'to', p_to, 'days', (p_to - p_from) + 1),
    'work', jsonb_build_object(
      'people', v_ops.people, 'crew', v_ops.crew,
      'active_days', v_ops.active_days, 'days_clocked', v_ops.days_clocked,
      'avg_day_min', v_ops.avg_day_min, 'total_miles', v_ops.total_miles,
      'visits', v_ops.visits, 'avg_visit_min', v_ops.avg_visit_min,
      'unnamed_legs', v_ops.unnamed_legs, 'last_active', v_ops.last_active),
    'usage', jsonb_build_object(
      'sessions', v_use.sessions, 'active_days', v_use.active_days,
      'page_views', v_use.page_views, 'clicks', v_use.clicks,
      'avg_session_min', v_use.avg_session_min, 'avg_screens', v_use.avg_screens,
      'clicks_per_session', v_use.clicks_per_session,
      'last_version', v_use.last_version, 'last_seen', v_use.last_seen),
    'funnel', jsonb_build_object(
      'leads', v_fun.leads, 'bids_sent', v_fun.bids_sent, 'sent_opened', v_fun.sent_opened,
      'sent_signed', v_fun.sent_signed, 'signed_total', v_fun.signed_total,
      'signed_paid', v_fun.signed_paid,
      'open_rate', v_fun.open_rate, 'close_rate', v_fun.close_rate,
      'signed_value', v_fun.signed_value, 'avg_ticket', v_fun.avg_ticket),
    'money', jsonb_build_object(
      'signed_count', v_money.signed_count, 'signed_value', v_money.signed_value,
      'avg_ticket', v_money.avg_ticket, 'median_ticket', v_money.median_ticket,
      'deposits', v_money.deposits, 'stripe_fees', v_money.stripe_fees,
      'paid_count', v_money.paid_count, 'pending_count', v_money.pending_count,
      'declined', v_money.declined, 'cancelled', v_money.cancelled,
      'by_cash', v_money.by_cash, 'by_check', v_money.by_check, 'by_card', v_money.by_card),
    'timing', v_time
  );
end;
$$;

comment on function public.ops_account_brief(uuid, date, date) is
  'Everything about one business for a date range, as one jsonb: work, app usage, funnel with close rates, money, and how long each step takes. The ops portal and any agent read this same function so their answers cannot disagree.';

revoke execute on function public.ops_account_brief(uuid, date, date) from public, anon;
grant  execute on function public.ops_account_brief(uuid, date, date) to authenticated;
