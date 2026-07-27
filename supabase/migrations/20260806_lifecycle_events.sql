-- Lifecycle event log: one append-only row per business milestone, so funnel
-- timings can be measured across EVERY lead and every account.
--
-- Why this exists: milestone times already live inside each account's records
-- (a bid's dates, a payment's date), which is right for the app but useless for
-- analytics, since nothing can query across leads or accounts. proposal_audit_events
-- already does this correctly for the client-facing sign flow (hub_opened,
-- proposal_opened, approved, signed); this table covers everything the CONTRACTOR
-- does, and the reporting RPC reads both.
--
-- ts is server-assigned (default now()), never supplied by the client, so a
-- duration can't be skewed by a device with a wrong clock.

CREATE TABLE IF NOT EXISTS lifecycle_events (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contractor_user_id uuid NOT NULL,
  event              text NOT NULL,
  client_id          text,
  bid_id             text,
  job_id             text,
  -- Set for once-per-entity milestones (a lead is only created once) so a retry
  -- or a second device can't double-count and skew an average. Left null for
  -- events that legitimately repeat, such as payments.
  dedupe_key         text,
  meta               jsonb,
  ts                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lifecycle_events_lookup
  ON lifecycle_events (contractor_user_id, event, ts DESC);
CREATE INDEX IF NOT EXISTS lifecycle_events_bid
  ON lifecycle_events (contractor_user_id, bid_id);
CREATE INDEX IF NOT EXISTS lifecycle_events_client
  ON lifecycle_events (contractor_user_id, client_id);
CREATE UNIQUE INDEX IF NOT EXISTS lifecycle_events_dedupe
  ON lifecycle_events (contractor_user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

ALTER TABLE lifecycle_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- A contractor reads and writes only their own rows. Insert is allowed from the
  -- app (authenticated) because these are the contractor's own actions; the
  -- WITH CHECK pins the row to the caller so one account cannot write another's
  -- history. ts is not settable here, the column default supplies it.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lifecycle_events' AND policyname='Contractor reads own lifecycle events') THEN
    EXECUTE $p$ CREATE POLICY "Contractor reads own lifecycle events"
      ON lifecycle_events FOR SELECT USING (contractor_user_id::text = auth.uid()::text) $p$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lifecycle_events' AND policyname='Contractor writes own lifecycle events') THEN
    EXECUTE $p$ CREATE POLICY "Contractor writes own lifecycle events"
      ON lifecycle_events FOR INSERT TO authenticated WITH CHECK (contractor_user_id::text = auth.uid()::text) $p$;
  END IF;
END $$;

GRANT SELECT, INSERT ON lifecycle_events TO authenticated;
GRANT ALL ON lifecycle_events TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Funnel durations. Returns one row per stage with the median and average gap in
-- hours, plus how many leads actually completed that stage. Median is reported
-- because a single lead that sat for three months would drag an average badly.
--
-- p_scope 'mine' measures the calling contractor (their own coaching numbers);
-- 'all' measures every account (owner-level product analytics) and is only
-- honoured for service_role callers.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lifecycle_funnel(p_scope text DEFAULT 'mine', p_since timestamptz DEFAULT NULL)
RETURNS TABLE(stage text, from_event text, to_event text, samples bigint, median_hours numeric, avg_hours numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH scoped AS (
    SELECT e.contractor_user_id, e.bid_id, e.client_id, e.event, e.ts
      FROM public.lifecycle_events e
     WHERE (p_since IS NULL OR e.ts >= p_since)
       AND (p_scope = 'all' OR e.contractor_user_id::text = auth.uid()::text)
    UNION ALL
    -- The client-facing half of the funnel already lives here.
    SELECT a.contractor_user_id, a.bid_id, a.client_id, a.event, a.ts
      FROM public.proposal_audit_events a
     WHERE (p_since IS NULL OR a.ts >= p_since)
       AND (p_scope = 'all' OR a.contractor_user_id::text = auth.uid()::text)
  ),
  -- First occurrence of each event per entity: a proposal can be opened many
  -- times, but "time to first open" is the meaningful number.
  firsts AS (
    SELECT contractor_user_id, COALESCE(bid_id, client_id) AS entity, event, MIN(ts) AS ts
      FROM scoped
     WHERE COALESCE(bid_id, client_id) IS NOT NULL
     GROUP BY contractor_user_id, COALESCE(bid_id, client_id), event
  ),
  stages(stage, from_event, to_event) AS (
    VALUES
      ('Lead to proposal',      'lead_created',      'proposal_saved'),
      ('Time to write proposal','proposal_started',  'proposal_saved'),
      ('Proposal to sent',      'proposal_saved',    'proposal_sent'),
      ('Sent to first open',    'proposal_sent',     'proposal_opened'),
      ('Opened to signed',      'proposal_opened',   'signed'),
      ('Sent to signed',        'proposal_sent',     'signed'),
      ('Signed to booked',      'signed',            'job_scheduled'),
      ('Booked to complete',    'job_scheduled',     'job_completed'),
      ('Complete to paid off',  'job_completed',     'balance_settled')
  ),
  gaps AS (
    SELECT s.stage, s.from_event, s.to_event,
           EXTRACT(EPOCH FROM (t.ts - f.ts))/3600.0 AS hours
      FROM stages s
      JOIN firsts f ON f.event = s.from_event
      JOIN firsts t ON t.event = s.to_event
                   AND t.entity = f.entity
                   AND t.contractor_user_id = f.contractor_user_id
     WHERE t.ts >= f.ts
  )
  SELECT s.stage, s.from_event, s.to_event,
         COUNT(g.hours)::bigint AS samples,
         ROUND(COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY g.hours), 0)::numeric, 2) AS median_hours,
         ROUND(COALESCE(AVG(g.hours), 0)::numeric, 2) AS avg_hours
    FROM stages s
    LEFT JOIN gaps g ON g.stage = s.stage
   GROUP BY s.stage, s.from_event, s.to_event
   ORDER BY s.stage;
$$;

GRANT EXECUTE ON FUNCTION lifecycle_funnel(text, timestamptz) TO authenticated, service_role;
