-- ── WHAT PEOPLE ACTUALLY ASK TIM, AND WHERE HE FAILS ────────────────────────
--
-- Owner, 2026-09-21: "I need tim to learn what everybody puts in so I can
-- improve him though, I need to know if he fails at a task."
--
-- Tim's thread already existed and could not answer either question: it is
-- localStorage on one phone, it never syncs, and it is wiped on sign-out. That
-- is right for a CONVERSATION and useless for improving him, because the one
-- sentence he could not place is on the one device nobody is looking at.
--
-- WHAT THIS TABLE DELIBERATELY DOES NOT HOLD, and the reason it is worth the
-- restraint: the thread carries customer names, what they owe, what a job was
-- charged at, and the address somebody worked at. None of that teaches Tim
-- anything. The SHAPE of the question is the whole lesson: "what does
-- <customer> owe me" is the thing to learn, and the customer's name is not.
-- So the device scrubs every client name out of the sentence before it leaves
-- (_timScrub, js/tim-log.js), and no figure, answer or row is ever sent. What
-- lands here is the sentence with names replaced, whether he placed it, and
-- which family placed it.
--
-- One row per sentence said to Tim. Append only: nothing here is ever updated,
-- because a record of what was asked at the time is the point, and a row that
-- can be edited later is not a record.
create table if not exists td_tim_asks (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- The account, so a shop's misses can be read together rather than per phone,
  -- and the device, so one man hammering the same miss is visible as one man.
  device_id   text,
  said        text not null,
  -- 'ask' | 'build' | 'read' | 'nav' | 'none'. 'none' is the failure: he was
  -- given a sentence and could not place it. Those are the rows worth reading.
  kind        text not null,
  -- Which answer family caught it, when one did. Null on a miss, which is what
  -- makes "what is he missing that he nearly has" answerable.
  family      text,
  -- Where the man was standing. The same sentence on the estimate builder and
  -- on Home are two different questions, and he answers them differently.
  page        text,
  app_version text,
  scrubbed    boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists td_tim_asks_user_created on td_tim_asks (user_id, created_at desc);
-- The misses, which is what gets read most: a partial index so the query that
-- matters stays cheap as the table grows.
create index if not exists td_tim_asks_misses on td_tim_asks (created_at desc) where kind = 'none';

alter table td_tim_asks enable row level security;

-- A man may write his own rows and read his own rows, and nothing else. There
-- is no update policy and no delete policy on purpose: append only.
--
-- ::text on BOTH sides, which every other migration in this repo does and
-- which a guard in e2e-rls-policies.spec.js enforces by reading the files.
-- user_id here is a uuid, so `auth.uid() = user_id` is uuid = uuid and is
-- perfectly valid; the guard is blanket on purpose, because the failure it
-- exists to stop is a TEXT column compared to a uuid, which Postgres rejects
-- outright with "operator does not exist: text = uuid" and which is only
-- discovered when a real user hits the policy. A rule that has to know each
-- column's type cannot be checked by reading the file, so this one does not
-- try, and the cost of obeying it here is one cast on a small append-only
-- table that is read by one man at a time.
drop policy if exists td_tim_asks_insert_own on td_tim_asks;
create policy td_tim_asks_insert_own on td_tim_asks
  for insert to authenticated with check (user_id::text = auth.uid()::text);

drop policy if exists td_tim_asks_select_own on td_tim_asks;
create policy td_tim_asks_select_own on td_tim_asks
  for select to authenticated using (user_id::text = auth.uid()::text);

-- ── READING IT ──────────────────────────────────────────────────────────────
-- The two questions the owner asked, as two queries.
--
--   What is he failing at:
--     select said, count(*) n, max(created_at) last
--       from td_tim_asks where kind = 'none'
--       group by said order by n desc limit 50;
--
--   What everybody puts in:
--     select coalesce(family,'(missed)') fam, count(*) n
--       from td_tim_asks group by 1 order by n desc;
comment on table td_tim_asks is
  'What was said to Tim, with client names scrubbed on-device. Append only. Never holds a figure, an answer or an address.';
