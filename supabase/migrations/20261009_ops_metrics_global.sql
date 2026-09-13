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
-- Three of them are observed. The fourth is inferred, and the inference is
-- written here rather than in the page so the portal and an agent cannot
-- disagree about what red means.
--
-- WHAT THE PHONE ACTUALLY TELLS US:
--   • analytics_events: a tap, screen or scroll. Flushed every 30s while the
--     app is in front, and once more the instant it backgrounds. So a
--     telemetry row inside the last two minutes means somebody is holding it.
--   • geo_events: fixes, region crossings, and (since the app log started
--     uploading) 'app-active' / 'app-background', the phone's own word for
--     the transition. Background location keeps flowing under Always, so
--     these keep arriving while the app sits behind other apps.
--
-- WHY FORCE CLOSED IS AN INFERENCE. iOS hands a webview no termination
-- callback: a force-quit fires nothing at all. What it DOES do is kill the
-- background watcher, so the fixes stop. Silence on both channels past the
-- 30-minute push-ping window is therefore the only evidence a force-quit ever
-- leaves. A dead battery, airplane mode and a phone in a basement look exactly
-- the same, which is why every red row carries the moment it went quiet: the
-- state is a reading, and the evidence is on screen next to it.
--
-- And silence is only meaningful for a phone that was recently alive. A person
-- who has reported nothing for a day is 'unknown', not force closed: the app
-- being shut overnight is not a fact worth a red light.
-- Dropped first: widening a returns-table is a type change, and Postgres
-- refuses to replace one in place (the lesson from 20261006).
drop function if exists public.ops_live_status(uuid);
create or replace function public.ops_live_status(p_target uuid)
returns table (
  person_user_id uuid,
  state          text,
  last_ui        timestamptz,
  last_geo       timestamptz,
  last_event     text,
  since          timestamptz,
  quiet_min      int,
  -- When the app last came to the front, and when it last went behind. On a
  -- backgrounded phone the first answers "how long ago did they actually look
  -- at it"; on a closed one the pair brackets the whole session, which is the
  -- only account of a force quit that exists.
  last_open      timestamptz,
  last_bg        timestamptz,
  -- Whether each of those is the PHONE's own word ('app-active'/'app-background'
  -- uploaded from its lifecycle log) or read off the telemetry session. An
  -- inferred time is close but it is not a report, and a screen that says
  -- "backgrounded" about a guess is lying in small print.
  open_reported  boolean,
  bg_reported    boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_ops_admin() then
    raise exception 'ops live status: not authorized' using errcode = '42501';
  end if;

  return query
  with people as (
    select r.person_user_id as uid from public.ops_view_roster() r
     where r.contractor_user_id = p_target
  ),
  ui as (
    select e.employee_user_id as uid, max(e.ts) as ts
      from analytics_events e
     where e.employee_user_id in (select uid from people)
       and e.ts > now() - interval '2 days'
       and e.event in ('page', 'click', 'scroll')
       and coalesce(e.source, 'app') <> 'test'
     group by 1
  ),
  geo as (
    select g.employee_user_id as uid, max(g.ts) as ts
      from geo_events g
     where g.employee_user_id in (select uid from people)
       and g.ts > now() - interval '2 days'
     group by 1
  ),
  -- The phone's own last word about being in front or behind, when it has one.
  life as (
    select distinct on (g.employee_user_id)
           g.employee_user_id as uid, g.type as kind, g.ts
      from geo_events g
     where g.employee_user_id in (select uid from people)
       and g.ts > now() - interval '2 days'
       and g.type in ('app-active', 'app-background')
     order by g.employee_user_id, g.ts desc
  ),
  -- The two edges, from the lifecycle log. A week rather than two days: a
  -- phone that has been shut since Thursday should still be able to say when
  -- Thursday was, which is exactly the question a red light raises.
  edges as (
    select g.employee_user_id as uid,
           max(g.ts) filter (where g.type = 'app-active')     as opened_at,
           max(g.ts) filter (where g.type = 'app-background') as bg_at
      from geo_events g
     where g.employee_user_id in (select uid from people)
       and g.ts > now() - interval '7 days'
       and g.type in ('app-active', 'app-background')
     group by 1
  ),
  -- The fallback, for a phone too old to upload a lifecycle log. Its most
  -- recent telemetry session starts when they opened it and ends within thirty
  -- seconds of them putting it down, because the app flushes on the way out.
  sess as (
    select uid, first_ts, last_ts from (
      select e.employee_user_id as uid,
             min(e.ts) as first_ts, max(e.ts) as last_ts,
             row_number() over (partition by e.employee_user_id order by max(e.ts) desc) as rn
        from analytics_events e
       where e.employee_user_id in (select uid from people)
         and e.ts > now() - interval '7 days'
         and e.event in ('page', 'click', 'scroll')
         and coalesce(e.source, 'app') <> 'test'
         and e.session_id is not null
       group by e.employee_user_id, e.session_id
    ) q where q.rn = 1
  ),
  m as (
    select p.uid,
           ui.ts  as ui_ts,
           geo.ts as geo_ts,
           life.kind as life_kind,
           greatest(coalesce(ui.ts, 'epoch'::timestamptz),
                    coalesce(geo.ts, 'epoch'::timestamptz)) as any_ts,
           edges.opened_at,
           edges.bg_at,
           sess.first_ts as sess_open,
           sess.last_ts  as sess_close
      from people p
      left join ui  on ui.uid  = p.uid
      left join geo on geo.uid = p.uid
      left join life on life.uid = p.uid
      left join edges on edges.uid = p.uid
      left join sess on sess.uid = p.uid
  )
  select m.uid,
         case
           -- In front of them: a tap or screen inside two minutes, or the
           -- phone's own 'came to the front' with nothing since to contradict.
           when m.ui_ts  > now() - interval '2 minutes' then 'active'
           when m.life_kind = 'app-active'
                and m.any_ts > now() - interval '2 minutes' then 'active'
           -- Running behind other apps: no taps, but the location layer is
           -- still reporting, which only a live app can do.
           when m.geo_ts > now() - interval '35 minutes' then 'background'
           -- Both channels silent past the push-ping window, on a phone that
           -- was alive within the day. Nothing is running.
           when m.any_ts > now() - interval '12 hours' then 'closed'
           else 'unknown'
         end,
         m.ui_ts,
         m.geo_ts,
         m.life_kind,
         nullif(m.any_ts, 'epoch'::timestamptz),
         case when m.any_ts > 'epoch'::timestamptz
              then floor(extract(epoch from (now() - m.any_ts)) / 60)::int end,
         coalesce(m.opened_at, m.sess_open),
         -- Only call it a background once they are not holding it: the close of
         -- a session still in progress is just the last tap.
         case when m.bg_at is not null then m.bg_at
              when m.ui_ts <= now() - interval '2 minutes' then m.sess_close end,
         m.opened_at is not null,
         m.bg_at is not null
    from m;
end;
$$;

comment on function public.ops_live_status(uuid) is
  'Per person on one account: active (taps within 2 min), background (no taps but location still reporting within 35 min), closed (both channels silent past the push-ping window on a phone alive within 12 hours), unknown (nothing recent). Closed is an inference, iOS gives a webview no termination callback, so every row carries when it went quiet, when the app was last opened and when it last went behind, plus whether each of those times is the phone''s own word or read off the telemetry session.';

revoke execute on function public.ops_live_status(uuid) from public, anon;
grant  execute on function public.ops_live_status(uuid) to authenticated;
