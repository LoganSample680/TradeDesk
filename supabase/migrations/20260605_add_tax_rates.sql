-- Tax rates table — ZIP code → combined sales tax rate
-- Populated and updated monthly by scripts/update-tax-rates.js
-- State base rate rows use zip = 'STATE-XX' as fallback when ZIP lookup misses
CREATE TABLE IF NOT EXISTS tax_rates (
  zip         TEXT         PRIMARY KEY,
  state       TEXT         NOT NULL,
  state_rate  NUMERIC(6,4) NOT NULL DEFAULT 0,
  local_rate  NUMERIC(6,4) NOT NULL DEFAULT 0,
  combined    NUMERIC(6,4) GENERATED ALWAYS AS (state_rate + local_rate) STORED,
  source      TEXT,
  updated_at  TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tax_rates_state_idx ON tax_rates(state);

ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;

-- Tax rates are public reference data — readable by anyone including anonymous clients
CREATE POLICY "tax_rates_public_read" ON tax_rates FOR SELECT USING (true);

-- Only service role (update script) can write
CREATE POLICY "tax_rates_service_write" ON tax_rates FOR ALL USING (auth.role() = 'service_role');
