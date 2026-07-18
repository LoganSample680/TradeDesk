-- App-wide billing gridlock gate.
--
-- Owner spec 2026-07-17: a contractor's 14-day trial now starts silently the
-- moment their account is created (start-billing-trial, called once from
-- obSubmit) so "day 15" is a real, unavoidable deadline, not something that
-- only starts if they happen to find the Subscribe button in Settings. Once
-- that trial ends (or an active subscription lapses to past_due/canceled)
-- with nothing paid, the ENTIRE app locks behind a single "Manage billing"
-- screen until they pay. td_billing_gate_locked() below is the single source
-- of truth the app reads to decide whether to render that lock screen.
--
-- Resolves the EFFECTIVE billing owner server-side: self if this auth user
-- owns an accounts row (a contractor/owner), else the contractor of their
-- most recently joined active crew link (a crew member never has their own
-- td_subscriptions row — their employer's subscription is what gates them).
-- No parameter, no probing surface: everything derives from auth.uid() alone,
-- same SECURITY DEFINER pattern as td_exports_unlocked()/td_billing_exempt()
-- in the 20260804_platform_billing migration.
create or replace function td_billing_gate_locked()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid text := auth.uid()::text;
  _target text;
  _exempt boolean;
  _status text;
begin
  if _uid is null then return false; end if;

  if exists(select 1 from public.users where id::text = _uid and account_id is not null) then
    _target := _uid;
  else
    select contractor_user_id::text into _target
      from public.team_members
      where employee_user_id::text = _uid and active = true
      order by joined_at desc
      limit 1;
  end if;
  -- No account, no crew link (mid-onboarding, or a not-yet-linked invite) —
  -- nothing to bill yet, never gate on that.
  if _target is null then return false; end if;

  select exists(select 1 from public.billing_exempt_users where user_id::text = _target) into _exempt;
  if _exempt then return false; end if;

  select status into _status from public.td_subscriptions where user_id::text = _target;
  -- No subscription row at all is either a not-yet-landed silent trial-start
  -- call or a pre-existing account from before this feature shipped — never
  -- gate on missing data, only on a CONFIRMED lapsed/canceled status.
  if _status is null then return false; end if;
  return _status not in ('trialing', 'active');
end;
$$;

revoke all on function td_billing_gate_locked() from public;
grant execute on function td_billing_gate_locked() to authenticated;
