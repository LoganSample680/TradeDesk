-- EMAIL-MATCH crew linking, done server-side. Under strict RLS the signing-in
-- employee cannot even SEE their unlinked roster row (employee_user_id is null, so
-- neither the contractor-only nor the employee-owns-row policy grants it) — the
-- legacy client-side select+update silently matched nothing on a from-migrations
-- stack (local runner, Proxmox at go-live). Hosted only worked via dashboard-era
-- permissive policies: the same drift family as the team_members columns. This RPC
-- links the MOST RECENT unlinked roster row matching the authenticated login's email,
-- atomically, trusting nothing from the client (SECURITY DEFINER; the email comes
-- from auth.users, never a parameter). Same return shape as claim_crew_invite.

create or replace function claim_crew_by_email()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  tm team_members%rowtype;
  em text;
begin
  if auth.uid()::text is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  select lower(u.email) into em from auth.users u where u.id::text = auth.uid()::text;
  if em is null or em = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_email');
  end if;
  update team_members
     set employee_user_id = (auth.uid()::text)::uuid,
         active = true,
         joined_at = coalesce(joined_at, now())
   where id = (
     select id from team_members
     where lower(email) = em and employee_user_id is null
     order by invited_at desc nulls last, created_at desc
     limit 1
   )
  returning * into tm;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_invite');
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

grant execute on function claim_crew_by_email() to authenticated;
