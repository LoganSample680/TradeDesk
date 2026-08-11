-- Client equipment: the furnace, water heater, panel, or unit a contractor
-- services, captured by pointing the camera at its data plate (Apple Vision
-- reads the model and serial on-device, js/equipment.js).
--
-- WHY IT IS ITS OWN TABLE: model + serial are what warranty claims and
-- service history hang on, and they belong to the CLIENT's property, not to
-- the one job that happened to touch them. A unit outlives every job record
-- around it, so it gets its own row and shows in the client hub.
--
-- ORDERING IS LOAD-BEARING: this file MUST sort after 20260814_td_equipment,
-- because every one of these migrations recreates get_account_delta and
-- load_account_data and the LAST one applied wins. This file's copies carry
-- every earlier table plus td_equipment.
--
-- Same fabric as td_vehicles/td_places/td_equipment: whole record in `data`
-- jsonb, owner + crew RLS, updated_at trigger, delta cursor, realtime. Crew
-- need access because the plate is photographed on THEIR device on site.

create table if not exists td_equipment (
  id          text         not null,
  user_id     uuid         not null references auth.users(id) on delete cascade,
  data        jsonb        not null default '{}',
  updated_at  timestamptz  not null default now(),
  deleted_at  timestamptz  default null,
  -- Required by the SHARED shape of get_account_delta / _lad_table (see the
  -- td_places note): the common query selects archived_at for every td_ table.
  archived_at timestamptz  default null,
  primary key (user_id, id)
);

alter table td_equipment enable row level security;

-- Both sides cast to text, exactly as td_vehicles/td_places do (see the
-- migration lint note there: an uncast comparison silently denies every row).
drop policy if exists "owner" on td_equipment;
create policy "owner" on td_equipment for all
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

do $$
begin
  drop policy if exists "crew" on td_equipment;
  create policy "crew" on td_equipment for all to authenticated
    using (crew_perm(user_id, 'td_equipment'))
    with check (crew_perm(user_id, 'td_equipment'));
exception when undefined_function then null;
end $$;

grant select, insert, update, delete on td_equipment to authenticated;

create index if not exists td_equipment_hot_idx
  on td_equipment (user_id, updated_at) where deleted_at is null and archived_at is null;
create index if not exists td_equipment_delta_idx
  on td_equipment (user_id, updated_at desc);

drop trigger if exists td_equipment_set_updated_at on td_equipment;
create trigger td_equipment_set_updated_at
  before update on td_equipment
  for each row execute function td_set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'td_equipment'
  ) then
    alter publication supabase_realtime add table td_equipment;
  end if;
end $$;

-- ── get_account_delta — same body as 20260814 + td_equipment ───────────────
-- (Must stay newer than 20260814 or the scans copy wins and drops equipment.)
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
      'td_places',       (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_places t       where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_scans',        (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_scans t        where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since),
      'td_equipment',    (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at,'archived_at',t.archived_at)),'[]'::jsonb) from td_equipment t    where t.user_id = (auth.uid()::text)::uuid and t.updated_at > since)
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


-- ── load_account_data — same body as 20260814 + td_equipment ───────────────
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
  result := result || _lad_table(target_uid, 'td_vehicles', case when (p_fin or p_expenses) then null else array['purchasePrice'] end);
  result := result || _lad_table(target_uid, 'td_places', null);
  -- A scan is operational (crew capture them on site); its sale PRICE is money,
  -- redacted on the same permission the estimate figures use.
  result := result || _lad_table(target_uid, 'td_scans',  case when (p_fin or p_estimate) then null else array['price'] end);
  -- Equipment carries no money: model, serial, install date, warranty. Crew
  -- must see it in full or a service call is guesswork.
  result := result || _lad_table(target_uid, 'td_equipment', null);

  return result;
end;
$$;

do $$ begin
  execute 'revoke all on function load_account_data(uuid) from public';
  execute 'grant execute on function load_account_data(uuid) to authenticated';
exception when others then
  raise notice 'load_account_data grant skipped: %', sqlerrm;
end $$;
