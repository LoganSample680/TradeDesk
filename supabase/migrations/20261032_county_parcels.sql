-- ── THE COUNTY IS THE SOURCE. ZILLOW WAS A MIDDLEMAN. ───────────────────────
--
-- Year built, sqft, and assessed value never originated at Zillow. Every one of
-- them starts in a county assessor's office, gets sold to a data aggregator,
-- gets bought by Zillow, and was then scraped back out of a property page by
-- scripts/property-proxy.js. That scraper is dead: Zillow serves 403 to it now
-- (verified 2026-09-22), and no header spoofing beats behavioral fingerprinting.
--
-- So we do what Zillow's own "County Direct" program does, scoped to the
-- counties our contractors actually work in: load the assessor's public record
-- once, keep it, and match against it. A lookup stops being a network call and
-- becomes a join.
--
-- WHY THAT MATTERS BEYOND COST. year_built is not a decoration on a card. It
-- fires the EPA RRP pre-1978 lead-paint gate (js/clients.js, js/generic-
-- estimate.js). The scraper's failure mode was returning null, which reads
-- exactly like "built after 1978" and silently drops a federal compliance
-- warning off a proposal. A miss here is explicit instead: no row means no
-- answer, and the contractor is asked.
--
-- WHAT THIS IS NOT: account data. These are public records, identical for every
-- contractor, so there is no user_id and no per-account scoping. Every signed-in
-- user reads the same parcel rows. Only the loader (service_role) writes.

-- ── ONE ADDRESS NORMALIZATION, AND IT LIVES HERE ────────────────────────────
--
-- The match is the whole feature, and it fails on formatting, not on data:
-- "2015 SW Randolph Ave" has to equal "2015 SW RANDOLPH AVE" and "2015
-- Southwest Randolph Avenue". Both sides of the comparison must normalize
-- IDENTICALLY, which is only guaranteed if there is exactly one definition of
-- how. It is this function. The loader normalizes through it, the lookup
-- normalizes through it, and the client never normalizes at all: it sends the
-- raw street line and lets the database decide. A second copy in JS would drift
-- and the drift would present as "the county has no record of this house."
--
-- Written as sequential steps rather than a stack of nested regexp_replace on
-- purpose: the ORDER of these rules is the only thing keeping them correct
-- ("SOUTH WEST" has to collapse before "SOUTH" does), and order is exactly what
-- a twelve-deep nest hides. Each step below says what it does next to what it
-- does it to.
--
-- IMMUTABLE because the parcel table's addr_key column is generated from it.
create or replace function td_addr_key(p_addr text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  s text;
begin
  -- Street line only. Everything from the first comma on is city/state/zip,
  -- which the parcel row carries in its own columns.
  s := upper(split_part(coalesce(p_addr, ''), ',', 1));

  -- Drop unit designators. A county parcel row is the BUILDING; the apartment
  -- number belongs to the tenant, not to the assessment.
  s := regexp_replace(s, '\s+(APT|UNIT|STE|SUITE|RM|ROOM|LOT|TRLR|BLDG|FL|FLOOR|#)\s*[A-Z0-9-]*\s*$', '');

  -- Punctuation to space (periods in "S.W.", hyphens, extra whitespace).
  s := regexp_replace(s, '[^A-Z0-9]+', ' ', 'g');

  -- Rejoin the letter pair the step above just split: "S.W." became "S W", and
  -- neither the compound rules nor the single-letter ones below put it back, so
  -- "2015 S.W. Randolph" keyed as "2015 S W RANDOLPH" and matched nothing.
  -- Caught by the test table in tests/e2e-county-parcels.spec.js, 2026-09-22.
  s := regexp_replace(s, '\y([NS]) ([EW])\y', '\1\2', 'g');

  -- Compound directionals BEFORE single ones, or "SOUTH WEST" resolves to
  -- "S W" instead of "SW".
  s := regexp_replace(s, '\y(NORTHWEST|NORTH WEST)\y', 'NW', 'g');
  s := regexp_replace(s, '\y(NORTHEAST|NORTH EAST)\y', 'NE', 'g');
  s := regexp_replace(s, '\y(SOUTHWEST|SOUTH WEST)\y', 'SW', 'g');
  s := regexp_replace(s, '\y(SOUTHEAST|SOUTH EAST)\y', 'SE', 'g');
  s := regexp_replace(s, '\yNORTH\y', 'N', 'g');
  s := regexp_replace(s, '\ySOUTH\y', 'S', 'g');
  s := regexp_replace(s, '\yEAST\y',  'E', 'g');
  s := regexp_replace(s, '\yWEST\y',  'W', 'g');

  -- Street types to the postal short form, so the county's spelling and the
  -- contractor's spelling land on the same key.
  s := regexp_replace(s, '\y(AVENUE|AVENU|AVEN)\y',        'AVE',  'g');
  s := regexp_replace(s, '\y(STREET|STR)\y',               'ST',   'g');
  s := regexp_replace(s, '\y(ROAD)\y',                     'RD',   'g');
  s := regexp_replace(s, '\y(DRIVE|DRV)\y',                'DR',   'g');
  s := regexp_replace(s, '\y(BOULEVARD|BOULEVARDE)\y',     'BLVD', 'g');
  s := regexp_replace(s, '\y(LANE)\y',                     'LN',   'g');
  s := regexp_replace(s, '\y(COURT)\y',                    'CT',   'g');
  s := regexp_replace(s, '\y(PLACE)\y',                    'PL',   'g');
  s := regexp_replace(s, '\y(TERRACE|TERR)\y',             'TER',  'g');
  s := regexp_replace(s, '\y(CIRCLE|CIRC)\y',              'CIR',  'g');
  s := regexp_replace(s, '\y(PARKWAY|PKWAY)\y',            'PKWY', 'g');
  s := regexp_replace(s, '\y(HIGHWAY|HIWAY|HWAY)\y',       'HWY',  'g');
  s := regexp_replace(s, '\y(TRAIL)\y',                    'TRL',  'g');

  return nullif(btrim(regexp_replace(s, '\s+', ' ', 'g')), '');
end;
$$;

comment on function td_addr_key(text) is
  'The one address normalization. Loader and lookup both key on this; the client sends raw text and never normalizes. See 20261032_county_parcels.sql.';

-- ── THE PARCELS ─────────────────────────────────────────────────────────────
create table if not exists td_county_parcels (
  id            bigint generated always as identity primary key,
  -- 5-digit FIPS (state 2 + county 3). The routing key, and the unit a load
  -- replaces: re-running a county wipes and rewrites exactly its own rows.
  county_fips   text not null,
  state         text not null,
  county_name   text not null,
  -- The assessor's own parcel identifier, kept so a row can be traced back to
  -- the record it came from when a contractor says the number looks wrong.
  --
  -- NOT NULL because it is also the upsert key: it is what makes the yearly
  -- reload update the county in place instead of adding a second copy of it.
  -- A parcel we cannot identify is one we can never correct, so it does not
  -- get in (the loader drops those rows before sending them).
  parcel_id     text not null,
  -- addr_key is generated, never written by the loader, so it CANNOT drift from
  -- what the lookup computes. This is the join column.
  street        text not null,
  addr_key      text generated always as (td_addr_key(street)) stored,
  city          text,
  zip           text,
  -- The facts. All nullable on purpose: counties publish wildly different
  -- subsets, and a null here means "this county does not publish it", which is
  -- a different and more honest thing than a zero.
  year_built    int,
  sqft          int,
  beds          numeric,
  baths         numeric,
  acres         numeric,
  assessed_value    int,
  land_value        int,
  improvement_value int,
  owner_name        text,
  last_sale_price   int,
  last_sale_date    date,
  -- Where this row came from, shown to the contractor on the property card so
  -- the number is attributable to a public record rather than to us.
  source        text not null,
  source_url    text,
  loaded_at     timestamptz not null default now()
);

-- The lookup index. addr_key + county keeps two counties' identical street
-- names ("100 MAIN ST" exists everywhere) from colliding.
create index if not exists td_county_parcels_key
  on td_county_parcels (addr_key, county_fips);
-- Zip-first lookup, for the common path where the client knows the zip.
create index if not exists td_county_parcels_zip_key
  on td_county_parcels (zip, addr_key);
create index if not exists td_county_parcels_fips
  on td_county_parcels (county_fips);
-- One row per parcel per county. A re-load upserts rather than duplicating.
--
-- Deliberately NOT a partial index. It was `where parcel_id is not null` until a
-- test ran the loader's actual statement against it: Postgres cannot infer a
-- partial index from a bare `on conflict (county_fips, parcel_id)`, and
-- PostgREST does not send the predicate, so every upsert failed with "no unique
-- or exclusion constraint matching the ON CONFLICT specification". Making
-- parcel_id NOT NULL removes the need for the predicate entirely.
create unique index if not exists td_county_parcels_uniq
  on td_county_parcels (county_fips, parcel_id);

-- ── ZIP → COUNTY ROUTING ────────────────────────────────────────────────────
--
-- An address gives us a zip, not a county, so the county a lookup should even
-- consider is data rather than code. Onboarding a county means loading its zips
-- here; nothing in the app changes. A zip that straddles two counties gets a row
-- for each, which is why the lookup below matches across all candidates instead
-- of picking one.
create table if not exists td_county_zips (
  zip          text not null,
  county_fips  text not null,
  state        text not null,
  county_name  text not null,
  primary key (zip, county_fips)
);

-- ── WHICH COUNTIES ARE LIVE ─────────────────────────────────────────────────
-- Read by the client so a miss can tell the truth: "we do not have your county
-- yet" and "your county has no record of this address" are different answers
-- and the contractor deserves the right one.
create table if not exists td_county_status (
  county_fips   text primary key,
  state         text not null,
  county_name   text not null,
  parcel_count  int  not null default 0,
  -- Which fields this county actually publishes, so the UI never shows an empty
  -- "Year built" slot for a county that has never had one.
  has_year_built boolean not null default false,
  has_sqft       boolean not null default false,
  has_beds       boolean not null default false,
  source         text,
  loaded_at      timestamptz
);

-- ── THE LOOKUP ──────────────────────────────────────────────────────────────
--
-- Takes every address a contractor has and answers in ONE round trip. This is
-- the whole reason the old design is gone: _startPropQueue trickled one HTTP
-- lookup every 6.5 seconds for as long as the browser stayed open, so a 500
-- client import could not finish before somebody closed the tab, and it silently
-- resumed from nothing next login.
--
-- security definer because td_county_parcels is reference data with RLS on and
-- no per-user rows to scope; the function IS the read path. It takes no account
-- identifier and returns no account data, so there is nothing here to scope TO.
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
  -- distinct: a contractor with the same address on two clients asks once.
  --
  -- The zip is pulled out of the SAME string rather than passed separately,
  -- because the client already holds "123 Main St, Topeka, KS 66604" and any
  -- second parameter is a second thing that can disagree with the first. It is
  -- the tiebreaker, never a filter: "100 MAIN ST" exists in every county we will
  -- ever load, and without it the first county loaded would start answering for
  -- all of them. A missing or unrecognized zip still matches, just unranked.
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
    p.owner_name, p.last_sale_price, p.last_sale_date,
    p.source, p.source_url
  from q
  join td_county_parcels p on p.addr_key = q.k
  -- Same-zip first (the cross-county tiebreaker above), then a row that
  -- actually carries a fact over a bare shell, so a county publishing the same
  -- parcel in two layers resolves to the useful one.
  order by q.raw,
           (q.zip is not null and p.zip = q.zip) desc,
           (p.year_built is not null) desc,
           (p.assessed_value is not null) desc,
           p.loaded_at desc
  -- Capped so a runaway client cannot ask for the table. 500 addresses is far
  -- past any real contractor's book and still one fast query.
  limit 500;
$$;

comment on function property_lookup(text[]) is
  'Match a contractor''s addresses against loaded county assessor records. One round trip, no external call. Returns only the addresses that matched.';

-- ── GRANTS AND RLS ──────────────────────────────────────────────────────────
alter table td_county_parcels enable row level security;
alter table td_county_zips    enable row level security;
alter table td_county_status  enable row level security;

-- Public records: every signed-in user reads the same rows. Writes are the
-- loader's alone (service_role bypasses RLS), so there is no write policy here
-- by design, not by omission.
drop policy if exists td_county_parcels_read on td_county_parcels;
create policy td_county_parcels_read on td_county_parcels
  for select to authenticated using (true);

drop policy if exists td_county_zips_read on td_county_zips;
create policy td_county_zips_read on td_county_zips
  for select to authenticated using (true);

drop policy if exists td_county_status_read on td_county_status;
create policy td_county_status_read on td_county_status
  for select to authenticated using (true);

grant select on td_county_parcels, td_county_zips, td_county_status to authenticated;
grant execute on function td_addr_key(text)      to authenticated;
grant execute on function property_lookup(text[]) to authenticated;
