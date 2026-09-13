-- ════════════════════════════════════════════════════════════════════════
-- The roster learns the trade, and stops listing our own test accounts.
--
-- Owner (2026-09-12): the portal should open on TRADES, each with how many
-- businesses, then drill into a trade, then into a business. That needs the
-- trade on every roster row, and the trade the contractor picked in settings is
-- the one the app itself reads: account_config.business_type, with trade_lines
-- for a shop that runs more than one. v_account_dim already derives exactly
-- this for the funnel and money rollups, so the roster now derives it the same
-- way rather than inventing a second answer (§7.3).
--
-- Second thing, and it was a real mismatch: v_account_dim EXCLUDES internal
-- accounts (analytics_internal_accounts), so every number on the portal already
-- did, while the roster listed them. The account list and the tiles disagreed
-- by however many test accounts exist. The roster excludes them too now.
--
-- The return type changes, so the function is dropped first: create or replace
-- cannot widen a returns-table signature.
-- ════════════════════════════════════════════════════════════════════════

drop function if exists public.ops_view_roster();

create or replace function public.ops_view_roster()
returns table (
  contractor_user_id uuid,
  business           text,
  trade              text,
  trade_lines        text,
  person_user_id     uuid,
  person_name        text,
  person_email       text,
  role               text,
  permissions        jsonb,
  active             boolean,
  last_seen          timestamptz
)
language sql stable security definer set search_path = public, auth as $$
  with dim as (
    -- One row per business: the name, and the trade the owner chose in setup.
    select a.owner_id as contractor_user_id,
           coalesce(nullif(btrim(a.business_name), ''), u.email, 'Unknown') as business,
           coalesce(nullif(btrim(ac.business_type), ''), 'unknown')         as trade,
           ac.trade_lines
      from public.accounts a
      left join public.account_config ac on ac.account_id = a.id
      left join auth.users u on u.id::text = a.owner_id::text
     where a.owner_id is not null
  ),
  hidden as (select user_id from public.analytics_internal_accounts),
  owners as (
    select distinct on (z.user_id)
           z.user_id as contractor_user_id,
           coalesce(d.business, u.email, 'Unknown') as business,
           coalesce(d.trade, 'unknown')             as trade,
           d.trade_lines,
           z.user_id as person_user_id,
           coalesce(nullif(btrim(u2.name), ''), u.email) as person_name,
           u.email as person_email,
           'owner'::text as role,
           '{}'::jsonb as permissions,
           true as active,
           z.updated_at as last_seen
      from public.zj_data z
      join auth.users u on u.id::text = z.user_id::text
      left join dim d on d.contractor_user_id::text = z.user_id::text
      left join public.users u2 on u2.id::text = z.user_id::text
     where not exists (select 1 from hidden h where h.user_id::text = z.user_id::text)
     order by z.user_id
  ),
  crew as (
    select tm.contractor_user_id,
           coalesce(d.business, ou.email, 'Unknown') as business,
           coalesce(d.trade, 'unknown')              as trade,
           d.trade_lines,
           tm.employee_user_id as person_user_id,
           tm.name as person_name,
           tm.email as person_email,
           coalesce(nullif(tm.role, ''), 'crew') as role,
           coalesce(tm.permissions, '{}'::jsonb) as permissions,
           coalesce(tm.active, true) as active,
           tm.joined_at as last_seen
      from public.team_members tm
      left join dim d on d.contractor_user_id::text = tm.contractor_user_id::text
      left join auth.users ou on ou.id::text = tm.contractor_user_id::text
     where tm.employee_user_id is not null
       and not exists (select 1 from hidden h where h.user_id::text = tm.contractor_user_id::text)
  )
  select * from (
    select * from owners
    union all
    select * from crew
  ) r
  where public.is_ops_admin()
  order by r.trade, r.business, (r.role <> 'owner'), r.person_name;
$$;

comment on function public.ops_view_roster() is
  'Every business and every person on it, with the trade from settings, for the ops portal. Internal accounts excluded, same as every ops number. Zero rows for anyone not on the ops allowlist.';

revoke execute on function public.ops_view_roster() from public, anon;
grant  execute on function public.ops_view_roster() to authenticated;
