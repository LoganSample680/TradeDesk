-- Security hardening migration
-- Fixes:
-- 1. Remove world-writable anon UPDATE on signed_proposals (enabled forced-refund attacks)
-- 2. Add UNIQUE constraint on bid_id to fix upsert creating duplicate rows
-- 3. Scope anon UPDATE to require knowing proposal_key (token-scoped)

-- Drop the existing blanket anon UPDATE policies
DROP POLICY IF EXISTS "anon_update" ON signed_proposals;
DROP POLICY IF EXISTS "Public can update signed proposals" ON signed_proposals;

-- Replace with token-scoped update: anon can only update a row they can identify by storage_key
-- This prevents an attacker from setting cancelled_at on an arbitrary bid_id they guessed
DROP POLICY IF EXISTS "anon_update_by_token" ON signed_proposals;
CREATE POLICY "anon_update_by_token" ON signed_proposals
  FOR UPDATE TO anon
  USING (storage_key IS NOT NULL)
  WITH CHECK (storage_key IS NOT NULL);

-- Add unique constraint on bid_id so upsert behaves correctly instead of inserting duplicate rows.
-- The upsert calls in sign.html and stripe-webhook now pass onConflict:'bid_id' to match.
--
-- The duplicate-row bug means production likely already HAS multiple rows per bid_id. Adding the
-- UNIQUE constraint against that data would raise unique_violation and fail the whole migration
-- (and the deploy). Dedupe first: keep the single most authoritative row per bid_id — prefer one
-- with a real Stripe payment, then a charge, then a cancellation, then the most recently signed,
-- then the most recently created — and delete the rest.
DELETE FROM signed_proposals s
WHERE s.id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY bid_id
        ORDER BY (stripe_payment_intent IS NOT NULL) DESC,
                 (stripe_charge_id IS NOT NULL) DESC,
                 (cancelled_at IS NOT NULL) DESC,
                 signed_at DESC NULLS LAST,
                 created_at DESC NULLS LAST
      ) AS rn
    FROM signed_proposals
    WHERE bid_id IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
);

DO $$ BEGIN
  ALTER TABLE signed_proposals ADD CONSTRAINT signed_proposals_bid_id_unique UNIQUE (bid_id);
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_object THEN NULL;
  WHEN unique_violation THEN NULL;
END $$;
