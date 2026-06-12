-- Forced-cancel hardening.
--
-- The hub cancellation flow and a forced-cancel attack are both anonymous writes
-- that set cancelled_at by bid_id, so RLS cannot distinguish them — and cancelled_at
-- drives an auto-refund. RLS only decides which ROWS a role may touch; it cannot
-- require the caller to prove they hold the proposal's secret token.
--
-- So block the anon role from changing cancelled_at at all. Legitimate hub
-- cancellations now go through the cancel-proposal edge function, which validates
-- the hub link token and writes cancelled_at with the service role (which this
-- trigger allows). Contractor-initiated cancels run as the authenticated role and
-- are still permitted (scoped to their own rows by the auth_update_own policy).
CREATE OR REPLACE FUNCTION public.block_anon_cancel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
     AND current_user = 'anon' THEN
    RAISE EXCEPTION 'cancelled_at may only be set via the cancel-proposal function';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_anon_cancel ON public.signed_proposals;
CREATE TRIGGER trg_block_anon_cancel
  BEFORE UPDATE ON public.signed_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.block_anon_cancel();
