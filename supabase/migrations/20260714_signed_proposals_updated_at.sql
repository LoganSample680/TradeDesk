-- Egress fix: give signed_proposals a real change cursor.
--
-- js/cloud.js checkNewSignatures() polls this table every 30s from every open
-- tab as the realtime fallback. Without a change cursor it must re-download the
-- newest 100 rows (each carrying a base64 signature image) on every tick even
-- when nothing changed — a multi-GB/day standing egress leak per idle tab.
--
-- updated_at lets the client poll with .gt('updated_at', <last seen>) so a
-- steady-state tick returns ZERO rows. The trigger bumps it on every UPDATE
-- (cancellations, remote change-order signings, payment-status flips), so every
-- mutation path the poll cares about re-surfaces the row exactly once.
--
-- IDEMPOTENT + drift-safe: clients that talk to a database without this column
-- fall back to the full poll (the pre-fix behavior), never an error.

alter table signed_proposals
  add column if not exists updated_at timestamptz not null default now();

create or replace function td_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists signed_proposals_touch_updated_at on signed_proposals;
create trigger signed_proposals_touch_updated_at
  before update on signed_proposals
  for each row execute function td_touch_updated_at();

-- The delta poll filters + orders on it — index keeps that cheap at any scale.
create index if not exists idx_signed_proposals_contractor_updated
  on signed_proposals (contractor_user_id, updated_at desc);
