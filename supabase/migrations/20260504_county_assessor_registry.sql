-- County assessor registry for property data auto-lookup
-- Stores scraped config per FIPS code (county_state), self-heals via Claude re-discovery

create table if not exists county_assessor_registry (
  fips text primary key,
  county text,
  state text,
  vendor text,
  config jsonb,
  last_verified timestamptz,
  last_failure timestamptz,
  failure_count int default 0
);

-- Add structured address columns to inbound_leads if they don't exist
alter table inbound_leads add column if not exists street text;
alter table inbound_leads add column if not exists city text;
alter table inbound_leads add column if not exists state text;
alter table inbound_leads add column if not exists zip text;
