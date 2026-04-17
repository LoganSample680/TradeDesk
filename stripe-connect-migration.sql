-- Stripe Connect migration
-- Run in Supabase → SQL Editor → New query
-- Adds stripe_account_id and stripe_connect_enabled to account_config

ALTER TABLE account_config
  ADD COLUMN IF NOT EXISTS stripe_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_connect_enabled boolean DEFAULT false;

-- Index for webhook lookup: account.updated event finds account by stripe_account_id
CREATE INDEX IF NOT EXISTS idx_account_config_stripe_account_id
  ON account_config (stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

-- Also needed: make sure account.updated webhook events are listened for.
-- In Stripe Dashboard → Developers → Webhooks → your webhook endpoint,
-- add "account.updated" to the list of events.
