-- ── AN ADDRESS WITH NO COMMAS IS STILL AN ADDRESS ───────────────────────────
--
-- Owner, 2026-09-22: "jack was saying his property record for pepe on elmwood
-- did not pull the county details."
--
-- It had not, and the cause was one character. td_addr_key takes everything
-- before the first comma as the street line. js/clients.js _propAddrString
-- joined street/city/state/zip with SPACES, so for any client stored with
-- separate street and city fields (which is how the lead form saves them) the
-- whole string became the street:
--
--   '306 SW Elmwood Ave, Topeka, KS 66606'  ->  306 SW ELMWOOD AVE        ✓
--   '306 SW Elmwood Ave Topeka KS 66606'    ->  306 SW ELMWOOD AVE TOPEKA KS 66606
--
-- The second matched nothing and never could. 675 of the owner's addresses and
-- all six of the first beta user's were in that shape.
--
-- _propAddrString now joins with commas, which is the real fix for the app. But
-- the DB function must not depend on ONE caller formatting its input politely:
-- td_addr_key is the single definition of how an address is keyed (20261032),
-- the generated addr_key column is computed from it, and the whole guarantee of
-- the design is that the loader and the lookup normalize identically. A caller
-- that sends a comma-less string, now or later, from a CSV import or a
-- geocoder or a paste, must key the same as one that sends commas.
--
-- So: when there is no comma, strip a TRAILING city/state/zip instead. The
-- anchor is the two-letter state plus optional zip at the end of the string,
-- because that is the only part of a US address with a reliable shape. The city
-- is then whatever sits between the street and that anchor, and it is dropped
-- with it.
--
-- DELIBERATELY CONSERVATIVE. It only fires when there is no comma AND the
-- string ends in a state-shaped token. A street that merely ends in two letters
-- is untouched, because the pattern requires the token to be a known state
-- abbreviation rather than any two letters: 'CIRCLE DR OK' is not stripped by
-- accident, but 'Topeka KS 66604' is. A string this cannot parse keys exactly
-- as it did before, so the change can only ever turn a non-match into a match.
--
-- IMMUTABLE and the same signature, so the generated column is unaffected. The
-- existing rows do not change: every parcel was loaded from a street-only
-- string, which has no comma and no trailing state, so this leaves all 29
-- keys exactly as they are (verified before and after).
create or replace function td_addr_key(p_addr text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  s text;
  raw text := coalesce(p_addr, '');
begin
  if position(',' in raw) > 0 then
    -- Street line only. Everything from the first comma on is city/state/zip,
    -- which the parcel row carries in its own columns.
    s := upper(split_part(raw, ',', 1));
  else
    s := upper(btrim(raw));
    -- No comma: strip a trailing "<CITY> <STATE> <ZIP>" instead. The state
    -- token is the anchor; the city is whatever precedes it, so both go.
    -- One optional word of city is matched greedily by \s+\S+ repeated, which
    -- is why the state list is spelled out: it stops the strip at a real state
    -- rather than eating a street name that happens to end in two letters.
    s := regexp_replace(
           s,
           '\s+\y(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|KANSAS|MISSOURI|NEBRASKA|OKLAHOMA|COLORADO|IOWA|ARKANSAS)\y(\s+\d{5}(-\d{4})?)?\s*$',
           '');
    -- What is left still carries the city, because the city sits between the
    -- street and the state token and nothing above removed it. Drop the last
    -- word ONLY when the strip above actually fired, which is what the length
    -- comparison establishes: a string that never had a state on it keeps
    -- every word it started with.
    if s <> upper(btrim(raw)) then
      s := regexp_replace(s, '\s+\S+\s*$', '');
    end if;
  end if;

  -- Drop unit designators. A county parcel row is the BUILDING; the apartment
  -- number belongs to the tenant, not to the assessment.
  s := regexp_replace(s, '\s+(APT|UNIT|STE|SUITE|RM|ROOM|LOT|TRLR|BLDG|FL|FLOOR|#)\s*[A-Z0-9-]*\s*$', '');

  -- Punctuation to space (periods in "S.W.", hyphens, extra whitespace).
  s := regexp_replace(s, '[^A-Z0-9]+', ' ', 'g');

  -- Rejoin the letter pair the step above just split: "S.W." became "S W".
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

  -- Street types to the postal short form.
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
  'The one address normalization. Handles both "street, city, ST zip" and the comma-less "street city ST zip" a composed string produces. Loader and lookup both key on this; the client sends raw text and never normalizes. See 20261032_county_parcels.sql and 20261036.';

-- ── UNSTAMP THE ADDRESSES THAT WERE NEVER REALLY MISSES ─────────────────────
--
-- This is the half that cannot be fixed by shipping code. _syncPropertyData
-- reads "no row came back" as "the county has no record", so every address
-- broken by the formatting bug was stamped propDataSource='county' with
-- propDataMiss=true. _propAnswered then returns true and NOTHING ASKS AGAIN:
-- the card would stay blank forever even after the key is fixed.
--
-- So clear the stamp, but ONLY where a parcel demonstrably exists for that
-- address. A genuine miss (an address the county really has no record of) is
-- left retired, because re-opening those is exactly the re-ask loop the gate
-- exists to prevent.
--
-- Matched on the CLIENT's own addr string, keyed through the function above,
-- which is now comma-tolerant, so this finds the records the old key could not.
with fixed as (
  select c.id,
         jsonb_strip_nulls(
           c.data
           - 'propDataSource' - 'propDataMiss' - 'propDataFetchedAt'
           - 'propDataExact'  - 'propDataCounty'
         ) as cleaned
  from td_clients c
  where c.data->>'propDataSource' = 'county'
    and (c.data->>'propDataMiss')::boolean is true
    and coalesce(c.data->>'yearBuilt','') = ''
    and exists (
      select 1 from td_county_parcels p
       where p.addr_key = td_addr_key(coalesce(c.data->>'addr',''))
    )
)
update td_clients c
   set data = f.cleaned
  from fixed f
 where c.id = f.id;
