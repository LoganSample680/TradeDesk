-- CREW BULLETPROOFING — the server half of "1000 crew logins nested under one owner".
--
-- Before this migration, every td_* table had exactly ONE policy: owner-only. A linked
-- crew member's app stamps rows with the boss's user_id, so the database REJECTED every
-- crew write to shared business data (silent sync-error loop), delivered them no
-- realtime (RLS filters postgres_changes), no delta reads, and no heartbeat cursor.
-- Crew reads worked only through the redacted load_account_data RPC.
--
-- This migration makes crew logins first-class citizens of the sync fabric while
-- KEEPING the permission boundary server-side:
--
--   1. crew_perm(boss, tbl)   — SECURITY DEFINER: active team_members link + the SAME
--      per-table permission map the client's save-guard uses (_employeeRedactedTables).
--      Money tables need the matching permission; operational tables need only an
--      active link. Table-level granularity: a crew member who may WRITE a table may
--      read it raw; anything below that stays behind the field-redacting RPC.
--   2. "crew" policies on all 14 td_* tables (additive to "owner") — writes AND reads,
--      which also switches ON realtime delivery and silent-delta reads for crew,
--      because both enforce RLS SELECT.
--   3. td_ops crew policy keyed on op_table through the same permission map — crew
--      devices join the per-field op channel (the 100-writer machinery) without ever
--      receiving ops for tables their permissions deny.
--   4. get_account_cursor / bump_account_cursor RPCs — crew heartbeat + "cursor moved
--      ⇒ data committed" for crew saves, WITHOUT granting zj_data row access (settings
--      stay owner-private; the cursor is just a timestamp).
--   5. crew_invites + claim_crew_invite(tok) — server-minted, single-use, expiring
--      invite tokens. The legacy ?emp_invite= payload is client-forgeable base64; it
--      only ever worked via the email-match path. The token path links regardless of
--      which email the crew member signed up with, and forgery is impossible because
--      the token exists only as a row the contractor created.
--
-- Idempotent; safe on hosted + local. All auth.uid() comparisons carry ::text casts
-- (repo lint) with the cast on the FUNCTION side wherever an index matters.

-- ── 1. Link + permission helpers (SECURITY DEFINER: read team_members regardless of
--       the caller's RLS; STABLE so the planner runs them once per statement). ──────
create or replace function crew_member_of(boss uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists(
    select 1 from team_members tm
    where tm.employee_user_id::text = auth.uid()::text
      and tm.contractor_user_id = boss
      and tm.active
  );
$$;

create or replace function crew_perm(boss uuid, tbl text)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists(
    select 1 from team_members tm
    where tm.employee_user_id::text = auth.uid()::text
      and tm.contractor_user_id = boss
      and tm.active
      and case tbl
        -- Mirror of js/cloud.js _employeeRedactedTables — keep the two in lockstep.
        when 'td_bids'     then coalesce((tm.permissions->>'financials')::boolean,false) or coalesce((tm.permissions->>'estimate')::boolean,false)
        when 'td_income'   then coalesce((tm.permissions->>'financials')::boolean,false)
        when 'td_payments' then coalesce((tm.permissions->>'financials')::boolean,false) or coalesce((tm.permissions->>'collect')::boolean,false)
        when 'td_liens'    then coalesce((tm.permissions->>'financials')::boolean,false) or coalesce((tm.permissions->>'collect')::boolean,false)
        when 'td_expenses' then coalesce((tm.permissions->>'financials')::boolean,false) or coalesce((tm.permissions->>'expenses')::boolean,false)
        when 'td_mileage'  then coalesce((tm.permissions->>'financials')::boolean,false) or coalesce((tm.permissions->>'mileage')::boolean,false)
        else true
      end
  );
$$;

grant execute on function crew_member_of(uuid) to authenticated;
grant execute on function crew_perm(uuid, text) to authenticated;

-- ── 2. Crew policies on the 14 td_* tables (additive to the existing "owner"). ─────
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
      execute format('drop policy if exists "crew" on %I', t);
      execute format(
        'create policy "crew" on %I for all to authenticated
           using (crew_perm(user_id, %L))
           with check (crew_perm(user_id, %L))', t, t, t);
    exception when undefined_table then null;
    end;
  end loop;
end $$;

-- ── 3. Crew joins the op channel, permission-filtered per op_table. ────────────────
do $$
begin
  begin
    drop policy if exists td_ops_crew on td_ops;
    create policy td_ops_crew on td_ops for all to authenticated
      using (crew_perm(user_id, op_table))
      with check (crew_perm(user_id, op_table));
  exception when undefined_table then null;
  end;
end $$;

-- ── 4. Cursor RPCs — heartbeat + cursor-bump for crew, zero zj_data row exposure. ──
create or replace function get_account_cursor(target uuid)
returns timestamptz
language sql security definer stable
set search_path = public
as $$
  select z.updated_at from zj_data z
  where z.user_id = target
    and (target::text = auth.uid()::text or crew_member_of(target));
$$;

create or replace function bump_account_cursor(target uuid)
returns timestamptz
language plpgsql security definer
set search_path = public
as $$
declare ts timestamptz;
begin
  if not (target::text = auth.uid()::text or crew_member_of(target)) then
    return null;
  end if;
  update zj_data set updated_at = now() where user_id = target returning updated_at into ts;
  return ts;
end $$;

grant execute on function get_account_cursor(uuid) to authenticated;
grant execute on function bump_account_cursor(uuid) to authenticated;

-- ── 5. Server-minted single-use invite tokens. ─────────────────────────────────────
create table if not exists crew_invites (
  token              uuid primary key default gen_random_uuid(),
  contractor_user_id uuid not null references auth.users(id) on delete cascade,
  team_member_id     uuid not null references team_members(id) on delete cascade,
  email              text,
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null default now() + interval '14 days',
  used_at            timestamptz,
  used_by            uuid
);

alter table crew_invites enable row level security;
grant select, insert, update, delete on crew_invites to authenticated;

do $$
begin
  drop policy if exists crew_invites_owner on crew_invites;
  create policy crew_invites_owner on crew_invites for all to authenticated
    using (contractor_user_id::text = auth.uid()::text)
    with check (contractor_user_id::text = auth.uid()::text);
end $$;

-- Claim: validates + links + burns the token in one server-side transaction.
-- Idempotent for the SAME user re-claiming (a reload mid-onboarding); anyone else
-- hitting a used token is rejected. Never trusts anything from the client but the token.
create or replace function claim_crew_invite(tok uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  inv crew_invites%rowtype;
  tm  team_members%rowtype;
begin
  if auth.uid()::text is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  select * into inv from crew_invites where token = tok for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if inv.used_at is not null and inv.used_by::text is distinct from auth.uid()::text then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;
  if inv.used_at is null and inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  update team_members
     set employee_user_id = (auth.uid()::text)::uuid,
         active = true,
         joined_at = coalesce(joined_at, now())
   where id = inv.team_member_id
     and (employee_user_id is null or employee_user_id::text = auth.uid()::text)
  returning * into tm;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'already_linked_other');
  end if;
  if inv.used_at is null then
    update crew_invites
       set used_at = now(), used_by = (auth.uid()::text)::uuid
     where token = tok;
  end if;
  return jsonb_build_object(
    'ok', true,
    'contractor_user_id', tm.contractor_user_id,
    'team_member_id', tm.id,
    'name', tm.name,
    'role', tm.role,
    'permissions', tm.permissions
  );
end $$;

grant execute on function claim_crew_invite(uuid) to authenticated;
