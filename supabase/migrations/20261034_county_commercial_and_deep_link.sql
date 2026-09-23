-- ── COMMERCIAL BUILDINGS HAVE A YEAR BUILT TOO ──────────────────────────────
--
-- Owner, 2026-09-22: "commercial addresses arent coming over."
--
-- They were coming over, with an owner and an assessed value and nothing else,
-- which on the property card reads as broken. The cause was in the enricher,
-- not the data: Shawnee's appraiser splits building facts by property type and
-- we only ever read the RESIDENTIAL half.
--
--   resBldgYearBuiltFrom / resBldgTotalArea / resBldgTotalBedrooms   (a house)
--   comBldgYearBuiltFrom / comBldgTotalArea / comBldgCount           (a store)
--
-- Every commercial parcel therefore answered with null for year built, which is
-- not "the county does not know", it is "we did not ask the right question".
-- 1530 SW Arvonia (Aldi) has been sitting there the whole time as built 2001,
-- 18,380 sqft. The Edge Function now reads the commercial fields when the
-- residential ones are absent.
--
-- THIS IS NOT COSMETIC. year_built arms the EPA RRP pre-1978 lead gate, and a
-- pre-1978 COMMERCIAL building is exactly as covered by it as a house is: RRP
-- applies to child-occupied facilities, which is any pre-1978 building with a
-- daycare, a preschool or a kindergarten in it. A null there disarmed the
-- warning on every commercial bid in the county.

-- ── WHAT THE PARCEL IS, NOT JUST WHAT IT IS WORTH ───────────────────────────
-- The appraiser already classifies every parcel and we were discarding it. A
-- contractor looking at "3111 SW Van Buren" learns more from "Grocery store /
-- supermarket" than from any other single field, and on a commercial card with
-- no beds and no baths it is most of what there is to say.
alter table td_county_parcels add column if not exists property_type text;
alter table td_county_parcels add column if not exists use_desc     text;

comment on column td_county_parcels.property_type is
  'The appraiser''s own classification: Residential, Commercial, Agricultural, Exempt. Stored, not inferred.';
comment on column td_county_parcels.use_desc is
  'The appraiser''s function-code description ("Grocery store / supermarket"). What the building IS, in the county''s words.';

-- ── THE LINK HAS TO LAND ON THE PROPERTY ────────────────────────────────────
--
-- Owner, same message: "linking to the records doesnt take you right to the
-- address with shawnee county, takes us to the search page."
--
-- Correct, and the reason is that source_url was the county's ROOT, identical
-- on every row, because it came from the county config rather than from the
-- parcel. Shawnee's ARES has no per-parcel URL at all (results are drawn
-- client-side; every /Property/... and /Detail/... route 404s), so the best
-- landing this county can give is its search page with the address already in
-- the box. That is what the Edge Function writes from now on, per parcel.
--
-- Backfill the rows already loaded, so the 29 parcels answered before this
-- migration get the same link as everything after it. Only rows still carrying
-- the old root value are touched, so a county whose deep link is genuinely
-- per-parcel is never overwritten by this.
update td_county_parcels
   set source_url = 'https://ares.sncoapps.us/BasicSearch/Index?searchCriteria='
                    || replace(replace(street, ' ', '+'), '&', '%26')
                    || '&countyCode=089&searchBy=address&listMode=card'
 where county_fips = '20177'
   and (source_url is null or source_url = 'https://ares.sncoapps.us/');

-- ── THE LOOKUP HAS TO HAND THE NEW COLUMNS BACK ─────────────────────────────
-- Adding a column to the table does nothing on its own: property_lookup names
-- its return columns explicitly, so a column it does not list is a column the
-- app can never see. Same shape, two more fields.
drop function if exists property_lookup(text[]);
create or replace function property_lookup(p_addrs text[])
returns table (
  q             text,
  county_fips   text,
  county_name   text,
  state         text,
  parcel_id     text,
  street        text,
  city          text,
  zip           text,
  year_built    int,
  sqft          int,
  beds          numeric,
  baths         numeric,
  acres         numeric,
  assessed_value    int,
  land_value        int,
  improvement_value int,
  owner_name        text,
  property_type     text,
  use_desc          text,
  last_sale_price   int,
  last_sale_date    date,
  source        text,
  source_url    text
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select distinct
      a as raw,
      td_addr_key(a) as k,
      substring(a from '\y(\d{5})(?:-\d{4})?\s*$') as zip
    from unnest(coalesce(p_addrs, '{}'::text[])) as a
    where td_addr_key(a) is not null
  )
  select distinct on (q.raw)
    q.raw, p.county_fips, p.county_name, p.state, p.parcel_id,
    p.street, p.city, p.zip,
    p.year_built, p.sqft, p.beds, p.baths, p.acres,
    p.assessed_value, p.land_value, p.improvement_value,
    p.owner_name, p.property_type, p.use_desc,
    p.last_sale_price, p.last_sale_date,
    p.source, p.source_url
  from q
  join td_county_parcels p on p.addr_key = q.k
  order by q.raw,
           (q.zip is not null and p.zip = q.zip) desc,
           (p.year_built is not null) desc,
           (p.assessed_value is not null) desc,
           p.loaded_at desc
  limit 500;
$$;

comment on function property_lookup(text[]) is
  'Match a contractor''s addresses against loaded county assessor records. One round trip, no external call. Returns only the addresses that matched.';

grant execute on function property_lookup(text[]) to authenticated;

-- ── RE-ASK THE COMMERCIAL PARCELS, ONCE ─────────────────────────────────────
-- These were retired as 'empty' by the ask gate because they came back with no
-- year built, which was true of the ANSWER and false of the county. Clearing
-- exactly those rows lets each one be asked one more time, now that the right
-- question gets asked. Residential misses are untouched: a house the county has
-- no record of is still a house the county has no record of.
delete from td_county_asks a
 where a.county_fips = '20177'
   and a.outcome = 'empty'
   and exists (
     select 1 from td_county_parcels p
      where p.county_fips = a.county_fips
        and p.addr_key    = a.addr_key
        and p.year_built is null
        and p.assessed_value is not null   -- the county DID answer, just not with a year
   );
