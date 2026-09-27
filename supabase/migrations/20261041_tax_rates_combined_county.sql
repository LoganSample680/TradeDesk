-- Sales tax: the combined rate, its range inside a ZIP, and the county fallback.
--
-- 2026-09-25. The SST import stored one jurisdiction's rate as if it were the
-- whole rate, so 643 Kansas ZIPs read 4 to 5.4 percent when the real rate is 9
-- to 10 (the 6.5 percent state rate was never added). scripts/sst-rates.js now
-- sums state + county + city + district for every address record. This file is
-- the database half.
--
-- Additive only (§3.1): two nullable columns and one new function. Production
-- code that reads tax_rates.combined keeps working untouched.

-- A ZIP that crosses a city line has more than one correct rate. The row keeps
-- the rate most addresses in it pay; these say how far the others spread, so
-- the app can tell the contractor to check city limits instead of picking for them.
alter table tax_rates add column if not exists rate_low  numeric(6,4);
alter table tax_rates add column if not exists rate_high numeric(6,4);

comment on column tax_rates.rate_low is
  'Lowest combined rate any address in this ZIP pays (SST boundary records). Null for rows that are not ZIPs.';
comment on column tax_rates.rate_high is
  'Highest combined rate any address in this ZIP pays. Differs from rate_low when the ZIP crosses a city or district line.';

-- The one lookup. ZIP first. When the ZIP has no row, the county data answers:
-- td_county_zips says which county the ZIP is in, and the "COUNTY-<fips>" row
-- (state plus county, no city) is what an address there pays outside city
-- limits. Only then the state base. One round trip, and the order lives here
-- rather than in every caller.
--
-- security invoker: tax_rates is public-read and td_county_zips is readable by
-- any signed-in user, so this needs no elevated rights. A signed-out caller just
-- never reaches the county step.
create or replace function td_tax_rate(p_zip text, p_state text)
returns table (combined numeric, rate_low numeric, rate_high numeric, source text, county_name text)
language sql
stable
security invoker
set search_path = public
as $$
  with z as (
    select r.combined, r.rate_low, r.rate_high, 'db_zip'::text as source, null::text as county_name
    from tax_rates r
    where r.zip = p_zip
  ),
  c as (
    -- A ZIP that straddles two counties has a row for each. Take the higher
    -- rate: undercharging tax comes out of the contractor's pocket, overcharging is a line they can fix.
    select r.combined, null::numeric, null::numeric, 'db_county'::text, cz.county_name
    from td_county_zips cz
    join tax_rates r on r.zip = 'COUNTY-' || cz.county_fips
    where cz.zip = p_zip
    order by r.combined desc
    limit 1
  ),
  s as (
    select r.combined, null::numeric, null::numeric, 'db_state'::text, null::text
    from tax_rates r
    where r.zip = 'STATE-' || upper(coalesce(p_state, ''))
  )
  select * from z
  union all
  select * from c where not exists (select 1 from z)
  union all
  select * from s where not exists (select 1 from z) and not exists (select 1 from c)
  limit 1;
$$;

grant execute on function td_tax_rate(text, text) to anon, authenticated;
