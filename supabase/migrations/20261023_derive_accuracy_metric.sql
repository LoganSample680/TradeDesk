-- ════════════════════════════════════════════════════════════════════════
-- IS IT GETTING SMARTER? (owner 2026-09-17)
--
-- "I need to know that it is and we're seeing less phone corrections."
--
-- A day is derived twice over its life. The server derives it as the events
-- land, and it may ADD but never RETIRE, because a stretch nobody uploaded yet
-- looks exactly like a stretch that did not happen. Then the phone boots, and
-- its own tape is the only evidence complete enough to say a row should not
-- exist, so its rebuild is the one that sweeps.
--
-- Every one of those late changes is a number somebody already saw. A row that
-- arrives the next morning was missing from a timesheet all day. A row swept
-- the next morning was on that timesheet all day and was wrong. Measured on
-- the week to 17 September, two people: 26 rows and 616 minutes arrived late,
-- 31 rows and 914 minutes were retired late, and 9 of 12 person-days changed
-- after they were over. One day alone (14 September) lost 611 minutes.
--
-- None of that was visible anywhere. This makes it a metric, so the question
-- stops being asked and starts being answered.
--
-- A DAY CANNOT BE GRADED UNTIL THE NEXT MORNING. Today's rows have not had
-- their chance to be corrected yet, so counting them would score every account
-- as perfect at noon. accuracy_by_contractor excludes today, and the number is
-- always "as of yesterday".
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Every automatic row, and whether it settled on the day it covers ─────
-- One row in, one row out, no aggregation: the shape every other ops view
-- takes so the same day can be sliced per person or per account without a
-- second definition of what "late" means.
create or replace view v_derive_correction as
with r as (
  select 'job'::text as kind, contractor_user_id, employee_user_id,
         arrived_at, created_at, deleted_at, minutes
    from job_time_entries
  union all
  select 'shop'::text, contractor_user_id, employee_user_id,
         arrived_at, created_at, deleted_at, minutes
    from shop_time_entries
)
select r.contractor_user_id,
       r.employee_user_id,
       r.kind,
       (r.arrived_at at time zone 'America/Chicago')::date as day,
       coalesce(r.minutes, 0)::numeric as minutes,
       -- Created on a LATER Central day than the one it covers: nobody could
       -- see this row while the day it describes was happening.
       (r.created_at at time zone 'America/Chicago')::date
         > (r.arrived_at at time zone 'America/Chicago')::date as added_late,
       -- Retired on a later day: it was on the timesheet, and it was wrong.
       (r.deleted_at is not null
        and (r.deleted_at at time zone 'America/Chicago')::date
          > (r.arrived_at at time zone 'America/Chicago')::date) as retired_late
  from r
 where r.arrived_at is not null
   and r.created_at is not null;

comment on view v_derive_correction is
  'Every automatic time row with two flags: was it created after the day it covers, and was it retired after the day it covers. Both mean somebody saw a wrong number first.';

-- ── 2. The rollup, one row per account ──────────────────────────────────────
create or replace function accuracy_by_contractor(p_from date, p_to date)
returns table (
  contractor_user_id uuid,
  business          text,
  trade             text,
  rows_total        bigint,
  added_late        bigint,
  added_late_min    numeric,
  retired_late      bigint,
  retired_late_min  numeric,
  person_days       bigint,
  clean_days        bigint,
  clean_pct         numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  with d as (
    select c.contractor_user_id as cid, c.employee_user_id as eid, c.day,
           count(*)                                              as n,
           count(*) filter (where c.added_late)                   as la,
           coalesce(sum(c.minutes) filter (where c.added_late),0) as lam,
           count(*) filter (where c.retired_late)                   as lr,
           coalesce(sum(c.minutes) filter (where c.retired_late),0) as lrm
      from v_derive_correction c
     where c.day between p_from and p_to
       -- Today has not had its correction yet. Grading it would score every
       -- account perfect until the morning sweep proves otherwise.
       and c.day < (now() at time zone 'America/Chicago')::date
     group by 1, 2, 3
  )
  select dim.contractor_user_id, dim.business, dim.trade,
         sum(d.n)::bigint,
         sum(d.la)::bigint, round(sum(d.lam), 0),
         sum(d.lr)::bigint, round(sum(d.lrm), 0),
         count(*)::bigint,
         count(*) filter (where d.la = 0 and d.lr = 0)::bigint,
         round(100.0 * count(*) filter (where d.la = 0 and d.lr = 0)
               / nullif(count(*), 0), 1)
    from d
    join v_account_dim dim on dim.contractor_user_id = d.cid
   group by 1, 2, 3
   order by 11 asc nulls last, 6 desc;
end;
$$;

comment on function accuracy_by_contractor(date, date) is
  'Per account: how much of the automatic record had to be corrected after the day was over. clean_pct is the share of person-days that needed no late add and no late retire, and is the one number to watch. Excludes today, which cannot be graded yet.';

revoke execute on function accuracy_by_contractor(date, date) from public, anon;
grant  execute on function accuracy_by_contractor(date, date) to authenticated;

-- ── 3. The registry gains an Accuracy section ───────────────────────────────
-- One row per metric, per CLAUDE.md 18: the portal and Tim both read this, so
-- the numbers below appear on the page and in an answer with no page change.
drop function if exists public.ops_metric_defs();
create or replace function public.ops_metric_defs()
returns table (
  section       text,
  section_label text,
  section_sort  int,
  key           text,
  label         text,
  fmt           text,
  sort          int
)
language sql immutable as $$
  select * from (values
    ('work',  'Work',      1, 'people',            'People',             'int',   1),
    ('work',  'Work',      1, 'active_days',       'Days opened',        'int',   2),
    ('work',  'Work',      1, 'days_clocked',      'Days clocked',       'int',   3),
    ('work',  'Work',      1, 'avg_day_min',       'Average day',        'hours', 4),
    ('work',  'Work',      1, 'total_miles',       'Miles',              'num',   5),
    ('work',  'Work',      1, 'visits',            'Visits',             'int',   6),
    ('work',  'Work',      1, 'avg_visit_min',     'Average visit',      'mins',  7),
    ('work',  'Work',      1, 'unnamed_legs',      'Unnamed drives',     'int',   8),

    ('funnel','Proposals', 2, 'leads',             'Leads',              'int',   1),
    ('funnel','Proposals', 2, 'bids_sent',         'Proposals sent',     'int',   2),
    ('funnel','Proposals', 2, 'sent_opened',       'Opened',             'int',   3),
    ('funnel','Proposals', 2, 'open_rate',         'Open rate',          'pct',   4),
    ('funnel','Proposals', 2, 'signed_total',      'Signed',             'int',   5),
    ('funnel','Proposals', 2, 'close_rate',        'Close rate',         'pct',   6),
    ('funnel','Proposals', 2, 'signed_value',      'Signed value',       'usd',   7),
    ('funnel','Proposals', 2, 'avg_ticket',        'Average ticket',     'usd',   8),

    ('money', 'Money',     3, 'signed_value',      'Signed',             'usd',   1),
    ('money', 'Money',     3, 'median_ticket',     'Median ticket',      'usd',   2),
    ('money', 'Money',     3, 'paid_count',        'Paid',               'int',   3),
    ('money', 'Money',     3, 'pending_count',     'Awaiting payment',   'int',   4),
    ('money', 'Money',     3, 'deposits',          'Deposits',           'usd',   5),
    ('money', 'Money',     3, 'stripe_fees',       'Stripe fees',        'usd',   6),
    ('money', 'Money',     3, 'declined',          'Declined',           'int',   7),
    ('money', 'Money',     3, 'cancelled',         'Cancelled',          'int',   8),

    ('usage', 'App usage', 4, 'sessions',          'Sessions',           'int',   1),
    ('usage', 'App usage', 4, 'avg_session_min',   'Average session',    'mins',  2),
    ('usage', 'App usage', 4, 'page_views',        'Screens',            'int',   3),
    ('usage', 'App usage', 4, 'clicks',            'Taps',               'int',   4),
    ('usage', 'App usage', 4, 'clicks_per_session','Taps per session',   'num',   5),
    ('usage', 'App usage', 4, 'avg_screens',       'Screens per session','num',   6),
    ('usage', 'App usage', 4, 'last_version',      'Version',            'text',  7),
    ('usage', 'App usage', 4, 'last_seen',         'Last seen',          'ago',   8),

    ('accuracy','Accuracy', 5, 'clean_pct',        'Days closed clean',  'pct',   1),
    ('accuracy','Accuracy', 5, 'added_late_min',   'Minutes added late', 'mins',  2),
    ('accuracy','Accuracy', 5, 'retired_late_min', 'Minutes removed late','mins', 3),
    ('accuracy','Accuracy', 5, 'added_late',       'Rows added late',    'int',   4),
    ('accuracy','Accuracy', 5, 'retired_late',     'Rows removed late',  'int',   5)
  ) as t(section, section_label, section_sort, key, label, fmt, sort);
$$;

-- ── 4. The brief carries the values ────────────────────────────────────────
create or replace function public.ops_account_brief(p_target uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ops   record;
  v_use   record;
  v_fun   record;
  v_money record;
  v_acc   record;
  v_time  jsonb;
  v_vals  jsonb;
  v_secs  jsonb;
  v_biz   text;
  v_trade text;
begin
  if not public.is_ops_admin() then
    raise exception 'ops brief: not authorized' using errcode = '42501';
  end if;

  select * into v_ops   from public.ops_by_contractor(p_from, p_to)    r where r.contractor_user_id = p_target;
  select * into v_use   from public.usage_by_contractor(p_from, p_to)  r where r.contractor_user_id = p_target;
  select * into v_fun   from public.funnel_by_contractor(p_from, p_to) r where r.contractor_user_id = p_target;
  select * into v_money from public.money_by_contractor(p_from, p_to)  r where r.contractor_user_id = p_target;
  select * into v_acc   from public.accuracy_by_contractor(p_from, p_to) r where r.contractor_user_id = p_target;

  select d.business, d.trade into v_biz, v_trade
    from public.v_account_dim d where d.contractor_user_id = p_target;

  -- Every value once, keyed section.metric. The sections below and the flat
  -- objects at the end are both READ from this, so a number cannot appear
  -- twice with two different computations behind it.
  v_vals := jsonb_build_object(
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
    -- How often a day had to be corrected after it was over. A day cannot
    -- be graded until the next morning, so accuracy_by_contractor excludes
    -- today and these can be null on a one-day window.
    'accuracy', jsonb_build_object(
      'clean_pct', v_acc.clean_pct, 'added_late_min', v_acc.added_late_min,
      'retired_late_min', v_acc.retired_late_min,
      'added_late', v_acc.added_late, 'retired_late', v_acc.retired_late)
  );

  -- The timings, for THIS account. funnel_timing answers for everyone at once
  -- and starts at saved to sent, so it can say how fast a proposal goes out but
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

  -- Values, labelled and ordered by the definition list. A def whose value the
  -- brief does not compute renders as "not measured" rather than vanishing, so
  -- a half-added metric is visible instead of silently missing.
  select coalesce(jsonb_agg(s order by s->>'sort'), '[]'::jsonb) into v_secs
  from (
    select jsonb_build_object(
             'key', d.section,
             'label', d.section_label,
             'sort', lpad(d.section_sort::text, 3, '0'),
             'metrics', jsonb_agg(jsonb_build_object(
                 'key', d.key, 'label', d.label, 'fmt', d.fmt,
                 'value', v_vals -> d.section -> d.key
               ) order by d.sort)
           ) as s
      from public.ops_metric_defs() d
     group by d.section, d.section_label, d.section_sort
  ) x;

  return jsonb_build_object(
    'contractor_user_id', p_target,
    'business', coalesce(v_biz, v_ops.business, v_use.business),
    'trade',    coalesce(v_trade, v_use.trade),
    'range',    jsonb_build_object('from', p_from, 'to', p_to, 'days', (p_to - p_from) + 1),
    'sections', v_secs,
    'work',   v_vals -> 'work',
    'usage',  v_vals -> 'usage',
    'funnel', v_vals -> 'funnel',
    'money',  v_vals -> 'money',
    'timing', v_time
  );
end;
$$;