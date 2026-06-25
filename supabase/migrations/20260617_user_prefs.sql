-- Per-individual-user UI layout preferences.
--
-- Why this is separate from zj_data.settings:
--   zj_data holds the business "S" blob keyed by the CONTRACTOR's user_id.
--   Employees load the contractor's zj_data row (shared business settings),
--   so anything stored in S is shared across the whole company and an
--   employee's edits either revert on reload or bleed into everyone else.
--
--   UI layout (dashboard widget order, nav tab order) must be per-individual,
--   exactly like an iOS home screen is per Apple ID — tied to the identity,
--   not the shared account. This table is keyed by auth.uid() so every
--   individual (owner OR employee) gets their own isolated row.

create table if not exists user_prefs (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  dash_widget_order jsonb,
  nav_tab_order     jsonb,
  updated_at        timestamptz default now()
);

alter table user_prefs enable row level security;

-- Each user can only ever see and write their own row. No contractor/employee
-- relationship is involved — the key IS the individual identity.
drop policy if exists "user_prefs own select" on user_prefs;
create policy "user_prefs own select" on user_prefs
  for select using (user_id::text = auth.uid()::text);

drop policy if exists "user_prefs own insert" on user_prefs;
create policy "user_prefs own insert" on user_prefs
  for insert with check (user_id::text = auth.uid()::text);

drop policy if exists "user_prefs own update" on user_prefs;
create policy "user_prefs own update" on user_prefs
  for update using (user_id::text = auth.uid()::text) with check (user_id::text = auth.uid()::text);
