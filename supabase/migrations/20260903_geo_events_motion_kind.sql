-- The motion classification, on the row (owner 2026-08-29: "how can we make
-- the core motion tape go to server side since it's iOS level shit").
--
-- The coprocessor classifies onFoot / still / driving and the native plugin
-- has recorded that word on every motion event since it was written
-- (native/td-geo/ios/Plugin/TdGeoPlugin.swift, "kind": kind). It reached the
-- ingest function and stopped there, because geo_events had nowhere to put
-- it. So the server knew a transition had happened and never what it was,
-- which is why a load-out could only ever be graded on the phone that still
-- held the tape, inside its ~7-day memory.
--
-- Additive and nullable: every existing row and every older shell simply
-- leaves it null, and nothing that reads this table today is touched.
alter table geo_events add column if not exists kind text;

-- The tape is queried by person and window ("what was he doing between these
-- two timestamps"), never by kind alone, so the index matches that shape.
-- Partial, because only motion rows ever carry a kind and they are a small
-- fraction of the table.
create index if not exists geo_events_motion_kind_idx
  on geo_events (employee_user_id, ts)
  where kind is not null;
