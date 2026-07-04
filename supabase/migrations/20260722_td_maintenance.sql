-- ─────────────────────────────────────────────────────────────────────────────
-- td_maintenance — the fleet SERVICE LOG becomes a first-class synced table.
--
-- Before this, `maintenance` (every oil change, repair, service record) was the
-- ONLY data store that never left the device (localStorage zp3_maint). A
-- reinstall or second device lost/never saw the vehicle service history. This
-- migration gives it the exact same sync fabric as the other 14 td_* tables:
--   1. table + RLS owner policy + grants + live-row index + realtime (core
--      pattern, 20260703) — plus archived_at + hot index (archival pattern,
--      20260721) and the server-authoritative updated_at trigger + delta cursor
--      index (20260710), all in one shot since the table is brand new.
--   2. additive "crew" policy (20260715) — non-financial, so an active link is
--      enough, same as td_jobs/td_licenses.
--   3. get_account_delta recreated with td_maintenance in the payload.
--   4. load_account_data recreated with td_maintenance as a non-financial
--      pass-through (no money keys to redact; costs are mirrored into
--      td_expenses which already redacts).
--   5. archive_old_records learns td_maintenance (business date: data->>'date').
-- Idempotent; safe on hosted + local.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Table + full sync fabric ──────────────────────────────────────────────
create table if not exists td_maintenance (
  id          text         not null,
  user_id     uuid         not null references auth.users(id) on delete cascade,
  data        jsonb        not null default '{}',
  updated_at  timestamptz  not null default now(),
  deleted_at  timestamptz  default null,
  archived_at timestamptz  default null,
  primary key (id, user_id)
);

alter table td_maintenance enable row level security;
grant select, insert, update, delete on td_maintenance to anon, authenticated, service_role;

create index if not exists idx_td_maintenance_user on td_maintenance (user_id) where deleted_at is null;
create index if not exists td_maintenance_hot_idx on td_maintenance (user_id, updated_at) where deleted_at is null and archived_at is null;
create index if not exists idx_td_maintenance_user_updated on td_maintenance (user_id, updated_at);

drop policy if exists "owner" on td_maintenance;
create policy "owner" on td_maintenance for all
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- Crew: non-financial (crew_perm's else-branch = active link suffices). Guarded —
-- a bare lint DB may lack crew_perm; skip there, real DBs have it (20260715).
do $$
begin
  drop policy if exists "crew" on td_maintenance;
  create policy "crew" on td_maintenance for all to authenticated
    using (crew_perm(user_id, 'td_maintenance'))
    with check (crew_perm(user_id, 'td_maintenance'));
exception when undefined_function then null;
end $$;

-- Server-authoritative updated_at (delta-cursor correctness across devices).
drop trigger if exists trg_td_maintenance_updated_at on td_maintenance;
create trigger trg_td_maintenance_updated_at before insert or update on td_maintenance
  for each row execute function td_set_updated_at();

-- Realtime delivery to the owner's other devices.
do $$
begin
  execute 'alter publication supabase_realtime add table td_maintenance';
exception
  when duplicate_object then null;
  when others then null;
end $$;

-- ── 2. get_account_delta — same body as 20260721 + td_maintenance ────────────
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
      'td_photos',       (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_photos t       where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_maintenance',  (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_maintenance t  where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since)
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

-- ── 3. load_account_data — same body as 20260627 + td_maintenance ─────────────
-- (_lad_table itself is untouched — the 20260721 hot-rows version stands.)
create or replace function load_account_data(target_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  is_owner   boolean;
  p_fin      boolean;
  p_collect  boolean;
  p_estimate boolean;
  p_expenses boolean;
  p_mileage  boolean;
  result jsonb := '{}'::jsonb;
begin
  is_owner := (auth.uid()::text = target_uid::text);
  if not is_owner and not exists (
    select 1 from team_members
    where contractor_user_id = target_uid
      and employee_user_id::text = auth.uid()::text
      and active = true
  ) then
    raise exception 'not authorized to load account %', target_uid;
  end if;

  if is_owner then
    p_fin := true; p_collect := true; p_estimate := true; p_expenses := true; p_mileage := true;
  else
    p_fin      := has_team_perm(target_uid, 'financials');
    p_collect  := has_team_perm(target_uid, 'collect');
    p_estimate := has_team_perm(target_uid, 'estimate');
    p_expenses := has_team_perm(target_uid, 'expenses');
    p_mileage  := has_team_perm(target_uid, 'mileage');
  end if;

  -- Non-financial tables — pass through unchanged.
  result := result
    || _lad_table(target_uid, 'td_clients',      null)
    || _lad_table(target_uid, 'td_jobs',         null)
    || _lad_table(target_uid, 'td_time_entries', null)
    || _lad_table(target_uid, 'td_licenses',     null)
    || _lad_table(target_uid, 'td_events',       null)
    || _lad_table(target_uid, 'td_contracts',    null)
    || _lad_table(target_uid, 'td_agreements',   null)
    || _lad_table(target_uid, 'td_photos',       null)
    || _lad_table(target_uid, 'td_maintenance',  null);

  -- Financial tables — zero the money keys unless the permission grants them.
  result := result || _lad_table(target_uid, 'td_bids',     case when (p_fin or p_estimate) then null else array['amount','deposit'] end);
  result := result || _lad_table(target_uid, 'td_income',   case when  p_fin               then null else array['amount'] end);
  result := result || _lad_table(target_uid, 'td_payments', case when (p_fin or p_collect)  then null else array['amount'] end);
  result := result || _lad_table(target_uid, 'td_liens',    case when (p_fin or p_collect)  then null else array['amount'] end);
  result := result || _lad_table(target_uid, 'td_expenses', case when (p_fin or p_expenses) then null else array['amount'] end);
  result := result || _lad_table(target_uid, 'td_mileage',  case when (p_fin or p_mileage)  then null else array['amount','miles','deduction'] end);

  return result;
end;
$$;

do $$ begin
  execute 'revoke all on function load_account_data(uuid) from public';
  execute 'grant execute on function load_account_data(uuid) to authenticated';
exception when others then
  raise notice 'load_account_data grant skipped: %', sqlerrm;
end $$;

-- ── 4. archive_old_records — td_maintenance joins the 7-year sweep ────────────
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
      ('td_time_entries', 'date'),
      ('td_maintenance',  'date')
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
