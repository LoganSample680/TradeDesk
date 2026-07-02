-- td_ops joins the realtime publication — the INSTANT leg of the per-field op channel.
--
-- The 100-writer capability: row upserts carry WHOLE rows, so two devices saving
-- different fields of the SAME row inside the propagation window clobber each other
-- server-side. Every save now also publishes its per-field ops to td_ops; peers apply
-- them field-by-field (HLC-guarded) the moment this publication delivers the INSERT.
-- Without this, ops still disseminate via the pull legs (save epilogue + load) — this
-- just makes same-row concurrency converge in milliseconds instead of a poll interval.
--
-- Retention: clients prune their own account's ops older than 14 days on boot (see
-- js/cloud.js cold-load timers) — the stream only needs to cover the concurrency
-- window plus a generous offline-return horizon; rows remain the state of record.
--
-- IDEMPOTENT and safe everywhere: duplicate adds and missing tables are swallowed.

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table td_ops';
  exception
    when duplicate_object then null;
    when undefined_table then null;
    when others then null;
  end;
end $$;

-- Retention prune scans by (user_id, created_at); hlc index alone would force a filter.
create index if not exists idx_td_ops_user_created on td_ops(user_id, created_at);
