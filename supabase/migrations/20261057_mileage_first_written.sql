-- ── WHEN DID THIS MILEAGE ROW FIRST REACH THE SERVER (owner 2026-09-30) ──
-- "We really need to make sure ... the mileage rows land in 10 seconds."
--
-- A leg is rewritten many times (every derive, the phone's routed miles, a
-- Rebuild), and updated_at moves with each one, so nothing on the row said
-- when it FIRST existed. Without that the 10 second goal could not be
-- measured, only guessed at.
--
-- Additive. Existing rows stay null (their first write is unknown, and
-- stamping them with today would be a lie the report would then believe);
-- every row inserted from now on carries the instant it landed. The upsert
-- paths only ever set the columns they name, so an update never touches it.
alter table td_mileage add column if not exists created_at timestamptz;
alter table td_mileage alter column created_at set default now();
