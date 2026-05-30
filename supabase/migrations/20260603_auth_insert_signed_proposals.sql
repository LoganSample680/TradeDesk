-- Allow authenticated users to INSERT into signed_proposals.
-- The anon_insert policy covers unauthenticated clients (normal sign flow).
-- This covers the contractor opening their sign.html link while logged into the
-- main app in the same browser session — they're "authenticated" but still need
-- to insert a new row on first sign.
CREATE POLICY "auth_insert" ON public.signed_proposals
  FOR INSERT TO authenticated WITH CHECK (true);
