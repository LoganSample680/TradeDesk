-- Crew location permission: an HONEST record of what the device reported and
-- what the person actually agreed to.
--
-- The problem this replaces: geo-track.js wrote `location_consent = true` on the
-- employee's row at sign-in without ever asking them, and the column comment on
-- 20260619 literally reads "employee's explicit opt-in". A field asserting a
-- consent that was never given is worse than no field at all: in a wage or
-- privacy dispute it reads as a manufactured record. These columns describe
-- reality instead.
--
--   location_status      what the DEVICE reported ('granted'|'denied'|'prompt'|'unsupported')
--   location_checked_at  when it reported it (drives the stale/gray state, since
--                        an owner can NEVER query a crew member's live permission,
--                        only see what their device last said)
--   location_device      which device said it (permission is per-device, not
--                        per-account: a phone and a tablet are separate grants)
--   location_ack_at      when the person tapped the setup action having READ the
--                        notice. This is the consent record; it is only ever set
--                        by an actual user gesture.
--   location_ack_version which notice copy they saw, so the record stays
--                        meaningful after the wording changes.
--
-- location_consent is deliberately NOT dropped here. Dropping it would break any
-- hosted row mid-deploy and there is no rollback for lost columns; it is left in
-- place, no longer written by the app, and retired in a later migration once
-- every account has an ack row. See js/geo-track.js.

alter table team_members add column if not exists location_status      text;
alter table team_members add column if not exists location_checked_at  timestamptz;
alter table team_members add column if not exists location_device      text;
alter table team_members add column if not exists location_ack_at      timestamptz;
alter table team_members add column if not exists location_ack_version text;

-- Every existing row carries location_consent=true that nobody ever agreed to.
-- Null the acknowledgment so those crew members are re-asked once on next sign-in
-- (js/geo-track.js `_geoNeedsAck()`), rather than inheriting a consent record the
-- app fabricated for them.
update team_members
   set location_ack_at = null,
       location_ack_version = null
 where location_ack_at is null;

comment on column team_members.location_status is
  'Last permission state reported BY THE DEVICE. Never a proxy for consent.';
comment on column team_members.location_ack_at is
  'Set only when the person tapped the location setup action having read the notice. This is the consent record.';
