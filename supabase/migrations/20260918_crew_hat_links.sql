-- ════════════════════════════════════════════════════════════════════════
-- crew_hat_links: the hats this login can wear, with the business NAMED.
--
-- Owner 2026-09-10, looking at Blake's switcher: "Switch Business is showing
-- Tradedesk as 'Crew', why?"
--
-- Because the switcher had nothing better to print. _hatCrewLinks is built
-- from a plain select on team_members, whose `name` column is the CREW
-- MEMBER's name, not the business's, so the row was hardcoded to the literal
-- string 'Crew'. With two crews it would have read "Crew" twice and there
-- would have been no way to tell which was which.
--
-- The business name lives on accounts.business_name, and a crew member cannot
-- read it: the RLS on accounts admits account members (account_users) and the
-- owner, and a crew member is in neither. account_public exposes the name to
-- anon but is keyed by accounts.id, and all the switcher holds is the owner's
-- uid, so it cannot join. Hence a definer function rather than a view.
--
-- It returns nothing but what the switcher draws: which account, what this
-- person is to it, and what it is called. No owner ids beyond the one the
-- caller is already linked to, no billing, no contact details.
--
-- A LINK TO YOURSELF IS NOT A HAT. An owner who put themselves on their own
-- roster would otherwise be offered their own business twice, once as owner
-- and once as crew, and switching to the crew copy would strip their own
-- permissions on their own account.
-- ════════════════════════════════════════════════════════════════════════

create or replace function crew_hat_links()
returns table (
  contractor_user_id uuid,
  role               text,
  business_name      text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.contractor_user_id,
         coalesce(nullif(btrim(t.role), ''), 'crew'),
         coalesce(nullif(btrim(a.business_name), ''), 'Their business')
  from team_members t
  left join accounts a on a.owner_id = t.contractor_user_id
  where t.employee_user_id = (auth.uid()::text)::uuid
    and t.active
    and t.contractor_user_id <> (auth.uid()::text)::uuid
  order by t.joined_at desc nulls last, t.created_at desc;
$$;

comment on function crew_hat_links() is
  'The crew hats the calling login can wear: account, role, and the business name the switcher prints. Definer because a crew member cannot read accounts under RLS. Self-links are never returned.';

grant execute on function crew_hat_links() to authenticated;
