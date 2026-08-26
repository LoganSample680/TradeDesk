-- ════════════════════════════════════════════════════════════════════════
-- Managers can read their crew's handset state (owner ask 2026-08-26:
-- "so we get it the moment it happens to the business owner and managers").
--
-- device_status read was owner-only: `auth.uid() = contractor_user_id`. That
-- was right when the only reader was the owner's Team screen, and wrong the
-- moment a manager could be notified that a crew member's tracking broke,
-- because the notification routes to a roster that would load nothing for
-- them. A push to a blank screen is worse than no push.
--
-- Scoped exactly like the existing team_members manager path
-- (20260619_team_comp_geo_tracking.sql, "Payroll manager reads team"), reusing
-- the same SECURITY DEFINER helper so checking "is the caller a permitted
-- manager" does not recurse through team_members' own RLS.
--
-- 'payroll' is the permission the app documents as seeing the crew location
-- map; 'team' is the one that manages crew. Both are labelled managers-only in
-- the permission picker. Ordinary crew are deliberately still excluded: where
-- a colleague's phone is, and whether it is reporting, is not general staff
-- information.
--
-- SELECT ONLY. Nobody edits somebody else's phone's permission state, the same
-- rule the owner policy already carries. Additive: no existing policy is
-- dropped or narrowed, so an owner's access is untouched and production code
-- that has never heard of this is unaffected (CLAUDE.md 3.1).
-- ════════════════════════════════════════════════════════════════════════

drop policy if exists "manager reads crew device status" on device_status;
create policy "manager reads crew device status" on device_status for select to authenticated
  using (
    has_team_perm(contractor_user_id, 'payroll')
    or has_team_perm(contractor_user_id, 'team')
  );
