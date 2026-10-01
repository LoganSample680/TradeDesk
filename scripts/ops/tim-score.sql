-- Tim's score: of the lines Tim wrote, how many went out untouched.
-- (owner 2026-09-29: one number that says whether the training is working)
--
-- Read-only. One row per Central day, last 14 days. A scope row is what Tim
-- made from a dictation; the kept row with the same ref is what was sent.
-- right = Tim lines found word for word in what was sent.
with pairs as (
  select (s.created_at at time zone 'America/Chicago')::date d,
         s.made tim_lines,
         (select k.made from td_tim_asks k
           where k.kind = 'kept' and k.ref = s.ref
           order by k.created_at desc limit 1) kept_lines
  from td_tim_asks s
  where s.kind = 'scope' and s.ref is not null
    and s.created_at > now() - interval '14 days'
),
lines as (
  select d, t.line, (kept_lines ? t.line) as kept
  from pairs, jsonb_array_elements_text(tim_lines) as t(line)
  where kept_lines is not null
)
select d,
       count(*) as tim_lines,
       count(*) filter (where kept) as went_out_untouched,
       round(100.0 * avg(kept::int)) as pct_right,
       (select count(*) from td_tim_asks f
         where f.kind = 'fix' and (f.created_at at time zone 'America/Chicago')::date = lines.d) as fixes
from lines
group by d
order by d;
