-- ── WHAT HE SAID, WHAT TIM MADE OF IT, WHAT WENT OUT ────────────────────────
--
-- Owner, 2026-09-28: "Tim should store so I can see when he's fucked up or
-- need to add capabilities."
--
-- td_tim_asks (20261031) logs the sentences said to Tim's dock, and nothing
-- else. The place Tim does his real work, turning a dictated job walk into
-- numbered scope lines on the T&M, Build Your Own and quick invoice screens,
-- was never logged at all. Blake Sample's proposal went out with "Install
-- where" and "Rod in will be" on it and the only way to find out what he had
-- actually said was to rebuild it from the saved lines.
--
-- So the same table grows three columns, and two new kinds:
--   kind 'scope': `said` is the whole dictation (client names scrubbed on the
--                 device, same as before), `made` is the lines Tim built.
--   kind 'kept':  `made` is the lines the proposal was saved with, so the gap
--                 between what Tim made and what the man sent is the list of
--                 everything he had to fix by hand. That gap IS the backlog.
-- `ref` ties a 'kept' row to its 'scope' row (the proposal id), and `surface`
-- says which screen: 'tm', 'byo', 'qi'.
--
-- Additive only (§3.1): old rows keep working, old app builds keep inserting
-- the columns they know about.
alter table td_tim_asks add column if not exists made    jsonb;
alter table td_tim_asks add column if not exists ref     text;
alter table td_tim_asks add column if not exists surface text;

create index if not exists td_tim_asks_ref on td_tim_asks (ref) where ref is not null;

-- Read with SQL, not a screen: the point is to line up what he said against
-- how Tim split it, per row.
--   select created_at, surface, said, made from td_tim_asks
--    where kind = 'scope' order by created_at desc limit 50;
comment on table td_tim_asks is
  'What was said to Tim, with client names and addresses scrubbed on-device, and (kind scope/kept) the lines he made and the lines that went out. Append only.';
