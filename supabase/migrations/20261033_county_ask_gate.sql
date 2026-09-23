-- ── ASK A COUNTY ABOUT AN ADDRESS ONCE. EVER. ───────────────────────────────
--
-- Owner, 2026-09-22: "I want it only to call the address one time and once
-- saved it's good, don't want my shit to get blocked."
--
-- He was right, and 20261032 as shipped did not do that. It gated county calls
-- on `year_built is null`, which caches the SUCCESSES and nothing else, so every
-- address the county could not answer was re-asked forever:
--
--   1. A parcel with no year built at all (vacant land, commercial, a mobile
--      home lot) stays null no matter how many times we ask. Every lookup on it
--      was another request, for eternity.
--   2. An address the county has no record of writes nothing back at all
--      (cacheBack needs a parcel_id, and a miss has none), so it was re-asked by
--      every contractor who ever touched it.
--   3. The loader's --enrich pass selects rows WHERE year_built IS NULL, so
--      re-running it walked straight back over every unanswerable address.
--
-- Those are exactly the addresses that get you blocked: the ones that never
-- resolve, asked over and over, forever, which from the county's side is
-- indistinguishable from a scraper probing them.
--
-- THE FIX IS TO RECORD THE ASK, NOT THE ANSWER. One row per (county, address)
-- the moment we decide to ask, before the request goes out. "We already asked
-- and got nothing" is a fact worth storing, and it is the fact that was missing.

create table if not exists td_county_asks (
  county_fips text not null,
  -- The SAME normalization the parcel table keys on, so an address asked as
  -- "2015 S.W. Randolph Ave." and later as "2015 SW RANDOLPH AVE" is understood
  -- to be the one address it is, rather than two chances to call the county.
  addr_key    text not null,
  asked_at    timestamptz not null default now(),
  -- 'hit'     the county answered with something usable. Never ask again.
  -- 'empty'   the county was asked and had nothing (no such address, or no year
  --           built for it). Never ask again inside the retry window.
  -- 'pending' claimed but not yet resolved. See the fail-closed note below.
  outcome     text not null default 'pending',
  tries       int not null default 1,
  primary key (county_fips, addr_key)
);

-- "How close am I to the cap" has to be answerable without scanning the table.
create index if not exists td_county_asks_recent
  on td_county_asks (county_fips, asked_at desc);

-- ── THE GATE ────────────────────────────────────────────────────────────────
--
-- Every path that is about to contact a county calls this FIRST and contacts
-- them only on 'go'. It claims the address and checks the day's budget in one
-- transaction, so two Cloudflare invocations racing on the same address cannot
-- both decide to ask.
--
-- IT FAILS CLOSED, and that is deliberate. The row is written as 'pending'
-- BEFORE the county request goes out, so if the worker dies mid-request the
-- address stays claimed and nothing re-asks it. The cost of failing closed is
-- one address that needs a contractor to type a year. The cost of failing open
-- is a retry loop against a county server, which is the thing we are avoiding.
create or replace function county_claim_ask(
  p_fips text,
  p_addr text,
  p_daily_cap int default 500
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  k     text := td_addr_key(p_addr);
  prior record;
  today int;
begin
  -- Nothing to claim. Callers treat anything but 'go' as "do not contact".
  if k is null or p_fips is null or p_fips = '' then
    return 'skip';
  end if;

  select * into prior from td_county_asks
   where county_fips = p_fips and addr_key = k;

  if found then
    -- Answered once. There is no version of this where asking again is right:
    -- the answer is already in td_county_parcels.
    if prior.outcome = 'hit' then
      return 'already';
    end if;

    -- Asked and came back empty. Re-askable eventually, because a lot really
    -- can get a house on it and a county really does correct its own records,
    -- but on a horizon of seasons rather than page loads.
    if prior.outcome = 'empty' and prior.asked_at > now() - interval '180 days' then
      return 'already';
    end if;

    -- A claim that never resolved. One hour covers any request that is still
    -- genuinely in flight; past that we assume the worker died and allow one
    -- more attempt rather than stranding the address forever.
    if prior.outcome = 'pending' and prior.asked_at > now() - interval '1 hour' then
      return 'already';
    end if;
  end if;

  -- The circuit breaker. Not a rate limit on a healthy day (a real contractor's
  -- whole book is a few hundred addresses, asked once each); this is what stops
  -- a bug or a loop from turning into thousands of requests at a county that
  -- has no rate limiting of its own and no reason to tolerate us.
  select count(*) into today from td_county_asks
   where county_fips = p_fips and asked_at > now() - interval '1 day';

  if today >= greatest(p_daily_cap, 1) then
    return 'capped';
  end if;

  insert into td_county_asks (county_fips, addr_key, asked_at, outcome, tries)
  values (p_fips, k, now(), 'pending', 1)
  on conflict (county_fips, addr_key) do update
    set asked_at = now(),
        outcome  = 'pending',
        tries    = td_county_asks.tries + 1;

  return 'go';
end;
$$;

comment on function county_claim_ask(text, text, int) is
  'Claim the right to contact a county about one address. Returns go | already | capped | skip. Contact the county ONLY on go. Fails closed by design.';

-- Close the claim. 'hit' retires the address permanently; 'empty' retires it for
-- the retry window above. Never contacts anything, so it is safe to call from a
-- best-effort background context.
create or replace function county_record_ask(
  p_fips text,
  p_addr text,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k text := td_addr_key(p_addr);
begin
  if k is null or p_fips is null then return; end if;
  update td_county_asks
     set outcome = case when p_outcome = 'hit' then 'hit' else 'empty' end,
         asked_at = now()
   where county_fips = p_fips and addr_key = k;
end;
$$;

-- ── WHAT IS STILL WORTH ASKING ──────────────────────────────────────────────
-- The loader's enrich pass used "year_built is null", which is how hole 3 above
-- happened. It asks this instead: rows missing a year that nobody has already
-- asked about. An address that came back empty drops out of the list for good,
-- so re-running enrich makes progress instead of re-walking the same failures.
create or replace function county_enrich_queue(p_fips text, p_limit int default 250)
returns table (id bigint, street text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.street
    from td_county_parcels p
    left join td_county_asks a
      on a.county_fips = p.county_fips and a.addr_key = p.addr_key
   where p.county_fips = p_fips
     and p.year_built is null
     and a.addr_key is null          -- never asked; an asked row is done with
   order by p.id
   limit greatest(least(coalesce(p_limit, 250), 5000), 1);
$$;

-- ── GRANTS ──────────────────────────────────────────────────────────────────
alter table td_county_asks enable row level security;

-- Readable so the app can tell "we already asked and the county had nothing"
-- apart from "we have not looked yet", which are different sentences on the
-- property card. No write policy: only the service_role key (the API route and
-- the loader) records asks, and it bypasses RLS. A contractor who could write
-- here could retire an address for everybody, or blow the daily cap for a whole
-- county, by writing rows.
drop policy if exists td_county_asks_read on td_county_asks;
create policy td_county_asks_read on td_county_asks
  for select to authenticated using (true);

grant select on td_county_asks to authenticated;
-- Deliberately NOT granted to authenticated: these mutate the shared gate, and
-- they run from the service_role key on the server. A contractor's browser has
-- no business claiming or closing a county ask.
revoke all on function county_claim_ask(text, text, int)  from public;
revoke all on function county_record_ask(text, text, text) from public;
revoke all on function county_enrich_queue(text, int)      from public;
