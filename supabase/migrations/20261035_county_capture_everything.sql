-- ── CAPTURE THE WHOLE ANSWER, BECAUSE WE ONLY GET TO ASK ONCE ───────────────
--
-- Owner, 2026-09-22: "I want all facts we can pull that would increase the
-- potential for selling" and "if it can feed my guy tim, I want it."
--
-- The ask gate (20261033) is the constraint that makes this urgent rather than
-- optional. An address is contacted ONCE, EVER. So every field in the county's
-- response that we do not store is a field we cannot go back for without
-- re-asking 77,000 parcels, which is precisely the behaviour the gate exists to
-- prevent. We were reading nine fields out of a response that carries fifty-six
-- and discarding the rest on the floor.
--
-- TWO TIERS, deliberately, and the split is not arbitrary.
--
--   Promoted COLUMNS  = the facts the app reasons about: things a query filters
--                       on, sorts by, or gates behaviour with. year_built has
--                       to be a column because the pre-1978 lead gate is a
--                       comparison. frontage_ft has to be a column because an
--                       estimate multiplies by it.
--   raw JSONB         = everything else, verbatim, as the county sent it.
--
-- The jsonb half is what makes this survivable at scale. Counties do not agree
-- on fields: Shawnee runs Tyler/Epona plus Esri, and the next county may run
-- Patriot or Vanguard with entirely different names. A fixed column per fact
-- means the first county publishing roof material forces a migration; a raw
-- column means its oddities are captured the day it is onboarded and can be
-- PROMOTED to a column later if enough counties turn out to publish it. The
-- data is already banked by then, so promoting is an UPDATE, never a re-ask.

-- ── PROMOTED: what the app reasons about ────────────────────────────────────
alter table td_county_parcels add column if not exists parcel_number   text;   -- the legal PID; what a lien filing needs, not a street address
alter table td_county_parcels add column if not exists deed_book_page  text;   -- '2022R20196': the recorded instrument, and the year they bought
alter table td_county_parcels add column if not exists year_built_to   int;    -- built-from 2001, built-to 2017 = the building was added to, twice
alter table td_county_parcels add column if not exists building_count  int;    -- a detached garage is scope nobody quoted
alter table td_county_parcels add column if not exists living_units    int;    -- a duplex is two of everything
alter table td_county_parcels add column if not exists frontage_ft     numeric;-- fence, gutter, driveway, curb: linear feet without a site visit
alter table td_county_parcels add column if not exists depth_ft        numeric;
alter table td_county_parcels add column if not exists basement_desc   text;   -- 'Full': egress, waterproofing, finish-out upside
alter table td_county_parcels add column if not exists subdivision     text;   -- 'COLLEGE HILL': local proof closes work
alter table td_county_parcels add column if not exists neighborhood    text;
alter table td_county_parcels add column if not exists school_district text;
alter table td_county_parcels add column if not exists land_sqft       numeric;-- true lot area off the parcel polygon, not a rounded acreage
alter table td_county_parcels add column if not exists raw             jsonb;  -- everything, verbatim

comment on column td_county_parcels.raw is
  'The county''s answer as it came, per source. We contact an address once ever (see county_claim_ask), so a field not stored here is a field we cannot go back for. Promote to a real column when enough counties publish it; the data is already banked, so promoting is an UPDATE, never a re-ask.';
comment on column td_county_parcels.deed_book_page is
  'Recorded instrument, e.g. 2022R20196. Shawnee publishes no sale price and no sale date; the year prefix here is the closest thing to "when did they buy it", which is the strongest propensity signal in home services.';

-- ── ONE DEFINITION PER FACT, AND ONLY ONE (§18) ─────────────────────────────
--
-- §18 exists because ops_account_brief shipped with its metrics written out
-- twice, once in the SQL and once in the page, so adding one meant editing both
-- in agreement forever. The same trap is open here the moment two readers want
-- these fields, and there are already two: the property card and Tim.
--
-- So the fields are DATA. county_field_defs() names each one once with its
-- label, its format, and the one thing a metric row does not need: whether it
-- is worth SAYING OUT LOUD. Tim reads `sell` to decide what is worth
-- mentioning; the card reads `sort` to decide what to show. Neither hardcodes
-- a label and neither hardcodes a format.
--
-- fmt values match §18's vocabulary exactly (int, usd, num, text, year, ft,
-- sqft, acres) so one formatter serves metrics and facts alike.
drop function if exists public.county_field_defs();
create or replace function public.county_field_defs()
returns table (
  key   text,
  label text,
  fmt   text,
  sell  boolean,   -- worth Tim saying unprompted
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
    ('assessed_value',    'Assessed',           'usd',   false, 15),
    ('improvement_value', 'Building value',     'usd',   true,  16),
    ('land_value',        'Land value',         'usd',   true,  17),
    ('owner_name',        'Owner',              'text',  true,  18),
    ('subdivision',       'Subdivision',        'text',  true,  19),
    ('neighborhood',      'Neighborhood',       'text',  false, 20),
    ('school_district',   'School district',    'text',  false, 21),
    ('deed_book_page',    'Deed',               'text',  true,  22),
    ('parcel_number',     'Parcel',             'text',  false, 23)
  ) as t(key, label, fmt, sell, sort);
$$;

comment on function public.county_field_defs() is
  'Every county fact named ONCE: label, format, and whether it is worth saying unprompted. The property card and Tim both read this. Never hardcode a county field label or format in JS (§18).';

-- Not gated on ops admin: these describe public records, and every contractor's
-- own property card reads them.
grant execute on function public.county_field_defs() to authenticated;

-- ── THE LOOKUP HANDS BACK WHAT IT NOW HOLDS ─────────────────────────────────
-- A column property_lookup does not name is a column the app can never read,
-- however well the loader fills it. This is the third time that sentence has
-- had to be written; it is the one thing to check when adding a column here.
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

-- ── RELEASE THE 29 ALREADY-ANSWERED PARCELS FOR ONE MORE ASK ────────────────
-- They were answered under the old nine-field parse, so their rows carry a
-- fraction of what the county actually sent and no raw at all. Releasing them
-- once, now, is 58 requests and it is the LAST time it is cheap: it is bounded
-- by the fact that only 29 addresses have ever been asked. Every address asked
-- from here on is captured whole on the first and only contact.
delete from td_county_asks
 where county_fips = '20177'
   and outcome in ('hit', 'empty');
