-- Let a contractor read the TradeDesk-wide benchmark numbers, and nothing else.
--
-- analytics_metrics_daily was service-role only by design: it holds internal ops
-- metrics (error rates, flow-test friction, deploy health) that no customer
-- should see. But the benchmark feature needs contractors to read the
-- platform-wide averages so their own numbers have something to sit beside.
--
-- Rather than open the table, this grants read access to exactly the rows that
-- are safe to publish, on two conditions that are enforced in SQL rather than in
-- the app, so a bug in the client cannot widen them:
--
--   1. metric LIKE 'bench\_%'  — only rows the rollup deliberately marked as
--      publishable. Every internal ops metric keeps its own name and stays
--      invisible.
--   2. n >= 5                  — a bucket built from fewer than 5 samples is
--      withheld. With a handful of accounts, "the average close rate for HVAC"
--      computed from one business IS that business's number, and a competitor
--      on the platform could read it straight off. The rollup applies the same
--      floor when writing; this is the second lock, in case it ever doesn't.
--
-- These rows carry no account identifier, no client names, and no dollar totals:
-- a count, a median, quartiles, and an average per bucket.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'analytics_metrics_daily'
       AND policyname = 'Contractors read published benchmarks'
  ) THEN
    EXECUTE $p$ CREATE POLICY "Contractors read published benchmarks"
      ON analytics_metrics_daily FOR SELECT TO authenticated
      USING (metric LIKE 'bench\_%' AND n >= 5) $p$;
  END IF;
END $$;

-- RLS filters rows; the role still needs the table privilege to read at all.
GRANT SELECT ON analytics_metrics_daily TO authenticated;
