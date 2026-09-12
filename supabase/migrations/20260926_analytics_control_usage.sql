-- Which control, how long on the page, and the same three levels as everything
-- else. Owner 2026-09-11: "every button needs tracked and needs telemetry we
-- can see, I need clicks, I need to know how long they were on that page, ...
-- broken down by overall then trade averages then individual business owners".
--
-- Before this, a click was a COUNT PER PAGE. `pg-tracker: 757 clicks` was the
-- whole story, and nothing said whether those were the Income tab or the
-- Hiring tab. Nothing backfills: the ten weeks of existing click rows stay
-- page-level forever, which is why this lands before the screen that reads it.
--
-- Additive only (CLAUDE.md 3.1): one nullable column, one lookup table, three
-- new functions. usage_by_screen and every existing rollup are untouched and
-- keep returning exactly what they returned before.

-- ── The control, alongside the page ──────────────────────────────────────────
-- ctx stays the page. ctl is the control inside it, null on every row written
-- before today and on every event that is not a click.
alter table analytics_events add column if not exists ctl text;

create index if not exists analytics_events_ctl_idx
  on analytics_events (event, ctx, ctl) where ctl is not null;

-- ── What the screen is actually called ───────────────────────────────────────
-- Owner 2026-09-11: "I need it called what it is on screen". pg-tracker is
-- Books, pg-est-generic is the estimate builder, pg-cal is the calendar. The
-- ids are code names and several are actively misleading. Seeded by hand and
-- checked against index.html, because a scrape mislabels them (it reads
-- pg-dispatch as "Books" from the neighbouring block).
create table if not exists analytics_screen_names (
  screen text primary key,
  label  text not null,
  sort   int  not null default 100
);

insert into analytics_screen_names (screen, label, sort) values
  ('pg-dash',          'Dashboard',        10),
  ('pg-tracker',       'Books',            20),
  ('pg-timelog',       'Timesheet',        30),
  ('pg-leads',         'Leads',            40),
  ('pg-clients',       'Clients',          50),
  ('pg-client-detail', 'Client detail',    55),
  ('pg-client-hub',    'Client hub',       57),
  ('pg-est-generic',   'Estimate builder', 60),
  ('pg-est',           'Paint estimate',   62),
  ('pg-proposals',     'Proposals',        64),
  ('pg-contracts',     'Contracts',        66),
  ('pg-jobs',          'Jobs',             70),
  ('pg-schedule',      'Schedule',         72),
  ('pg-cal',           'Calendar',         74),
  ('pg-dispatch',      'Dispatch',         76),
  ('pg-money',         'Collect',          80),
  ('pg-taxes',         'Taxes',            82),
  ('pg-licensing',     'Licensing',        84),
  ('pg-team',          'Fleet & Team',     90),
  ('pg-gallery',       'Gallery',          92),
  ('pg-checklist',     'Setup checklist',  94),
  ('pg-qr-leads',      'QR codes',         96),
  ('pg-settings',      'Settings',         98)
on conflict (screen) do update set label = excluded.label, sort = excluded.sort;

alter table analytics_screen_names enable row level security;
revoke all on analytics_screen_names from anon, authenticated;

-- ── The spine every level reads ──────────────────────────────────────────────
-- One place decides what counts, so the three levels can never disagree about
-- a number (the lesson from the 332% close rate: two sources, one metric).
-- source='test' is the flow suite driving the deployed app with a real login;
-- it reaches ingest-telemetry exactly like a tap and must never be a user.
create or replace view v_control_event as
  select e.contractor_user_id,
         e.employee_user_id,
         e.role,
         e.session_id,
         e.ts,
         e.event,
         e.ctx  as screen,
         e.ctl  as control,
         coalesce(e.value, 1)::numeric as value
    from analytics_events e
   where coalesce(e.source, 'app') <> 'test'
     and e.contractor_user_id is not null
     and e.contractor_user_id not in (select user_id from analytics_internal_accounts);

-- ── Overall ──────────────────────────────────────────────────────────────────
create or replace function control_usage_summary(p_from date, p_to date)
returns table (
  screen text, label text, control text,
  clicks bigint, sessions bigint, people integer, businesses integer,
  dwell_min numeric, avg_visit_sec numeric, visits bigint
)
language plpgsql security definer set search_path = public as $$
begin
  if not is_ops_admin() then raise exception 'ops dashboard: not authorized' using errcode = '42501'; end if;
  return query
  -- Every column is alias-qualified: this function's OUT parameters are named
  -- screen, control and clicks, and an unqualified reference to any of them is
  -- ambiguous to plpgsql rather than an error at create time. It compiles
  -- either way and fails on the first call.
  with win as (
    select * from v_control_event
     where ts >= p_from::timestamptz and ts < (p_to + 1)::timestamptz
  ),
  -- Dwell is per SCREEN, not per control: the seconds belong to the visit, and
  -- attributing them to whichever button happened to be pressed would invent a
  -- number. Every control row on a screen reports that screen's dwell.
  d as (
    select w.screen as scr, sum(w.value)/60.0 as dwell_min, count(*) as visits,
           avg(w.value) as avg_visit_sec
      from win w where w.event = 'dwell' group by w.screen
  ),
  c as (
    select w.screen as scr, w.control as ctl,
           sum(w.value)::bigint            as clicks,
           count(distinct w.session_id)    as sessions,
           count(distinct w.employee_user_id)   as people,
           count(distinct w.contractor_user_id) as businesses
      from win w where w.event = 'click' and w.control is not null
     group by w.screen, w.control
  )
  select c.scr,
         coalesce(n.label, c.scr),
         c.ctl,
         c.clicks, c.sessions, c.people::int, c.businesses::int,
         round(coalesce(d.dwell_min, 0), 1),
         round(coalesce(d.avg_visit_sec, 0), 1),
         coalesce(d.visits, 0)
    from c
    left join d on d.scr = c.scr
    left join analytics_screen_names n on n.screen = c.scr
   order by c.clicks desc, c.scr;
end $$;

-- ── Trade averages ───────────────────────────────────────────────────────────
-- PER BUSINESS, not per raw total, which is the only way a trade with three
-- shops compares to a trade with thirty. A trade's number is what its average
-- business does, so one heavy user cannot speak for the trade.
create or replace function control_usage_by_trade(p_from date, p_to date)
returns table (
  trade text, screen text, label text, control text,
  businesses integer, clicks bigint, clicks_per_business numeric,
  dwell_min numeric, dwell_min_per_business numeric
)
language plpgsql security definer set search_path = public as $$
begin
  if not is_ops_admin() then raise exception 'ops dashboard: not authorized' using errcode = '42501'; end if;
  return query
  with win as (
    select w.*, coalesce(a.trade, 'unknown') as trade
      from v_control_event w
      left join v_account_dim a on a.contractor_user_id = w.contractor_user_id
     where w.ts >= p_from::timestamptz and w.ts < (p_to + 1)::timestamptz
  ),
  d as (
    select w.trade, w.screen,
           sum(w.value)/60.0 as dwell_min,
           count(distinct w.contractor_user_id) as biz
      from win w where w.event = 'dwell' group by w.trade, w.screen
  ),
  c as (
    select w.trade, w.screen, w.control,
           sum(w.value)::bigint as clicks,
           count(distinct w.contractor_user_id) as biz
      from win w where w.event = 'click' and w.control is not null
     group by w.trade, w.screen, w.control
  )
  select c.trade, c.screen, coalesce(n.label, c.screen), c.control,
         c.biz::int, c.clicks,
         round(c.clicks::numeric / nullif(c.biz, 0), 1),
         round(coalesce(d.dwell_min, 0), 1),
         round(coalesce(d.dwell_min, 0) / nullif(d.biz, 0), 1)
    from c
    left join d on d.trade = c.trade and d.screen = c.screen
    left join analytics_screen_names n on n.screen = c.screen
   order by c.trade, c.clicks desc;
end $$;

-- ── Individual business owners ───────────────────────────────────────────────
create or replace function control_usage_by_contractor(p_from date, p_to date)
returns table (
  contractor_user_id uuid, business text, trade text,
  screen text, label text, control text,
  clicks bigint, sessions bigint, people integer,
  dwell_min numeric, visits bigint, last_used date
)
language plpgsql security definer set search_path = public as $$
begin
  if not is_ops_admin() then raise exception 'ops dashboard: not authorized' using errcode = '42501'; end if;
  return query
  with win as (
    select * from v_control_event
     where ts >= p_from::timestamptz and ts < (p_to + 1)::timestamptz
  ),
  d as (
    select w.contractor_user_id as cid, w.screen,
           sum(w.value)/60.0 as dwell_min, count(*) as visits
      from win w where w.event = 'dwell' group by w.contractor_user_id, w.screen
  ),
  c as (
    select w.contractor_user_id as cid, w.screen, w.control,
           sum(w.value)::bigint as clicks,
           count(distinct w.session_id) as sessions,
           count(distinct w.employee_user_id) as people,
           max((w.ts at time zone 'America/Chicago')::date) as last_used
      from win w where w.event = 'click' and w.control is not null
     group by w.contractor_user_id, w.screen, w.control
  )
  select c.cid,
         coalesce(a.business, '(unknown)'),
         coalesce(a.trade, 'unknown'),
         c.screen, coalesce(n.label, c.screen), c.control,
         c.clicks, c.sessions, c.people::int,
         round(coalesce(d.dwell_min, 0), 1),
         coalesce(d.visits, 0),
         c.last_used
    from c
    left join d on d.cid = c.cid and d.screen = c.screen
    left join v_account_dim a on a.contractor_user_id = c.cid
    left join analytics_screen_names n on n.screen = c.screen
   order by c.clicks desc;
end $$;

revoke all on function control_usage_summary(date, date)       from anon, authenticated;
revoke all on function control_usage_by_trade(date, date)      from anon, authenticated;
revoke all on function control_usage_by_contractor(date, date) from anon, authenticated;
grant execute on function control_usage_summary(date, date)       to authenticated;
grant execute on function control_usage_by_trade(date, date)      to authenticated;
grant execute on function control_usage_by_contractor(date, date) to authenticated;

revoke all on v_control_event from anon, authenticated;
