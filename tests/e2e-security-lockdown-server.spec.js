// @ts-check
/**
 * SECURITY LOCKDOWN (20261049), static half.
 *
 * The behaviour half runs in the Migration lint job
 * (scripts/ci/security-lockdown.sql): it applies every migration to a real
 * Postgres and tries each closed door as a browser role would. This file pins
 * the SHAPE, in the same way tests/e2e-rls-policies.spec.js pins the ::text
 * casts: the migration still closes what it closed, the edge functions still
 * check what they check, and the public pages no longer use the doors that
 * were removed (CLAUDE.md 3.1: a removed path must be switched in the same PR
 * and must fail closed).
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const MIG = read('supabase/migrations/20261049_security_lockdown.sql');
// Comments say what was removed and why; the checks below are about code.
const SQL = MIG.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const fn = (name) => read(`supabase/functions/${name}/index.ts`);

test.describe('20261049 security lockdown: the migration', () => {
  test('one file on this version, sorted where Supabase expects it', () => {
    const files = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => f.startsWith('20261049_'));
    expect(files).toEqual(['20261049_security_lockdown.sql']);
  });

  test('C1: users.account_id and role are frozen by a trigger, not a column grant', () => {
    expect(SQL).toMatch(/create trigger users_guard before insert or update on public\.users/);
    expect(SQL).toMatch(/account_id cannot be moved/);
    expect(SQL).toMatch(/only the server changes id or role/);
    expect(SQL).toMatch(/create trigger accounts_guard before insert or update on public\.accounts/);
  });

  test('C1: account, membership and config writes belong to the real owner', () => {
    for (const p of ['accounts_update', 'account_users_insert', 'config_insert', 'config_update', 'Account owner manages config']) {
      expect(SQL, p + ' is dropped').toContain(`drop policy if exists "${p}"`);
    }
    // The owner update policies now carry a WITH CHECK (they had none).
    expect(SQL).toMatch(/"Owner updates memberships"[\s\S]*?with check \(public\._td_account_owner\(account_id\) = auth\.uid\(\)::text\)/);
    expect(SQL).toMatch(/"Account owner can update"[\s\S]*?with check \(owner_id::text = auth\.uid\(\)::text\)/);
  });

  test('C1 + C4: payout settings and is_dev are the server\'s alone', () => {
    expect(SQL).toMatch(/create trigger account_config_guard before insert or update on public\.account_config/);
    for (const col of ['is_dev', 'stripe_account_id', 'stripe_connect_enabled']) {
      expect(SQL, col + ' is guarded').toMatch(new RegExp(`to_jsonb\\(new\\)->>'${col}'`));
    }
    expect(SQL).toMatch(/if public\._td_is_trusted\(\) then return new; end if;/);
  });

  test('C2: anon has no table access to signed_proposals; reads need the link', () => {
    for (const p of ['anon_select', 'anon_update_by_token', 'anon_insert', 'auth_insert']) {
      expect(SQL, p + ' is dropped').toContain(`drop policy if exists "${p}" on public.signed_proposals`);
    }
    expect(SQL).toContain('revoke all on public.signed_proposals from anon');
    expect(SQL).toMatch(/function public\.proposal_sign_status\(p_key text\)[\s\S]*?_td_object_exists\('proposals', p_key\)/);
    expect(SQL).toMatch(/function public\.hub_signed_proposals[\s\S]*?_td_object_exists\('proposals', 'client-hub\/'/);
    // The hub read never hands back Stripe ids, IPs or notify addresses.
    const hub = SQL.slice(SQL.indexOf('function public.hub_signed_proposals'), SQL.indexOf('$$;', SQL.indexOf('function public.hub_signed_proposals')));
    for (const secret of ['stripe_payment_intent', 'ip_address', 'user_agent', 'notify_email', 'signing_token']) {
      expect(hub, secret + ' stays server-side').not.toContain(secret);
    }
  });

  test('C3 + C6: _lad_table and geo_fences_for are closed to every browser role', () => {
    expect(SQL).toContain('revoke execute on function public._lad_table(uuid, text, text[]) from public, anon, authenticated');
    expect(SQL).toContain('revoke execute on function public.geo_fences_for(uuid, date) from public, anon, authenticated');
    expect(SQL).toContain('grant execute on function public.geo_fences_for(uuid, date) to service_role');
  });

  test('C4 + M4: dev_support and the hardcoded-Gmail policies are gone', () => {
    expect(SQL).toMatch(/policyname in \('dev_support', 'dev_support_read', 'dev_support_write'\)/);
    expect(SQL).toMatch(/policyname = 'dev_full_access_receipts'/);
    expect(SQL, 'no policy in this file names an email').not.toMatch(/@gmail\.com/);
  });

  test('C5: storage has no anonymous list or overwrite; owners write their own folder', () => {
    for (const p of ['anon_read_proposals', 'anon_upsert_proposal_json', 'anon_update_proposal_json', 'Public can read proposals', 'auth_rw_proposals', 'auth_rw_gallery', 'anon_read_gallery']) {
      expect(SQL, p + ' is dropped').toContain(`'${p}'`);
    }
    const creates = SQL.match(/create policy "td_[a-z_]+" on storage\.objects[^;]*/g) || [];
    expect(creates.length).toBe(5);
    // The only policy that reaches anon is the insert-only client upload.
    const anon = creates.filter((c) => /to anon/.test(c));
    expect(anon.length).toBe(1);
    expect(anon[0]).toMatch(/for insert/);
    expect(anon[0]).toMatch(/_td_hub_exists/);
    expect(SQL).toMatch(/set allowed_mime_types = array\['image\/jpeg'/);
    expect(SQL, 'no SVG in the gallery').not.toMatch(/image\/svg/);
  });

  test('H3: get_hub_proposal_statuses answers only the contractor, never anon', () => {
    expect(SQL).toMatch(/get_hub_proposal_statuses[\s\S]*?p_contractor_user_id::text = auth\.uid\(\)::text/);
    expect(SQL).toContain('revoke execute on function public.get_hub_proposal_statuses(uuid, text[]) from public, anon');
  });

  test('H4: no email-only join; the invite token binds to the invited address', () => {
    expect(SQL).toContain('drop policy if exists "employee_claim_invite" on public.team_members');
    expect(SQL).toMatch(/function public\.claim_crew_by_email\(\)[\s\S]*?'invite_required'/);
    expect(SQL).toMatch(/function public\.claim_crew_invite\(tok uuid\)[\s\S]*?'email_mismatch'/);
  });

  test('H5: remove_crew_member deactivates the seat and deletes memberships, owner or co-owner only', () => {
    const body = SQL.slice(SQL.indexOf('function public.remove_crew_member'));
    expect(body).toMatch(/update team_members set active = false where id = tm\.id/);
    expect(body).toMatch(/delete from account_users where account_id = acct/);
    expect(body).toMatch(/public\.is_co_owner\(tm\.contractor_user_id\)/);
    expect(SQL).toContain('revoke execute on function public.remove_crew_member(uuid, text, uuid) from public, anon');
  });

  test('H6: the approve token lives where no browser can read it, and decide requires it', () => {
    expect(SQL).toMatch(/create table if not exists public\.td_timesheet_approvers/);
    expect(SQL).toContain('revoke all on public.td_timesheet_approvers from anon, authenticated');
    const decide = SQL.slice(SQL.indexOf('function public.timesheet_decide'));
    expect(decide).toMatch(/from td_timesheet_approvers a join td_timesheets t/);
    expect(decide).toMatch(/you cannot approve your own timesheet/);
    expect(SQL, 'timesheet_submit is not redefined: the worker still only gets the view token').not.toMatch(/function public\.timesheet_submit/);
  });

  test('H7: payout changes are logged by triggers the browser cannot skip', () => {
    expect(SQL).toMatch(/create trigger zj_data_payout_audit after update of settings on public\.zj_data/);
    expect(SQL).toMatch(/create trigger account_config_payout_audit after update of stripe_account_id/);
    expect(SQL).toContain('revoke all on public.payout_change_log from anon, authenticated');
  });

  test('M1: definer views are invoker views and closed to anon; intake has a one-row RPC', () => {
    expect(SQL).toContain("alter view public.account_public set (security_invoker = true)");
    expect(SQL).toContain('revoke all on public.account_public from anon');
    expect(SQL).toContain("alter view public.v_derive_correction set (security_invoker = true)");
    expect(SQL).toMatch(/function public\.account_public_card\(p_id uuid\)/);
  });

  test('M2: anon loses every definer function except the signed-out pages\' own', () => {
    expect(SQL).toMatch(/p\.proname not in \('check_login_methods', 'timesheet_public', 'timesheet_decide',/);
    expect(SQL).toMatch(/had_auth := has_function_privilege\('authenticated', r\.oid, 'EXECUTE'\)/);
    for (const f of ['county_field_defs', 'geo_street_line', 'get_account_delta', 'td_addr_key', 'timesheet_window']) {
      expect(SQL, f + ' gets a pinned search_path').toContain(`'${f}'`);
    }
  });
});

test.describe('20261049 security lockdown: edge functions', () => {
  test('proposal-sign proves the link and takes money fields from the stored proposal', () => {
    const src = fn('proposal-sign');
    expect(src).toMatch(/parseProposalKey\(body\.key\)/);
    expect(src).toMatch(/const prop = await readJson\(pk\.key\)/);
    expect(src).toMatch(/Number\(prop\.discountedPrice\)/);
    expect(src, 'the amount is never read from the request').not.toMatch(/body\.amount|body\.deposit/);
    expect(src).toMatch(/hubKey\(body\.u, body\.c, body\.t\)/);
  });

  test('proposal-sign takes one change after signing: Pay Later to the method picked, on the same link', () => {
    // sign.html saves the signature the moment he signs, as Pay Later (Earl
    // audit 2026-09-27), and sends the method once he picks it. That second
    // call may change the method and nothing else, and only from Pay Later,
    // only while unpaid, only on the link that signed.
    const src = fn('proposal-sign');
    const block = src.slice(src.indexOf("if (state === 'signed') {"), src.indexOf("const portfolio ="));
    expect(block).toMatch(/existing\.payment_method === 'later' && existing\.payment_status === 'pending_later'/);
    expect(block).toMatch(/existing\.signing_token === pk\.token/);
    expect(block, 'the update is guarded in the database too, so a race cannot overwrite a paid row')
      .toMatch(/\.eq\('payment_method', 'later'\)\.eq\('payment_status', 'pending_later'\)/);
    expect(block, 'only the method changes').toMatch(/\.update\(\{ payment_method: method, payment_status: 'pending_' \+ method \}\)/);
    expect((block.match(/\.update\(/g) || []).length, 'that one update is the only write: signature, name, amount and time stay as first written').toBe(1);
    expect(block, 'a second signature is still refused').toMatch(/alreadySigned: true/);
    expect(block, 'the signing token never goes back to the page').not.toMatch(/row: existing\b/);
  });

  test('sign.html has no direct write to signed_proposals, early save included', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'sign.html'), 'utf8');
    expect(html).not.toMatch(/from\('signed_proposals'\)\.(upsert|insert|update)/);
    expect(html).toMatch(/_earlySigSave=_saveSignature\('later'\)/);
    expect(html).toMatch(/await _signCall\(\{action:'sign',key,signerName:name,method,/);
  });

  test('create-checkout refuses a payment that names no proposal, and trusts only stored values', () => {
    const src = fn('create-checkout');
    expect(src).toMatch(/missing its proposal/);
    expect(src).toMatch(/contractorUserId = String\(stored\.contractorUserId/);
    expect(src, 'the contractor is never taken from the request').not.toMatch(/contractorUserId,\s*notifyEmail,\s*\n?\s*signatureDataUrl/);
    expect(src).toMatch(/const safeUrl = /);
  });

  test('stripe-webhook keeps the EPA and senior flags the card path used to write from the browser', () => {
    const src = fn('stripe-webhook');
    expect(src).toMatch(/meta\.epa === '1'/);
    expect(src).toMatch(/meta\.senior === '1'/);
  });

  test('H1: slack-notify refuses a caller without the shared secret or service role', () => {
    const src = fn('slack-notify');
    expect(src).toMatch(/if \(!authorized\(req\)\) return json\(\{ ok: false, error: "unauthorized" \}, 401\)/);
    expect(src).toMatch(/x-slack-notify-secret/);
  });

  test('H2: invite and proposal emails rebuild the link, name the business themselves, and cap per day', () => {
    for (const name of ['send-invite-email', 'send-proposal-email']) {
      const src = fn(name);
      expect(src, name + ' reads the business from the account').toMatch(/businessFor\(svc, caller\.id\)/);
      expect(src, name + ' caps per day').toMatch(/underDailyCap\(svc, caller\.id/);
      expect(src, name + ' never takes businessName from the request').not.toMatch(/body\.businessName|businessName\s*\}\s*=\s*body/);
    }
    expect(fn('send-proposal-email')).toMatch(/rebuildClientLink\(svc, caller\.id, body\.proposalUrl\)/);
    expect(fn('send-invite-email')).toMatch(/verifiedInvite\(caller\.id, body\.inviteUrl/);
  });

  test('H6: timesheet-notify emails the approve link to the owner, never back to the worker', () => {
    const src = fn('timesheet-notify');
    expect(src).toMatch(/getUserById\(String\(ts\.contractor_user_id\)\)/);
    expect(src).toMatch(/\.eq\('employee_user_id', caller\.id\)/);
    expect(src, 'the approve token is never in the reply').not.toMatch(/json\(\{[^}]*token/);
  });

  test('M3: ingest-telemetry caps and dedupes errors, and only a fresh message wakes the hotfix lane', () => {
    const src = fn('ingest-telemetry');
    expect(src).toMatch(/ERR_CAP_PER_HOUR/);
    expect(src).toMatch(/if \(seen\.has\(k\)\) continue;/);
    expect(src).toMatch(/errCount > 0 && freshMessage && GH_DISPATCH_TOKEN/);
  });

  test('new public functions are registered without gateway JWT checks, like their peers', () => {
    const cfg = read('supabase/config.toml');
    expect(cfg).toMatch(/\[functions\.proposal-sign\]\nverify_jwt = false/);
    expect(cfg).toMatch(/\[functions\.payout-alert\]\nverify_jwt = false/);
  });
});

test.describe('20261049 security lockdown: the pages moved off the closed doors', () => {
  test('sign.html and client.html never touch signed_proposals directly', () => {
    for (const f of ['sign.html', 'client.html']) {
      expect(read(f), f).not.toMatch(/from\('signed_proposals'\)/);
    }
    expect(read('sign.html')).toMatch(/rpc\('proposal_sign_status',\{p_key:key\}\)/);
    expect(read('client.html')).toMatch(/rpc\('hub_signed_proposals'/);
  });

  test('no public page writes the proposal bucket except a client upload, which never overwrites', () => {
    expect(read('sign.html')).not.toMatch(/storage\.from\('proposals'\)\.upload/);
    expect(read('contract-sign.html')).not.toMatch(/storage\.from\('proposals'\)\.upload/);
    const hubUploads = read('client.html').match(/storage\.from\('proposals'\)\.upload\([^)]*\)/g) || [];
    expect(hubUploads.length).toBe(2);
    for (const u of hubUploads) expect(u).toContain('upsert:false');
  });

  test('intake.html reads one business through account_public_card', () => {
    const src = read('intake.html');
    expect(src).toMatch(/rpc\('account_public_card',\{p_id:ACCOUNT_ID\}\)/);
    expect(src).not.toMatch(/from\('account_public'\)/);
  });

  test('the app no longer joins a crew by email alone', () => {
    const src = read('js/cloud.js');
    expect(src).not.toMatch(/rpc\('claim_crew_by_email'\)/);
    expect(src).not.toMatch(/\.update\(\{employee_user_id:_supaUser\.id/);
  });

  test('the texted timesheet link is for reading; approving is emailed to the owner', () => {
    const src = read('js/timesheet.js');
    expect(src).toMatch(/functions\.invoke\('timesheet-notify'/);
    expect(src).not.toMatch(/Tap to review and approve/);
    expect(read('js/timesheet-public.js')).toMatch(/d\.can_decide===false/);
  });

  test('nothing this change added carries an em dash', () => {
    const files = ['supabase/migrations/20261049_security_lockdown.sql', 'scripts/ci/security-lockdown.sql',
      'supabase/functions/proposal-sign/index.ts', 'supabase/functions/timesheet-notify/index.ts',
      'supabase/functions/payout-alert/index.ts', 'supabase/functions/_shared/links.ts', 'supabase/functions/_shared/mail-guard.ts'];
    for (const f of files) expect(read(f), f).not.toContain(String.fromCharCode(0x2014));
  });
});
