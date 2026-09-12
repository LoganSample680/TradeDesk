-- Five ops rollups threw on their FIRST EVER call. Found 2026-09-11 while
-- building the dashboard that reads them, which is the first time anything
-- had actually called them rather than checked that they refuse a stranger.
--
-- ROOT CAUSE, one sentence: sum() returns NUMERIC in Postgres, including
-- sum(bigint), but these functions declare those columns bigint, so the
-- RETURN QUERY fails with "structure of query does not match function result
-- type" every time. Plus funnel_by_contractor names an OUT parameter
-- contractor_user_id and then selects an unqualified contractor_user_id inside
-- two subqueries, which plpgsql reads as ambiguous.
--
-- WHY IT SHIPPED. Both classes are invisible at create time: Postgres accepts
-- the function and only resolves the row type when it runs. The lockdown work
-- proved every one of these raises 42501 for a non-admin, and that test passes
-- whether or not the query underneath it works, because the gate returns
-- before the query is ever reached. A gate test is not a call.
--
-- Return types are NOT changed: create or replace cannot change them, and the
-- declared types are right. Minutes are cast with round()::bigint, matching
-- 20260924 and CLAUDE.md 17: a minute is a whole number.

-- ── ops_summary ──────────────────────────────────────────────────────────────
create or replace function ops_summary(p_from date, p_to date)
returns table (
  days integer, people integer, accounts integer, active_days bigint,
  clock_punches bigint, days_clocked bigint, avg_day_min numeric,
  total_miles numeric, avg_miles_per_day numeric, days_driven bigint,
  total_drive_min bigint, total_site_min bigint, avg_visit_min numeric,
  unnamed_min bigint, unnamed_legs bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  select (p_to - p_from) + 1,
         count(distinct d.employee_user_id)::int,
         count(distinct d.contractor_user_id)::int,
         count(*) filter (where d.app_opened),
         coalesce(sum(d.clock_punches), 0)::bigint,
         count(*) filter (where d.clocks_closed > 0),
         round(avg(d.worked_min) filter (where d.worked_min > 0), 1),
         round(sum(d.miles), 1),
         round(avg(d.miles) filter (where d.miles > 0), 1),
         count(*) filter (where d.miles > 0),
         round(coalesce(sum(d.drive_min), 0))::bigint,
         round(coalesce(sum(d.site_min), 0))::bigint,
         round(sum(d.site_min)::numeric / nullif(sum(d.visits), 0), 1),
         round(coalesce(sum(d.unnamed_min), 0))::bigint,
         coalesce(sum(d.mileage_legs_unnamed), 0)::bigint
  from v_ops_daily d
  where d.day between p_from and p_to;
end;
$$;

-- ── ops_by_contractor ────────────────────────────────────────────────────────
create or replace function ops_by_contractor(p_from date, p_to date)
returns table (
  contractor_user_id uuid, business text, people integer, crew integer,
  active_days bigint, clock_punches bigint, days_clocked bigint,
  avg_day_min numeric, total_miles numeric, avg_miles_per_day numeric,
  drive_min bigint, site_min bigint, shop_min bigint, visits bigint,
  avg_visit_min numeric, unnamed_min bigint, unnamed_legs bigint,
  last_active date
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  select d.contractor_user_id,
         -- The business's own name. Falls back to the owner's email only when
         -- an account row has never been written (a signup that never finished).
         coalesce(nullif(btrim(a.business_name), ''), u.email, 'Unknown'),
         count(distinct d.employee_user_id)::int,
         count(distinct d.employee_user_id) filter (where d.role = 'crew')::int,
         count(*) filter (where d.app_opened),
         coalesce(sum(d.clock_punches), 0)::bigint,
         count(*) filter (where d.clocks_closed > 0),
         round(avg(d.worked_min) filter (where d.worked_min > 0), 1),
         round(sum(d.miles), 1),
         round(avg(d.miles) filter (where d.miles > 0), 1),
         round(coalesce(sum(d.drive_min), 0))::bigint,
         round(coalesce(sum(d.site_min), 0))::bigint,
         round(coalesce(sum(d.shop_min), 0))::bigint,
         coalesce(sum(d.visits), 0)::bigint,
         round(sum(d.site_min)::numeric / nullif(sum(d.visits), 0), 1),
         round(coalesce(sum(d.unnamed_min), 0))::bigint,
         coalesce(sum(d.mileage_legs_unnamed), 0)::bigint,
         max(d.day) filter (where d.app_opened)
  from v_ops_daily d
  left join accounts a on a.owner_id = d.contractor_user_id
  left join auth.users u on u.id = d.contractor_user_id
  where d.day between p_from and p_to
    and d.contractor_user_id is not null
  group by d.contractor_user_id, a.business_name, u.email
  order by count(*) filter (where d.app_opened) desc;
end;
$$;

-- ── ops_daily ────────────────────────────────────────────────────────────────
-- No sums here: the view's own minute columns are numeric and the function
-- declares them bigint, so the mismatch is per row rather than per group.
create or replace function ops_daily(p_from date, p_to date)
returns table (
  day date, contractor_user_id uuid, business text, employee_user_id uuid,
  role text, app_opened boolean, clock_punches bigint, worked_min bigint,
  miles numeric, mileage_legs bigint, mileage_legs_unnamed bigint,
  drive_min bigint, site_min bigint, shop_min bigint, unnamed_min bigint,
  drives bigint, visits bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  select d.day, d.contractor_user_id,
         coalesce(nullif(btrim(a.business_name), ''), u.email, 'Unknown'),
         d.employee_user_id, d.role,
         d.app_opened, d.clock_punches, round(coalesce(d.worked_min, 0))::bigint,
         round(d.miles::numeric, 1), d.mileage_legs, d.mileage_legs_unnamed,
         round(coalesce(d.drive_min, 0))::bigint,
         round(coalesce(d.site_min, 0))::bigint,
         round(coalesce(d.shop_min, 0))::bigint,
         round(coalesce(d.unnamed_min, 0))::bigint,
         d.drives, d.visits
  from v_ops_daily d
  left join accounts a on a.owner_id = d.contractor_user_id
  left join auth.users u on u.id = d.contractor_user_id
  where d.day between p_from and p_to
  order by d.day, 3;
end;
$$;

-- ── funnel_by_contractor ─────────────────────────────────────────────────────
-- The subqueries are aliased so contractor_user_id can never be read as this
-- function's own OUT parameter. Nothing else about the query changes.
create or replace function funnel_by_contractor(p_from date, p_to date)
returns table (
  contractor_user_id uuid, business text, trade text, leads bigint,
  bids_sent bigint, sent_opened bigint, sent_signed bigint,
  signed_total bigint, signed_paid bigint, open_rate numeric,
  close_rate numeric, signed_value numeric, avg_ticket numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  select d.contractor_user_id, d.business, d.trade,
         coalesce(l.leads, 0),
         coalesce(b.bids_sent, 0), coalesce(b.sent_opened, 0), coalesce(b.sent_signed, 0),
         coalesce(b.signed_total, 0), coalesce(b.signed_paid, 0),
         round(100.0 * b.sent_opened / nullif(b.bids_sent, 0), 1),
         round(100.0 * b.sent_signed / nullif(b.bids_sent, 0), 1),
         round(coalesce(b.signed_value, 0), 2),
         round(b.signed_value / nullif(b.signed_total, 0), 2)
  from v_account_dim d
  left join (
    select le.contractor_user_id as cid,
           count(*) filter (where le.event = 'lead_created') as leads
    from lifecycle_events le
    where le.ts::date between p_from and p_to
      and (le.bid_id is null or le.bid_id not in (select t.bid_id from v_test_bid_ids t))
    group by le.contractor_user_id
  ) l on l.cid = d.contractor_user_id
  left join (
    select fb.contractor_user_id as cid,
           count(*) filter (where fb.sent_at is not null)                              as bids_sent,
           count(*) filter (where fb.sent_at is not null and fb.opened_at is not null) as sent_opened,
           count(*) filter (where fb.sent_at is not null and fb.signed_at is not null) as sent_signed,
           count(*) filter (where fb.signed_at is not null)                            as signed_total,
           count(*) filter (where fb.signed_at is not null and fb.paid_at is not null) as signed_paid,
           sum(fb.amount) filter (where fb.signed_at is not null)                      as signed_value
    from v_funnel_bid fb
    where coalesce(fb.sent_at, fb.signed_at, fb.opened_at, fb.saved_at)::date between p_from and p_to
    group by fb.contractor_user_id
  ) b on b.cid = d.contractor_user_id
  where coalesce(l.leads, 0) + coalesce(b.bids_sent, 0) + coalesce(b.signed_total, 0) > 0
  order by coalesce(b.signed_total, 0) desc, coalesce(b.bids_sent, 0) desc;
end;
$$;

-- ── funnel_by_trade ──────────────────────────────────────────────────────────
-- Reads funnel_by_contractor, so it could never have worked either. Its own
-- sums are numeric against bigint columns, the same defect one level up.
create or replace function funnel_by_trade(p_from date, p_to date)
returns table (
  trade text, businesses integer, leads bigint, bids_sent bigint,
  sent_opened bigint, sent_signed bigint, signed_total bigint,
  open_rate numeric, close_rate numeric, signed_value numeric, avg_ticket numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  select f.trade, count(*)::int,
         coalesce(sum(f.leads), 0)::bigint,
         coalesce(sum(f.bids_sent), 0)::bigint,
         coalesce(sum(f.sent_opened), 0)::bigint,
         coalesce(sum(f.sent_signed), 0)::bigint,
         coalesce(sum(f.signed_total), 0)::bigint,
         round(100.0 * sum(f.sent_opened) / nullif(sum(f.bids_sent), 0), 1),
         round(100.0 * sum(f.sent_signed) / nullif(sum(f.bids_sent), 0), 1),
         round(sum(f.signed_value), 2),
         round(sum(f.signed_value) / nullif(sum(f.signed_total), 0), 2)
  from funnel_by_contractor(p_from, p_to) f
  group by f.trade
  order by sum(f.signed_total) desc;
end;
$$;

revoke all on function ops_summary(date, date)          from anon, authenticated;
revoke all on function ops_by_contractor(date, date)    from anon, authenticated;
revoke all on function ops_daily(date, date)            from anon, authenticated;
revoke all on function funnel_by_contractor(date, date) from anon, authenticated;
revoke all on function funnel_by_trade(date, date)      from anon, authenticated;
grant execute on function ops_summary(date, date)          to authenticated;
grant execute on function ops_by_contractor(date, date)    to authenticated;
grant execute on function ops_daily(date, date)            to authenticated;
grant execute on function funnel_by_contractor(date, date) to authenticated;
grant execute on function funnel_by_trade(date, date)      to authenticated;
