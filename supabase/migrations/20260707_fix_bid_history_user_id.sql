-- HOTFIX: bid deletes/edits never propagated across devices and resurrected on reload.
--
-- 20260626_bid_history.sql shipped the td_bids history trigger (BEFORE UPDATE OR DELETE
-- → _capture_bid_history) with TWO schema mismatches against td_bids, so EVERY update/
-- delete of a bid raised a Postgres error, 400'd the PATCH, and aborted supaSaveToCloud
-- (cloud.js _upsertTable throws on the failed deleted_at UPDATE). The soft-delete never
-- landed, so a deleted bid stayed alive in the cloud and came back on every device /
-- after reload. Two bugs, both here:
--
--   1. The function read OLD.contractor_user_id, but td_bids keys on user_id ((id,user_id);
--      20260703) and has no such column → 42703 "record \"old\" has no field
--      \"contractor_user_id\"". Fixed by reading OLD.user_id.
--   2. td_bids_history.bid_id was declared BIGINT, but td_bids.id is TEXT (20260703), so
--      INSERT ... VALUES (OLD.id, …) → 42804 "column \"bid_id\" is of type bigint but
--      expression is of type text". Fixed by making bid_id TEXT to match the source.
--
-- (The history table never captured a single row — the trigger always threw — so the
-- ALTER is on an empty table; instant and safe.) Idempotent; APPLY TO PRODUCTION.

-- Bug 2: bid_id must match td_bids.id (text). Guarded so it's a no-op once already text.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'td_bids_history'
      AND column_name = 'bid_id' AND data_type <> 'text'
  ) THEN
    ALTER TABLE td_bids_history ALTER COLUMN bid_id TYPE text USING bid_id::text;
  END IF;
END $$;

-- Bug 1: read OLD.user_id (td_bids' real owner column). CREATE OR REPLACE is idempotent;
-- the existing trg_bid_history trigger stays bound to this function.
CREATE OR REPLACE FUNCTION _capture_bid_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO td_bids_history(bid_id, contractor_user_id, operation, old_row, changed_at)
  VALUES (OLD.id, OLD.user_id, TG_OP, to_jsonb(OLD), NOW());
  RETURN NEW;
END;
$$;
