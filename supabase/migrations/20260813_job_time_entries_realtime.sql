-- Realtime publication parity for job_time_entries (20260711 pattern).
--
-- js/cloud.js's sig-feed channel now also subscribes postgres_changes on
-- job_time_entries, so a geofence departure lands on the client Activity
-- timeline live instead of waiting for the next 30s poll. Without this, the
-- subscription is accepted but the server never publishes the change event,
-- the same silent realtime zombie 20260711 closed for zj_data/signed_proposals/
-- proposal_views.
--
-- IDEMPOTENT and safe on the hosted project: duplicate adds are swallowed.

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table job_time_entries';
  exception
    when duplicate_object then null;
    when undefined_table then null;
    when others then null;
  end;
end $$;
