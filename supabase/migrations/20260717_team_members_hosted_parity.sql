-- team_members HOSTED-SCHEMA PARITY. The app writes invited_at (both invite flows +
-- the email-match ordering in loadAccountData), pay_type/pay_rate (team comp), and
-- location_consent (geo-track consent) — columns that exist on the HOSTED project via
-- dashboard edits that never became migrations. On a from-migrations stack (local
-- runner today, self-hosted Proxmox at go-live) every roster upsert failed with
-- "Could not find the 'invited_at' column ... in the schema cache" and the email-match
-- lookup 400'd on its ORDER BY — crew invites were dead on those stacks (surfaced by
-- the crew certification flow). Idempotent; no-ops on hosted where the columns exist.

alter table team_members add column if not exists invited_at       timestamptz;
alter table team_members add column if not exists pay_type         text;
alter table team_members add column if not exists pay_rate         numeric;
alter table team_members add column if not exists location_consent boolean default false;
