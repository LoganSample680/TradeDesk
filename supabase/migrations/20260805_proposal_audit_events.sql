-- Append-only per-event audit log for a proposal's full engagement chain.
-- proposal_views stores only the FURTHEST step (one timestamp) — good for the
-- dashboard "how hot is this lead" badge, useless as an audit trail. This table
-- records EVERY event as its own row with its own timestamp + captured IP/device:
-- hub_opened, proposal_opened, approved, signature_ready, payment_viewed,
-- method_selected, signed. That's the granular, court-ready record a contractor
-- needs. Written only by the log-proposal-view Edge Function (service role); the
-- browser can't spoof the IP because it's read server-side from the request.

CREATE TABLE IF NOT EXISTS proposal_audit_events (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contractor_user_id uuid NOT NULL,
  bid_id             text NOT NULL,
  client_id          text,
  event              text NOT NULL,
  ip_address         text,
  user_agent         text,
  ts                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proposal_audit_events_lookup
  ON proposal_audit_events (contractor_user_id, bid_id, ts DESC);

ALTER TABLE proposal_audit_events ENABLE ROW LEVEL SECURITY;

-- The contractor reads their own audit rows. Inserts happen only through the
-- Edge Function's service-role client, which bypasses RLS, so there is
-- deliberately NO anon/authenticated insert policy: no client can forge an event.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'proposal_audit_events'
       AND policyname = 'Contractor reads own audit events'
  ) THEN
    EXECUTE $p$ CREATE POLICY "Contractor reads own audit events"
      ON proposal_audit_events FOR SELECT
      USING (contractor_user_id = auth.uid()) $p$;
  END IF;
END $$;

GRANT SELECT ON proposal_audit_events TO authenticated;
GRANT ALL    ON proposal_audit_events TO service_role;
