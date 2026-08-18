// @ts-check
// ── TEST FLEET SEEDER (owner ask 2026-08-18) ─────────────────────────────────
//
// "Spin up test users where we can have 25 different test accounts linked to
// each other with different things but not need separate emails for each."
//
// Every persona is a plus-alias of the ONE support inbox (see fleetAcct in
// live-helpers.js): distinct Supabase auth users, zero new mailboxes. This spec
// is IDEMPOTENT and on-demand: first run creates whatever is missing (auth user,
// business rows, crew links), later runs verify and no-op in seconds. Per §12.7
// the fleet persists forever, that is the point of it.
//
// NOT a measured flow: no step()/report(). This is pre-flight infrastructure
// (the same exception §12.1 grants signIn/resetLedger), driven through the
// app's own vendored supabase client + the SAME insert sequence obSubmit runs
// and the SAME team_members upsert the invite modal runs (§7.3: the seeder
// mirrors the app's real paths, keep them in lockstep if obSubmit changes).
//
// A DETACHED client (own storageKey, no persistence) does all the work, so the
// app booting alongside never sees these sign-ins and no auth state leaks into
// the page's real session storage.
//
// If the Dev project has signup email-confirmation ON, first-run personas land
// in "blocked" and this spec fails LOUDLY with the one-line SQL that confirms
// the whole fleet at once (or flip Confirm email off in Auth settings).
const { test, expect } = require('@playwright/test');
const { fleetAcct, needsLiveCreds } = require('./live-helpers');

// ── The topology: 25 personas, every archetype the app sells ────────────────
// owners: trade + business name.  crewOf: linked as crew onto those personas.
// A persona with BOTH is a dual-hat (§9.10). t19 stays deliberately empty
// (auth only), the "signed up and wandered off" edge every boot path must survive.
const FLEET = {
  t01: { trade: 'painting',    bname: 'Fleet Painting Co' },
  t02: { trade: 'plumbing',    bname: 'Big Sample Plumbing' },          // the "dad" archetype
  t03: { trade: 'electrical',  bname: 'Fleet Electric Co' },
  t04: { trade: 'hvac',        bname: 'Fleet Heating & Air' },
  t05: { trade: 'landscaping', bname: 'Fleet Landscapes' },
  t06: { trade: 'roofing',     bname: 'Fleet Roofing Co' },
  t07: { trade: 'general',     bname: 'Fleet General Contracting' },
  t08: { trade: 'landscaping', bname: 'Nightshift Lawns', crewOf: ['t02'] }, // the BIL archetype: plumber by day, landscaper by night
  t09: { crewOf: ['t01'] },
  t10: { crewOf: ['t02'] },
  t11: { crewOf: ['t01', 't03'] },                                      // multi-crew sub
  t12: { trade: 'painting', bname: 'Moonlight Painting', crewOf: ['t02', 't04'] }, // dual-hat + multi-crew
  t13: { crewOf: ['t03'] },
  t14: { crewOf: ['t04'] },
  t15: { crewOf: ['t05'] },
  t16: { crewOf: ['t06'] },
  t17: { crewOf: ['t07'] },
  t18: { trade: 'other',       bname: 'Fleet Handyman Services' },
  t19: {},                                                              // auth only, no business, no links
  t20: { trade: 'hvac',        bname: 'Afterhours Air', crewOf: ['t05'] },
  t21: { crewOf: ['t01'] },
  t22: { crewOf: ['t02'] },
  t23: { crewOf: ['t01'] },
  t24: { crewOf: ['t02'] },
  t25: { crewOf: ['t07'] },
};

test.describe('Fleet seed: 25 linked personas on one inbox', () => {
  test.skip(!needsLiveCreds(), 'live creds not configured');
  test.skip(!fleetAcct(1), 'fleet base account (DEV2 creds) not configured');

  test('every persona exists, owns what it should, and is linked where it should be', async ({ page }) => {
    test.setTimeout(1800000); // paced auth calls + 429 backoffs; steady-state re-runs finish in a few minutes
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => typeof supabase !== 'undefined' && typeof SUPA_URL !== 'undefined' && typeof SUPA_KEY !== 'undefined', { timeout: 30000 });

    const roster = {};
    for (const [tag, def] of Object.entries(FLEET)) roster[tag] = { ...def, ...fleetAcct(parseInt(tag.slice(1), 10)) };

    const out = await page.evaluate(async (ROSTER) => {
      const sb = supabase.createClient(SUPA_URL, SUPA_KEY, {
        auth: { storageKey: 'td-fleet-seed', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const report = { created: [], existed: [], businessMade: [], linked: [], alreadyLinked: [], blockedConfirm: [], badPassword: [], errors: [] };
      const uidOf = {};

      // Supabase's auth /token endpoint rate-limits per IP (learned live on the
      // first run: everything past persona ~18 got 429s). Two defenses: pace
      // every token call (~4s apart stays far under the bucket), and on a 429
      // back off a full minute and retry, the bucket is time-windowed, so
      // patience always wins on an on-demand seeder.
      const pace = (ms) => new Promise((r) => setTimeout(r, ms));
      const signIn = async (p) => {
        for (let attempt = 0; attempt < 4; attempt++) {
          await pace(attempt === 0 ? 4000 : 65000);
          const { data, error } = await sb.auth.signInWithPassword({ email: p.email, password: p.password });
          if (!error && data?.user) { uidOf[p.tag] = data.user.id; return { ok: true, user: data.user }; }
          if (!/rate limit/i.test(error?.message || '')) return { ok: false, error: error?.message || 'unknown' };
        }
        return { ok: false, error: 'rate limited after 4 paced attempts' };
      };

      // ── Pass 1: every persona has an auth user + (owners) a real business ──
      for (const p of Object.values(ROSTER)) {
        try {
          let s = await signIn(p);
          if (!s.ok && /invalid login credentials/i.test(s.error)) {
            const { data: su, error: se } = await sb.auth.signUp({ email: p.email, password: p.password });
            if (se) { report.errors.push(p.tag + ': signUp: ' + se.message); continue; }
            // Existing-user obfuscation: signUp "succeeds" with empty identities
            // when the email exists under a different password.
            if (su?.user && Array.isArray(su.user.identities) && su.user.identities.length === 0) {
              report.badPassword.push(p.tag + ' (' + p.email + ')'); continue;
            }
            s = await signIn(p);
            if (!s.ok && /confirm/i.test(s.error)) { report.blockedConfirm.push(p.tag + ' (' + p.email + ')'); continue; }
            if (!s.ok) { report.errors.push(p.tag + ': post-signup sign-in: ' + s.error); continue; }
            report.created.push(p.tag);
          } else if (!s.ok && /confirm/i.test(s.error)) {
            report.blockedConfirm.push(p.tag + ' (' + p.email + ')'); continue;
          } else if (!s.ok) {
            report.errors.push(p.tag + ': sign-in: ' + s.error); continue;
          } else {
            report.existed.push(p.tag);
          }
          // Owners: ensure the business rows exist. SAME sequence as obSubmit
          // (accounts → users → account_users → account_config), via the same
          // client library, RLS live.
          if (p.trade) {
            const uid = uidOf[p.tag];
            const { data: uRow } = await sb.from('users').select('account_id').eq('id', uid).maybeSingle();
            if (!uRow || !uRow.account_id) {
              const { data: acct, error: aErr } = await sb.from('accounts').insert({
                business_name: p.bname, phone: '', email: p.email, address: '', license_info: '', owner_id: uid, state: 'KS',
              }).select().maybeSingle();
              if (aErr || !acct) { report.errors.push(p.tag + ': accounts insert: ' + (aErr?.message || 'no row')); await sb.auth.signOut(); continue; }
              const { error: uErr } = await sb.from('users').insert({ id: uid, email: p.email, name: 'Fleet ' + p.tag.toUpperCase(), role: 'owner', account_id: acct.id, business_type: p.trade });
              if (uErr) report.errors.push(p.tag + ': users insert: ' + uErr.message);
              await sb.from('account_users').insert({ account_id: acct.id, user_id: uid, role: 'owner' });
              const baseCfg = (typeof BUSINESS_CONFIGS !== 'undefined' && (BUSINESS_CONFIGS[p.trade] || BUSINESS_CONFIGS.other)) || {};
              await sb.from('account_config').insert({ ...baseCfg, account_id: acct.id, business_type: p.trade, state: 'KS' });
              report.businessMade.push(p.tag);
            }
          }
          await sb.auth.signOut();
        } catch (e) { report.errors.push(p.tag + ': ' + (e?.message || String(e))); try { await sb.auth.signOut(); } catch (_e) {} }
      }

      // ── Pass 2: crew links, grouped to spend the fewest token calls. One
      // boss session upserts ALL its members' roster rows (the invite modal's
      // exact upsert), then one member session claims ALL its links (the same
      // SECURITY DEFINER claim_crew_by_email RPC loadAccountData's email-match
      // path uses). 7 boss sessions + ~14 member sessions instead of two
      // sign-ins per (member, boss) pair. ──
      const byBoss = {};
      for (const p of Object.values(ROSTER)) {
        if (!p.crewOf || !uidOf[p.tag]) continue;
        for (const bossTag of p.crewOf) (byBoss[bossTag] = byBoss[bossTag] || []).push(p);
      }
      const needsClaim = new Set();
      for (const [bossTag, members] of Object.entries(byBoss)) {
        const boss = ROSTER[bossTag];
        if (!boss || !uidOf[bossTag]) { report.errors.push('boss ' + bossTag + ' unavailable for links'); continue; }
        try {
          const bs = await signIn(boss);
          if (!bs.ok) { report.errors.push('boss ' + bossTag + ' sign-in: ' + bs.error); continue; }
          const bossUid = uidOf[bossTag];
          for (const p of members) {
            const { data: existing } = await sb.from('team_members').select('id,employee_user_id,active').eq('contractor_user_id', bossUid).eq('email', p.email).maybeSingle();
            if (existing && existing.employee_user_id && existing.active) { report.alreadyLinked.push(p.tag + '→' + bossTag); continue; }
            if (!existing) {
              const { error: tmErr } = await sb.from('team_members').upsert({
                contractor_user_id: bossUid, email: p.email, name: 'Fleet ' + p.tag.toUpperCase(), role: 'tech',
                permissions: {}, active: false, invited_at: new Date().toISOString(),
              }, { onConflict: 'contractor_user_id,email' });
              if (tmErr) { report.errors.push(p.tag + '→' + bossTag + ': team_members upsert: ' + tmErr.message); continue; }
            }
            needsClaim.add(p.tag);
          }
          await sb.auth.signOut();
        } catch (e) { report.errors.push('boss ' + bossTag + ': ' + (e?.message || String(e))); try { await sb.auth.signOut(); } catch (_e) {} }
      }
      for (const tag of needsClaim) {
        const p = ROSTER[tag];
        try {
          const ms = await signIn(p);
          if (!ms.ok) { report.errors.push(p.tag + ': member sign-in for claim: ' + ms.error); continue; }
          // Each RPC call links one unlinked row; loop caps at this persona's
          // own link count.
          for (let i = 0; i < p.crewOf.length + 1; i++) {
            const { data: cl, error: clErr } = await sb.rpc('claim_crew_by_email');
            if (clErr) { report.errors.push(p.tag + ': claim RPC: ' + clErr.message); break; }
            if (!cl || !cl.ok) break; // nothing left to claim
          }
          for (const bossTag of p.crewOf) {
            if (!uidOf[bossTag]) continue;
            const { data: verify } = await sb.from('team_members').select('id').eq('contractor_user_id', uidOf[bossTag]).eq('employee_user_id', uidOf[p.tag]).eq('active', true).maybeSingle();
            if (verify) report.linked.push(p.tag + '→' + bossTag);
            else report.errors.push(p.tag + '→' + bossTag + ': link did not verify after claim');
          }
          await sb.auth.signOut();
        } catch (e) { report.errors.push(p.tag + ': claim pass: ' + (e?.message || String(e))); try { await sb.auth.signOut(); } catch (_e) {} }
      }
      return report;
    }, roster);

    console.log('FLEET SEED REPORT');
    console.log('  created:        ' + (out.created.join(', ') || 'none (all existed)'));
    console.log('  existed:        ' + (out.existed.join(', ') || 'none'));
    console.log('  business made:  ' + (out.businessMade.join(', ') || 'none needed'));
    console.log('  linked:         ' + (out.linked.join(', ') || 'none new'));
    console.log('  already linked: ' + (out.alreadyLinked.join(', ') || 'none'));
    if (out.blockedConfirm.length) console.log('  BLOCKED (email confirm): ' + out.blockedConfirm.join(', '));
    if (out.badPassword.length) console.log('  BAD PASSWORD (exists under a different password): ' + out.badPassword.join(', '));
    if (out.errors.length) console.log('  ERRORS:\n    ' + out.errors.join('\n    '));

    expect(out.blockedConfirm.length,
      'Signup email confirmation is ON in this Supabase project. Either flip it off (Auth → Providers → Email → Confirm email) ' +
      'or run this SQL once to confirm the whole fleet: ' +
      "UPDATE auth.users SET email_confirmed_at = now() WHERE email LIKE '%+t__@%' AND email_confirmed_at IS NULL; " +
      'Blocked: ' + out.blockedConfirm.join(', ')
    ).toBe(0);
    expect(out.badPassword.length,
      'These fleet emails already exist under a DIFFERENT password (created outside the seeder?): ' + out.badPassword.join(', ')
    ).toBe(0);
    expect(out.errors, 'fleet seeding errors').toEqual([]);
  });
});
