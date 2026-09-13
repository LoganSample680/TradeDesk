-- ════════════════════════════════════════════════════════════════════════
-- Adding a metric should be ONE edit, and every reader should get it.
--
-- ops_account_brief shipped with its metrics written out twice: once in the
-- SQL that computed them, once in the page that labelled and formatted them.
-- Adding "how many change orders" meant editing both, in agreement, forever,
-- and an agent reading the jsonb got raw keys with no idea what a number
-- meant or how to say it out loud.
--
-- So the metric list becomes DATA. ops_metric_defs() names every metric once:
-- its section, its label, and how to format it. The brief computes values and
-- joins them to that list, the portal renders whatever the list contains
-- rather than a hard-coded grid, and an agent reads label and format straight
-- off the answer. A new metric is a value in the brief plus a row here, and it
-- appears on the page, in the copied JSON and in an agent's answer at once,
-- with no page change at all.
--
-- Also here: ops_live_status, which answers whether their app is open right
-- now. See its own comment for why "force closed" is an inference and what it
-- is inferred from.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. The metric list. THE one place a metric is defined. ──────────────────
-- fmt is what the reader does with the number, not what Postgres stored:
--   int   a count            pct   already 0-100      usd   dollars
--   num   one decimal        hours minutes as hours   mins  minutes as "70m"
--   text  as-is              date  a day              ago   a timestamp, said as "today"
-- Dropped first: widening a returns-table is a type change, and Postgres
-- refuses to replace one in place (the lesson from 20261006).
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
    ('usage', 'App usage', 4, 'last_seen',         'Last seen',          'ago',   8)
  ) as t(section, section_label, section_sort, key, label, fmt, sort);
$$;

comment on function public.ops_metric_defs() is
  'Every metric the ops brief carries, named once: section, label and format. The brief joins values to this and the portal renders whatever it finds, so adding a metric is one row here plus its value, never a page change.';

revoke execute on function public.ops_metric_defs() from public, anon;
grant  execute on function public.ops_metric_defs() to authenticated;

-- ── 2. The brief, rendered from the list above ──────────────────────────────
-- Same signature, same flat sections an agent may already read. What is NEW is
-- `sections`: the same numbers with their label and format attached, in order,
-- which is what the page draws and what lets an agent say "close rate is
-- forty five percent" instead of reading a key name aloud.
create or replace function public.ops_account_brief(p_target uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ops   record;
  v_use   record;
  v_fun   record;
  v_money record;
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
      'by_cash', v_money.by_cash, 'by_check', v_money.by_check, 'by_card', v_money.by_card)
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

comment on function public.ops_account_brief(uuid, date, date) is
  'Everything about one business for a date range, as one jsonb: work, app usage, funnel with close rates, money, and how long each step takes. `sections` carries the same numbers with the label and format from ops_metric_defs, so the portal and an agent read one answer. The ops portal and any agent call this same function so their answers cannot disagree.';

revoke execute on function public.ops_account_brief(uuid, date, date) from public, anon;
grant  execute on function public.ops_account_brief(uuid, date, date) to authenticated;

-- ── 3. Is their app open right now? ─────────────────────────────────────────
-- Owner asked for four lights: open, backgrounded, force closed, nothing.
--
-- The first version of this read analytics_events and geo_events directly and
-- built its own state machine. That was wrong, and app_presence()
-- (20260921) is why: it has answered this exact question since September,
-- from the SAME evidence, and better in the two ways that matter.
--
--   1. THE PHONE REPORTS ALL THREE. TdGeoPlugin observes willResignActive,
--      didBecomeActive and willTerminate and records 'app-background',
--      'app-active' and 'app-terminate' into geo_events, flushing urgently on
--      background because that is the last moment iOS reliably gives it. So
--      force closed is not only an inference from silence: when the phone gets
--      the notification off, it is the phone's own word.
--   2. STALENESS IS JUDGED AGAINST THE PING CRON, NOT THE WALL CLOCK. If the
--      geo-ping cron stops, nobody was asked, so nobody failed to answer, and
--      calling that a fleet of force quits would be the most misleading thing
--      the portal could do. My version would have done exactly that.
--
-- It also separates 'push-blocked' (a phone still writing its own fixes but
-- not taking silent pushes: Background App Refresh or Low Power Mode, not the
-- user) from 'force-closed', which is the distinction that keeps a red light
-- worth trusting.
--
-- So this is now a thin per-account read of it, mapping seven honest states
-- onto the owner's four lights and carrying the detail sentence through, and
-- app_presence stays the one place the rule lives (§7.3).

-- app_presence had every edge except the one a red row needs to show: WHEN it
-- went behind. It is already in the function's own CTE, so it is RETURNED now
-- rather than re-derived by a caller, and every reader gets it, not just this
-- one. Everything else below is 20260928's definition verbatim, including the
-- dormant state and the awake-buckets evidence: this is that function plus one
-- column, never a rewrite of it. Widening a returns-table is a type change,
-- hence the drop (the 20261006 lesson).

drop function if exists app_presence();

create or replace function app_presence()
returns table (
  contractor_user_id uuid, business text, employee_user_id uuid, person text,
  role text, state text, state_detail text,
  last_open_at timestamptz, last_bg_at timestamptz,
  minutes_since_open numeric, opens_today bigint,
  last_heard_at timestamptz, minutes_since_heard numeric,
  last_ping_at timestamptz, pings_missed integer, awake_buckets bigint,
  last_terminate_at timestamptz, app_version text, battery_level numeric,
  has_push_token boolean, cron_ran_at timestamptz,
  last_alive_at timestamptz, dormant_days numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_cron timestamptz;
  -- A week of total silence. Named once so the number is arguable in one place.
  c_dormant_days constant numeric := 7;
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;

  select cw.ran_at into v_cron from cron_watermarks cw where cw.name = 'geo-ping';

  return query
  with tok as (
    select dt.user_id, count(*) as n
    from device_tokens dt where dt.invalid_at is null group by dt.user_id
  ),
  dev as (
    select distinct on (ds.user_id) ds.user_id, ds.app_version, ds.battery_level, ds.checked_at
    from device_status ds order by ds.user_id, ds.checked_at desc
  ),
  s as (
    select d.contractor_user_id, d.business, pd.employee_user_id, pd.person, pd.role,
           r.last_open_at, r.last_bg_at, r.last_terminate_at, r.last_relaunch_at,
           r.last_ping_at, r.last_write_at, r.self_writes_40m,
           coalesce(r.buckets_alive_since_ping, 0) as awake,
           r.opens_today,
           coalesce(tok.n, 0) > 0 as has_token,
           dev.app_version, dev.battery_level,
           -- Any sign of life, whichever came last. A push the device answered
           -- is deliberately NOT one of these: the whole question is what to
           -- believe when those have stopped.
           greatest(r.last_open_at, r.last_write_at, dev.checked_at) as alive_at,
           -- Negative when the device answered more recently than the last
           -- recorded tick, which is normal; clamp so it reads as zero.
           greatest(floor(extract(epoch from
             (v_cron - coalesce(r.last_ping_at, v_cron))) / 1800)::int, 0) as missed
    from v_app_presence_raw r
    join v_person_dim pd on pd.employee_user_id = r.employee_user_id
    join v_account_dim d on d.contractor_user_id = pd.contractor_user_id
    left join tok on tok.user_id = r.employee_user_id
    left join dev on dev.user_id = r.employee_user_id
  ),
  t as (
    select s.*,
           case when s.alive_at is null then null
                else round(extract(epoch from (now() - s.alive_at)) / 86400.0, 1) end as quiet_days
    from s
  )
  select t.contractor_user_id, t.business, t.employee_user_id, t.person, t.role,
         case
           when t.last_open_at is not null
                and t.last_open_at >= coalesce(t.last_bg_at, t.last_open_at)
                and now() - t.last_open_at < interval '3 minutes'      then 'foreground'
           -- Dormant outranks every silence-based state below it. Nothing the
           -- device did or did not do can be read when nobody is using the
           -- account at all.
           when t.alive_at is null
             or t.quiet_days >= c_dormant_days                          then 'dormant'
           when not t.has_token                                         then 'no-push-token'
           when v_cron is null
             or now() - v_cron > interval '45 minutes'                  then 'unknown-cron-down'
           when t.missed <= 1                                           then 'background'
           -- Awake for essentially every half hour it skipped a nudge.
           when t.missed >= 2 and t.awake >= t.missed - 1               then 'push-blocked'
           -- Writing now, but it cannot yet be shown it was here during the
           -- gap. The next nudge decides between background and push-blocked.
           when t.self_writes_40m > 0                                   then 'back-online'
           when coalesce(t.last_terminate_at, '-infinity') > coalesce(t.last_ping_at, '-infinity')
             or coalesce(t.last_relaunch_at, '-infinity') > coalesce(t.last_ping_at, '-infinity')
                                                                        then 'force-closed'
           else 'dark'
         end,
         case
           when t.alive_at is null
             then 'This account has never opened the app, written anything, or reported a device. '
                  || case when t.has_token then 'A push token is registered, so the nudge is firing at a device that will never answer.'
                          else 'Nothing was ever sent to it.' end
           when t.quiet_days >= c_dormant_days
             then 'Nothing from this account for ' || t.quiet_days || ' days: no foreground, no writes, no device report. '
                  || case when t.has_token then 'The nudge is still firing at a stale token, so pings_missed will keep climbing and means nothing.'
                          else 'No push token either.' end
           when not t.has_token
             then 'No registered device token, so no push was ever sent. Silence here means nothing.'
           when v_cron is null or now() - v_cron > interval '45 minutes'
             then 'The geo-ping cron has not run recently. Nobody was asked, so nobody failing to answer proves anything.'
           when t.missed >= 2 and t.awake >= t.missed - 1
             then 'Device was awake and writing through ' || t.awake || ' of the ' || t.missed
                  || ' half-hours it skipped a nudge. It is running and not taking silent pushes: check Background App Refresh and Low Power Mode, not the user.'
           when t.missed >= 2 and t.self_writes_40m > 0
             then 'Device went quiet after its last answered nudge and has just started writing again. Next tick confirms whether pushes are landing.'
           when coalesce(t.last_terminate_at, '-infinity') > coalesce(t.last_ping_at, '-infinity')
             then 'App reported its own termination after the last push it answered.'
           else null
         end,
         t.last_open_at,
         t.last_bg_at,
         round(extract(epoch from (now() - t.last_open_at)) / 60, 1),
         t.opens_today,
         t.last_write_at,
         round(extract(epoch from (now() - t.last_write_at)) / 60, 1),
         t.last_ping_at,
         t.missed,
         t.awake,
         t.last_terminate_at,
         t.app_version,
         t.battery_level,
         t.has_token,
         v_cron,
         t.alive_at,
         t.quiet_days
  from t
  order by t.contractor_user_id, t.last_write_at desc nulls last;
end;
$$;

revoke all on function app_presence() from anon, authenticated;
grant execute on function app_presence() to authenticated;

drop function if exists public.ops_live_status(uuid);
create or replace function public.ops_live_status(p_target uuid)
returns table (
  person_user_id uuid,
  -- The light: active, background, closed, unknown. Four, because that is what
  -- a person reads at a glance.
  state          text,
  -- What app_presence actually said, and why. The portal shows the light and
  -- carries these two so nothing is flattened away: 'push-blocked' and
  -- 'background' are the same colour and NOT the same problem.
  presence       text,
  detail         text,
  last_open      timestamptz,
  last_bg        timestamptz,
  last_terminate timestamptz,
  last_heard     timestamptz,
  quiet_min      int,
  opens_today    bigint,
  app_version    text,
  battery_level  numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_ops_admin() then
    raise exception 'ops live status: not authorized' using errcode = '42501';
  end if;

  return query
  select p.employee_user_id,
         case p.state
           when 'foreground'   then 'active'
           when 'background'   then 'background'
           -- Still running, just not answering pushes. A live app is amber,
           -- and the detail says which kind of amber it is.
           when 'push-blocked' then 'background'
           when 'force-closed' then 'closed'
           -- dark, no-push-token and unknown-cron-down are all "we do not
           -- know", and none of them earns a red light: two of them mean the
           -- silence proves nothing at all.
           else 'unknown'
         end,
         p.state,
         p.state_detail,
         p.last_open_at,
         p.last_bg_at,
         p.last_terminate_at,
         p.last_heard_at,
         case when p.minutes_since_heard is not null
              then floor(p.minutes_since_heard)::int end,
         p.opens_today,
         p.app_version,
         p.battery_level
    from public.app_presence() p
   where p.contractor_user_id = p_target;
end;
$$;

comment on function public.ops_live_status(uuid) is
  'The ops portal''s four lights for one account, read straight from app_presence: active, background, closed, unknown. Carries app_presence''s own seven-state answer and its explanation alongside, because push-blocked and background share a colour and not a cause. The rule lives in app_presence, never here and never in the page.';

revoke execute on function public.ops_live_status(uuid) from public, anon;
grant  execute on function public.ops_live_status(uuid) to authenticated;
