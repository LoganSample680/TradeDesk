-- Geo hardening: idempotent time-entry writes.
--
-- Time entries are now written through a device-side durable queue that RETRIES
-- until the insert lands (a dead spot at departure time used to silently lose the
-- record). Retries need idempotency: each row carries a client-minted key, and the
-- partial unique index turns a retried insert (response lost, row actually landed)
-- into a no-op instead of a duplicate — duplicated rows would double-count hours
-- in payroll / Job Profit / future OJT reports.
--
-- Client behavior when this migration hasn't reached a DB yet (deploy-order safe):
-- the queue's upsert fails, and it falls back to a plain insert (durability beats
-- idempotency until the schema catches up).

alter table job_time_entries  add column if not exists client_key text;
alter table shop_time_entries add column if not exists client_key text;

create unique index if not exists job_time_entries_ckey_uq
  on job_time_entries (contractor_user_id, client_key) where client_key is not null;
create unique index if not exists shop_time_entries_ckey_uq
  on shop_time_entries (contractor_user_id, client_key) where client_key is not null;
