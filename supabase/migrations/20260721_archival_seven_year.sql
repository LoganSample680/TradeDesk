-- ─────────────────────────────────────────────────────────────────────────────
-- SEVEN-YEAR ARCHIVAL — the scale primitive for decade-old accounts.
--
-- IRS record retention says keep at least 7 years; the app keeps the current
-- year + 7 FULL prior years HOT and flags everything older `archived_at`.
-- Archived rows are NEVER deleted: same table, same backups, same RLS — they
-- simply stop riding boots/deltas/memory, so a 15-year-old account loads and
-- syncs like a 2-year-old one. An Archive view reads them on demand and a
-- restore is just archived_at=null (rides the normal delta back to every
-- device). Deliberately mirrors the soft-delete machinery the sync engine
-- already trusts — archived is "removed from the hot set", NOT "deleted", and
-- the client sweep is taught the difference.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. archived_at + hot partial index on every synced td_* table ────────────
-- The partial index keeps every hot-path scan (user_id + updated_at deltas,
-- full loads) walking ONLY live rows no matter how big the archive grows.
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
    begin
      execute format('alter table %I add column if not exists archived_at timestamptz', t);
      execute format(
        'create index if not exists %I on %I (user_id, updated_at) where deleted_at is null and archived_at is null',
        t || '_hot_idx', t);
    exception when undefined_table then null;
    end;
  end loop;
end $$;

-- ── 2. get_account_delta — archived_at rides every row ───────────────────────
-- Archiving bumps updated_at, so the transition IS a delta: every device drops
-- the row from its hot set through the ordinary sync path, no special protocol.
drop function if exists get_account_delta(timestamptz, text);

create or replace function get_account_delta(since timestamptz, ops_since text default null)
returns jsonb
language sql
security invoker
stable
as $$
  select jsonb_build_object(
    'cursor', (select z.updated_at from zj_data z where z.user_id = (auth.uid()::text)::uuid),
    'server_now', now(),
    'tables', jsonb_build_object(
      'td_clients',      (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_clients t      where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_bids',         (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_bids t         where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_jobs',         (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_jobs t         where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_income',       (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_income t       where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_expenses',     (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_expenses t     where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_mileage',      (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_mileage t      where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_payments',     (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_payments t     where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_liens',        (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_liens t        where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_time_entries', (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_time_entries t where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_licenses',     (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_licenses t     where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_events',       (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_events t       where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_contracts',    (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_contracts t    where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_agreements',   (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_agreements t   where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_photos',       (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_photos t       where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since)
    ),
    'ops', case when ops_since is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object('hlc',o.hlc,'op_table',o.op_table,'row_id',o.row_id,'fields',o.fields,'device_id',o.device_id) order by o.hlc),'[]'::jsonb)
      from (
        select hlc, op_table, row_id, fields, device_id
        from td_ops
        where user_id = (auth.uid()::text)::uuid and hlc > ops_since
        order by hlc asc
        limit 500
      ) o
    ) end
  );
$$;

grant execute on function get_account_delta(timestamptz, text) to authenticated;

-- ── 3. _lad_table (crew/employee full loads) — hot rows only ──────────────────
-- Same body as 20260627 with `archived_at is null` added: a crew boot on a
-- decade-old account downloads the working set, not the decade. Dynamic SQL, so
-- this stays valid even where td_* tables or the column don't exist yet.
create or replace function _lad_table(target_uid uuid, tbl text, zero_keys text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  arr jsonb;
  zero_obj jsonb := '{}'::jsonb;
  k text;
begin
  if to_regclass('public.' || tbl) is null then
    return jsonb_build_object(tbl, '[]'::jsonb);
  end if;
  if zero_keys is not null then
    foreach k in array zero_keys loop
      zero_obj := zero_obj || jsonb_build_object(k, 0);
    end loop;
  end if;
  begin
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''id'', id, ''data'', data || $2)), ''[]''::jsonb)'
      || ' from %I where user_id = $1 and deleted_at is null and archived_at is null',
      tbl
    )
    using target_uid, zero_obj
    into arr;
  exception when undefined_column then
    -- DB predating this migration: fall back to the unfiltered read.
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''id'', id, ''data'', data || $2)), ''[]''::jsonb)'
      || ' from %I where user_id = $1 and deleted_at is null',
      tbl
    )
    using target_uid, zero_obj
    into arr;
  end;
  return jsonb_build_object(tbl, arr);
end;
$$;

revoke all on function _lad_table(uuid, text, text[]) from public;

-- ── 4. archive_old_records() — the monthly archiver ──────────────────────────
-- Flags rows whose BUSINESS date (per-table field inside data) is before Jan 1
-- of (current year − 7). Rows with no parseable date are never auto-archived —
-- when in doubt, stay hot. Clients, licenses, contracts, agreements, and photos
-- are never auto-archived (active entities / legal documents). SECURITY INVOKER:
-- RLS scopes every update to the caller's own rows.
create or replace function archive_old_records()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  cutoff date := make_date(extract(year from now())::int - 7, 1, 1);
  uid uuid := (auth.uid()::text)::uuid;
  n int;
  total jsonb := '{}'::jsonb;
  spec record;
begin
  for spec in
    select * from (values
      ('td_bids',         'bid_date'),
      ('td_jobs',         'start'),
      ('td_income',       'date'),
      ('td_expenses',     'date'),
      ('td_payments',     'date'),
      ('td_mileage',      'date'),
      ('td_liens',        'date'),
      ('td_events',       'date'),
      ('td_time_entries', 'date')
    ) as v(tbl, datefield)
  loop
    begin
      execute format(
        'update %I set archived_at = now(), updated_at = now()
           where user_id = $1 and archived_at is null and deleted_at is null
             and (data->>%L) ~ ''^\d{4}-\d{2}-\d{2}''
             and (data->>%L)::date < $2',
        spec.tbl, spec.datefield, spec.datefield)
      using uid, cutoff;
      get diagnostics n = row_count;
      if n > 0 then total := total || jsonb_build_object(spec.tbl, n); end if;
    exception when undefined_table or undefined_column then null;
    end;
  end loop;
  return total;
end;
$$;

do $$ begin
  execute 'revoke all on function archive_old_records() from public';
  execute 'grant execute on function archive_old_records() to authenticated';
exception when others then
  raise notice 'archive_old_records grant skipped: %', sqlerrm;
end $$;
