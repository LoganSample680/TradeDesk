-- QR lead tracking: a contractor generates a QR code tied to a physical
-- marketing source (yard sign, truck wrap, business card). Scanning it hits
-- a tracked redirect (functions/q/[[code]].js) that logs a 'scan' event and
-- forwards to intake.html?a=<account>&src=<code>, which logs 'form_opened'
-- on load and 'submitted' (+ optional 'field_dropoff') as the person fills
-- it out. This is the funnel nobody in this market currently measures (see
-- PR description): scan → form open → submit, broken down by physical source.
--
-- Two tables, two very different trust levels, mirrored on the existing
-- inbound_leads / proposal_audit_events split:
--   qr_sources — the code REGISTRY. Readable by anon (the redirect function
--     and intake.html both need to resolve a code with no contractor logged
--     in), writable only by the owning contractor (same ownership check as
--     account_users/inbound_leads: account_id must belong to accounts where
--     owner_id = auth.uid()).
--   qr_events  — the append-only EVENT LOG. No anon/authenticated insert
--     policy at all, same shape as proposal_audit_events: only the
--     log-qr-event Edge Function (service role) can write, so a scanner's
--     browser can never forge or inflate its own funnel numbers.

CREATE TABLE IF NOT EXISTS qr_sources (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code       text NOT NULL UNIQUE,
  label      text NOT NULL,
  category   text NOT NULL DEFAULT 'Other',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qr_sources_account_idx ON qr_sources (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS qr_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  qr_source_id uuid NOT NULL REFERENCES qr_sources(id) ON DELETE CASCADE,
  event        text NOT NULL,
  field_name   text,
  ip_address   text,
  user_agent   text,
  ts           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qr_events_source_idx ON qr_events (qr_source_id, ts DESC);

ALTER TABLE qr_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_events  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- qr_sources: anon can read (the redirect function + intake.html resolve a
  -- code with nobody signed in), only the owning contractor can create/edit/
  -- delete their own codes. Same ownership check already used for
  -- account_users/vehicles/account_config.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'qr_sources' AND policyname = 'Anon reads QR sources'
  ) THEN
    EXECUTE $p$ CREATE POLICY "Anon reads QR sources" ON qr_sources FOR SELECT TO anon USING (true) $p$;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'qr_sources' AND policyname = 'Authenticated reads QR sources'
  ) THEN
    EXECUTE $p$ CREATE POLICY "Authenticated reads QR sources" ON qr_sources FOR SELECT TO authenticated USING (true) $p$;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'qr_sources' AND policyname = 'Owner creates QR sources'
  ) THEN
    EXECUTE $p$ CREATE POLICY "Owner creates QR sources" ON qr_sources FOR INSERT TO authenticated
      WITH CHECK (account_id::text IN (SELECT id::text FROM accounts WHERE owner_id::text = auth.uid()::text)) $p$;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'qr_sources' AND policyname = 'Owner updates QR sources'
  ) THEN
    EXECUTE $p$ CREATE POLICY "Owner updates QR sources" ON qr_sources FOR UPDATE TO authenticated
      USING (account_id::text IN (SELECT id::text FROM accounts WHERE owner_id::text = auth.uid()::text)) $p$;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'qr_sources' AND policyname = 'Owner deletes QR sources'
  ) THEN
    EXECUTE $p$ CREATE POLICY "Owner deletes QR sources" ON qr_sources FOR DELETE TO authenticated
      USING (account_id::text IN (SELECT id::text FROM accounts WHERE owner_id::text = auth.uid()::text)) $p$;
  END IF;

  -- qr_events: contractor reads their own funnel (joined through qr_sources'
  -- ownership check). Deliberately NO anon/authenticated insert policy —
  -- only the log-qr-event Edge Function's service-role client can write,
  -- so a scanner can never forge or inflate their own scan/submit counts.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'qr_events' AND policyname = 'Contractor reads own QR events'
  ) THEN
    EXECUTE $p$ CREATE POLICY "Contractor reads own QR events" ON qr_events FOR SELECT TO authenticated
      USING (qr_source_id IN (
        SELECT id FROM qr_sources WHERE account_id::text IN (
          SELECT id::text FROM accounts WHERE owner_id::text = auth.uid()::text
        )
      )) $p$;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON qr_sources TO authenticated;
GRANT SELECT ON qr_sources TO anon;
GRANT ALL ON qr_sources TO service_role;

GRANT SELECT ON qr_events TO authenticated;
GRANT ALL ON qr_events TO service_role;
