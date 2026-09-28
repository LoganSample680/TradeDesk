-- An answered gap is not a clock punch (owner 2026-09-28).
--
-- Jack clocked in at 7:58 and never clocked out, and the ops day view said he
-- clocked out at 9:28. At 9:40 he answered the Time log's "unaccounted time"
-- question for 9:21 to 9:28 as work, which writes a closed row to
-- td_time_entries (fromGap, "Added from unaccounted time"). This view counted
-- every closed row as a punch: it took 9:28 as his last clock-out, counted a
-- second punch, and added the seven minutes to worked_min on top of the clock
-- that already covered them.
--
-- A gap answer is a statement about a stretch inside the day, not a clock, so
-- it is left out here exactly as the Time log rail leaves it out of its clock
-- caps (js/timelog.js _tlIsGapAnswer, the same two tests: the fromGap flag, and
-- the label for rows written before the flag existed). Same columns, same
-- order, so v_gap_day and v_ops_daily read it unchanged. Additive: no data is
-- touched.
create or replace view public.v_clock_day as
select (( (t.data->>'start_time')::timestamptz) at time zone 'America/Chicago')::date as day,
       t.user_id as employee_user_id,
       count(*)                                                as punches,
       count(*) filter (where t.data->>'end_time' is not null) as closed,
       sum(case when t.data->>'end_time' is not null
                then extract(epoch from ((t.data->>'end_time')::timestamptz
                                       - (t.data->>'start_time')::timestamptz))/60.0
           end)::numeric(10,1)                                 as worked_min,
       min((t.data->>'start_time')::timestamptz)               as first_in,
       max((t.data->>'end_time')::timestamptz)                 as last_out
from td_time_entries t
where t.deleted_at is null
  and t.data->>'start_time' is not null
  and coalesce(t.data->>'fromGap', 'false') <> 'true'
  and coalesce(t.data->>'scope_label', '') !~ '^(Added from unaccounted time|Break \(|Personal time)'
  and t.user_id not in (select user_id from analytics_internal_accounts)
group by 1, 2;
