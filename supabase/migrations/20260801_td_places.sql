-- Contractor-owned geocoded locations: the shop, supply houses, anywhere else
-- the crew legitimately stops.
--
-- Why this exists: the geofence state machine only ever knew two kinds of place,
-- the shop (S.officeLat/officeLon) and job sites (client addresses). Supply
-- houses were invisible, and that broke drive tracking in three ways:
--
--   1. Time PARKED at a supply house counted as driving. No fence contained the
--      truck, so the drive clock kept running while it sat in the lot, and those
--      minutes landed on the next job's drive leg.
--   2. A supply run that returned to the shop logged NOTHING. Leaving the shop
--      started the drive clock, but arriving back merely cleared it;
--      _geoDriveEntry only ever fired on arriving at a JOB. A real, deductible
--      round trip produced zero miles.
--   3. Every leg billed to its destination job, so shop -> supply -> job charged
--      that job for the supply stop too, and Job Profit was wrong.
--
-- Mileage is a tax deduction, so these are accuracy defects, not UX ones.
--
-- Same fabric as td_vehicles (20260809): the whole record lives in `data` jsonb,
-- owner + crew RLS, updated_at trigger, delta cursor, realtime. Crew need read
-- access because the fence machine runs on THEIR device.

create table if not exists td_places (
  id          text         not null,
  user_id     uuid         not null references auth.users(id) on delete cascade,
  data        jsonb        not null default '{}',
  updated_at  timestamptz  not null default now(),
  deleted_at  timestamptz  default null,
  primary key (user_id, id)
);

alter table td_places enable row level security;

-- Both sides cast to text, exactly as td_vehicles does. auth.uid() can come back
-- as text depending on the JWT path, and an uncast comparison fails at runtime
-- as "operator does not exist: text = uuid", which silently denies every row
-- rather than erroring loudly. There is a migration lint for this.
drop policy if exists "owner" on td_places;
create policy "owner" on td_places for all
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- Crew need places because the fence machine runs on THEIR device: without this
-- a supply stop is unresolvable for the person actually driving. Uses the shared
-- crew_perm helper rather than a hand-rolled team_members subquery so the
-- casting and the active-link rule stay in one place. td_places is not in
-- crew_perm's redaction list, so it falls to the permissive default, which is
-- right: a place carries no money, only a name and a coordinate.
do $$
begin
  drop policy if exists "crew" on td_places;
  create policy "crew" on td_places for all to authenticated
    using (crew_perm(user_id, 'td_places'))
    with check (crew_perm(user_id, 'td_places'));
exception when undefined_function then null;
end $$;

grant select, insert, update, delete on td_places to authenticated;

create index if not exists td_places_hot_idx
  on td_places (user_id) where deleted_at is null;
create index if not exists td_places_delta_idx
  on td_places (user_id, updated_at desc);

drop trigger if exists td_places_set_updated_at on td_places;
create trigger td_places_set_updated_at
  before update on td_places
  for each row execute function td_set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'td_places'
  ) then
    alter publication supabase_realtime add table td_places;
  end if;
end $$;

-- ── get_account_delta — same body as 20260809 + td_places ───────────────────
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
      'td_maintenance',  (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_maintenance t  where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_vehicles',     (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_vehicles t     where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_places',       (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_places t       where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since)
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


-- ── load_account_data — same body as 20260809 + td_places ───────────────────
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
  -- A vehicle is operational (crew need the list to log a trip against), but its
  -- purchase price is the asset's cost basis — money. Redact it on the same
  -- permission as the vehicle-purchase expense it mirrors into td_expenses.
  result := result || _lad_table(target_uid, 'td_vehicles', case when (p_fin or p_expenses) then null else array['purchasePrice'] end);
  result := result || _lad_table(target_uid, 'td_places', null);

  return result;
end;
$$;

do $$ begin
  execute 'revoke all on function load_account_data(uuid) from public';
  execute 'grant execute on function load_account_data(uuid) to authenticated';
exception when others then
  raise notice 'load_account_data grant skipped: %', sqlerrm;
end $$;
