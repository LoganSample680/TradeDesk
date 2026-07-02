-- Server-authoritative updated_at on the td_* sync tables — the FOUNDATION for
-- INCREMENTAL ("delta") cloud loads (js/cloud.js supaLoadFromCloud).
--
-- WHY: cold boot currently re-reads the ENTIRE account on every sign-in (a full
-- per-table select), so load time grows without bound as the account accumulates rows
-- — far enough that sign-in itself now times out on a heavily-used account. The fix is
-- to load only rows changed since this device's last visit (updated_at > lastSync) and
-- merge them onto the local cache. For that cursor to be correct ACROSS DEVICES,
-- updated_at must be authoritative SERVER time — not the client clock the app stamps
-- today (a device whose clock lags would otherwise be skipped by a peer's delta query).
--
-- A BEFORE INSERT OR UPDATE trigger stamps now() on every write, INCLUDING the
-- soft-delete UPDATE (cloud.js:3099 sets deleted_at — the trigger co-stamps updated_at),
-- so deletes ride the same delta and disappear on peers' next load.
--
-- SAFE: the app never READS td_*.updated_at (the load selects only id,data), so
-- overriding the client-written value changes nothing the client depends on. zj_data is
-- intentionally NOT touched (settings keep their own settingsTs precedence). Idempotent
-- — re-running drops/recreates the triggers and skips existing indexes; prod untouched.

create or replace function td_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare
  t text;
  tables text[] := array[
    'td_clients','td_bids','td_jobs','td_income','td_expenses','td_mileage',
    'td_payments','td_liens','td_time_entries','td_licenses','td_events',
    'td_contracts','td_agreements','td_photos'
  ];
begin
  foreach t in array tables loop
    -- server-stamp updated_at on every write (insert + update, incl. the soft-delete)
    execute format('drop trigger if exists trg_%1$s_updated_at on %1$I', t, t);
    execute format(
      'create trigger trg_%1$s_updated_at before insert or update on %1$I
         for each row execute function td_set_updated_at()', t, t);

    -- Index the delta cursor so `where user_id = $1 and updated_at > $2` is a range
    -- scan, not a full per-user scan (a cheap read is the whole point). No partial
    -- predicate, so soft-deleted rows are in the index too — deletes ride the delta.
    execute format('create index if not exists %I on %I (user_id, updated_at)',
                   'idx_' || t || '_user_updated', t);
  end loop;
end $$;
