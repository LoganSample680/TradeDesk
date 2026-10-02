-- Tim's fixes: every line a contractor retyped after Tim wrote it.
-- (owner 2026-09-29: "Tim is only going to get smarter the more he's used")
--
-- Read-only. The nightly retrain runs this, groups the rows by what Tim got
-- wrong, and turns each group into a rule fix plus a case in
-- tests/fixtures/tim-fixes.json. Names and addresses were scrubbed on the
-- phone before these rows were written (js/tim-log.js _timScrubAll).
--
--   field  work | supply     which screen line was retyped
--   tim    what Tim wrote
--   kept   what the contractor changed it to
--   heard  the whole sentence Tim was told, when a scope row shares the ref
select f.created_at,
       f.surface,
       f.made->>'field' as field,
       f.made->>'tim'   as tim,
       f.made->>'kept'  as kept,
       (select s.said from td_tim_asks s
         where s.kind = 'scope' and s.ref is not null and s.ref = f.ref
         order by s.created_at desc limit 1) as heard,
       f.user_id
from td_tim_asks f
where f.kind = 'fix'
  and f.created_at > now() - interval '2 days'
order by f.created_at;
