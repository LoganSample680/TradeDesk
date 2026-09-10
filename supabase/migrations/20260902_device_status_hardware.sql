-- The exact handset, on the per-device server record (owner 2026-08-27).
--
-- device_label is UIDevice.current.model, which iOS collapses to the literal
-- string "iPhone" for every iPhone ever made, so two phones behaving
-- differently were indistinguishable from the server. The native TdDevice
-- plugin already reads the real sysctl identifier and the OS version and
-- stores them in the local settings blob; they just never reached a queryable
-- table. Additive columns, nullable, so an older shell that cannot answer
-- simply leaves them null and every existing reader is untouched.
alter table device_status add column if not exists hw_id text;
alter table device_status add column if not exists os_version text;
