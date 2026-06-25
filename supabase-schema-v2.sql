-- ============================================================
-- TradeDesk Schema v2 — Per-record rows for multi-device sync
-- Run this entire script in your Supabase SQL Editor once.
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS.
-- ============================================================

-- ── 1. Add checks_state column to zj_data if missing ────────
-- Settings + checksState stay in zj_data (single-writer, no
-- concurrent conflict). Everything else moves to per-record tables.
ALTER TABLE zj_data ADD COLUMN IF NOT EXISTS checks_state text DEFAULT '{}';

-- ── 2. Create per-record tables ──────────────────────────────
-- Pattern: (id text, user_id uuid) composite PK
--   id         — the JS record ID (Date.now() integer as text, or any string)
--   user_id    — owner; RLS ensures only the owner can read/write
--   data       — full JS object as JSONB (no schema lock-in)
--   updated_at — for delta sync and conflict resolution (last-write-wins)
--   deleted_at — soft delete: NULL = live, timestamp = deleted
--                Lets other devices pull the deletion event via realtime.

CREATE TABLE IF NOT EXISTS td_clients (
  id          text         NOT NULL,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data        jsonb        NOT NULL DEFAULT '{}',
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz  DEFAULT NULL,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS td_bids (
  id          text         NOT NULL,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data        jsonb        NOT NULL DEFAULT '{}',
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz  DEFAULT NULL,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS td_jobs (
  id          text         NOT NULL,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data        jsonb        NOT NULL DEFAULT '{}',
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz  DEFAULT NULL,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS td_income (
  id          text         NOT NULL,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data        jsonb        NOT NULL DEFAULT '{}',
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz  DEFAULT NULL,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS td_expenses (
  id          text         NOT NULL,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data        jsonb        NOT NULL DEFAULT '{}',
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz  DEFAULT NULL,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS td_mileage (
  id          text         NOT NULL,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data        jsonb        NOT NULL DEFAULT '{}',
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz  DEFAULT NULL,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS td_payments (
  id          text         NOT NULL,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data        jsonb        NOT NULL DEFAULT '{}',
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz  DEFAULT NULL,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS td_liens (
  id          text         NOT NULL,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data        jsonb        NOT NULL DEFAULT '{}',
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz  DEFAULT NULL,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS td_time_entries (
  id          text         NOT NULL,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data        jsonb        NOT NULL DEFAULT '{}',
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz  DEFAULT NULL,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS td_licenses (
  id          text         NOT NULL,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data        jsonb        NOT NULL DEFAULT '{}',
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz  DEFAULT NULL,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS td_events (
  id          text         NOT NULL,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data        jsonb        NOT NULL DEFAULT '{}',
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz  DEFAULT NULL,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS td_contracts (
  id          text         NOT NULL,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data        jsonb        NOT NULL DEFAULT '{}',
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz  DEFAULT NULL,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS td_agreements (
  id          text         NOT NULL,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data        jsonb        NOT NULL DEFAULT '{}',
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz  DEFAULT NULL,
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS td_photos (
  id          text         NOT NULL,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data        jsonb        NOT NULL DEFAULT '{}',
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz  DEFAULT NULL,
  PRIMARY KEY (id, user_id)
);

-- ── 3. Row-level security ────────────────────────────────────
ALTER TABLE td_clients     ENABLE ROW LEVEL SECURITY;
ALTER TABLE td_bids        ENABLE ROW LEVEL SECURITY;
ALTER TABLE td_jobs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE td_income      ENABLE ROW LEVEL SECURITY;
ALTER TABLE td_expenses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE td_mileage     ENABLE ROW LEVEL SECURITY;
ALTER TABLE td_payments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE td_liens       ENABLE ROW LEVEL SECURITY;
ALTER TABLE td_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE td_licenses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE td_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE td_contracts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE td_agreements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE td_photos      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner" ON td_clients      FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "owner" ON td_bids         FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "owner" ON td_jobs         FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "owner" ON td_income       FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "owner" ON td_expenses     FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "owner" ON td_mileage      FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "owner" ON td_payments     FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "owner" ON td_liens        FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "owner" ON td_time_entries FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "owner" ON td_licenses     FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "owner" ON td_events       FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "owner" ON td_contracts    FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "owner" ON td_agreements   FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "owner" ON td_photos       FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

-- ── 4. Indexes (user_id is in every query; deleted_at filter common) ─
CREATE INDEX IF NOT EXISTS idx_td_clients_user      ON td_clients      (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_td_bids_user         ON td_bids         (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_td_jobs_user         ON td_jobs         (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_td_income_user       ON td_income       (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_td_expenses_user     ON td_expenses     (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_td_mileage_user      ON td_mileage      (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_td_payments_user     ON td_payments     (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_td_liens_user        ON td_liens        (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_td_time_entries_user ON td_time_entries (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_td_licenses_user     ON td_licenses     (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_td_events_user       ON td_events       (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_td_contracts_user    ON td_contracts    (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_td_agreements_user   ON td_agreements   (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_td_photos_user       ON td_photos       (user_id) WHERE deleted_at IS NULL;

-- ── 5. Enable Realtime (postgres_changes) for all new tables ─
-- This wires each table into Supabase's logical replication feed.
-- Other devices receive per-record change events instead of full reloads.
ALTER PUBLICATION supabase_realtime ADD TABLE td_clients;
ALTER PUBLICATION supabase_realtime ADD TABLE td_bids;
ALTER PUBLICATION supabase_realtime ADD TABLE td_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE td_income;
ALTER PUBLICATION supabase_realtime ADD TABLE td_expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE td_mileage;
ALTER PUBLICATION supabase_realtime ADD TABLE td_payments;
ALTER PUBLICATION supabase_realtime ADD TABLE td_liens;
ALTER PUBLICATION supabase_realtime ADD TABLE td_time_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE td_licenses;
ALTER PUBLICATION supabase_realtime ADD TABLE td_events;
ALTER PUBLICATION supabase_realtime ADD TABLE td_contracts;
ALTER PUBLICATION supabase_realtime ADD TABLE td_agreements;
ALTER PUBLICATION supabase_realtime ADD TABLE td_photos;

-- ── 6. One-time data migration from zj_data JSON blobs ───────
-- Reads each user's existing zj_data row and explodes every array
-- into per-record rows in the new tables. Safe to re-run (ON CONFLICT DO NOTHING).
DO $$
DECLARE
  r   RECORD;
  rec jsonb;
BEGIN
  FOR r IN SELECT user_id, clients, bids, jobs, income, expenses, mileage,
                  payments, liens FROM zj_data
  LOOP
    FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(r.clients::jsonb,'[]'::jsonb))
    LOOP
      INSERT INTO td_clients(id,user_id,data,updated_at)
      VALUES(rec->>'id', r.user_id, rec, now())
      ON CONFLICT (id,user_id) DO NOTHING;
    END LOOP;

    FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(r.bids::jsonb,'[]'::jsonb))
    LOOP
      INSERT INTO td_bids(id,user_id,data,updated_at)
      VALUES(rec->>'id', r.user_id, rec, now())
      ON CONFLICT (id,user_id) DO NOTHING;
    END LOOP;

    FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(r.jobs::jsonb,'[]'::jsonb))
    LOOP
      INSERT INTO td_jobs(id,user_id,data,updated_at)
      VALUES(rec->>'id', r.user_id, rec, now())
      ON CONFLICT (id,user_id) DO NOTHING;
    END LOOP;

    FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(r.income::jsonb,'[]'::jsonb))
    LOOP
      INSERT INTO td_income(id,user_id,data,updated_at)
      VALUES(rec->>'id', r.user_id, rec, now())
      ON CONFLICT (id,user_id) DO NOTHING;
    END LOOP;

    FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(r.expenses::jsonb,'[]'::jsonb))
    LOOP
      INSERT INTO td_expenses(id,user_id,data,updated_at)
      VALUES(rec->>'id', r.user_id, rec, now())
      ON CONFLICT (id,user_id) DO NOTHING;
    END LOOP;

    FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(r.mileage::jsonb,'[]'::jsonb))
    LOOP
      INSERT INTO td_mileage(id,user_id,data,updated_at)
      VALUES(rec->>'id', r.user_id, rec, now())
      ON CONFLICT (id,user_id) DO NOTHING;
    END LOOP;

    FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(r.payments::jsonb,'[]'::jsonb))
    LOOP
      INSERT INTO td_payments(id,user_id,data,updated_at)
      VALUES(rec->>'id', r.user_id, rec, now())
      ON CONFLICT (id,user_id) DO NOTHING;
    END LOOP;

    FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(r.liens::jsonb,'[]'::jsonb))
    LOOP
      INSERT INTO td_liens(id,user_id,data,updated_at)
      VALUES(rec->>'id', r.user_id, rec, now())
      ON CONFLICT (id,user_id) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- Done. Verify with:
-- SELECT COUNT(*) FROM td_clients;
-- SELECT COUNT(*) FROM td_mileage;
