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
      const src = readSrc('functions/api/property.js');
      // PROPERTY_TUNNEL_URL pointed at a cloudflared quick tunnel to the owner's
      // house. If this comes back, production property lookups depend on his
      // power and his ISP again.
      expect(src).not.toMatch(/PROPERTY_TUNNEL_URL/);
      expect(src).not.toMatch(/cfargotunnel/);
      // And it must not have quietly started scraping Zillow from the edge.
      expect(src).not.toMatch(/zillow\.com/i);
    });

    test('no source file still calls zillow for property data', () => {
      for (const f of ['js/clients.js', 'js/data.js', 'functions/api/property.js']) {
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

  // ── County configs ───────────────────────────────────────────────────────
  // Onboarding a county is meant to be a config file and nothing else. That only
  // stays true while the configs are actually complete, and the failure mode of
  // an incomplete one is a column of nulls rather than an error.
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

    test('--print and --dry-run never need a credential', () => {
      // Checking a new county's field map has to be runnable before any secret
      // exists, or the first step of onboarding a county is blocked on the last.
      expect(src()).toMatch(/if \(!DRY_RUN && !PRINT\)/);
    });
  });
});
