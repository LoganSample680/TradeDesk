-- ════════════════════════════════════════════════════════════════════════
-- Battery on the crew roster (owner ask 2026-08-26: "all the location stuff
-- and battery level ... and last ping").
--
-- Why it belongs next to the permission axes rather than in its own table: a
-- dead phone and a phone with location switched off produce the SAME silence
-- on the roster, and the owner chases them completely differently. One is a
-- conversation about permissions, the other is a charger. Without this the
-- roster can only ever say "no recent activity" and leave them guessing which.
--
-- No iOS build needed (CLAUDE.md 3.2): TdGeo.stats() has returned batteryLevel
-- and charging since the plugin was written, for the radio-time accounting, and
-- nothing outside the shadow-engine diagnostic ever read them.
--
-- Additive only, and both nullable: a browser, an Android, or a shell whose
-- stats call fails must stay distinguishable from a phone that genuinely
-- reported 0%. 'we do not know' and 'flat' are different diagnoses, the same
-- reason location_services_enabled is a nullable boolean.
-- ════════════════════════════════════════════════════════════════════════

alter table device_status add column if not exists battery_level    numeric;
alter table device_status add column if not exists battery_charging boolean;
