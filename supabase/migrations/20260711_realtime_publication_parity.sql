-- Realtime publication PARITY for every table the app subscribes to.
--
-- js/cloud.js subscribes postgres_changes on: td_* (covered by 20260703),
-- zj_data (the cross-device sync cursor + settings row — the event that drives
-- every reconcile), and the sig-feed tables signed_proposals / proposal_views.
--
-- On the HOSTED project these were added to the supabase_realtime publication
-- via the dashboard, OUTSIDE version control — so any fresh database (the local
-- test stack today, the self-hosted Proxmox Supabase after the migration) accepts
-- the subscriptions but never publishes the change events: a silent, server-side
-- realtime zombie. The client-side twin of this bug (the socket forced to the
-- hosted endpoint) was fixed in js/cloud.js; this closes the server side.
--
-- IDEMPOTENT and safe on the hosted project: duplicate adds are swallowed, and
-- a table that doesn't exist in an environment is skipped.

do $$
declare
  t text;
  tables text[] := array['zj_data','signed_proposals','proposal_views'];
begin
  foreach t in array tables loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception
      when duplicate_object then null;
      when undefined_table then null;
      when others then null;
    end;
  end loop;
end $$;
