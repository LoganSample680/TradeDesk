-- TradeDesk: Proposal storage + signing setup
-- Run in Supabase SQL Editor

-- 1. signed_proposals table — records when clients sign
create table if not exists signed_proposals (
  id uuid primary key default gen_random_uuid(),
  bid_id text,
  contractor_user_id uuid references auth.users(id),
  client_name text,
  client_signed_name text,
  amount numeric,
  deposit numeric,
  signed_at timestamptz default now(),
  notify_email text,
  storage_key text,
  created_at timestamptz default now()
);

-- 2. RLS on signed_proposals
alter table signed_proposals enable row level security;

-- Contractor can read their own signed proposals
drop policy if exists "Contractor reads own signed proposals" on signed_proposals;
create policy "Contractor reads own signed proposals"
  on signed_proposals for select
  using (contractor_user_id = auth.uid());

-- Anyone (client) can insert a signed proposal (unauthenticated)
drop policy if exists "Anyone can submit signature" on signed_proposals;
create policy "Anyone can submit signature"
  on signed_proposals for insert
  with check (true);

-- Contractor can update their own records
drop policy if exists "Contractor updates own records" on signed_proposals;
create policy "Contractor updates own records"
  on signed_proposals for update
  using (contractor_user_id = auth.uid());

-- 3. Add state column to accounts if not exists
alter table accounts add column if not exists state text;

-- 4. Add state column to account_config if not exists
alter table account_config add column if not exists state text;
