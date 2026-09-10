-- The flip's own id, on the row (owner 2026-08-31: "what do we need so you can
-- watch the id run through the pipeline?").
--
-- ONE FLIP, ONE ID is his rule and the plugin now mints one at every CoreMotion
-- transition (native/td-geo/ios/Plugin/TdGeoPlugin.swift, newFlipId). It rides
-- the GPS ping, the fence lookup spends it, and both writers key their leg on
-- it, which is what makes a duplicate row for one drive impossible to create
-- rather than something to detect and delete afterwards.
--
-- ingest-geo already parses and length-caps it and then drops it on the floor,
-- because geo_events had nowhere to put it. The consequence is not a bug in the
-- app, it is a blind spot in US: the id can only be observed at the END of the
-- chain, on the leg key of a written row, so a drive that comes out wrong has
-- to be reasoned about backwards instead of pointed at. With the id on the raw
-- row, one departure joins end to end:
--
--   the motion row      the flip, its instant, and the ping's lat/lon
--   the regionExit row  which fence spent it and what it named the place
--   job_time_entries    client_key
--   td_mileage          data->>'legKey'
--
-- A stage that drops the id is then the stage holding a null, which is an
-- answer rather than an inference.
--
-- Additive and nullable, exactly like the kind column before it: every existing
-- row, every older shell, and every event replayed out of a pre-build-45 buffer
-- simply leaves it null, and nothing that reads this table today is touched.
-- That matters more than usual here because one Supabase project serves dev,
-- UAT and production (CLAUDE.md 3.1), so this is live for all three at once.
alter table geo_events add column if not exists flip_id text;

-- Looked up BY THE ID, which is the whole point of the column and the opposite
-- of how kind is queried (kind answers "what was he doing in this window", this
-- answers "show me every stage of this one departure"). Partial, because only
-- motion rows carry a flip id and they are a small fraction of the table.
create index if not exists geo_events_flip_id_idx
  on geo_events (flip_id)
  where flip_id is not null;
