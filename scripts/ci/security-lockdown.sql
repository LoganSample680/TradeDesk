\set ON_ERROR_STOP on
-- ── The security lockdown holds (20261049) ──────────────────────────────────
--
-- A migration that CREATES a guard proves nothing about whether the guard
-- refuses anything. This calls each one the way an attacker would, as a
-- browser role (the request.jwt.claims PostgREST sets), and fails the job if
-- any door that was closed opens again. It runs as the lint job's superuser,
-- which bypasses RLS, on purpose: that isolates the TRIGGERS and the
-- definer functions, the parts that must hold no matter what a policy says.

create or replace function pg_temp.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
create or replace function pg_temp.as_server() returns void language sql as $$
  select set_config('request.jwt.claims', '{}', true);
$$;

do $$
declare
  victim   uuid := '51111111-1111-4111-8111-111111111111';
  attacker uuid := '52222222-2222-4222-8222-222222222222';
  crew     uuid := '53333333-3333-4333-8333-333333333333';
  va uuid := '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  aa uuid := '5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  tm uuid; tsid uuid; view_tok text; appr_tok text; tok uuid;
  res jsonb; n int; ok boolean;
begin
  perform pg_temp.as_server();
  insert into auth.users (id, email) values (victim, 'victim@example.test'), (attacker, 'attacker@example.test'), (crew, 'crew@example.test')
    on conflict (id) do nothing;
  insert into accounts (id, business_name, owner_id) values (va, 'Victim Co', victim), (aa, 'Attacker Co', attacker)
    on conflict (id) do nothing;
  insert into users (id, email, account_id) values (victim, 'victim@example.test', va), (attacker, 'attacker@example.test', aa)
    on conflict (id) do nothing;
  insert into account_config (account_id) select va where not exists (select 1 from account_config where account_id = va);
  insert into account_config (account_id) select aa where not exists (select 1 from account_config where account_id = aa);

  -- C1: a login cannot move its users row onto another business.
  perform pg_temp.as_user(attacker);
  begin
    update users set account_id = va where id = attacker;
    raise exception 'C1 OPEN: users.account_id moved to another business';
  exception when insufficient_privilege then null;
  end;
  -- nor create one pointing at it
  begin
    insert into users (id, email, account_id) values ('5ccccccc-cccc-4ccc-8ccc-cccccccccccc', 'x@example.test', va);
    raise exception 'C1 OPEN: users row created inside another business';
  exception when insufficient_privilege then null;
  end;
  -- nor hand an account to somebody else
  begin
    update accounts set owner_id = attacker where id = va;
    raise exception 'C1 OPEN: accounts.owner_id changed by a browser';
  exception when insufficient_privilege then null;
  end;
  -- nor write where payouts land
  begin
    update account_config set stripe_account_id = 'acct_evil' where account_id = aa;
    raise exception 'C1 OPEN: stripe_account_id written by a browser';
  exception when insufficient_privilege then null;
  end;
  -- C4: nor make itself a developer
  begin
    insert into account_config (account_id, stripe_connect_enabled) values ('5ddddddd-dddd-4ddd-8ddd-dddddddddddd', true);
    raise exception 'C4 OPEN: a browser created config with payout settings';
  exception when insufficient_privilege then null;
  end;

  -- The server still can (stripe-connect-onboard), and the change is logged (H7).
  perform pg_temp.as_server();
  update account_config set stripe_account_id = 'acct_ok' where account_id = aa;
  select count(*) into n from payout_change_log where account_owner = attacker and kind = 'stripe' and new_value = 'acct_ok';
  if n <> 1 then raise exception 'H7: a payout change wrote % audit rows, expected 1', n; end if;
  insert into zj_data (user_id, settings) values (victim, '{"venmoUser":"victim-pay"}')
    on conflict (user_id) do update set settings = excluded.settings;
  update zj_data set settings = '{"venmoUser":"evil-pay"}' where user_id = victim;
  select count(*) into n from payout_change_log where account_owner = victim and kind = 'venmo' and new_value = 'evil-pay';
  if n <> 1 then raise exception 'H7: a Venmo change wrote % audit rows, expected 1', n; end if;

  -- C2: the signer's status needs the link. No object, no answer.
  insert into signed_proposals (bid_id, contractor_user_id, client_name, payment_method, payment_status, signed_at)
  values ('ci-bid-1', victim, 'Client', 'cash', 'pending_cash', now()), ('ci-bid-2', victim, 'Other', 'cash', 'pending_cash', now())
  on conflict do nothing;
  perform pg_temp.as_anon();
  select count(*) into n from proposal_sign_status('proposals/' || victim || '/ci-bid-1_deadbeefdeadbeef.json');
  if n <> 0 then raise exception 'C2 OPEN: sign status answered without the link'; end if;
  perform pg_temp.as_server();
  insert into storage.objects (bucket_id, name) values ('proposals', 'proposals/' || victim || '/ci-bid-1_deadbeefdeadbeef.json'),
    ('proposals', 'client-hub/' || victim || '/77_feedfacefeedface.json');
  perform pg_temp.as_anon();
  select count(*) into n from proposal_sign_status('proposals/' || victim || '/ci-bid-1_deadbeefdeadbeef.json');
  if n <> 1 then raise exception 'C2: sign status with the real link returned % rows, expected 1', n; end if;

  -- The hub: the right link sees its bids, a wrong token sees nothing, and a
  -- bid filed under another client never comes back.
  perform pg_temp.as_server();
  insert into td_bids (id, user_id, data) values ('ci-bid-2', victim, '{"client_id":"88"}') on conflict do nothing;
  perform pg_temp.as_anon();
  select count(*) into n from hub_signed_proposals(victim, '77', 'feedfacefeedface', array['ci-bid-1']);
  if n <> 1 then raise exception 'C2: hub read with the real link returned % rows, expected 1', n; end if;
  select count(*) into n from hub_signed_proposals(victim, '77', 'wrongwrongwrong1', array['ci-bid-1']);
  if n <> 0 then raise exception 'C2 OPEN: hub read answered a wrong token'; end if;
  select count(*) into n from hub_signed_proposals(victim, '77', 'feedfacefeedface', array['ci-bid-2']);
  if n <> 0 then raise exception 'C2 OPEN: hub read returned another client''s bid'; end if;

  -- H4: an invite meant for one address cannot be claimed by another login.
  perform pg_temp.as_server();
  insert into team_members (contractor_user_id, email, name, role, active) values (victim, 'crew@example.test', 'Crew', 'tech', false)
    returning id into tm;
  insert into crew_invites (contractor_user_id, team_member_id, email) values (victim, tm, 'crew@example.test') returning token into tok;
  perform pg_temp.as_user(attacker);
  res := claim_crew_invite(tok);
  if (res->>'ok')::boolean then raise exception 'H4 OPEN: another login claimed an invite meant for crew@: %', res; end if;
  res := claim_crew_by_email();
  if (res->>'ok')::boolean then raise exception 'H4 OPEN: email-only claim still links'; end if;
  perform pg_temp.as_user(crew);
  res := claim_crew_invite(tok);
  if not coalesce((res->>'ok')::boolean, false) then raise exception 'H4: the invited address could not claim its own invite: %', res; end if;

  -- H5: removing them turns the seat off on the server.
  perform pg_temp.as_user(attacker);
  begin
    perform remove_crew_member(tm, null, null);
    raise exception 'H5 OPEN: a stranger removed another business''s crew';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_user(victim);
  res := remove_crew_member(tm, null, null);
  if not coalesce((res->>'ok')::boolean, false) then raise exception 'H5: owner could not remove crew: %', res; end if;
  select count(*) into n from team_members where id = tm and active;
  if n <> 0 then raise exception 'H5: removed crew member is still active'; end if;

  -- H6: the worker's view link cannot decide; the approve link can, but not
  -- for the worker.
  perform pg_temp.as_server();
  insert into td_timesheets (contractor_user_id, employee_user_id, week_start, status, version, total_min, business_name, person_name, biz_tz, submitted_at)
  values (victim, crew, date '2026-08-23', 'submitted', 1, 600, 'Victim Co', 'Crew', 'America/Chicago', now())
  returning id, token into tsid, view_tok;
  select token into appr_tok from td_timesheet_approvers where timesheet_id = tsid;
  if appr_tok is null or appr_tok = view_tok then raise exception 'H6: no separate approve token was minted'; end if;
  perform pg_temp.as_anon();
  res := timesheet_public(view_tok, 'dev-worker');
  if coalesce((res->>'can_decide')::boolean, true) then raise exception 'H6 OPEN: the view link says it can decide'; end if;
  begin
    perform timesheet_decide(view_tok, 'approve', null, null, 'dev-worker');
    raise exception 'H6 OPEN: the worker''s view link approved the week';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_user(crew);
  begin
    perform timesheet_decide(appr_tok, 'approve', null, null, 'dev-worker');
    raise exception 'H6 OPEN: the worker approved their own week with the approve link';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_anon();
  res := timesheet_decide(appr_tok, 'approve', null, 'Dad', 'dev-dad');
  if res->>'status' <> 'approved' then raise exception 'H6: the approve link did not approve: %', res; end if;

  -- M1: the intake card answers for exactly one business.
  select count(*) into n from account_public_card(va);
  if n <> 1 then raise exception 'M1: account_public_card returned % rows for one id', n; end if;

  perform pg_temp.as_server();
end $$;

-- Grants: the doors a browser role must not have.
do $$
declare bad text := '';
begin
  if has_table_privilege('anon', 'public.signed_proposals', 'select') then bad := bad || ' anon can read signed_proposals;'; end if;
  if has_table_privilege('anon', 'public.signed_proposals', 'update') then bad := bad || ' anon can update signed_proposals;'; end if;
  if has_table_privilege('authenticated', 'public.td_timesheet_approvers', 'select') then bad := bad || ' approve tokens readable;'; end if;
  if has_table_privilege('authenticated', 'public.email_send_log', 'insert') then bad := bad || ' email_send_log writable;'; end if;
  if has_function_privilege('anon', 'public._lad_table(uuid, text, text[])', 'execute')
     or has_function_privilege('authenticated', 'public._lad_table(uuid, text, text[])', 'execute') then bad := bad || ' _lad_table callable;'; end if;
  if has_function_privilege('anon', 'public.geo_fences_for(uuid, date)', 'execute')
     or has_function_privilege('authenticated', 'public.geo_fences_for(uuid, date)', 'execute') then bad := bad || ' geo_fences_for callable;'; end if;
  if has_function_privilege('anon', 'public.claim_crew_invite(uuid)', 'execute') then bad := bad || ' anon claim_crew_invite;'; end if;
  if has_function_privilege('anon', 'public.load_account_data(uuid)', 'execute') then bad := bad || ' anon load_account_data;'; end if;
  if has_function_privilege('authenticated', 'public.timesheet_claim(uuid, text)', 'execute') then bad := bad || ' timesheet_claim callable;'; end if;
  if not has_function_privilege('anon', 'public.timesheet_public(text, text)', 'execute') then bad := bad || ' timesheet page lost timesheet_public;'; end if;
  if not has_function_privilege('anon', 'public.proposal_sign_status(text)', 'execute') then bad := bad || ' sign page lost proposal_sign_status;'; end if;
  if not has_function_privilege('authenticated', 'public.load_account_data(uuid)', 'execute') then bad := bad || ' app lost load_account_data;'; end if;
  if exists (select 1 from pg_policies where policyname in
      ('anon_select', 'anon_update_by_token', 'anon_insert', 'dev_support', 'dev_support_read', 'dev_support_write',
       'employee_claim_invite', 'accounts_update', 'account_users_insert', 'config_update', 'config_insert',
       'anon_read_proposals', 'anon_upsert_proposal_json', 'anon_update_proposal_json', 'auth_rw_proposals', 'auth_rw_gallery', 'anon_read_gallery'))
  then bad := bad || ' a dropped policy is back;'; end if;
  if bad <> '' then raise exception 'SECURITY LOCKDOWN REGRESSED:%', bad; end if;
end $$;
