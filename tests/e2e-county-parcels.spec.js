// ── THE COUNTY RECORD PATH, AND THE SCRAPER THAT IS GONE ────────────────────
//
// Property facts (year built, sqft, beds/baths, assessed value) used to come
// from scripts/property-proxy.js, which scraped Zillow from a home IP because
// Zillow bot-challenges datacenter IPs. Zillow serves it a hard 403 now, so the
// scraper, the Proxmox service it ran as, and the cloudflared tunnel that
// reached it are all deleted. Facts come from the county assessor instead,
// loaded into td_county_parcels and matched with one SQL join.
//
// WHAT THIS SPEC IS FOR. Two things, and the second is the one that earns it.
//
// 1. §7.1: prove the old entry points are GONE, not merely unused. A resurrected
//    tunnel would fail silently in exactly the way the original did: property
//    data just stops arriving and nothing says why.
// 2. Freeze the guarantees in the migration that are invisible at the call site
//    and catastrophic when broken. addr_key being a GENERATED column is the load
//    bearing one: it is the only thing making the loader's spelling and the
//    lookup's spelling provably identical. The day somebody "optimizes" it into
//    a plain column the loader writes, the two drift and every lookup starts
//    answering "the county has no record of this house."
//
// The normalization RULES themselves are executed against a real Postgres
// (verified 2026-09-22: ten spelling pairs, including "2015 S.W. Randolph Ave."
// vs "2015 SW RANDOLPH AVE", all collapse to one key). That cannot run in the
// offline shard, which has no database, so what is frozen here is the contract
// around it.
const { test, expect } = require('./helpers');
const fs = require('fs');
const path = require('path');

const repo = (p) => path.join(__dirname, '..', p);
const readSrc = (p) => fs.readFileSync(repo(p), 'utf8');
const MIGRATION = 'supabase/migrations/20261032_county_parcels.sql';
const FN = 'supabase/functions/county-property/index.ts';

test.describe('county parcel records', () => {

  // ── §7.1: the scraper is deleted ─────────────────────────────────────────
  test.describe('the Zillow scraper path is removed, not hidden', () => {
    test('every file that made up the scraper is gone from the repo', () => {
      for (const f of [
        'scripts/property-proxy.js',          // the scraper itself
        'scripts/setup-property-proxy.sh',    // the installer
        'scripts/tradedesk-property.service', // the systemd unit on the Proxmox box
      ]) {
        expect(fs.existsSync(repo(f)), `${f} must be deleted, not left dormant`).toBe(false);
      }
    });

    test('the api route no longer reaches for the home tunnel', () => {
      const src = readSrc(FN);
      // PROPERTY_TUNNEL_URL pointed at a cloudflared quick tunnel to the owner's
      // house. If this comes back, production property lookups depend on his
      // power and his ISP again.
      expect(src).not.toMatch(/PROPERTY_TUNNEL_URL/);
      expect(src).not.toMatch(/cfargotunnel/);
      // And it must not have quietly started scraping Zillow from the edge.
      expect(src).not.toMatch(/zillow\.com/i);
    });

    test('no source file still calls zillow for property data', () => {
      for (const f of ['js/clients.js', 'js/data.js', FN]) {
        const src = readSrc(f);
        expect(src, `${f} must not request anything from zillow`).not.toMatch(/https?:\/\/[^\s'"]*zillow/i);
      }
    });
  });

  // ── The migration's load-bearing guarantees ──────────────────────────────
  test.describe('migration contract', () => {
    const sql = () => readSrc(MIGRATION);

    test('addr_key is a GENERATED column, so the two sides cannot drift', () => {
      // The entire feature is an equality test between what the loader wrote and
      // what the lookup computes. Generating the column from td_addr_key is what
      // makes that equality structural instead of a convention two files are
      // each trusted to honor.
      expect(sql()).toMatch(/addr_key\s+text\s+generated always as \(td_addr_key\(street\)\) stored/);
    });

    test('td_addr_key is IMMUTABLE, which the generated column requires', () => {
      const fn = sql().match(/create or replace function td_addr_key[\s\S]*?\$\$;/);
      expect(fn, 'td_addr_key must exist').toBeTruthy();
      expect(fn[0]).toMatch(/\bimmutable\b/);
    });

    test('compound directionals collapse before single ones', () => {
      // Order is the only thing keeping these correct: if SOUTH is replaced
      // before SOUTHWEST, "SOUTH WEST" becomes "S W" and matches nothing. This
      // is a real bug that was caught in testing, not a hypothetical.
      const fn = sql().match(/create or replace function td_addr_key[\s\S]*?\$\$;/)[0];
      const sw = fn.indexOf('SOUTHWEST');
      const s  = fn.search(/'\\ySOUTH\\y'/);
      expect(sw, 'SOUTHWEST rule must exist').toBeGreaterThan(-1);
      expect(s, 'SOUTH rule must exist').toBeGreaterThan(-1);
      expect(sw, 'SOUTHWEST must be replaced before SOUTH').toBeLessThan(s);
    });

    test('punctuation-split directionals are rejoined', () => {
      // "2015 S.W. Randolph" -> "2015 S W RANDOLPH" -> must become "2015 SW…".
      expect(sql()).toMatch(/\[NS\]\) \(\[EW\]/);
    });

    test('the upsert key is a PLAIN unique index, not a partial one', () => {
      // A real bug, caught by running the loader's own statement against a live
      // Postgres (2026-09-22). The index was `where parcel_id is not null`, and
      // Postgres cannot infer a partial index from a bare
      // `on conflict (county_fips, parcel_id)` unless the statement repeats the
      // predicate, which PostgREST does not send. Every county load failed with
      // "no unique or exclusion constraint matching the ON CONFLICT
      // specification". If the predicate comes back, loading breaks again.
      const s = sql();
      const idx = s.match(/create unique index if not exists td_county_parcels_uniq[\s\S]*?;/);
      expect(idx, 'the upsert index must exist').toBeTruthy();
      expect(idx[0], 'the upsert index must not be partial').not.toMatch(/\bwhere\b/i);
      // Which only holds because a parcel row must be identifiable at all.
      expect(s).toMatch(/parcel_id\s+text not null/);
    });

    test('property_lookup is capped and cannot be asked for the whole table', () => {
      const fn = sql().match(/create or replace function property_lookup[\s\S]*?\$\$;/);
      expect(fn, 'property_lookup must exist').toBeTruthy();
      expect(fn[0]).toMatch(/limit\s+500/);
    });

    test('the zip is a tiebreaker in ORDER BY, never a filter in WHERE', () => {
      // "100 MAIN ST" exists in every county we will ever load, so the zip has
      // to rank. But a missing or unrecognized zip must still match, or a client
      // record without one silently stops resolving.
      const fn = sql().match(/create or replace function property_lookup[\s\S]*?\$\$;/)[0];
      expect(fn, 'the zip must rank results').toMatch(/order by[\s\S]*p\.zip = q\.zip/);
      // Check the clause that actually selects rows, rather than scanning the
      // whole function for the word "and": the ORDER BY legitimately contains
      // "and p.zip = q.zip" inside its ranking expression, which an over-broad
      // pattern flags as the very thing it is supposed to permit.
      const selecting = fn.slice(fn.indexOf('from q'), fn.indexOf('order by'));
      expect(selecting, 'the parcel zip must not filter which rows match')
        .not.toMatch(/p\.zip/);
    });

    test('parcel data is readable by any signed-in user and writable by none', () => {
      const s = sql();
      expect(s).toMatch(/alter table td_county_parcels enable row level security/);
      expect(s).toMatch(/create policy td_county_parcels_read on td_county_parcels\s*\n\s*for select to authenticated using \(true\)/);
      // These are public records shared by every account, so there is no insert
      // or update policy at all: only the loader's service_role key writes, and
      // it bypasses RLS. A write policy appearing here would mean any signed-in
      // contractor could rewrite the assessor data every other account reads.
      expect(s, 'no write policy may exist on the shared parcel table')
        .not.toMatch(/create policy[^\n]*on td_county_parcels\s*\n\s*for (insert|update|delete|all)/);
    });

    test('the lookup is executable by signed-in users', () => {
      expect(sql()).toMatch(/grant execute on function property_lookup\(text\[\]\) to authenticated/);
    });
  });

  // ── One ask per address, ever ────────────────────────────────────────────
  //
  // Owner, 2026-09-22: "I want it only to call the address one time and once
  // saved it's good, don't want my shit to get blocked."
  //
  // The first cut of this feature did not deliver that. It gated county calls on
  // `year_built is null`, which caches the SUCCESSES and nothing else, so the
  // addresses a county cannot answer were re-asked forever. Those are exactly
  // the requests that look like probing from the county's side. Every guard
  // below stands between us and a county blocking the range.
  //
  // The gate's BEHAVIOUR is executed against a real Postgres (verified
  // 2026-09-22: one address asked five times yields one 'go' and four
  // 'already'; a different spelling of the same address gets no second bite; a
  // cap of 5 across 10 addresses yields exactly five 'go'). The offline shard
  // has no database, so what is frozen here is the contract around it.
  test.describe('county ask gate', () => {
    const GATE = 'supabase/migrations/20261033_county_ask_gate.sql';
    const gate = () => readSrc(GATE);

    test('a resolved address is never asked about again', () => {
      const fn = gate().match(/create or replace function county_claim_ask[\s\S]*?\$\$;/);
      expect(fn, 'county_claim_ask must exist').toBeTruthy();
      expect(fn[0], "a 'hit' must retire the address with no time window at all")
        .toMatch(/outcome = 'hit' then\s*\n\s*return 'already'/);
    });

    test('an address the county had nothing for is also retired', () => {
      // Hole 2 and the vacant-lot case. A parcel with no year built stays null
      // no matter how often it is asked, so "empty" has to be a remembered
      // answer rather than a reason to try again.
      expect(gate()).toMatch(/outcome = 'empty' and prior\.asked_at > now\(\) - interval '180 days'/);
    });

    test('the gate claims BEFORE the request, so a crash fails closed', () => {
      // The row is written as 'pending' before the county is contacted. If the
      // worker dies mid-request the address stays claimed and nothing re-asks
      // it. Failing closed costs one hand-typed year; failing open costs a retry
      // loop against a county server.
      const fn = gate().match(/create or replace function county_claim_ask[\s\S]*?\$\$;/)[0];
      expect(fn).toMatch(/insert into td_county_asks[\s\S]*'pending'/);
      expect(fn).toMatch(/outcome = 'pending' and prior\.asked_at > now\(\) - interval '1 hour'/);
    });

    test('a daily cap per county exists as a circuit breaker', () => {
      const fn = gate().match(/create or replace function county_claim_ask[\s\S]*?\$\$;/)[0];
      expect(fn).toMatch(/return 'capped'/);
      expect(fn, 'the cap must count real recent asks, not a static number')
        .toMatch(/count\(\*\) into today from td_county_asks/);
    });

    test('the enrich queue excludes addresses already asked about', () => {
      // Hole 3: the loader selected `year_built is null`, which walked straight
      // back over every previous failure on every run.
      const fn = gate().match(/create or replace function county_enrich_queue[\s\S]*?\$\$;/);
      expect(fn, 'county_enrich_queue must exist').toBeTruthy();
      expect(fn[0]).toMatch(/left join td_county_asks/);
      expect(fn[0]).toMatch(/a\.addr_key is null/);
    });

    test('contractors cannot write to the gate', () => {
      const s = gate();
      expect(s).toMatch(/alter table td_county_asks enable row level security/);
      // A contractor who could write here could retire an address for everybody,
      // or burn a whole county's daily cap, from a browser console.
      expect(s, 'no write policy may exist on the gate')
        .not.toMatch(/create policy[^\n]*on td_county_asks\s*\n\s*for (insert|update|delete|all)/);
      expect(s).toMatch(/revoke all on function county_claim_ask\(text, text, int\)\s+from public/);
      expect(s).toMatch(/revoke all on function county_record_ask\(text, text, text\) from public/);
    });

    test('both paths to a county go through the gate', () => {
      // The API route and the loader must BOTH claim, or the one that does not
      // bypasses the cap and the one-ask rule for everybody.
      expect(readSrc(FN), 'the api route must claim before contacting a county')
        .toMatch(/county_claim_ask/);
      const loader = readSrc('scripts/county-load.js');
      expect(loader, 'the loader must claim before contacting a county').toMatch(/county_claim_ask/);
      expect(loader, 'the loader must use the queue, not a bare year_built filter')
        .toMatch(/county_enrich_queue/);
      expect(loader, 'the loader must not re-introduce the null-select hole')
        .not.toMatch(/year_built=is\.null/);
    });

    test('both paths record the outcome, or nothing is ever retired', () => {
      expect(readSrc(FN)).toMatch(/county_record_ask/);
      expect(readSrc('scripts/county-load.js')).toMatch(/county_record_ask/);
    });

    test('a failed request is left pending, not recorded as empty', () => {
      // A refused or broken request is not proof the county has nothing. Marking
      // it empty would retire a perfectly good address for 180 days on one blip.
      //
      // Two sources are asked per address now (the building from the appraiser's
      // search, the money from the GIS parcel layer), so this got stricter: the
      // claim closes only when BOTH answered. A transient failure on one side
      // would otherwise leave a house with a value and no year built, forever,
      // with nothing left to retry it.
      const src = readSrc(FN);
      // undefined is the transport-failure signal, deliberately distinct from
      // null, which means "answered, and has no such address".
      expect(src, 'a failed fetch must be distinguishable from a genuine miss')
        .toMatch(/if \(!res\.ok\) return undefined;/);
      expect(src, 'the claim closes only when both sources actually answered')
        .toMatch(/if \(building !== undefined && parcel !== undefined\) \{[\s\S]{0,400}?close\(/);
      // And a double failure returns before any close at all.
      expect(src).toMatch(/if \(building === undefined && parcel === undefined\)/);
    });
  });

  // ── Demand-driven: a county is asked when an address is SAVED ────────────
  //
  // Owner, 2026-09-22: "We're not loading all of Shawnee county, we're just
  // bringing them in when a address is saved through the day rail or lead
  // record."
  //
  // That is the whole volume story. A contractor saves a handful of addresses a
  // day, so the county sees a handful of requests a day, naturally paced by a
  // person actually working. No bulk pre-load, no drip, nothing to throttle.
  // These tests exist because the trigger is easy to lose in a refactor and its
  // absence is silent: property cards would just quietly stop filling in.
  test.describe('demand-driven triggers', () => {
    test('saving a lead record with an address asks the county', () => {
      const src = readSrc('js/clients.js');
      const fn = src.slice(src.indexOf('function saveClient('));
      expect(fn.slice(0, 12000), 'saveClient must trigger the lookup')
        .toMatch(/_lookupPropertyData\(c\.id,\s*\{street,city,state,zip\}\)/);
    });

    test('the lead trigger is not gated on the dead scraper\'s stamp', () => {
      // propDataFetchedAt was set by the Zillow scraper on its own FAILURES, so
      // gating on it means a client whose lookup failed in June is never asked
      // about again, and the demand-driven path silently skips exactly the
      // records it exists to fill.
      const src = readSrc('js/clients.js');
      const i = src.indexOf('const _prevAddr=');
      const branch = src.slice(i, i + 700);
      expect(branch, 'the save trigger must use _propAnswered').toMatch(/_propAnswered\(_existingClient\)/);
      expect(branch, 'and must not gate on the old stamp').not.toMatch(/_existingClient\?\.propDataFetchedAt/);
    });

    test('filing an address from the day rail asks the county too', () => {
      // _mileWhoPick attaches a stop's address to an EXISTING client, so it
      // never passes through the new-lead form. Without its own trigger the
      // property card for that address stays empty forever.
      const src = readSrc('js/mileage.js');
      const fn = src.slice(src.indexOf('async function _mileWhoPick('));
      const body = fn.slice(0, fn.indexOf('\n}'));
      expect(body, '_mileWhoPick must trigger the lookup').toMatch(/_lookupPropertyData\(/);
      // For the address actually filed, not the client's primary: on a
      // landlord's second rental those are different houses.
      expect(body).toMatch(/_parseAddrParts\(addr\)/);
    });

    test('one saved address costs exactly two county requests', () => {
      // The building (year built, sqft, beds, baths) and the money (assessed,
      // land, improvement, owner) live in two different county systems. Both
      // are asked on the same lookup so a saved address is complete in one
      // pass, which is what removes any need for a bulk pre-load.
      const src = readSrc(FN);
      expect(src).toMatch(/building:\s*\{/);
      expect(src).toMatch(/parcel:\s*\{/);
      expect(src, 'both are asked together, not one after the other')
        .toMatch(/Promise\.all\(\[ask\(enricher\.building\), ask\(enricher\.parcel\)\]\)/);
      // And the whole pair sits behind ONE claim, so the gate still counts an
      // address as one ask however many systems it took to answer.
      const claimAt = src.indexOf('county_claim_ask');
      const askAt = src.indexOf('Promise.all([ask(');
      expect(claimAt, 'the claim must come first').toBeLessThan(askAt);
    });

    test('the assessed figures are written back, or nobody ever sees them', () => {
      // These came from the bulk load before. With no bulk load, a value not
      // cached here is a value that is fetched and then thrown away.
      const src = readSrc(FN);
      const fn = src.slice(src.indexOf('async function cacheBack('));
      const patch = fn.slice(0, fn.indexOf('};'));
      for (const f of ['assessed_value', 'land_value', 'improvement_value', 'owner_name', 'acres']) {
        expect(patch, `cacheBack must persist ${f}`).toMatch(new RegExp(`${f}:`));
      }
    });
  });

  // ── It is an Edge Function, and it checks who is asking ──────────────────
  //
  // This was a Cloudflare Pages Function first, purely because the dead Zillow
  // tunnel proxy happened to live at that file path and the rewrite stayed put.
  // That was a §7.3 violation (twenty Edge Functions already do this shape of
  // work) and it shipped with NO caller check at all: anyone on the internet
  // could hit it and make us fire a request at a county server through our own
  // domain, which is exactly what gets a range blocked.
  test.describe('the county lookup is an authenticated Edge Function', () => {
    const fn = () => readSrc(FN);

    test('the Cloudflare route is deleted, not left alongside', () => {
      // Two doors to the same county is two places to forget the auth check.
      expect(fs.existsSync(repo('functions/api/property.js')),
        'the Cloudflare property route must be gone').toBe(false);
    });

    test('it refuses a caller with no session', () => {
      const s = fn();
      expect(s, 'a missing Authorization header must be a 401')
        .toMatch(/if \(!auth\) return json\(\{ error: "unauthorized" \}, 401\)/);
      // And the token must actually be verified, not merely present.
      expect(s).toMatch(/asUser\.auth\.getUser\(\)/);
      expect(s).toMatch(/if \(meErr \|\| !me\?\.user\) return json\(\{ error: "unauthorized" \}, 401\)/);
    });

    test('the service key is never touched before the caller is verified', () => {
      // The whole point of the check. If the privileged client is built first,
      // an unauthenticated request has already been handed the keys.
      const s = fn();
      const verifiedAt = s.indexOf('auth.getUser()');
      const serviceAt = s.indexOf('createClient(SUPABASE_URL, SERVICE_KEY)');
      expect(verifiedAt, 'the caller check must exist').toBeGreaterThan(-1);
      expect(serviceAt, 'the service client must exist').toBeGreaterThan(-1);
      expect(verifiedAt, 'verify the caller BEFORE building the service client')
        .toBeLessThan(serviceAt);
    });

    test('the key comes from the Supabase runtime, not a second vendor config', () => {
      // One fewer copy of the most privileged credential, and nothing for the
      // owner to paste into Cloudflare.
      expect(fn()).toMatch(/Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
    });
  });

  // ── One door to the county ───────────────────────────────────────────────
  test.describe('both property surfaces share one fetch', () => {
    test('_countyProperty is the only thing that calls the function', () => {
      // There are two surfaces: the estimate builder's live address card
      // (js/data.js) and the client record's saved-address lookup
      // (js/clients.js). Two copies of "how do we ask the county" drift, and
      // the drift shows up as a card that silently stops filling in (§7.3).
      const data = readSrc('js/data.js');
      const clients = readSrc('js/clients.js');
      expect(data, 'the shared door lives in data.js, which loads first')
        .toMatch(/async function _countyProperty\(addr,signal\)/);
      expect((data + clients).match(/functions\/v1\/county-property/g) || [],
        'exactly one place may build that request').toHaveLength(1);
      expect(clients, 'the client card must go through the shared door')
        .toMatch(/_countyProperty\(addr,ctrl\.signal\)/);
      expect(data, 'the estimate card must go through it too')
        .toMatch(/_countyProperty\(addr,_ctrl\.signal\)/);
    });

    test('the live estimate card reads the county field names, not the scraper\'s', () => {
      // It read d.yearBuilt / d.estValue, which was the dead Zillow proxy's
      // camelCase shape. Against the county's snake_case every field would have
      // come back undefined and the card would have rendered dashes with no
      // lead-paint warning: silently wrong about the one number that carries a
      // federal disclosure.
      const data = readSrc('js/data.js');
      const card = data.slice(data.indexOf('async function _lookupProperty('), data.indexOf('// ── Crowdsourced'));
      expect(card).toMatch(/d\.year_built/);
      expect(card, 'no camelCase leftovers from the scraper').not.toMatch(/d\.yearBuilt|d\.estValue|d\.lastSalePrice/);
      // And it still fires the pre-1978 gate off that year.
      expect(card).toMatch(/leadPaint\s*=\s*_yr\s*&&\s*_yr\s*<\s*1978/);
    });

    test('a county miss is distinguishable from a failed request', () => {
      // Collapsing them looks harmless and is not: the client card stamps a
      // miss so the address is never re-asked, and doing that on a blip retires
      // a good address permanently.
      const data = readSrc('js/data.js');
      expect(data, '_countyProperty must pass {found:false} through, not null it')
        .toMatch(/return d;\s*\/\/ may be \{found:false\}/);
      expect(readSrc('js/clients.js'), 'only an explicit found:false records a miss')
        .toMatch(/_propApplyMatch\(c,keyAddr,d\.found===false\?null:d\)/);
    });
  });

  // ── County configs ───────────────────────────────────────────────────────
  // Onboarding a county is meant to be a config file and nothing else. That only
  // stays true while the configs are actually complete, and the failure mode of
  // an incomplete one is a column of nulls rather than an error.
  // ── A COMMERCIAL PARCEL IS NOT A PARCEL WITH NOTHING ON IT ───────────────
  //
  // Owner, 2026-09-22: "commercial addresses arent coming over." They were,
  // with an owner and an assessed value and nothing else, because Shawnee
  // publishes building facts under resBldg* for a house and comBldg* for a
  // store and we only ever read the residential half. Seven parcels on his own
  // book sat at null year built; three of them are pre-1978, which means the
  // EPA RRP lead gate was disarmed on every one of those bids.
  test.describe('commercial buildings', () => {
    const fn = () => readSrc(FN);

    test('year built falls back to the commercial field', () => {
      const s = fn();
      expect(s, 'a commercial parcel has comBldgYearBuiltFrom, not resBldgYearBuiltFrom')
        .toMatch(/year_built:\s*yearOrNull\(r\.resBldgYearBuiltFrom\)\s*\?\?\s*yearOrNull\(r\.comBldgYearBuiltFrom\)/);
    });

    test('square footage falls back to the commercial field', () => {
      expect(fn()).toMatch(/sqft:\s*intOrNull\(r\.resBldgTotalArea\)\s*\?\?\s*intOrNull\(r\.comBldgTotalArea\)/);
    });

    test('?? and not ||, so a genuine zero is not read as missing', () => {
      // yearOrNull already rejects a placeholder year, so the only thing || would
      // add here is swallowing a real 0 sqft. ?? falls through on null alone.
      const s = fn();
      expect(s, 'resBldg values must fall through on null, never on falsy')
        .not.toMatch(/resBldg(YearBuiltFrom|TotalArea)\)\s*\|\|/);
    });

    test('the county classification is captured and persisted', () => {
      const s = fn();
      expect(s, 'the appraiser already says what the building is').toMatch(/use_desc:\s*r\.functionCodeDescription/);
      expect(s, 'and what class it is').toMatch(/property_type:\s*r\.propertyType/);
      // Parsed but never written is the same as never parsed.
      expect(s, 'cacheBack must persist property_type').toMatch(/property_type:\s*out\.property_type/);
      expect(s, 'cacheBack must persist use_desc').toMatch(/use_desc:\s*out\.use_desc/);
    });

    test('the lookup hands both new columns back', () => {
      // A column property_lookup does not name is a column the app can never
      // read, however well the loader fills it.
      const m = readSrc('supabase/migrations/20261034_county_commercial_and_deep_link.sql');
      expect(m).toMatch(/property_type\s+text/);
      expect(m).toMatch(/use_desc\s+text/);
      expect(m, 'the select list has to carry them too').toMatch(/p\.owner_name,\s*p\.property_type,\s*p\.use_desc/);
    });

    test('the county keeps its own word for the use, apart from the contractor\'s', () => {
      // propertyType is set by hand and drives isRental and the card icon.
      // Overwriting it with "Commercial" would silently re-type a property
      // somebody already classified themselves.
      const c = readSrc('js/clients.js');
      expect(c).toMatch(/pd\.propDataUse\s*=/);
      expect(c, 'the county must never write the contractor-owned field')
        .not.toMatch(/pd\.propertyType\s*=\s*d\.(property_type|use_desc)/);
      expect(readSrc('js/data.js'), 'and it has to survive a save').toMatch(/'propDataUse'/);
    });
  });

  // ── THE RECORD LINK HAS TO LAND ON THE RECORD ────────────────────────────
  // Owner, same message: "linking to the records doesnt take you right to the
  // address, takes us to the search page." It did, because source_url was the
  // county root, identical on every row.
  test.describe('the county record link', () => {
    test('it is built per parcel, not taken from the county config', () => {
      const s = readSrc(FN);
      expect(s, 'sourceUrl must be a function of the street').toMatch(/sourceUrl:\s*\(street:\s*string\)\s*=>/);
      expect(s, 'and the response must use it').toMatch(/source_url:\s*enricher\.sourceUrl\(street\)/);
      expect(s, 'a bare county root on every row is the bug this replaced')
        .not.toMatch(/sourceUrl:\s*"https:\/\/ares\.sncoapps\.us\/"/);
    });

    test('it carries the address the contractor is looking at', () => {
      const s = readSrc(FN);
      expect(s).toMatch(/searchCriteria:\s*street/);
    });

    test('rows loaded before the fix are backfilled, and only those', () => {
      const m = readSrc('supabase/migrations/20261034_county_commercial_and_deep_link.sql');
      expect(m).toMatch(/update td_county_parcels/);
      // A county whose deep link IS per-parcel must never be flattened by this.
      expect(m, 'only rows still carrying the old root may be rewritten')
        .toMatch(/source_url is null or source_url = 'https:\/\/ares\.sncoapps\.us\/'/);
    });

    test('the commercial parcels are released for one more ask, houses are not', () => {
      // They were retired as 'empty' because the answer had no year, which was
      // true of the answer and false of the county. A house the county has no
      // record of is still a house the county has no record of.
      const m = readSrc('supabase/migrations/20261034_county_commercial_and_deep_link.sql');
      expect(m).toMatch(/delete from td_county_asks/);
      expect(m, 'only rows the county actually answered about').toMatch(/assessed_value is not null/);
      expect(m).toMatch(/year_built is null/);
    });
  });

  // ── WE ONLY GET TO ASK ONCE, SO KEEP THE WHOLE ANSWER ────────────────────
  //
  // Owner, 2026-09-22: "I want all facts we can pull that would increase the
  // potential for selling" and "if it can feed my guy tim, I want it."
  //
  // county_claim_ask is what makes this a correctness rule rather than a
  // preference: an address is contacted ONCE, EVER, so a field the parse drops
  // is a field that cannot be recovered without re-asking the whole county,
  // which is the exact behaviour the gate exists to prevent. We were reading
  // nine fields out of a fifty-six field response.
  test.describe('the whole county answer is captured', () => {
    const fn = () => readSrc(FN);
    const MIG35 = 'supabase/migrations/20261035_county_capture_everything.sql';

    test('the raw response is kept verbatim, per source', () => {
      const s = fn();
      expect(s, 'the appraiser row').toMatch(/_raw_building:\s*r,/);
      expect(s, 'the parcel row').toMatch(/_raw_parcel:\s*a,/);
      expect(s, 'and both are folded into one jsonb column').toMatch(/building:\s*out\._raw_building/);
      expect(readSrc(MIG35), 'which has to exist').toMatch(/add column if not exists raw\s+jsonb/);
    });

    test('the raw blobs never reach the browser', () => {
      // Tens of kilobytes of county bookkeeping the card never reads, on every
      // saved address, on a phone.
      expect(fn()).toMatch(/delete out\._raw_building;\s*delete out\._raw_parcel;/);
    });

    test('the raw keys can never land as columns', () => {
      // They are stripped from the patch before the upsert; an _raw_ key
      // reaching the table would fail the write for every address.
      const s = fn();
      expect(s).toMatch(/if \(raw\) patch\.raw = raw;/);
      expect(s, 'the patch must be built from named fields, never spread from out')
        .not.toMatch(/const patch: Record<string, unknown> = \{\s*\.\.\.out/);
    });

    test('every sell-relevant field the county publishes is parsed', () => {
      const s = fn();
      for (const f of ['year_built_to', 'parcel_number', 'deed_book_page', 'building_count',
                       'living_units', 'frontage_ft', 'depth_ft', 'basement_desc',
                       'subdivision', 'neighborhood', 'school_district', 'land_sqft']) {
        expect(s, `${f} must be parsed`).toMatch(new RegExp(`${f}:`));
        expect(s, `${f} must be persisted`).toMatch(new RegExp(`${f}: out\\.${f}`));
      }
    });

    test('building_count sums every structure type, not just houses', () => {
      // A detached garage or a second building is scope nobody quoted.
      const s = fn();
      expect(s).toMatch(/resBldgCount[\s\S]{0,80}comBldgCount[\s\S]{0,80}mhCount/);
    });

    test('the lookup hands every new column back', () => {
      // Third time this has had to be written: a column property_lookup does
      // not name is a column the app can never read.
      const m = readSrc(MIG35);
      for (const f of ['year_built_to', 'parcel_number', 'deed_book_page', 'building_count',
                       'living_units', 'frontage_ft', 'depth_ft', 'basement_desc',
                       'subdivision', 'neighborhood', 'school_district', 'land_sqft']) {
        expect(m, `${f} must be in the returns-table`).toMatch(new RegExp(`${f}\\s+(int|text|numeric)`));
        expect(m, `${f} must be in the select list`).toMatch(new RegExp(`p\\.${f}`));
      }
    });
  });

  // ── §18: ONE DEFINITION PER FACT, AND ONLY ONE ───────────────────────────
  // ops_account_brief shipped with its metrics written out twice and adding one
  // meant editing both in agreement forever. The same trap opens here the
  // moment two readers want these fields, and there are already two: the
  // property card and Tim.
  test.describe('the county field registry', () => {
    const MIG35 = 'supabase/migrations/20261035_county_capture_everything.sql';

    test('it names every fact once, with a label and a format', () => {
      const m = readSrc(MIG35);
      expect(m).toMatch(/create or replace function public\.county_field_defs\(\)/);
      expect(m, 'label, format, and whether Tim should say it unprompted')
        .toMatch(/key\s+text,[\s\S]{0,120}label\s+text,[\s\S]{0,120}fmt\s+text,[\s\S]{0,120}sell\s+boolean/);
    });

    test('it is readable by any signed-in contractor, not just ops', () => {
      // These describe PUBLIC records and every contractor's own property card
      // reads them. Gating it on ops admin would make the card unrenderable.
      expect(readSrc(MIG35)).toMatch(/grant execute on function public\.county_field_defs\(\) to authenticated/);
    });

    test('every registry key is a real column or a real parse field', () => {
      // A row for a field nothing produces is a label nobody can ever fill.
      const m = readSrc(MIG35);
      const keys = [...m.matchAll(/^\s*\('([a-z_]+)',\s*'[^']*',\s*'[a-z]+',/gm)].map((x) => x[1]);
      expect(keys.length, 'the registry must not be empty').toBeGreaterThan(15);
      const known = readSrc(FN) + m + readSrc('supabase/migrations/20261032_county_parcels.sql')
        + readSrc('supabase/migrations/20261034_county_commercial_and_deep_link.sql');
      for (const k of keys) expect(known, `${k} is named in the registry but produced nowhere`).toContain(k);
    });

    test('no JS file hardcodes a county field label or format', () => {
      // The whole point of the registry. The moment a reader hardcodes "frontage
      // is feet", it is two places again and they drift.
      const m = readSrc(MIG35);
      const labels = [...m.matchAll(/^\s*\('[a-z_]+',\s*'([^']{3,})',\s*'[a-z]+',/gm)].map((x) => x[1]);
      const js = ['js/tim.js', 'js/ops-view.js'].filter((f) => fs.existsSync(repo(f))).map(readSrc).join('\n');
      for (const L of labels) {
        expect(js, `"${L}" must come from county_field_defs(), not a literal`).not.toContain(`'${L}'`);
      }
    });
  });

  test.describe('county configs', () => {
    const dir = repo('scripts/counties');
    const names = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

    test('at least one county ships', () => {
      expect(names.length).toBeGreaterThan(0);
    });

    for (const file of names) {
      test(`${file} is complete and internally consistent`, () => {
        const cfg = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));

        // FIPS is the routing key and the unit a reload replaces. Five digits,
        // state 2 + county 3, and it is NOT the same as a state's own county
        // numbering (Shawnee is FIPS 20177 and ARES countyCode 089).
        expect(cfg.county_fips, `${file}: county_fips must be 5 digits`).toMatch(/^\d{5}$/);
        expect(cfg.state).toMatch(/^[A-Z]{2}$/);
        expect(cfg.county_name, `${file}: needs a county_name`).toBeTruthy();
        expect(cfg.source, `${file}: needs a source to attribute the data to`).toBeTruthy();

        // The bulk source has to name a street field, because a parcel row with
        // no address can never be matched to a client and is dead weight.
        expect(cfg.bulk, `${file}: needs a bulk source`).toBeTruthy();
        expect(cfg.bulk.kind).toBeTruthy();
        expect(cfg.bulk.url).toMatch(/^https:\/\//);
        expect(cfg.bulk.fields && cfg.bulk.fields.street, `${file}: bulk.fields.street is required`).toBeTruthy();
        // parcel_id is the upsert key. Without it a yearly reload duplicates the
        // whole county instead of updating it.
        expect(cfg.bulk.fields.parcel_id, `${file}: bulk.fields.parcel_id is required for upsert`).toBeTruthy();

        // A county claiming to publish year built must say where it comes from,
        // or the card will promise a field nothing ever fills.
        if (cfg.publishes && cfg.publishes.year_built) {
          const fromBulk = !!(cfg.bulk.fields.year_built);
          const fromEnrich = !!(cfg.enrich && cfg.enrich.fields && cfg.enrich.fields.year_built);
          expect(fromBulk || fromEnrich,
            `${file}: publishes.year_built is true but no bulk or enrich field provides it`).toBe(true);
        }

        if (cfg.enrich) {
          expect(cfg.enrich.url).toMatch(/^https:\/\//);
          expect(cfg.enrich.kind).toBeTruthy();
        }

        (cfg.zips || []).forEach((z) => {
          expect(z, `${file}: "${z}" is not a 5-digit zip`).toMatch(/^\d{5}$/);
        });
      });
    }

    test('no two counties claim the same FIPS', () => {
      const seen = {};
      names.forEach((f) => {
        const { county_fips: fips } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        expect(seen[fips], `${f} and ${seen[fips]} both claim FIPS ${fips}`).toBeUndefined();
        seen[fips] = f;
      });
    });
  });

  // ── The loader is polite ─────────────────────────────────────────────────
  // Not a nicety. These are small county servers with no rate limiting and no
  // commercial interest in us. An admin who sees an anonymous client hammering
  // the appraiser search blocks the range and never tells anybody, and we would
  // find out when a contractor's property card went blank.
  test.describe('county loader manners', () => {
    const src = () => readSrc('scripts/county-load.js');

    test('it identifies itself with a contactable User-Agent', () => {
      const ua = src().match(/const UA = '([^']+)'/);
      expect(ua, 'the loader must set a User-Agent').toBeTruthy();
      expect(ua[1]).toMatch(/TradeDesk/);
      expect(ua[1], 'the UA must carry a URL a county admin can follow').toMatch(/https?:\/\//);
    });

    test('it pauses between requests by default', () => {
      expect(src()).toMatch(/intArg\('--pause',\s*(\d+)\)/);
      const ms = parseInt(src().match(/intArg\('--pause',\s*(\d+)\)/)[1], 10);
      expect(ms, 'the default pause must be a real pause').toBeGreaterThanOrEqual(100);
    });

    test('a placeholder year is never treated as a real one', () => {
      // 0 and 1900 are what CAMA systems store for "we do not know". Passing
      // either through would arm or disarm the pre-1978 lead gate on a guess.
      const fn = src().match(/function cleanYear[\s\S]*?\n}/);
      expect(fn, 'cleanYear must exist').toBeTruthy();
      expect(fn[0]).toMatch(/n < 1700/);
    });

    // ── Human pacing ───────────────────────────────────────────────────────
    // Owner, 2026-09-22: "I want every single one to load itself in, not all at
    // once but a slow human style lookup so we don't get our shit blocked."
    //
    // What gets a range blocked is the RATE and the REGULARITY, not the total.
    // 77,006 addresses at the old flat 250ms is 5.3 hours of perfectly
    // metronomic requests, four a second, and no person has ever done that.
    // These assertions are the difference between a drip that reads as a title
    // clerk's afternoon and one that reads as a scraper.
    test('the per-address gap is randomized, never a fixed interval', () => {
      const fn = src().match(/function humanGapMs\(\)[\s\S]*?\n}/);
      expect(fn, 'humanGapMs must exist').toBeTruthy();
      // Drawn fresh every time. A constant, or a counter, would give the
      // sequence a period, and a period is what a log review finds.
      expect(fn[0]).toMatch(/Math\.random\(\)/);
    });

    test('the gap distribution is human-shaped, measured not asserted', () => {
      // eslint-disable-next-line no-eval
      const humanGapMs = eval(`(${src().match(/function humanGapMs\(\)[\s\S]*?\n}/)[0]})`);
      const g = Array.from({ length: 20000 }, () => humanGapMs() / 1000);
      const mean = g.reduce((a, b) => a + b, 0) / g.length;

      // Never faster than a person could plausibly click.
      expect(Math.min(...g), 'no gap may be under ten seconds').toBeGreaterThanOrEqual(10);
      // And not so slow the county never finishes.
      expect(mean, 'mean gap should sit in the tens of seconds').toBeGreaterThan(30);
      expect(mean, 'mean gap should sit in the tens of seconds').toBeLessThan(120);
      // The long tail is the "got up and did something else" break. Without it
      // the sequence is uniform, which is its own kind of tell.
      const longBreaks = g.filter((s) => s > 90).length / g.length;
      expect(longBreaks, 'roughly one gap in ten is a real break').toBeGreaterThan(0.03);
      expect(longBreaks, 'but breaks must not dominate').toBeLessThan(0.25);
      // Spread, not a metronome with noise: the middle half of the draws must
      // actually span a range.
      const sorted = g.slice().sort((a, b) => a - b);
      const iqr = sorted[Math.floor(g.length * 0.75)] - sorted[Math.floor(g.length * 0.25)];
      expect(iqr, 'the interquartile spread must be seconds wide, not milliseconds').toBeGreaterThan(10);
    });

    test('the drip refuses to work overnight', () => {
      // Traffic that only ever arrives in office hours reads as office traffic.
      // A request at 4am from the same client every night does not.
      const fn = src().match(/function withinWorkingHours[\s\S]*?\n}/);
      expect(fn, 'withinWorkingHours must exist').toBeTruthy();
      // eslint-disable-next-line no-eval
      const within = eval(`(() => { const HOUR_START = 7, HOUR_END = 21; return ${fn[0].replace(/^function /, 'function ')} })()`);
      const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return within(d); };
      expect(at(3), '3am must be idle').toBe(false);
      expect(at(6), '6am must be idle').toBe(false);
      expect(at(12), 'midday must work').toBe(true);
      expect(at(20), '8pm must work').toBe(true);
      expect(at(23), '11pm must be idle').toBe(false);
    });

    test('a visit is time-boxed, so a manual batch cannot run away', () => {
      // --enrich is a bounded manual backfill now, not a standing drip. The
      // clock bound is what keeps a hand-run batch from becoming an all-day
      // session against a county server.
      expect(src()).toMatch(/MAX_MIN && \(Date\.now\(\) - startedAt\) > MAX_MIN \* 60000/);
      const wf = readSrc('.github/workflows/county-load.yml');
      expect(wf, 'the workflow must pace and bound its enrich mode').toMatch(/--human/);
      expect(wf).toMatch(/--max-minutes\s+\d+/);
    });

    test('there is no standing drip installed anywhere', () => {
      // Owner, 2026-09-22: "We're not loading all of Shawnee county, we're just
      // bringing them in when a address is saved." The systemd drip that would
      // have walked all 77,006 parcels is deleted, not disabled (§7), and §7.1
      // wants CI to prove the entry point is gone rather than merely unused.
      for (const f of [
        'scripts/county-drip.service',
        'scripts/county-drip.timer',
        'scripts/setup-county-drip.sh',
      ]) {
        expect(fs.existsSync(repo(f)), `${f} must be deleted`).toBe(false);
      }
      for (const f of ['js/clients.js', 'js/cloud.js', 'js/mileage.js', FN]) {
        expect(readSrc(f), `${f} must not reference a drip`).not.toMatch(/county-drip/);
      }
    });

    test('--print and --dry-run never need a credential', () => {
      // Checking a new county's field map has to be runnable before any secret
      // exists, or the first step of onboarding a county is blocked on the last.
      expect(src()).toMatch(/if \(!DRY_RUN && !PRINT\)/);
    });
  });
});
