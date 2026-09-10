-- ════════════════════════════════════════════════════════════════════════
-- Second layer for the ops dashboard: the funnel, the money, the usage.
--
-- 20260917 answered "how hard is the crew working." This answers "does the
-- product work": where a job dies between the phone ringing and the money
-- landing, and which screens people actually touch on the way.
--
-- Three things made this possible that were not obvious:
--
-- 1. lifecycle_events is already a real append-only funnel ledger, 9 stages
--    deep, and nothing reads it. td_bids is NOT usable for this: it is a
--    live snapshot the sync sweep prunes, 4,283 rows down to 51 live. A
--    funnel built on it would silently lose most of its history.
-- 2. account_config.business_type is populated for every account, so a
--    per-trade cut is real today rather than a schema change away.
-- 3. contractor_hash is not one-way in practice. It is
--    sha256('tdh:' || uid) truncated to 8 bytes, with a constant salt and
--    about thirty users, so the whole rainbow table rebuilds in one join.
--    That is what makes the 15,000 telemetry rows from before the grain
--    migration attributable at all. Worth being clear-eyed about: this
--    hash anonymizes nothing against anyone holding the user list.
--
-- Everything here is allowlist-gated exactly like 20260919. The views stay
-- unreachable from outside; the functions are the contract.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Who each account is ──────────────────────────────────────────────────
-- Not every contractor has an accounts row: an account created before that
-- table existed, or a signup that never finished, still shows up all over the
-- operational data. Union rather than select, or those businesses vanish from
-- every rollup below while their rows keep counting toward the totals.
create or replace view v_account_dim as
with ids as (
  select owner_id as contractor_user_id from accounts where owner_id is not null
  union select contractor_user_id from lifecycle_events where contractor_user_id is not null
  union select contractor_user_id from signed_proposals where contractor_user_id is not null
  union select contractor_user_id from job_time_entries where contractor_user_id is not null
)
select i.contractor_user_id,
       coalesce(nullif(btrim(a.business_name), ''), u.email, 'Unknown')  as business,
       coalesce(nullif(btrim(ac.business_type), ''), 'unknown')          as trade,
       ac.trade_lines,
       a.state,
       coalesce(a.created_at, u.created_at)::date                        as joined_on
from ids i
left join accounts a       on a.owner_id = i.contractor_user_id
left join account_config ac on ac.account_id = a.id
left join auth.users u     on u.id = i.contractor_user_id
where not exists (select 1 from analytics_internal_accounts n where n.user_id = i.contractor_user_id);

comment on view v_account_dim is
  'One row per real business: name, trade, state, join date. Union of accounts owners and anyone who appears as a contractor in the operational tables, so pre-accounts businesses are not silently dropped. Internal accounts excluded.';

-- ── 2. The telemetry rainbow ────────────────────────────────────────────────
-- Undoes the contractor_hash so pre-grain telemetry attributes to a person.
create or replace view v_telemetry_person as
select 'c' || encode(substring(extensions.digest('tdh:' || u.id::text, 'sha256') from 1 for 8), 'hex') as contractor_hash,
       u.id as user_id
from auth.users u;

comment on view v_telemetry_person is
  'contractor_hash back to the uid that produced it. The hash is sha256 of a constant-salted uid truncated to 8 bytes, so this is a rebuildable lookup, not a break. Exists so telemetry predating the account-grain migration is still attributable.';

-- ── 2b. The bids CI wrote ───────────────────────────────────────────────────
-- 404 of the 615 signed_proposals rows are flow-test signatures, and they sit
-- under a REAL login, so excluding internal accounts does not touch them. The
-- only positive marker is `_e2e` on the bid row itself, which survives the
-- soft delete, so the sweep does not hide the evidence.
--
-- Known and deliberately not papered over: ~119 signed rows have no bid row at
-- all (the bid was hard-deleted), and most of those are old test data named
-- "History 3" and "E2E CO Client". They still count. The fix is for CI to
-- stamp its own signatures, not for this view to pattern-match client names,
-- which would quietly start dropping a real customer the day one is called
-- History. Until then `signed` runs about a hundred high on the all-time range
-- and is clean on any window after 2026-08-06.
create or replace view v_test_bid_ids as
  select id as bid_id from td_bids where data ? '_e2e';

comment on view v_test_bid_ids is
  'Bid ids written by the flow-test suite. The only positive CI marker in the proposal chain: CI runs under a real login, so account-level exclusion misses it.';

revoke all on v_test_bid_ids from anon, authenticated;

-- ── 3. One row per proposal, every timestamp on it ──────────────────────────
-- The spine of the funnel. Stages come from the append-only ledgers only:
-- lifecycle_events for what the contractor did, proposal_views and
-- proposal_audit_events for what the client did, signed_proposals for the
-- money. Nothing reads td_bids, on purpose (see the header).
create or replace view v_funnel_bid as
with l as (
  select bid_id, min(contractor_user_id::text)::uuid as contractor_user_id,
         min(ts) filter (where event = 'proposal_saved')    as saved_at,
         min(ts) filter (where event = 'proposal_sent')     as sent_at,
         min(ts) filter (where event = 'job_scheduled')     as scheduled_at,
         min(ts) filter (where event = 'payment_received')  as paid_at,
         min(ts) filter (where event = 'balance_settled')   as settled_at,
         min(ts) filter (where event = 'job_completed')     as completed_at,
         min(client_id) as client_id
  from lifecycle_events where bid_id is not null
    and bid_id not in (select bid_id from v_test_bid_ids)
  group by bid_id
),
v as (
  select bid_id,
         min(client_opened_at) as opened_at,
         max(furthest_step)    as furthest_step
  from proposal_views where bid_id is not null
    and bid_id not in (select bid_id from v_test_bid_ids)
  group by bid_id
),
au as (
  select bid_id,
         min(ts) filter (where event = 'approved')        as approved_at,
         min(ts) filter (where event = 'method_selected') as method_at
  from proposal_audit_events where bid_id is not null
    and bid_id not in (select bid_id from v_test_bid_ids)
  group by bid_id
),
g as (
  select bid_id,
         min(signed_at)  as signed_at,
         max(amount)     as amount,
         max(deposit)    as deposit,
         min(payment_method) as payment_method,
         min(payment_status) as payment_status,
         bool_or(cancelled_at is not null) as cancelled,
         bool_or(decline_reason is not null) as declined,
         sum(stripe_fee) as stripe_fee
  from signed_proposals where bid_id is not null
    and bid_id not in (select bid_id from v_test_bid_ids)
  group by bid_id
)
select coalesce(l.bid_id, v.bid_id, au.bid_id, g.bid_id)              as bid_id,
       coalesce(l.contractor_user_id, g2.contractor_user_id)          as contractor_user_id,
       l.client_id,
       l.saved_at, l.sent_at, v.opened_at, au.approved_at, au.method_at,
       g.signed_at, l.scheduled_at, l.paid_at, l.settled_at, l.completed_at,
       v.furthest_step, g.amount, g.deposit, g.payment_method, g.payment_status,
       coalesce(g.cancelled, false) as cancelled,
       coalesce(g.declined, false)  as declined,
       g.stripe_fee
from l
full outer join v  on v.bid_id  = l.bid_id
full outer join au on au.bid_id = coalesce(l.bid_id, v.bid_id)
full outer join g  on g.bid_id  = coalesce(l.bid_id, v.bid_id, au.bid_id)
left join (select bid_id, min(contractor_user_id::text)::uuid contractor_user_id
           from signed_proposals
           where bid_id not in (select bid_id from v_test_bid_ids)
           group by bid_id) g2
       on g2.bid_id = coalesce(l.bid_id, v.bid_id, au.bid_id, g.bid_id);

comment on view v_funnel_bid is
  'One row per proposal with every stage timestamp: saved, sent, client opened, approved, method chosen, signed, scheduled, paid, settled, completed. Built only from append-only ledgers, never from td_bids, which the sync sweep prunes.';

revoke all on v_account_dim, v_telemetry_person, v_funnel_bid from anon, authenticated;

-- ── 4. One row per telemetry session ────────────────────────────────────────
-- ctx is the screen id and value is a rolled-up count, so this is
-- screen-grain, not control-grain. Per-button telemetry does not exist yet;
-- anything claiming to report it would be inventing numbers.
create or replace view v_usage_session as
select e.ts::date                                     as day,
       coalesce(e.contractor_user_id, pa.contractor_user_id) as contractor_user_id,
       coalesce(e.employee_user_id, p.user_id)        as employee_user_id,
       e.session_id,
       min(e.ts)                                      as first_ts,
       max(e.ts)                                      as last_ts,
       count(distinct e.ctx) filter (where e.event = 'page')   as screens,
       coalesce(sum(e.value) filter (where e.event = 'page'), 0)   as page_views,
       coalesce(sum(e.value) filter (where e.event = 'click'), 0)  as clicks,
       coalesce(sum(e.value) filter (where e.event = 'scroll'), 0) as scrolls,
       max(e.meta->>'v')                              as app_version
from analytics_events e
left join v_telemetry_person p on p.contractor_hash = e.contractor_hash
left join v_person_account pa  on pa.employee_user_id = coalesce(e.employee_user_id, p.user_id)
-- CI writes flow_step and flow_total from a real login, so excluding the
-- account is not enough: the events themselves have to go.
where e.event in ('page', 'click', 'scroll')
  and coalesce(e.source, 'app') <> 'test'
  and e.session_id is not null
group by 1, 2, 3, 4;

comment on view v_usage_session is
  'One row per telemetry session: screens touched, page views, clicks, scrolls, app version. Screen-grain only, there is no per-control telemetry. Flow-test events excluded.';

revoke all on v_usage_session from anon, authenticated;

-- ── 5. The funnel, three cuts ───────────────────────────────────────────────
-- EVERY RATE IS A SUBSET OF ITS OWN DENOMINATOR, and that is not a stylistic
-- choice. The first cut of this counted `sent` from lifecycle_events and
-- `signed` from signed_proposals, which are different populations over
-- different date ranges: lifecycle logging starts 2026-07-29, signatures go
-- back to 2025. It reported a 332% close rate. A dashboard number that can
-- exceed 100% is not a number, it is a bug with a percent sign on it.
--
-- So every bid stage is counted on one spine, v_funnel_bid, and a rate is
-- always "of the bids that reached the previous stage, how many reached this
-- one." `signed_total` is reported alongside `sent_signed` precisely so the
-- gap between them (a signature with no recorded send, i.e. a bid that
-- predates the ledger) is visible rather than folded into a ratio.
--
-- leads / visits_booked / started stay separate on purpose: they happen
-- before a bid exists, so they are client-grain and cannot join this spine.
create or replace function funnel_summary(p_from date, p_to date)
returns table (
  leads           bigint,
  visits_booked   bigint,
  started         bigint,
  bids_sent       bigint,
  sent_opened     bigint,
  sent_approved   bigint,
  sent_signed     bigint,
  signed_total    bigint,
  signed_paid     bigint,
  signed_scheduled bigint,
  completed       bigint,
  open_rate       numeric,
  approve_rate    numeric,
  close_rate      numeric,
  pay_rate        numeric,
  ledger_start    date
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  with c as (
    select count(*) filter (where l.event = 'lead_created')          as leads,
           count(*) filter (where l.event = 'estimate_visit_booked') as visits_booked,
           count(*) filter (where l.event = 'proposal_started')      as started
    from lifecycle_events l
    join v_account_dim d on d.contractor_user_id = l.contractor_user_id
    where l.ts::date between p_from and p_to
      and (l.bid_id is null or l.bid_id not in (select bid_id from v_test_bid_ids))
  ),
  b as (
    select
      count(*) filter (where f.sent_at is not null)                                   as bids_sent,
      count(*) filter (where f.sent_at is not null and f.opened_at   is not null)     as sent_opened,
      count(*) filter (where f.sent_at is not null and f.approved_at is not null)     as sent_approved,
      count(*) filter (where f.sent_at is not null and f.signed_at   is not null)     as sent_signed,
      count(*) filter (where f.signed_at is not null)                                 as signed_total,
      count(*) filter (where f.signed_at is not null and f.paid_at      is not null)  as signed_paid,
      count(*) filter (where f.signed_at is not null and f.scheduled_at is not null)  as signed_scheduled,
      count(*) filter (where f.completed_at is not null)                              as completed
    from v_funnel_bid f
    join v_account_dim d on d.contractor_user_id = f.contractor_user_id
    where coalesce(f.sent_at, f.signed_at, f.opened_at, f.saved_at)::date
          between p_from and p_to
  )
  select c.leads, c.visits_booked, c.started,
         b.bids_sent, b.sent_opened, b.sent_approved, b.sent_signed,
         b.signed_total, b.signed_paid, b.signed_scheduled, b.completed,
         round(100.0 * b.sent_opened   / nullif(b.bids_sent, 0), 1),
         round(100.0 * b.sent_approved / nullif(b.bids_sent, 0), 1),
         round(100.0 * b.sent_signed   / nullif(b.bids_sent, 0), 1),
         round(100.0 * b.signed_paid   / nullif(b.signed_total, 0), 1),
         (select min(ts)::date from lifecycle_events where event = 'proposal_sent')
  from c, b;
end;
$$;

comment on function funnel_summary(date, date) is
  'Lead to money, one row. Every rate is a subset of its own denominator, so none can exceed 100%. signed_total minus sent_signed is signatures with no recorded send, which is bids predating the lifecycle ledger, not a conversion.';

create or replace function funnel_by_contractor(p_from date, p_to date)
returns table (
  contractor_user_id uuid,
  business     text,
  trade        text,
  leads        bigint,
  bids_sent    bigint,
  sent_opened  bigint,
  sent_signed  bigint,
  signed_total bigint,
  signed_paid  bigint,
  open_rate    numeric,
  close_rate   numeric,
  signed_value numeric,
  avg_ticket   numeric
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
    select contractor_user_id, count(*) filter (where event = 'lead_created') as leads
    from lifecycle_events
    where ts::date between p_from and p_to
      and (bid_id is null or bid_id not in (select bid_id from v_test_bid_ids))
    group by 1
  ) l on l.contractor_user_id = d.contractor_user_id
  left join (
    select contractor_user_id,
           count(*) filter (where sent_at is not null)                            as bids_sent,
           count(*) filter (where sent_at is not null and opened_at is not null)  as sent_opened,
           count(*) filter (where sent_at is not null and signed_at is not null)  as sent_signed,
           count(*) filter (where signed_at is not null)                          as signed_total,
           count(*) filter (where signed_at is not null and paid_at is not null)  as signed_paid,
           sum(amount) filter (where signed_at is not null)                       as signed_value
    from v_funnel_bid
    where coalesce(sent_at, signed_at, opened_at, saved_at)::date between p_from and p_to
    group by 1
  ) b on b.contractor_user_id = d.contractor_user_id
  where coalesce(l.leads, 0) + coalesce(b.bids_sent, 0) + coalesce(b.signed_total, 0) > 0
  order by coalesce(b.signed_total, 0) desc, coalesce(b.bids_sent, 0) desc;
end;
$$;

create or replace function funnel_by_trade(p_from date, p_to date)
returns table (
  trade        text,
  businesses   int,
  leads        bigint,
  bids_sent    bigint,
  sent_opened  bigint,
  sent_signed  bigint,
  signed_total bigint,
  open_rate    numeric,
  close_rate   numeric,
  signed_value numeric,
  avg_ticket   numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  select f.trade, count(*)::int,
         sum(f.leads), sum(f.bids_sent), sum(f.sent_opened), sum(f.sent_signed),
         sum(f.signed_total),
         round(100.0 * sum(f.sent_opened) / nullif(sum(f.bids_sent), 0), 1),
         round(100.0 * sum(f.sent_signed) / nullif(sum(f.bids_sent), 0), 1),
         round(sum(f.signed_value), 2),
         round(sum(f.signed_value) / nullif(sum(f.signed_total), 0), 2)
  from funnel_by_contractor(p_from, p_to) f
  group by f.trade
  order by sum(f.signed_total) desc;
end;
$$;

-- ── 6. How long each stage takes ────────────────────────────────────────────
-- Median plus quartiles, never a bare average: one proposal signed three
-- weeks late drags a mean past the point of meaning anything.
--
-- MINUTES, not hours. In hours every stage on today's data reports 0.00,
-- because the only proposals in the system were sent, opened and signed by
-- the same person within a few minutes. An axis whose entire range rounds to
-- zero teaches nothing; minutes keep the shape visible now and still read
-- fine when a real client takes two days (2,880).
create or replace function funnel_timing(p_from date, p_to date)
returns table (
  stage      text,
  stage_no   int,
  n          bigint,
  p25_min    numeric,
  median_min numeric,
  p75_min    numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  with h as (
    select 'saved to sent'::text as stage, 1 as stage_no, extract(epoch from (f.sent_at - f.saved_at))/60 as mins
      from v_funnel_bid f join v_account_dim d using (contractor_user_id)
      where f.sent_at is not null and f.saved_at is not null
        and f.sent_at::date between p_from and p_to
    union all
    select 'sent to opened', 2, extract(epoch from (f.opened_at - f.sent_at))/60
      from v_funnel_bid f join v_account_dim d using (contractor_user_id)
      where f.opened_at is not null and f.sent_at is not null
        and f.sent_at::date between p_from and p_to
    union all
    select 'opened to signed', 3, extract(epoch from (f.signed_at - f.opened_at))/60
      from v_funnel_bid f join v_account_dim d using (contractor_user_id)
      where f.signed_at is not null and f.opened_at is not null
        and f.signed_at::date between p_from and p_to
    union all
    select 'signed to paid', 5, extract(epoch from (f.paid_at - f.signed_at))/60
      from v_funnel_bid f join v_account_dim d using (contractor_user_id)
      where f.paid_at is not null and f.signed_at is not null
        and f.paid_at::date between p_from and p_to
    union all
    select 'signed to scheduled', 4, extract(epoch from (f.scheduled_at - f.signed_at))/60
      from v_funnel_bid f join v_account_dim d using (contractor_user_id)
      where f.scheduled_at is not null and f.signed_at is not null
        and f.scheduled_at::date between p_from and p_to
  )
  select h.stage, h.stage_no, count(*),
         round(percentile_cont(0.25) within group (order by h.mins)::numeric, 2),
         round(percentile_cont(0.50) within group (order by h.mins)::numeric, 2),
         round(percentile_cont(0.75) within group (order by h.mins)::numeric, 2)
  from h where h.mins >= 0
  group by h.stage, h.stage_no
  order by h.stage_no;
end;
$$;

-- ── 7. Where the client gives up ────────────────────────────────────────────
-- The signing portal's own steps, in order, as a TRUE funnel: `reached` is
-- how many proposals got AT LEAST this far, so the column can only ever fall.
--
-- Counting each step's own events instead reads as a funnel and is not one.
-- The portal does not force strict order, so raw hits came back non-monotonic
-- (payment_viewed 30, method_selected 29) and every "drop" between them was
-- noise dressed as a finding. Taking each proposal's furthest step and
-- counting backwards from it is the only version where `lost_here` means what
-- the word says.
create or replace function signing_funnel(p_from date, p_to date)
returns table (
  step           text,
  step_no        int,
  reached        bigint,
  lost_here      bigint,
  pct_of_entered numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  with steps(step, step_no) as (
    values ('hub_opened', 1), ('proposal_opened', 2), ('approved', 3),
           ('method_selected', 4), ('payment_viewed', 5),
           ('signature_ready', 6), ('signed', 7)
  ),
  ev as (
    select e.bid_id, s.step_no
    from proposal_audit_events e
    join steps s on s.step = e.event
    join v_account_dim d on d.contractor_user_id = e.contractor_user_id
    where e.ts::date between p_from and p_to
      and e.bid_id is not null
      and e.bid_id not in (select bid_id from v_test_bid_ids)
  ),
  far as (select ev.bid_id, max(ev.step_no) as furthest from ev group by ev.bid_id),
  j as (
    select s.step, s.step_no,
           (select count(*) from far f where f.furthest >= s.step_no) as reached
    from steps s
  ),
  base as (select max(j2.reached) as top from j j2)
  select j.step, j.step_no, j.reached,
         coalesce(lag(j.reached) over (order by j.step_no), j.reached) - j.reached,
         round(100.0 * j.reached / nullif((select top from base), 0), 1)
  from j order by j.step_no;
end;
$$;

comment on function signing_funnel(date, date) is
  'The client signing portal as a true funnel: reached = proposals that got at least this far, taken from each proposal furthest step, so the column falls monotonically and lost_here is a real loss.';

-- ── 8. Money ────────────────────────────────────────────────────────────────
create or replace function money_by_contractor(p_from date, p_to date)
returns table (
  contractor_user_id uuid,
  business      text,
  trade         text,
  signed_count  bigint,
  signed_value  numeric,
  avg_ticket    numeric,
  median_ticket numeric,
  deposits      numeric,
  stripe_fees   numeric,
  paid_count    bigint,
  pending_count bigint,
  declined      bigint,
  cancelled     bigint,
  by_cash       bigint,
  by_check      bigint,
  by_card       bigint,
  method_pending bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  select d.contractor_user_id, d.business, d.trade,
         count(*),
         round(coalesce(sum(s.amount), 0), 2),
         round(avg(s.amount), 2),
         round(percentile_cont(0.5) within group (order by s.amount)::numeric, 2),
         round(coalesce(sum(s.deposit), 0), 2),
         round(coalesce(sum(s.stripe_fee), 0), 2),
         count(*) filter (where s.payment_status = 'paid'),
         count(*) filter (where s.payment_status like 'pending%'),
         count(*) filter (where s.payment_status = 'declined' or s.decline_reason is not null),
         count(*) filter (where s.cancelled_at is not null),
         -- Method vocabulary is cash / check / card / pending / declined, and
         -- "pending" means the client never picked one, not a fifth method.
         count(*) filter (where s.payment_method = 'cash'),
         count(*) filter (where s.payment_method = 'check'),
         count(*) filter (where s.payment_method = 'card'),
         count(*) filter (where s.payment_method = 'pending' or s.payment_method is null)
  from signed_proposals s
  join v_account_dim d on d.contractor_user_id = s.contractor_user_id
  where s.signed_at::date between p_from and p_to
    and s.bid_id not in (select bid_id from v_test_bid_ids)
  group by 1, 2, 3
  order by 5 desc;
end;
$$;

-- ── 9. Usage ────────────────────────────────────────────────────────────────
create or replace function usage_by_contractor(p_from date, p_to date)
returns table (
  contractor_user_id uuid,
  business         text,
  trade            text,
  people           int,
  sessions         bigint,
  active_days      bigint,
  page_views       bigint,
  clicks           bigint,
  scrolls          bigint,
  avg_session_min  numeric,
  avg_screens      numeric,
  clicks_per_session numeric,
  last_version     text,
  last_seen        date
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  select d.contractor_user_id, d.business, d.trade,
         count(distinct u.employee_user_id)::int,
         count(*),
         count(distinct u.day),
         sum(u.page_views)::bigint, sum(u.clicks)::bigint, sum(u.scrolls)::bigint,
         round(avg(extract(epoch from (u.last_ts - u.first_ts)) / 60)::numeric, 1),
         round(avg(u.screens), 1),
         round(avg(u.clicks), 1),
         (array_agg(u.app_version order by u.last_ts desc nulls last))[1],
         max(u.day)
  from v_usage_session u
  join v_account_dim d on d.contractor_user_id = u.contractor_user_id
  where u.day between p_from and p_to
  group by 1, 2, 3
  order by 5 desc;
end;
$$;

-- Which screens carry the app, and which ones nobody opens twice.
create or replace function usage_by_screen(p_from date, p_to date)
returns table (
  screen        text,
  page_views    bigint,
  clicks        bigint,
  scrolls       bigint,
  sessions      bigint,
  people        int,
  businesses    int,
  clicks_per_view numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_ops_admin() then
    raise exception 'ops dashboard: not authorized' using errcode = '42501';
  end if;
  return query
  select e.ctx,
         coalesce(sum(e.value) filter (where e.event = 'page'), 0)::bigint,
         coalesce(sum(e.value) filter (where e.event = 'click'), 0)::bigint,
         coalesce(sum(e.value) filter (where e.event = 'scroll'), 0)::bigint,
         count(distinct e.session_id),
         count(distinct coalesce(e.employee_user_id, p.user_id))::int,
         count(distinct pa.contractor_user_id)::int,
         round(sum(e.value) filter (where e.event = 'click')
               / nullif(sum(e.value) filter (where e.event = 'page'), 0), 2)
  from analytics_events e
  left join v_telemetry_person p on p.contractor_hash = e.contractor_hash
  left join v_person_account pa  on pa.employee_user_id = coalesce(e.employee_user_id, p.user_id)
  where e.event in ('page', 'click', 'scroll')
    and e.ctx is not null
    and coalesce(e.source, 'app') <> 'test'
    and e.ts::date between p_from and p_to
    and exists (select 1 from v_account_dim d where d.contractor_user_id = pa.contractor_user_id)
  group by e.ctx
  order by 2 desc;
end;
$$;

-- ── 10. Grants: authenticated may call, the gate decides ────────────────────
revoke execute on function funnel_summary(date, date)       from public, anon;
revoke execute on function funnel_by_contractor(date, date) from public, anon;
revoke execute on function funnel_by_trade(date, date)      from public, anon;
revoke execute on function funnel_timing(date, date)        from public, anon;
revoke execute on function signing_funnel(date, date)       from public, anon;
revoke execute on function money_by_contractor(date, date)  from public, anon;
revoke execute on function usage_by_contractor(date, date)  from public, anon;
revoke execute on function usage_by_screen(date, date)      from public, anon;

grant execute on function funnel_summary(date, date)       to authenticated;
grant execute on function funnel_by_contractor(date, date) to authenticated;
grant execute on function funnel_by_trade(date, date)      to authenticated;
grant execute on function funnel_timing(date, date)        to authenticated;
grant execute on function signing_funnel(date, date)       to authenticated;
grant execute on function money_by_contractor(date, date)  to authenticated;
grant execute on function usage_by_contractor(date, date)  to authenticated;
grant execute on function usage_by_screen(date, date)      to authenticated;
