-- Fix security_definer_view lint error on my_signed_proposals.
-- The view was created without security_invoker, making it a SECURITY DEFINER
-- view that runs as the view owner (postgres) rather than the querying user,
-- bypassing RLS. Recreate it with security_invoker = true so it respects the
-- caller's RLS policies instead.
CREATE OR REPLACE VIEW public.my_signed_proposals
  WITH (security_invoker = true)
AS
  SELECT * FROM public.signed_proposals
  WHERE contractor_user_id::text = auth.uid()::text
  ORDER BY signed_at DESC;
