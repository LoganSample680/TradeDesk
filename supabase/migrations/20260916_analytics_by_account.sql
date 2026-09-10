-- ════════════════════════════════════════════════════════════════════════
-- analytics_events: who, at what grain, and whether it was a person at all.
--
-- Owner 2026-09-10, planning the pre-launch metrics dashboard: "would it be
-- nice to see the metrics by user? I would love that", and then "is it worth
-- it to bring in by employee too".
--
-- THREE THINGS WERE WRONG WITH THE TABLE FOR THAT.
--
-- 1. It only ever held an anonymized hash. That was a deliberate choice when
--    observability.js was written and it is the right default for anything
--    that leaves the company, but it made the table unable to answer the only
--    questions a founder asks before launch: which accounts are stuck, which
--    trades close, who is about to churn. The hash STAYS, for anything shown
--    outside; the account id lands beside it, for the internal dashboard.
--
-- 2. The hash was of whoever was signed in, so a crew member's events hashed
--    to a DIFFERENT value than their own boss's. Every per-account rollup was
--    silently splitting one business into one bucket per phone. The account
--    is now resolved through team_members at ingest and stored explicitly.
--
-- 3. The flow tests write to this table (tests/flow/live-helpers.js calls
--    _obs.track('flow_step')). Of the seventeen event kinds in there today the
--    three highest-volume are CI, so any dashboard built on it would report
--    the test suite's behaviour as customer behaviour. `source` separates
--    them and every reader filters on it.
--
-- BY EMPLOYEE, DELIBERATELY STORED AND DELIBERATELY NOT REPORTED ON. The
-- employee id and their role ride along because whether a crew ever opens the
-- app is the best early churn signal there is and it cannot be reconstructed
-- later. The views over this table aggregate to ROLE. An individual crew
-- member's click-by-click behaviour is their employer's business, not ours,
-- and naming it on a screen buys nothing.
--
-- Additive per CLAUDE.md 3.1: every column is nullable, nothing production
-- reads changes shape, and rows written before this migration keep working
-- with these columns null.
-- ════════════════════════════════════════════════════════════════════════

alter table analytics_events
  add column if not exists contractor_user_id uuid,
  add column if not exists employee_user_id   uuid,
  add column if not exists role               text,
  add column if not exists source             text;

comment on column analytics_events.contractor_user_id is
  'The ACCOUNT the event belongs to: the business paying for TradeDesk. For a crew member this is their employer, not them. Null on rows written before 2026-09-15.';
comment on column analytics_events.employee_user_id is
  'The signed-in person. Stored so role-level questions (does the crew use this at all) can be answered; NOT for naming individuals on a screen.';
comment on column analytics_events.role is
  'owner | crew. What the person was to the account at the moment of the event.';
comment on column analytics_events.source is
  'app | test. Anything reading this table for product metrics must filter to app: the flow suite writes here too.';

-- The dashboard reads one account over a date range, or one event kind across
-- everybody. Both get an index; nothing else is a real query shape.
create index if not exists analytics_events_acct_ts_idx
  on analytics_events (contractor_user_id, ts desc);
create index if not exists analytics_events_event_ts_idx
  on analytics_events (event, ts desc);
-- Every product read filters source='app', so it leads the partial index.
create index if not exists analytics_events_app_ts_idx
  on analytics_events (ts desc) where source = 'app';

-- RLS is unchanged and must stay that way: the table is deny-all to clients
-- and reached only by the service role in ingest-telemetry. Adding a real uid
-- to it makes that more important, not less, so this migration asserts the
-- state rather than assuming it.
alter table analytics_events enable row level security;
