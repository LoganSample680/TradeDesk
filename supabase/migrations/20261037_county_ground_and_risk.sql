-- ── WHAT THE GROUND IS, WHAT FLOODS, AND WHO IS BEHIND ON TAX ───────────────
--
-- Owner, 2026-09-22: "I want them to know everything they would need to close a
-- piece of business", and on these three specifically: "flood zone and soils
-- could help landscapers on drainage and sprinkler installs and tax sale could
-- benefit all people."
--
-- Three more layers on the SAME county GIS server the parcel data already comes
-- from. Free, unauthenticated, real JSON, no scraping. Each was probed against
-- a live parcel before a column was written for it (2026-09-22):
--
--   FloodZones/3    949 polygons.  Values: A, AE (both SFHA) and the 0.2%
--                   shaded zone. A parcel outside them returns zero features,
--                   which is the correct answer and not a failed query.
--   Soils/0         10,538 polygons, full county coverage. 2015 SW Randolph
--                   comes back "Ladysmith silty clay loam, 1 to 3 percent
--                   slopes".
--   TaxSalePublish/1  553 parcels, keyed on the SAME QUICKREFID the parcel row
--                   already carries, so it is a plain attribute query with no
--                   geometry involved at all.
--
-- ZONING WAS PROBED AND DELIBERATELY LEFT OUT. That layer has 304 features for
-- the whole county and returns nothing for a parcel inside Topeka, because the
-- city zones its own land. A field that is blank for most addresses does not
-- read as "no data", it reads as broken, and it would undermine every other
-- field on the card. If city zoning becomes available it is a new column, not
-- a half-populated one shipped today.

-- ── FLOOD ───────────────────────────────────────────────────────────────────
-- Not for sizing a sump pump. Flood zones map riverine and coastal flooding and
-- correlate poorly with groundwater, which is what makes a sump run; soil_desc
-- below is the field that speaks to that. What flood_sfha is for is the
-- SUBSTANTIAL IMPROVEMENT rule: inside a Special Flood Hazard Area, an
-- improvement worth more than 50% of the structure's value drags the whole
-- building up to current floodplain code (elevation, flood vents, elevated
-- mechanicals, flood-resistant materials below BFE). That can cost more than
-- the job being bid, and it is the kind of thing a contractor finds out after
-- signing.
alter table td_county_parcels add column if not exists flood_zone     text;
alter table td_county_parcels add column if not exists flood_sfha     boolean;
alter table td_county_parcels add column if not exists flood_floodway text;
alter table td_county_parcels add column if not exists flood_bfe      numeric;

comment on column td_county_parcels.flood_sfha is
  'True inside a FEMA Special Flood Hazard Area (zone A/AE). The 50% substantial-improvement rule applies there. NOT a sump-pump signal: see soil_desc.';

-- ── THE GROUND ITSELF ───────────────────────────────────────────────────────
-- The owner asked whether flood zone could size a sump pump. It cannot, but the
-- question was pointing at something real, and this is it. Soil type plus slope
-- is what a landscaper needs for drainage, french drains, irrigation zones and
-- sprinkler head spacing, and what anyone digging needs for a foundation or a
-- post. "Silty clay loam" drains slowly and heaves; sandy loam does not.
alter table td_county_parcels add column if not exists soil_desc text;

comment on column td_county_parcels.soil_desc is
  'NRCS soil map unit as the county publishes it, e.g. "Ladysmith silty clay loam, 1 to 3 percent slopes". Drainage, irrigation and excavation input. The slope is part of the string because that is how it is published; do not split it into a number, the ranges are not uniform.';

-- ── WHO IS IN TAX FORECLOSURE ───────────────────────────────────────────────
-- A published, public list of parcels in tax sale. This is the one field here
-- that should change a contractor's behaviour rather than inform it: an owner
-- who has not paid property tax is an owner who may not pay an invoice, and the
-- county's own lien outranks any mechanic's lien filed later.
--
-- Stored as the county's own facts (sale year, case number) and never as a
-- judgement. The card states the record and links to it; it does not tell
-- anybody what to do about it.
alter table td_county_parcels add column if not exists tax_sale_year int;
alter table td_county_parcels add column if not exists tax_sale_case text;

comment on column td_county_parcels.tax_sale_case is
  'County tax-sale case number. A public record, stated as a fact, never as advice. Absence means "not on the published list", which is not the same as "taxes are current".';

-- ── REGISTRY (§18): every fact named ONCE ───────────────────────────────────
-- Adding a metric must never mean editing a rendering file. These seven rows
-- are the whole of what the card and Tim need to know about the new fields.
drop function if exists public.county_field_defs();
create or replace function public.county_field_defs()
returns table (
  key   text,
  label text,
  fmt   text,
  sell  boolean,
  sort  int
)
language sql immutable as $$
  select * from (values
    ('year_built',        'Built',              'year',  true,   1),
    ('year_built_to',     'Added to',           'year',  true,   2),
    ('property_type',     'Class',              'text',  false,  3),
    ('use_desc',          'Use',                'text',  true,   4),
    ('sqft',              'Building',           'sqft',  true,   5),
    ('beds',              'Beds',               'num',   false,  6),
    ('baths',             'Baths',              'num',   false,  7),
    ('living_units',      'Units',              'int',   true,   8),
    ('building_count',    'Buildings',          'int',   true,   9),
    ('basement_desc',     'Basement',           'text',  true,  10),
    ('acres',             'Lot',                'acres', false, 11),
    ('land_sqft',         'Lot area',           'sqft',  false, 12),
    ('frontage_ft',       'Frontage',           'ft',    true,  13),
    ('depth_ft',          'Depth',              'ft',    true,  14),
    -- The ground and the water. Both lead for a landscaper, which is why they
    -- sort above the money rather than below it.
    ('soil_desc',         'Soil',               'text',  true,  15),
    ('flood_zone',        'Flood zone',         'text',  true,  16),
    ('flood_sfha',        'In flood hazard area','bool', true,  17),
    ('flood_bfe',         'Base flood elev',    'num',   false, 18),
    ('tax_sale_year',     'Tax sale',           'year',  true,  19),
    ('tax_sale_case',     'Tax sale case',      'text',  false, 20),
    ('assessed_value',    'Assessed',           'usd',   false, 21),
    ('improvement_value', 'Building value',     'usd',   true,  22),
    ('land_value',        'Land value',         'usd',   true,  23),
    ('owner_name',        'Owner',              'text',  true,  24),
    ('subdivision',       'Subdivision',        'text',  true,  25),
    ('neighborhood',      'Neighborhood',       'text',  false, 26),
    ('school_district',   'School district',    'text',  false, 27),
    ('deed_book_page',    'Deed',               'text',  true,  28),
    ('parcel_number',     'Parcel',             'text',  false, 29)
  ) as t(key, label, fmt, sell, sort);
$$;

comment on function public.county_field_defs() is
  'Every county fact named ONCE: label, format, and whether it is worth saying unprompted. The property card and Tim both read this. Never hardcode a county field label or format in JS (§18).';

grant execute on function public.county_field_defs() to authenticated;

-- ── THE LOOKUP HANDS THE NEW COLUMNS BACK ───────────────────────────────────
-- Fourth time: a column property_lookup does not name is a column the app can
-- never read, however well the loader fills it.
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
  year_built_to int,
  sqft          int,
  beds          numeric,
  baths         numeric,
  acres         numeric,
  land_sqft     numeric,
  assessed_value    int,
  land_value        int,
  improvement_value int,
  owner_name        text,
  property_type     text,
  use_desc          text,
  parcel_number     text,
  deed_book_page    text,
  building_count    int,
  living_units      int,
  frontage_ft       numeric,
  depth_ft          numeric,
  basement_desc     text,
  subdivision       text,
  neighborhood      text,
  school_district   text,
  soil_desc         text,
  flood_zone        text,
  flood_sfha        boolean,
  flood_floodway    text,
  flood_bfe         numeric,
  tax_sale_year     int,
  tax_sale_case     text,
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
    p.year_built, p.year_built_to, p.sqft, p.beds, p.baths, p.acres, p.land_sqft,
    p.assessed_value, p.land_value, p.improvement_value,
    p.owner_name, p.property_type, p.use_desc,
    p.parcel_number, p.deed_book_page, p.building_count, p.living_units,
    p.frontage_ft, p.depth_ft, p.basement_desc,
    p.subdivision, p.neighborhood, p.school_district,
    p.soil_desc, p.flood_zone, p.flood_sfha, p.flood_floodway, p.flood_bfe,
    p.tax_sale_year, p.tax_sale_case,
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

-- ── RELEASE THE 29 FOR ONE FINAL RE-ASK ─────────────────────────────────────
-- They predate the ground/risk layers AND they carry no raw, because the last
-- backfill went in through SQL rather than the function. This is the last time
-- a re-ask is cheap: it is bounded only because just 29 addresses have ever
-- been asked, and every address from here is captured whole on first contact.
delete from td_county_asks
 where county_fips = '20177'
   and outcome in ('hit', 'empty');
