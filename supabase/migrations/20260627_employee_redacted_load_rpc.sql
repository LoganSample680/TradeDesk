-- ─────────────────────────────────────────────────────────────────────────────
-- Server-side redaction of contractor financials from employee sessions.
--
-- THE HOLE THIS CLOSES: financial gating was 100% client-side. When an employee
-- signs in, the app loads the CONTRACTOR's rows (cloud.js supaLoadFromCloud →
-- user_id = _contractorUserId), so bids/payments/income sat in memory with real
-- dollar amounts. A rogue employee opening DevTools could read every bid amount
-- and payment even though the Money page/tiles are hidden.
--
-- THE FIX: load_account_data(target_uid) — a SECURITY DEFINER RPC the employee
-- branch of supaLoadFromCloud calls instead of raw .select(). It re-verifies the
-- caller is the owner or an ACTIVE team member of target_uid, then returns each
-- td_* table's rows with money keys ZEROED unless the caller's team permission
-- grants that field (permission-aware — a `collect` tech still sees payment
-- amounts so the collect feature keeps working; only what they're not entitled to
-- is redacted). Contractors (auth.uid() = target_uid) are never redacted.
--
-- WHY ZERO, NOT DELETE: every consumer coalesces (bid.amount||0); a 0 flows
-- safely through getBidBalance/profit/exports, a missing key would NaN some sums.
--
-- The companion client change (cloud.js) ALSO skips writing redacted tables back
-- on save, so a zeroed in-memory array can never overwrite the contractor's real
-- amounts. That guard is permission-derived (RPC-independent), so corruption is
-- impossible even before this migration reaches production.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Internal helper: return {<tbl>: [{id,data}, ...]} for one td_* table, with
-- the given money keys overwritten to 0. Fully dynamic (EXECUTE) + to_regclass
-- guarded so it compiles and runs even on a bare DB where the td_* tables — which
-- are provisioned out-of-band, not by repo migrations — do not exist (the
-- migration-lint DB is one such bare DB). NOT granted to clients: only the
-- authorizing wrapper below may call it, or an employee could fetch unredacted
-- data by calling the helper directly.
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
  -- `data || zero_obj` overwrites the money keys with 0 (identity when zero_obj
  -- is '{}'). $1 = target_uid, $2 = zero_obj.
  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(''id'', id, ''data'', data || $2)), ''[]''::jsonb)'
    || ' from %I where user_id = $1 and deleted_at is null',
    tbl
  )
  using target_uid, zero_obj
  into arr;
  return jsonb_build_object(tbl, arr);
end;
$$;

revoke all on function _lad_table(uuid, text, text[]) from public;

-- ── Public RPC: authorize, resolve the caller's permissions, return the redacted
-- account payload as one jsonb object keyed by table name.
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
  -- Authorize: caller is the owner OR an active team member of target_uid.
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
    || _lad_table(target_uid, 'td_photos',       null);

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

-- Lock down exposure. Wrapped so a bare lint DB (no Supabase `authenticated`
-- role) doesn't error — in production the role exists and the grant applies.
do $$ begin
  execute 'revoke all on function load_account_data(uuid) from public';
  execute 'grant execute on function load_account_data(uuid) to authenticated';
exception when others then
  raise notice 'load_account_data grant skipped: %', sqlerrm;
end $$;
