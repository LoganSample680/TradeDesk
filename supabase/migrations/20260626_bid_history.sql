-- td_bids_history: captures every UPDATE and DELETE on td_bids so no bid version
-- is ever permanently lost. The recover UI reads this table as its authoritative source.

CREATE TABLE IF NOT EXISTS td_bids_history (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bid_id          BIGINT        NOT NULL,
  contractor_user_id UUID       NOT NULL,
  operation       TEXT          NOT NULL CHECK (operation IN ('UPDATE','DELETE')),
  old_row         JSONB         NOT NULL,
  changed_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_td_bids_history_bid
  ON td_bids_history(bid_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_td_bids_history_contractor
  ON td_bids_history(contractor_user_id, changed_at DESC);

-- Contractor sees only their own bid history
ALTER TABLE td_bids_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='td_bids_history' AND policyname='contractor_bid_history_own'
  ) THEN
    EXECUTE $p$
      CREATE POLICY contractor_bid_history_own ON td_bids_history
        FOR ALL USING (contractor_user_id::text = auth.uid()::text)
    $p$;
  END IF;
END $$;

-- Trigger function: write old row into history before update/delete
CREATE OR REPLACE FUNCTION _capture_bid_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO td_bids_history(bid_id, contractor_user_id, operation, old_row, changed_at)
  VALUES (OLD.id, OLD.contractor_user_id, TG_OP, to_jsonb(OLD), NOW());
  RETURN NEW;
END;
$$;

-- Guard: only install the trigger if td_bids exists (preview branches that
-- have not yet applied the base migrations will not have it).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'td_bids'
  ) THEN
    DROP TRIGGER IF EXISTS trg_bid_history ON td_bids;
    CREATE TRIGGER trg_bid_history
      BEFORE UPDATE OR DELETE ON td_bids
      FOR EACH ROW EXECUTE FUNCTION _capture_bid_history();
  END IF;
END $$;

-- pg_cron: prune history older than 90 days — runs daily at 3 AM UTC.
-- Silently skipped if pg_cron is not enabled on this Supabase plan.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('prune-bid-history');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'prune-bid-history',
      '0 3 * * *',
      $sql$ DELETE FROM td_bids_history WHERE changed_at < NOW() - INTERVAL '90 days' $sql$
    );
  END IF;
END $$;
