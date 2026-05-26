-- ============================================================
-- TradeDesk initial schema
-- Runs first (oldest timestamp) on every fresh database,
-- including Supabase Preview branches.
-- All statements are idempotent (CREATE … IF NOT EXISTS).
--
-- Structure: ALL tables created first, ALL policies last.
-- This avoids forward-reference errors where a policy on
-- table A references table B that hasn't been created yet.
-- ============================================================

-- ══════════════════════════════════════════════════════════
-- SECTION 1: TABLES (all tables before any policies)
-- ══════════════════════════════════════════════════════════

create table if not exists zj_data (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  account_id     uuid,
  clients        text default '[]',
  bids           text default '[]',
  jobs           text default '[]',
  payments       text default '[]',
  income         text default '[]',
  expenses       text default '[]',
  mileage        text default '[]',
  liens          text default '[]',
  settings       text default '{}',
  licenses       text default '[]',
  events         text default '[]',
  checks_state   text default '{}',
  time_entries   text default '[]',
  receipt_images text default '{}',
  contracts      text default '[]',
  gallery_photos text default '[]',
  updated_at     timestamptz default now()
);

create table if not exists accounts (
  id            uuid primary key default gen_random_uuid(),
  business_name text,
  phone         text,
  email         text,
  address       text,
  state         text,
  license_info  text,
  owner_id      uuid,
  created_at    timestamptz default now()
);

create table if not exists users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  name          text,
  role          text check (role in ('owner','estimator','technician','apprentice')),
  account_id    uuid references accounts(id),
  business_type text,
  created_at    timestamptz default now()
);

create table if not exists account_users (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  user_id    uuid references users(id) on delete cascade,
  role       text check (role in ('owner','estimator','technician','apprentice')),
  created_at timestamptz default now(),
  unique(account_id, user_id)
);

create table if not exists vehicles (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid references accounts(id) on delete cascade,
  name           text not null,
  type           text,
  vin            text,
  odometer_start numeric default 0,
  created_at     timestamptz default now()
);

create table if not exists account_config (
  account_id             uuid primary key references accounts(id) on delete cascade,
  business_type          text,
  default_job_type       text,
  require_estimate       boolean default true,
  require_deposit        boolean default true,
  allow_full_payment     boolean default false,
  show_schedule          boolean default true,
  stripe_account_id      text,
  stripe_connect_enabled boolean default false,
  state                  text,
  updated_at             timestamptz default now()
);

create table if not exists team_members (
  id                 uuid primary key default gen_random_uuid(),
  contractor_user_id uuid references auth.users(id) on delete cascade,
  employee_user_id   uuid references auth.users(id) on delete set null,
  name               text not null,
  email              text,
  phone              text,
  role               text default 'employee',
  permissions        jsonb default '{}',
  active             boolean default true,
  joined_at          timestamptz,
  created_at         timestamptz default now()
);

create table if not exists signed_proposals (
  id                    uuid primary key default gen_random_uuid(),
  bid_id                text,
  contractor_user_id    uuid references auth.users(id),
  client_name           text,
  client_signed_name    text,
  amount                numeric,
  deposit               numeric,
  signed_at             timestamptz default now(),
  notify_email          text,
  storage_key           text,
  payment_method        text default 'pending',
  payment_status        text default 'pending',
  stripe_payment_intent text,
  stripe_charge_id      text,
  stripe_fee            numeric,
  created_at            timestamptz default now()
);

create table if not exists inbound_leads (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  client_id  uuid,
  source     text,
  name       text,
  phone      text,
  addr       text,
  street     text,
  city       text,
  state      text,
  zip        text,
  notes      text,
  call_time  text,
  status     text default 'pending',
  created_at timestamptz default now()
);

create table if not exists county_assessor_registry (
  fips          text primary key,
  county        text,
  state         text,
  vendor        text,
  config        jsonb,
  last_verified timestamptz,
  last_failure  timestamptz,
  failure_count int default 0
);

create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  updated_at timestamptz not null default now()
);

-- ══════════════════════════════════════════════════════════
-- SECTION 2: INDEXES
-- ══════════════════════════════════════════════════════════

create index if not exists idx_account_config_stripe_account_id
  on account_config (stripe_account_id)
  where stripe_account_id is not null;

create index if not exists push_subscriptions_user_idx
  on push_subscriptions(user_id);

-- ══════════════════════════════════════════════════════════
-- SECTION 3: VIEWS
-- ══════════════════════════════════════════════════════════

create or replace view my_signed_proposals as
  select * from signed_proposals
  where contractor_user_id::text = auth.uid()::text
  order by signed_at desc;

-- ══════════════════════════════════════════════════════════
-- SECTION 4: RLS ENABLE (all tables)
-- ══════════════════════════════════════════════════════════

alter table zj_data               enable row level security;
alter table accounts              enable row level security;
alter table users                 enable row level security;
alter table account_users         enable row level security;
alter table vehicles              enable row level security;
alter table account_config        enable row level security;
alter table team_members          enable row level security;
alter table signed_proposals      enable row level security;
alter table inbound_leads         enable row level security;
alter table county_assessor_registry enable row level security;
alter table push_subscriptions    enable row level security;

-- ══════════════════════════════════════════════════════════
-- SECTION 5: POLICIES (all tables exist by this point)
-- ══════════════════════════════════════════════════════════

do $$ begin
  -- zj_data
  -- Cast both sides to text so policy works whether user_id is uuid or text on production
  if not exists (select 1 from pg_policies where tablename='zj_data' and policyname='Users manage own data') then
    execute $p$ create policy "Users manage own data" on zj_data
      for all using (user_id::text = auth.uid()::text) with check (user_id::text = auth.uid()::text) $p$;
  end if;

  -- accounts
  if not exists (select 1 from pg_policies where tablename='accounts' and policyname='Account members can read') then
    execute $p$ create policy "Account members can read" on accounts for select
      using (id::text in (select account_id::text from account_users where user_id::text = auth.uid()::text)) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='accounts' and policyname='Account owner can insert') then
    execute $p$ create policy "Account owner can insert" on accounts for insert
      with check (owner_id::text = auth.uid()::text) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='accounts' and policyname='Account owner can update') then
    execute $p$ create policy "Account owner can update" on accounts for update
      using (owner_id::text = auth.uid()::text) $p$;
  end if;

  -- users
  if not exists (select 1 from pg_policies where tablename='users' and policyname='Users read own row') then
    execute $p$ create policy "Users read own row" on users for select using (id::text = auth.uid()::text) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='users' and policyname='Users insert own row') then
    execute $p$ create policy "Users insert own row" on users for insert with check (id::text = auth.uid()::text) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='users' and policyname='Users update own row') then
    execute $p$ create policy "Users update own row" on users for update using (id::text = auth.uid()::text) $p$;
  end if;

  -- account_users
  if not exists (select 1 from pg_policies where tablename='account_users' and policyname='Members read own membership') then
    execute $p$ create policy "Members read own membership" on account_users for select
      using (user_id::text = auth.uid()::text) $p$;
  end if;
  -- NOTE: no self-referencing FOR ALL policy here — that causes infinite recursion.
  -- Write access is handled by the non-recursive INSERT/UPDATE/DELETE policies below
  -- that check ownership via the accounts table instead of account_users itself.
  if not exists (select 1 from pg_policies where tablename='account_users' and policyname='Owner inserts memberships') then
    execute $p$ create policy "Owner inserts memberships" on account_users for insert
      with check (
        account_id::text in (select id::text from accounts where owner_id::text = auth.uid()::text)
      ) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='account_users' and policyname='Owner updates memberships') then
    execute $p$ create policy "Owner updates memberships" on account_users for update
      using (
        account_id::text in (select id::text from accounts where owner_id::text = auth.uid()::text)
      ) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='account_users' and policyname='Owner deletes memberships') then
    execute $p$ create policy "Owner deletes memberships" on account_users for delete
      using (
        account_id::text in (select id::text from accounts where owner_id::text = auth.uid()::text)
      ) $p$;
  end if;

  -- vehicles
  if not exists (select 1 from pg_policies where tablename='vehicles' and policyname='Account members read vehicles') then
    execute $p$ create policy "Account members read vehicles" on vehicles for select
      using (account_id::text in (select account_id::text from account_users where user_id::text = auth.uid()::text)) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='vehicles' and policyname='Account owner manages vehicles') then
    execute $p$ create policy "Account owner manages vehicles" on vehicles for all
      using (account_id::text in (
        select account_id::text from account_users where user_id::text = auth.uid()::text and role = 'owner'
      )) $p$;
  end if;

  -- account_config
  if not exists (select 1 from pg_policies where tablename='account_config' and policyname='Account members read config') then
    execute $p$ create policy "Account members read config" on account_config for select
      using (account_id::text in (select account_id::text from account_users where user_id::text = auth.uid()::text)) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='account_config' and policyname='Account owner manages config') then
    execute $p$ create policy "Account owner manages config" on account_config for all
      using (account_id::text in (
        select account_id::text from account_users where user_id::text = auth.uid()::text and role = 'owner'
      )) $p$;
  end if;

  -- team_members
  if not exists (select 1 from pg_policies where tablename='team_members' and policyname='Contractor manages own team') then
    execute $p$ create policy "Contractor manages own team" on team_members for all
      using (contractor_user_id::text = auth.uid()::text) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='team_members' and policyname='Employee reads own record') then
    execute $p$ create policy "Employee reads own record" on team_members for select
      using (employee_user_id::text = auth.uid()::text) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='team_members' and policyname='Employee updates own record') then
    execute $p$ create policy "Employee updates own record" on team_members for update
      using (employee_user_id::text = auth.uid()::text) $p$;
  end if;

  -- signed_proposals
  if not exists (select 1 from pg_policies where tablename='signed_proposals' and policyname='anon_select') then
    execute $p$ create policy "anon_select" on signed_proposals for select to anon using (true) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='signed_proposals' and policyname='anon_insert') then
    execute $p$ create policy "anon_insert" on signed_proposals for insert to anon with check (true) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='signed_proposals' and policyname='anon_update') then
    execute $p$ create policy "anon_update" on signed_proposals for update to anon using (true) with check (true) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='signed_proposals' and policyname='auth_select_own') then
    execute $p$ create policy "auth_select_own" on signed_proposals for select to authenticated
      using (contractor_user_id::text = auth.uid()::text) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='signed_proposals' and policyname='auth_update_own') then
    execute $p$ create policy "auth_update_own" on signed_proposals for update to authenticated
      using (contractor_user_id::text = auth.uid()::text) with check (contractor_user_id::text = auth.uid()::text) $p$;
  end if;

  -- inbound_leads
  if not exists (select 1 from pg_policies where tablename='inbound_leads' and policyname='Contractor reads own leads') then
    execute $p$ create policy "Contractor reads own leads" on inbound_leads for select
      using (account_id::text in (select id::text from accounts where owner_id::text = auth.uid()::text)) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='inbound_leads' and policyname='Anon can submit lead') then
    execute $p$ create policy "Anon can submit lead" on inbound_leads for insert to anon with check (true) $p$;
  end if;
  if not exists (select 1 from pg_policies where tablename='inbound_leads' and policyname='Contractor updates own leads') then
    execute $p$ create policy "Contractor updates own leads" on inbound_leads for update
      using (account_id::text in (select id::text from accounts where owner_id::text = auth.uid()::text)) $p$;
  end if;

  -- push_subscriptions
  if not exists (select 1 from pg_policies where tablename='push_subscriptions' and policyname='owner') then
    execute $p$ create policy "owner" on push_subscriptions
      using (auth.uid()::text = user_id::text) with check (auth.uid()::text = user_id::text) $p$;
  end if;
end $$;

-- ══════════════════════════════════════════════════════════
-- SECTION 6: OPTIONAL COLUMN ADDITIONS (safe on production)
-- ══════════════════════════════════════════════════════════

-- zj_data → accounts FK (may already exist on production)
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name='zj_data' and column_name='account_id'
  ) then
    alter table zj_data add column account_id uuid references accounts(id);
  end if;
end $$;
