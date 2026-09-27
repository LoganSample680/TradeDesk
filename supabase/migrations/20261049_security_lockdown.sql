-- SECURITY LOCKDOWN (owner approved 2026-09-27, "go").
--
-- A read-only review of the live database found ways for a stranger, or any
-- signed-up account, to reach another business's money and records. This file
-- closes them. Every section names the finding it answers (C1..C6, H3..H7,
-- M1, M2, M4) so the report and the tests can point at one place.
--
-- THE RULE THIS FILE KEEPS (CLAUDE.md 3.1): one Supabase serves dev, UAT and
-- production, so nothing here may break a path the code on main still uses
-- without the same PR moving that code, and every path that is closed fails
-- CLOSED (an empty answer or a refusal), never open. Where the old anonymous
-- write paths are closed (signed_proposals, the proposals bucket), sign.html,
-- client.html and contract-sign.html move to the proposal-sign edge function
-- and the token-checked RPCs below in the same commit.
--
-- Additive where it can be: new helper functions, new tables, new policies,
-- triggers. The removals are the policies and grants that were the holes.
-- Idempotent and bare-database safe (to_regclass / to_regprocedure guards),
-- like every migration here, because the lint job applies it to a Postgres
-- that has no auth.email(), no storage.foldername() and none of the tables the
-- dashboard created by hand.

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Who is calling
-- ════════════════════════════════════════════════════════════════════════════
-- PostgREST stamps the JWT role on every request. anon and authenticated are
-- the two a browser can be; service_role (edge functions) and a direct
-- database session (migrations, the dashboard, the lint job) are trusted.
create or replace function public._td_jwt_role()
returns text
language plpgsql stable
set search_path = public
as $$
declare r text;
begin
  begin
    r := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role';
  exception when others then r := null;
  end;
  if r is null then r := nullif(current_setting('request.jwt.claim.role', true), ''); end if;
  return coalesce(r, '');
end $$;

create or replace function public._td_is_trusted()
returns boolean
language sql stable
set search_path = public
as $$
  select public._td_jwt_role() not in ('anon', 'authenticated');
$$;

-- The login's email, read from auth.users rather than auth.email() (which a
-- bare Postgres does not have). Lower-cased once, here.
create or replace function public._td_my_email()
returns text
language sql stable security definer
set search_path = public, auth
as $$
  select lower(btrim(u.email)) from auth.users u where u.id::text = auth.uid()::text;
$$;

revoke execute on function public._td_my_email() from public, anon;
grant execute on function public._td_my_email() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- C1. users.account_id takeover  +  C4. self-granted dev
-- ════════════════════════════════════════════════════════════════════════════
-- "Users update own row" had no WITH CHECK and the table grants let a login
-- rewrite users.account_id. Pointing it at another business made the login a
-- member of it (get_my_account_id), and from there config_update could write
-- account_config.stripe_account_id, which create-checkout pays out to. The fix
-- is a trigger, not a column grant: Supabase grants the whole table to anon
-- and authenticated, so a column revoke underneath it changes nothing.
--
-- A browser may: create its own users row pointing at an account it OWNS, and
-- attach an account it owns to a row that has none yet (signup order). It may
-- never move account_id or change role afterwards. The server may do anything.
do $$
begin
  if to_regclass('public.users') is null or to_regclass('public.accounts') is null then return; end if;

  create or replace function public.users_guard()
  returns trigger
  language plpgsql security definer
  set search_path = public
  as $f$
  begin
    if public._td_is_trusted() then return new; end if;
    if tg_op = 'INSERT' then
      if new.account_id is not null and not exists (
        select 1 from accounts a where a.id = new.account_id and a.owner_id::text = new.id::text
      ) then
        raise exception 'users: account_id must be an account this login owns' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.id is distinct from old.id or new.role is distinct from old.role then
      raise exception 'users: only the server changes id or role' using errcode = '42501';
    end if;
    if new.account_id is distinct from old.account_id and not (
      old.account_id is null and new.account_id is not null and exists (
        select 1 from accounts a where a.id = new.account_id and a.owner_id::text = new.id::text)
    ) then
      raise exception 'users: account_id cannot be moved' using errcode = '42501';
    end if;
    return new;
  end $f$;

  drop trigger if exists users_guard on public.users;
  create trigger users_guard before insert or update on public.users
    for each row execute function public.users_guard();

  -- accounts: nobody but the server hands an account to someone else or
  -- marks it lifetime (that is billing).
  create or replace function public.accounts_guard()
  returns trigger
  language plpgsql security definer
  set search_path = public
  as $f$
  begin
    if public._td_is_trusted() then return new; end if;
    if tg_op = 'INSERT' then
      if new.owner_id::text is distinct from auth.uid()::text then
        raise exception 'accounts: an account is created by its owner' using errcode = '42501';
      end if;
      if coalesce((to_jsonb(new)->>'is_lifetime')::boolean, false) then
        raise exception 'accounts: only the server changes owner or plan' using errcode = '42501';
      end if;
      return new;
    end if;
    -- to_jsonb: is_lifetime was added on the hosted project by hand and a
    -- migrations-only stack does not have it; a field reference would throw.
    if new.owner_id is distinct from old.owner_id or new.id is distinct from old.id
       or (to_jsonb(new)->>'is_lifetime') is distinct from (to_jsonb(old)->>'is_lifetime') then
      raise exception 'accounts: only the server changes owner or plan' using errcode = '42501';
    end if;
    return new;
  end $f$;

  drop trigger if exists accounts_guard on public.accounts;
  create trigger accounts_guard before insert or update on public.accounts
    for each row execute function public.accounts_guard();
end $$;

-- Who owns an account, read past accounts' own RLS so a policy that asks
-- does not depend on whether the caller can SELECT that row.
create or replace function public._td_account_owner(p_account uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select a.owner_id::text from public.accounts a where a.id = p_account;
$$;

-- accounts: membership could update the account row. Only its owner may now.
do $$
begin
  if to_regclass('public.accounts') is null then return; end if;
  execute 'drop policy if exists "accounts_update" on public.accounts';
  execute 'drop policy if exists "Account owner can update" on public.accounts';
  execute 'create policy "Account owner can update" on public.accounts for update to authenticated
             using (owner_id::text = auth.uid()::text)
             with check (owner_id::text = auth.uid()::text)';
end $$;

-- account_users: an insert keyed on get_my_account_id() let a member add
-- members. Only the account's owner writes memberships now, and an owner can
-- no longer move a membership row into somebody else's account (the update
-- policy had no WITH CHECK).
do $$
begin
  if to_regclass('public.account_users') is null or to_regclass('public.accounts') is null then return; end if;
  execute 'drop policy if exists "account_users_insert" on public.account_users';
  execute 'drop policy if exists "Owner updates memberships" on public.account_users';
  execute 'create policy "Owner updates memberships" on public.account_users for update to authenticated
             using (public._td_account_owner(account_id) = auth.uid()::text)
             with check (public._td_account_owner(account_id) = auth.uid()::text)';
  execute 'drop policy if exists "Owner inserts memberships" on public.account_users';
  execute 'create policy "Owner inserts memberships" on public.account_users for insert to authenticated
             with check (public._td_account_owner(account_id) = auth.uid()::text)';
end $$;

-- account_config: writes belong to the real owner (accounts.owner_id), or a
-- co-owner the owner made one. The money columns (stripe_account_id,
-- stripe_connect_enabled) and is_dev are the server's alone, enforced by the
-- trigger below whatever a policy says: stripe-connect-onboard,
-- stripe-connect-status and stripe-connect-disconnect write them with the
-- service role, and the browser never did.
do $$
begin
  if to_regclass('public.account_config') is null or to_regclass('public.accounts') is null then return; end if;
  execute 'drop policy if exists "config_insert" on public.account_config';
  execute 'drop policy if exists "config_update" on public.account_config';
  execute 'drop policy if exists "Account owner manages config" on public.account_config';
  execute 'drop policy if exists "account_config_owner_insert" on public.account_config';
  execute 'drop policy if exists "account_config_owner_update" on public.account_config';
  execute 'drop policy if exists "account_config_owner_delete" on public.account_config';
  execute 'create policy "account_config_owner_insert" on public.account_config for insert to authenticated
             with check (public._td_account_owner(account_id) = auth.uid()::text)';
  execute 'create policy "account_config_owner_update" on public.account_config for update to authenticated
             using ((public._td_account_owner(account_id) = auth.uid()::text
                     or public.is_co_owner(public._td_account_owner(account_id)::uuid)))
             with check ((public._td_account_owner(account_id) = auth.uid()::text
                     or public.is_co_owner(public._td_account_owner(account_id)::uuid)))';
  execute 'create policy "account_config_owner_delete" on public.account_config for delete to authenticated
             using (public._td_account_owner(account_id) = auth.uid()::text)';

  create or replace function public.account_config_guard()
  returns trigger
  language plpgsql security definer
  set search_path = public
  as $f$
  begin
    if public._td_is_trusted() then return new; end if;
    if tg_op = 'INSERT' then
      if coalesce((to_jsonb(new)->>'is_dev')::boolean, false)
         or (to_jsonb(new)->>'stripe_account_id') is not null
         or coalesce((to_jsonb(new)->>'stripe_connect_enabled')::boolean, false) then
        raise exception 'account_config: payout and developer settings are set by the server' using errcode = '42501';
      end if;
      return new;
    end if;
    -- to_jsonb, not field references: is_dev exists only on the hosted project.
    if new.account_id is distinct from old.account_id
       or (to_jsonb(new)->>'is_dev') is distinct from (to_jsonb(old)->>'is_dev')
       or (to_jsonb(new)->>'stripe_account_id') is distinct from (to_jsonb(old)->>'stripe_account_id')
       or (to_jsonb(new)->>'stripe_connect_enabled') is distinct from (to_jsonb(old)->>'stripe_connect_enabled') then
      raise exception 'account_config: payout and developer settings are set by the server' using errcode = '42501';
    end if;
    return new;
  end $f$;

  drop trigger if exists account_config_guard on public.account_config;
  create trigger account_config_guard before insert or update on public.account_config
    for each row execute function public.account_config_guard();
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- C4 + M4. Developer access comes from the server, never from a flag
-- ════════════════════════════════════════════════════════════════════════════
-- dev_support (ALL, every td_* table) trusted account_config.is_dev, which any
-- signup could set on its own account. zj_data/users/receipts trusted a
-- hardcoded Gmail. Both go. Developer READS already exist through
-- ops_view_read (is_ops_admin(), the analytics_admins allowlist) on every
-- table the support view loads, and there are no cross-tenant writes at all.
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where (schemaname = 'public' and policyname in ('dev_support', 'dev_support_read', 'dev_support_write'))
              or (schemaname = 'storage' and policyname = 'dev_full_access_receipts')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- C2. signed_proposals: no anonymous table access at all
-- ════════════════════════════════════════════════════════════════════════════
-- anon_select (USING true) and anon_update_by_token (storage_key IS NOT NULL)
-- let anyone read and rewrite every business's signed proposals; anon_insert
-- and auth_insert (WITH CHECK true) let anyone plant one. The signer's page
-- now reads through proposal_sign_status and the hub through
-- hub_signed_proposals (both require the secret link), and every public write
-- goes through the proposal-sign edge function, which proves the link the
-- same way before it touches a row.
do $$
begin
  if to_regclass('public.signed_proposals') is null then return; end if;
  execute 'drop policy if exists "anon_select" on public.signed_proposals';
  execute 'drop policy if exists "anon_update_by_token" on public.signed_proposals';
  execute 'drop policy if exists "anon_insert" on public.signed_proposals';
  execute 'drop policy if exists "auth_insert" on public.signed_proposals';
  execute 'revoke all on public.signed_proposals from anon';
end $$;

-- A proposal link is proposals/<uid>/<bid>_<token>.json in the proposals
-- bucket. The object existing IS the proof: nobody can list the bucket any
-- more (C5), so only someone holding the link knows the name.
create or replace function public._td_object_exists(p_bucket text, p_name text)
returns boolean
language sql stable security definer
set search_path = public, storage
as $$
  select p_name is not null and length(p_name) between 10 and 400
     and exists (select 1 from storage.objects o where o.bucket_id = p_bucket and o.name = p_name);
$$;
revoke execute on function public._td_object_exists(text, text) from public, anon, authenticated;

create or replace function public.proposal_sign_status(p_key text)
returns table (signed_at timestamptz, client_signed_name text, payment_method text, payment_status text)
language plpgsql stable security definer
set search_path = public
as $$
declare m text[];
begin
  m := regexp_match(coalesce(p_key, ''), '^proposals/([0-9a-fA-F-]{36})/([^/_]+)_([^/]{8,})\.json$');
  if m is null or not public._td_object_exists('proposals', p_key) then return; end if;
  return query
    select s.signed_at, s.client_signed_name, s.payment_method, s.payment_status
    from public.signed_proposals s
    where s.bid_id = m[2]
    limit 1;
end $$;
revoke execute on function public.proposal_sign_status(text) from public;
grant execute on function public.proposal_sign_status(text) to anon, authenticated;

-- The client hub: client-hub/<uid>/<clientId>_<token>.json. Returns only the
-- signing state the hub renders, never Stripe ids, IPs or notify addresses,
-- and only for bids that are this client's (a bid whose record names another
-- client is never returned).
create or replace function public.hub_signed_proposals(p_u uuid, p_c text, p_t text, p_bid_ids text[])
returns setof jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  if p_u is null or coalesce(p_c, '') = '' or length(coalesce(p_t, '')) < 8
     or p_bid_ids is null or coalesce(array_length(p_bid_ids, 1), 0) = 0 or array_length(p_bid_ids, 1) > 300
     or p_c ~ '[/_]' or p_t ~ '/' then
    return;
  end if;
  if not public._td_object_exists('proposals', 'client-hub/' || p_u::text || '/' || p_c || '_' || p_t || '.json') then
    return;
  end if;
  return query
    select jsonb_build_object(
      'bid_id', s.bid_id, 'signed_at', s.signed_at, 'client_signed_name', s.client_signed_name,
      'payment_method', s.payment_method, 'payment_status', s.payment_status,
      'amount', s.amount, 'deposit', s.deposit, 'decline_reason', s.decline_reason,
      'signature_data', s.signature_data, 'epa_required', s.epa_required, 'epa_ack_at', s.epa_ack_at,
      'rrp_firm_cert', s.rrp_firm_cert, 'rrp_renovator_name', s.rrp_renovator_name,
      'buyer_senior', s.buyer_senior, 'cancelled_at', s.cancelled_at,
      'cancelled_signed_name', s.cancelled_signed_name, 'change_orders', s.change_orders)
    from public.signed_proposals s
    where s.contractor_user_id::text = p_u::text
      and s.bid_id = any(p_bid_ids)
      and not exists (
        select 1 from public.td_bids b
        where b.id = s.bid_id and b.user_id::text = p_u::text
          and b.data ? 'client_id' and (b.data->>'client_id') is distinct from p_c);
end $$;
revoke execute on function public.hub_signed_proposals(uuid, text, text, text[]) from public;
grant execute on function public.hub_signed_proposals(uuid, text, text, text[]) to anon, authenticated;

-- The old unauthenticated helpers had no JS caller and trusted a token they
-- let the caller overwrite (submit_signed_proposal replaced signing_token on
-- conflict). Closed to browsers; the service role keeps them.
do $$
declare f text;
begin
  foreach f in array array[
    'public.get_signed_proposal_status(text, uuid, text)',
    'public.submit_signed_proposal(text, uuid, text, text, text, numeric, numeric, text, text, text, boolean, numeric, boolean)',
    'public.update_proposal_notified(text, uuid, text)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
    end if;
  end loop;
end $$;

-- H3. get_hub_proposal_statuses returned status and deposit to anyone who
-- named a contractor. It answers only that contractor now (no JS caller; the
-- hub uses hub_signed_proposals, which requires the hub link).
do $$
begin
  if to_regclass('public.signed_proposals') is null then return; end if;
  create or replace function public.get_hub_proposal_statuses(p_contractor_user_id uuid, p_bid_ids text[])
  returns table (bid_id text, payment_status text, payment_method text, signed_at timestamptz, deposit numeric)
  language sql stable security definer
  set search_path = public
  as $f$
    select s.bid_id, s.payment_status, s.payment_method, s.signed_at, s.deposit
    from public.signed_proposals s
    where s.contractor_user_id::text = p_contractor_user_id::text
      and p_contractor_user_id::text = auth.uid()::text
      and s.bid_id = any(p_bid_ids);
  $f$;
  revoke execute on function public.get_hub_proposal_statuses(uuid, text[]) from public, anon;
  grant execute on function public.get_hub_proposal_statuses(uuid, text[]) to authenticated;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- C5. Storage: no anonymous list or overwrite, owners write their own folder
-- ════════════════════════════════════════════════════════════════════════════
-- Both buckets are public, so a file is served by its exact public URL with
-- no policy involved. A SELECT policy is what LISTING needs, and anon list
-- handed out every proposal and hub key (the token is in the name). anon
-- insert/update let anyone overwrite a proposal, including the amount
-- create-checkout validated against. Authenticated could delete any tenant's
-- files.
--
-- Owner layouts: proposals bucket   <kind>/<uid>/...  (proposals, client-hub,
--                                   agreements, photo-share, client-uploads)
--                gallery bucket     <uid>/...  or legacy gallery/<uid>/...
-- The owner uid is the first path segment that is a uuid, looked at in the
-- first two positions. A crew member or co-owner writes into the boss's
-- folder (the hub is filed under _effectiveUid), so both are allowed.
create or replace function public._td_storage_owner(p_name text)
returns text
language sql immutable
set search_path = public
as $$
  select case
    when split_part(coalesce(p_name, ''), '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then lower(split_part(p_name, '/', 1))
    when split_part(coalesce(p_name, ''), '/', 2) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then lower(split_part(p_name, '/', 2))
    else null end;
$$;

create or replace function public._td_storage_can_write(p_name text)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare o text := public._td_storage_owner(p_name);
begin
  if o is null or auth.uid()::text is null then return false; end if;
  if o = lower(auth.uid()::text) then return true; end if;
  return public.crew_member_of(o::uuid) or public.is_co_owner(o::uuid);
end $$;
revoke execute on function public._td_storage_can_write(text) from public, anon;
grant execute on function public._td_storage_can_write(text) to authenticated;

-- A client uploading a document from their hub: client-uploads/<uid>/<clientId>/<file>.
-- Allowed only where that client's hub exists. Insert only, never overwrite.
create or replace function public._td_hub_exists(p_u text, p_c text)
returns boolean
language sql stable security definer
set search_path = public, storage
as $$
  select coalesce(p_u, '') ~ '^[0-9a-fA-F-]{36}$' and coalesce(p_c, '') <> '' and p_c !~ '[/_%\\]'
     and exists (select 1 from storage.objects o
                 where o.bucket_id = 'proposals'
                   and o.name like 'client-hub/' || p_u || '/' || p_c || '\_%.json');
$$;
revoke execute on function public._td_hub_exists(text, text) from public;
grant execute on function public._td_hub_exists(text, text) to anon, authenticated;

do $$
declare p text;
begin
  if to_regclass('storage.objects') is null then return; end if;
  foreach p in array array[
    'anon_read_proposals', 'anon_upsert_proposal_json', 'anon_update_proposal_json',
    'Public can read proposals', 'Authenticated users can delete proposals',
    'Authenticated users can update proposals', 'Authenticated users can upload proposals',
    'auth_rw_proposals', 'auth_rw_gallery', 'anon_read_gallery',
    'td_owner_select', 'td_owner_insert', 'td_owner_update', 'td_owner_delete', 'td_client_upload_insert'
  ] loop
    execute format('drop policy if exists %I on storage.objects', p);
  end loop;

  execute 'create policy "td_owner_select" on storage.objects for select to authenticated
             using (bucket_id in (''proposals'', ''gallery'') and public._td_storage_can_write(name))';
  execute 'create policy "td_owner_insert" on storage.objects for insert to authenticated
             with check (bucket_id in (''proposals'', ''gallery'') and public._td_storage_can_write(name))';
  execute 'create policy "td_owner_update" on storage.objects for update to authenticated
             using (bucket_id in (''proposals'', ''gallery'') and public._td_storage_can_write(name))
             with check (bucket_id in (''proposals'', ''gallery'') and public._td_storage_can_write(name))';
  execute 'create policy "td_owner_delete" on storage.objects for delete to authenticated
             using (bucket_id in (''proposals'', ''gallery'') and public._td_storage_can_write(name))';
  execute 'create policy "td_client_upload_insert" on storage.objects for insert to anon, authenticated
             with check (bucket_id = ''proposals''
                         and split_part(name, ''/'', 1) = ''client-uploads''
                         and public._td_hub_exists(split_part(name, ''/'', 2), split_part(name, ''/'', 3)))';
end $$;

-- Gallery holds pictures and nothing else. SVG is left out on purpose: it can
-- carry script. A logo upload that is an SVG falls back to the inline logo.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $q$update storage.buckets
               set allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif','image/avif']
               where id = 'gallery'$q$;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- C3. _lad_table dumped any tenant's table to anyone
-- ════════════════════════════════════════════════════════════════════════════
-- Its only caller is load_account_data, a definer function that runs as the
-- owner, so closing it to every browser role changes nothing for the app.
do $$
begin
  if to_regprocedure('public._lad_table(uuid, text, text[])') is not null then
    execute 'revoke execute on function public._lad_table(uuid, text, text[]) from public, anon, authenticated';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- C6. geo_fences_for returned every client address and GPS point to anon
-- ════════════════════════════════════════════════════════════════════════════
-- No browser calls it: the phone builds its fences itself (_geoDeriveFences)
-- and the server deriver (supabase/functions/_shared/derive-day.mjs) calls it
-- with the service role. Closed to every browser role.
do $$
begin
  if to_regprocedure('public.geo_fences_for(uuid, date)') is not null then
    execute 'revoke execute on function public.geo_fences_for(uuid, date) from public, anon, authenticated';
    execute 'grant execute on function public.geo_fences_for(uuid, date) to service_role';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- H4. A crew seat is joined with the invite, never with an email alone
-- ════════════════════════════════════════════════════════════════════════════
-- Email confirmation is off (owner's call), so auth.email() proves nothing: a
-- stranger could sign up as the invited address and take the seat. The
-- email-only paths go; the forge-proof token is the way in, and when the
-- invite names an email the login must be that email too.
do $$
begin
  if to_regclass('public.team_members') is not null then
    execute 'drop policy if exists "employee_claim_invite" on public.team_members';
  end if;
end $$;

create or replace function public.claim_crew_by_email()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  -- Retired 2026-09-27 (H4). Kept so a cached client calling it gets an
  -- answer rather than an error; it never links anybody.
  return jsonb_build_object('ok', false, 'reason', 'invite_required');
end $$;
revoke execute on function public.claim_crew_by_email() from public, anon;
grant execute on function public.claim_crew_by_email() to authenticated;

do $$
begin
  if to_regclass('public.crew_invites') is null or to_regclass('public.team_members') is null then return; end if;
  create or replace function public.claim_crew_invite(tok uuid)
  returns jsonb
  language plpgsql security definer
  set search_path = public
  as $f$
  declare
    inv crew_invites%rowtype;
    tm  team_members%rowtype;
  begin
    if auth.uid()::text is null then
      return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
    end if;
    select * into inv from crew_invites where token = tok for update;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'invalid');
    end if;
    if inv.used_at is not null and inv.used_by::text is distinct from auth.uid()::text then
      return jsonb_build_object('ok', false, 'reason', 'used');
    end if;
    if inv.used_at is null and inv.expires_at < now() then
      return jsonb_build_object('ok', false, 'reason', 'expired');
    end if;
    -- The invite names who it is for. Holding the link is not enough when the
    -- link was meant for somebody else's address.
    if coalesce(btrim(inv.email), '') <> ''
       and public._td_my_email() is distinct from lower(btrim(inv.email)) then
      return jsonb_build_object('ok', false, 'reason', 'email_mismatch');
    end if;
    update team_members
       set employee_user_id = (auth.uid()::text)::uuid,
           active = true,
           joined_at = coalesce(joined_at, now())
     where id = inv.team_member_id
       and (employee_user_id is null or employee_user_id::text = auth.uid()::text)
    returning * into tm;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'already_linked_other');
    end if;
    if inv.used_at is null then
      update crew_invites
         set used_at = now(), used_by = (auth.uid()::text)::uuid
       where token = tok;
    end if;
    return jsonb_build_object(
      'ok', true,
      'contractor_user_id', tm.contractor_user_id,
      'team_member_id', tm.id,
      'name', tm.name,
      'role', tm.role,
      'permissions', tm.permissions
    );
  end $f$;
  revoke execute on function public.claim_crew_invite(uuid) from public, anon;
  grant execute on function public.claim_crew_invite(uuid) to authenticated;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- H5. A removed crew member loses access on the server, at once
-- ════════════════════════════════════════════════════════════════════════════
-- Removing someone only edited S.employees on the phone; their team_members
-- row stayed active and any owner membership stayed. remove_crew_member is
-- the server half: the owner (or a co-owner) names the row by id, or by email
-- on their own account, and it is deactivated, every membership the person
-- holds on that account is deleted, and any unused invite for the seat dies.
-- Contract (for js/cloud.js removeEmployee):
--   rpc('remove_crew_member', {p_team_member_id: uuid|null, p_email: text|null, p_contractor: uuid|null})
--   -> {ok:true, team_member_id, employee_user_id}
--   -> {ok:false, reason:'not_found'}           nothing to remove (already gone)
--   raises 42501                                 caller is not that account's owner or co-owner
do $$
begin
  if to_regclass('public.team_members') is null then return; end if;
  create or replace function public.remove_crew_member(p_team_member_id uuid default null, p_email text default null, p_contractor uuid default null)
  returns jsonb
  language plpgsql security definer
  set search_path = public
  as $f$
  declare
    tm   team_members%rowtype;
    boss uuid := coalesce(p_contractor, (auth.uid()::text)::uuid);
    acct uuid;
  begin
    if auth.uid()::text is null then raise exception 'remove_crew_member: not signed in' using errcode = '42501'; end if;
    if p_team_member_id is not null then
      select * into tm from team_members where id = p_team_member_id for update;
    elsif coalesce(btrim(p_email), '') <> '' then
      select * into tm from team_members
       where contractor_user_id::text = boss::text and lower(email) = lower(btrim(p_email))
       order by created_at desc limit 1 for update;
    end if;
    if tm.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if not (tm.contractor_user_id::text = auth.uid()::text or public.is_co_owner(tm.contractor_user_id)) then
      raise exception 'remove_crew_member: only the business owner can remove crew' using errcode = '42501';
    end if;
    if tm.employee_user_id::text = tm.contractor_user_id::text then
      raise exception 'remove_crew_member: the owner cannot remove themselves' using errcode = '42501';
    end if;
    update team_members set active = false where id = tm.id;
    if tm.employee_user_id is not null and to_regclass('public.account_users') is not null then
      select a.id into acct from accounts a where a.owner_id::text = tm.contractor_user_id::text limit 1;
      if acct is not null then
        delete from account_users where account_id = acct and user_id::text = tm.employee_user_id::text;
      end if;
    end if;
    if to_regclass('public.crew_invites') is not null then
      update crew_invites set expires_at = least(expires_at, now())
       where team_member_id = tm.id and used_at is null;
    end if;
    return jsonb_build_object('ok', true, 'team_member_id', tm.id, 'employee_user_id', tm.employee_user_id);
  end $f$;
  revoke execute on function public.remove_crew_member(uuid, text, uuid) from public, anon;
  grant execute on function public.remove_crew_member(uuid, text, uuid) to authenticated;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- H6. The worker can no longer approve their own timesheet
-- ════════════════════════════════════════════════════════════════════════════
-- timesheet_submit hands the worker the link token, and the worker is the one
-- who texts it, so any token in that text is one the worker holds. First-
-- device binding only meant the worker had to be first. There is no version of
-- "the worker sends the approve link" that the worker cannot use.
--
-- So there are now TWO tokens:
--   td_timesheets.token          the VIEW link. The worker gets it and texts
--                                it, exactly as before. It shows the week. It
--                                can no longer approve or reject.
--   td_timesheet_approvers.token the APPROVE link. Minted by the server on
--                                every submit, stored where no browser role can
--                                read it, never returned to the worker, and
--                                emailed by the timesheet-notify edge function
--                                to the business owner's login email. Jack's
--                                dad needs no app and no password: he taps the
--                                link in his email.
-- Signed in as the worker, even the approve link refuses.
do $$
begin
  if to_regclass('public.td_timesheets') is null then return; end if;

  create table if not exists public.td_timesheet_approvers (
    timesheet_id uuid primary key references public.td_timesheets(id) on delete cascade,
    token        text not null unique,
    bound_device text,
    bound_at     timestamptz,
    created_at   timestamptz not null default now()
  );
  alter table public.td_timesheet_approvers enable row level security;
  revoke all on public.td_timesheet_approvers from anon, authenticated;

  create or replace function public._td_new_token()
  returns text
  language sql volatile
  set search_path = public
  as $f$ select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''); $f$;

  -- A resend is a new view link (timesheet_submit rotates token), so it is a
  -- new approve link too, unbound.
  create or replace function public.td_timesheet_approver_rotate()
  returns trigger
  language plpgsql security definer
  set search_path = public
  as $f$
  begin
    insert into td_timesheet_approvers (timesheet_id, token)
    values (new.id, public._td_new_token())
    on conflict (timesheet_id) do update
      set token = excluded.token, bound_device = null, bound_at = null, created_at = now();
    return null;
  end $f$;
  drop trigger if exists td_timesheet_approver_rotate on public.td_timesheets;
  create trigger td_timesheet_approver_rotate after insert or update of token on public.td_timesheets
    for each row execute function public.td_timesheet_approver_rotate();

  insert into public.td_timesheet_approvers (timesheet_id, token)
  select t.id, public._td_new_token() from public.td_timesheets t
  on conflict (timesheet_id) do nothing;

  -- First device to open the APPROVE link keeps it, same rule as the view link.
  create or replace function public._td_timesheet_approver_claim(p_id uuid, p_device text)
  returns boolean
  language plpgsql security definer
  set search_path = public
  as $f$
  declare
    dev text := left(nullif(btrim(coalesce(p_device, '')), ''), 80);
    cur text;
  begin
    select bound_device into cur from td_timesheet_approvers where timesheet_id = p_id for update;
    if cur is not null then return cur is not distinct from dev; end if;
    if dev is null then return true; end if;
    update td_timesheet_approvers set bound_device = dev, bound_at = now()
     where timesheet_id = p_id and bound_device is null;
    return true;
  end $f$;
  revoke execute on function public._td_timesheet_approver_claim(uuid, text) from public, anon, authenticated;

  create or replace function public.timesheet_public(p_token text, p_device text default '')
  returns jsonb
  language plpgsql security definer
  set search_path = public
  as $f$
  declare
    ts    td_timesheets%rowtype;
    win   tstzrange;
    t_rows jsonb;
    s_rows jsonb;
    m_rows jsonb;
    decide boolean := false;
  begin
    if p_token is null or length(p_token) < 16 then return null; end if;
    select * into ts from td_timesheets where token = p_token;
    if ts.id is not null then
      if not timesheet_claim(ts.id, p_device) then
        return jsonb_build_object('refused', 'bound');
      end if;
    else
      select t.* into ts from td_timesheet_approvers a join td_timesheets t on t.id = a.timesheet_id
       where a.token = p_token;
      if ts.id is null then return null; end if;
      if not public._td_timesheet_approver_claim(ts.id, p_device) then
        return jsonb_build_object('refused', 'bound');
      end if;
      -- The worker opening the approve link while signed in reads it, and
      -- still cannot decide it.
      decide := auth.uid()::text is distinct from ts.employee_user_id::text;
    end if;
    win := timesheet_window(ts.week_start, ts.biz_tz);

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'job_id', e.job_id, 'arrived_at', e.arrived_at, 'departed_at', e.departed_at,
        'minutes', e.minutes, 'source', e.source, 'client_key', e.client_key,
        'origin_place', e.origin_place, 'dest_place', e.dest_place,
        'job_name', j.data->>'name', 'client_name', c.data->>'name',
        'addr', coalesce(j.data->>'addr', c.data->>'addr', '')
      ) order by e.arrived_at), '[]'::jsonb) into t_rows
    from job_time_entries e
    left join td_jobs j on j.id = e.job_id and j.user_id = ts.contractor_user_id and j.deleted_at is null
    left join td_clients c on c.id = (j.data->>'client_id') and c.user_id = ts.contractor_user_id and c.deleted_at is null
    where e.employee_user_id = ts.employee_user_id and e.contractor_user_id = ts.contractor_user_id
      and e.deleted_at is null and coalesce(e.source, '') <> 'dismissed'
      and e.arrived_at >= lower(win) and e.arrived_at < upper(win);

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'arrived_at', s.arrived_at, 'departed_at', s.departed_at,
        'minutes', s.minutes, 'client_key', s.client_key
      ) order by s.arrived_at), '[]'::jsonb) into s_rows
    from shop_time_entries s
    where s.employee_user_id = ts.employee_user_id and s.contractor_user_id = ts.contractor_user_id
      and s.deleted_at is null
      and s.arrived_at >= lower(win) and s.arrived_at < upper(win);

    select coalesce(jsonb_agg(m.data order by m.data->>'start_time'), '[]'::jsonb) into m_rows
    from td_time_entries m
    where m.user_id = ts.contractor_user_id and m.deleted_at is null
      and coalesce(m.data->>'open', 'false') <> 'true'
      and (m.data->>'date') >= ts.week_start::text and (m.data->>'date') <= (ts.week_start + 6)::text
      and ((m.data->>'logged_by_uid') = ts.employee_user_id::text
           or ((m.data->>'logged_by_uid') is null and ts.employee_user_id = ts.contractor_user_id));

    return jsonb_build_object(
      'business_name', ts.business_name, 'person_name', ts.person_name,
      'week_start', ts.week_start, 'biz_tz', ts.biz_tz,
      'status', ts.status, 'version', ts.version, 'total_min', ts.total_min,
      'submitted_at', ts.submitted_at,
      'approved_at', ts.approved_at, 'approved_name', ts.approved_name,
      'rejected_at', ts.rejected_at, 'reject_note', ts.reject_note,
      'pay_rate', ts.pay_rate,
      'can_decide', decide,
      'time', t_rows, 'shop', s_rows, 'manual', m_rows);
  end $f$;
  grant execute on function public.timesheet_public(text, text) to anon, authenticated;

  -- Deciding takes the APPROVE token. The view token the worker texted is
  -- refused with its own reason so the page can say where approving happens.
  create or replace function public.timesheet_decide(p_token text, p_decision text, p_note text default null, p_name text default null, p_device text default '')
  returns jsonb
  language plpgsql security definer
  set search_path = public
  as $f$
  declare
    ts td_timesheets%rowtype;
  begin
    if p_token is null or length(p_token) < 16 then raise exception 'timesheet_decide: no such timesheet'; end if;
    select t.* into ts from td_timesheet_approvers a join td_timesheets t on t.id = a.timesheet_id
     where a.token = p_token;
    if ts.id is null then
      if exists (select 1 from td_timesheets where token = p_token) then
        raise exception 'timesheet_decide: approve from the link emailed to the business owner' using errcode = '42501';
      end if;
      raise exception 'timesheet_decide: no such timesheet';
    end if;
    if auth.uid()::text is not null and auth.uid()::text = ts.employee_user_id::text then
      raise exception 'timesheet_decide: you cannot approve your own timesheet' using errcode = '42501';
    end if;
    if not public._td_timesheet_approver_claim(ts.id, p_device) then
      raise exception 'timesheet_decide: this link was opened on another device';
    end if;
    if p_decision = 'approve' then
      update td_timesheets set status = 'approved', approved_at = now(),
        approved_name = left(coalesce(p_name, ''), 80),
        rejected_at = null, reject_note = null, updated_at = now()
        where id = ts.id;
    elsif p_decision = 'reject' then
      update td_timesheets set status = 'rejected', rejected_at = now(),
        reject_note = left(coalesce(p_note, ''), 300),
        approved_at = null, approved_name = null, updated_at = now()
        where id = ts.id;
    else
      raise exception 'timesheet_decide: decision must be approve or reject';
    end if;
    select * into ts from td_timesheets where id = ts.id;
    return jsonb_build_object('status', ts.status, 'version', ts.version,
      'approved_at', ts.approved_at, 'rejected_at', ts.rejected_at, 'reject_note', ts.reject_note);
  end $f$;
  grant execute on function public.timesheet_decide(text, text, text, text, text) to anon, authenticated;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- H2 / H6 / H7. One ledger for every email the server sends on someone's behalf
-- ════════════════════════════════════════════════════════════════════════════
-- send-invite-email, send-proposal-email and timesheet-notify count a login's
-- sends here and stop at a daily cap, so a stolen or throwaway login cannot
-- turn TradeDesk's sending domain into a relay. Server-only table.
create table if not exists public.email_send_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  kind       text not null,
  recipient  text,
  created_at timestamptz not null default now()
);
create index if not exists email_send_log_user_day on public.email_send_log (user_id, kind, created_at desc);
alter table public.email_send_log enable row level security;
revoke all on public.email_send_log from anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- H7. A change to where the money goes is written down and the owner is told
-- ════════════════════════════════════════════════════════════════════════════
-- venmoUser (zj_data.settings, which a co-owner can edit) and
-- stripe_account_id (server only, see account_config_guard) are where client
-- payments land. Any change writes a row here that nobody but the server can
-- write; the payout-alert edge function emails the account owner about every
-- row not yet notified (pg_net fires it when the extension is present).
create table if not exists public.payout_change_log (
  id            bigint generated always as identity primary key,
  account_owner uuid not null,
  kind          text not null,
  old_value     text,
  new_value     text,
  changed_by    uuid,
  created_at    timestamptz not null default now(),
  notified_at   timestamptz
);
alter table public.payout_change_log enable row level security;
revoke all on public.payout_change_log from anon, authenticated;
grant select on public.payout_change_log to authenticated;
drop policy if exists "payout_change_log_owner_read" on public.payout_change_log;
create policy "payout_change_log_owner_read" on public.payout_change_log for select to authenticated
  using (account_owner::text = auth.uid()::text);

create or replace function public._td_payout_alert_kick()
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      execute $q$select net.http_post(
        url := 'https://mwtsmctajhrrybblgorf.supabase.co/functions/v1/payout-alert',
        body := '{}'::jsonb,
        headers := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 10000)$q$;
    exception when others then null;  -- a failed kick never blocks the save; the row waits
    end;
  end if;
end $$;
revoke execute on function public._td_payout_alert_kick() from public, anon, authenticated;

create or replace function public._td_json_field(p_text text, p_key text)
returns text
language plpgsql immutable
set search_path = public
as $$
begin
  return nullif(btrim(coalesce(p_text, '')::jsonb->>p_key), '');
exception when others then
  return null;
end $$;

do $$
begin
  if to_regclass('public.zj_data') is not null then
    create or replace function public.zj_data_payout_audit()
    returns trigger
    language plpgsql security definer
    set search_path = public
    as $f$
    declare o text; n text;
    begin
      o := public._td_json_field(old.settings, 'venmoUser');
      n := public._td_json_field(new.settings, 'venmoUser');
      if o is distinct from n then
        insert into payout_change_log (account_owner, kind, old_value, new_value, changed_by)
        values (new.user_id, 'venmo', o, n, (auth.uid()::text)::uuid);
        perform public._td_payout_alert_kick();
      end if;
      return null;
    end $f$;
    drop trigger if exists zj_data_payout_audit on public.zj_data;
    create trigger zj_data_payout_audit after update of settings on public.zj_data
      for each row execute function public.zj_data_payout_audit();
  end if;

  if to_regclass('public.account_config') is not null and to_regclass('public.accounts') is not null then
    create or replace function public.account_config_payout_audit()
    returns trigger
    language plpgsql security definer
    set search_path = public
    as $f$
    declare owner_uid uuid;
    begin
      if new.stripe_account_id is distinct from old.stripe_account_id then
        select a.owner_id into owner_uid from accounts a where a.id = new.account_id;
        if owner_uid is not null then
          insert into payout_change_log (account_owner, kind, old_value, new_value, changed_by)
          values (owner_uid, 'stripe', old.stripe_account_id, new.stripe_account_id, (auth.uid()::text)::uuid);
          perform public._td_payout_alert_kick();
        end if;
      end if;
      return null;
    end $f$;
    drop trigger if exists account_config_payout_audit on public.account_config;
    create trigger account_config_payout_audit after update of stripe_account_id on public.account_config
      for each row execute function public.account_config_payout_audit();
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- M1. Definer views were readable by anyone
-- ════════════════════════════════════════════════════════════════════════════
-- account_public let anon list every business's name, phone and logo. The
-- intake page needs ONE business, by the id in its QR link, so it asks for
-- exactly that through account_public_card. The view now runs as the caller
-- (members see their own account, as accounts' RLS says) and anon cannot read
-- it. v_derive_correction feeds accuracy_by_contractor (a definer function)
-- and nothing else.
create or replace function public.account_public_card(p_id uuid)
returns table (id uuid, business_name text, phone text, logo_data text, brand_color text)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if p_id is null or to_regclass('public.accounts') is null then return; end if;
  return query execute
    'select a.id, a.business_name, a.phone, a.logo_data, a.brand_color from public.accounts a where a.id = $1 limit 1'
    using p_id;
end $$;
revoke execute on function public.account_public_card(uuid) from public;
grant execute on function public.account_public_card(uuid) to anon, authenticated;

do $$
begin
  if to_regclass('public.account_public') is not null then
    execute 'alter view public.account_public set (security_invoker = true)';
    execute 'revoke all on public.account_public from anon';
  end if;
  if to_regclass('public.v_derive_correction') is not null then
    execute 'alter view public.v_derive_correction set (security_invoker = true)';
    execute 'revoke all on public.v_derive_correction from anon, authenticated';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- M2. Definer functions a stranger never needs
-- ════════════════════════════════════════════════════════════════════════════
-- Every SECURITY DEFINER function in public loses anon (and PUBLIC) EXECUTE,
-- except the few the signed-out pages really call:
--   check_login_methods     the sign-in screen, before a session exists. It
--                           does let a stranger ask whether an email has an
--                           account; kept because the login flow needs it.
--   timesheet_public/decide timesheet.html (no login)
--   proposal_sign_status, hub_signed_proposals, account_public_card,
--   _td_hub_exists          sign.html, client.html, intake.html, and the
--                           client-upload storage policy
--   log_proposal_step, log_proposal_view_with_count
--                           kept as they were; their edge function uses the
--                           service role, but an older cached page may not.
-- Functions that RLS policies call (crew_perm, is_co_owner, has_team_perm,
-- ...) run with the caller's rights, and no table anon touches has such a
-- policy (checked 2026-09-27: inbound_leads, qr_sources, proposal_views), so
-- closing them to anon cannot turn an anonymous insert into an error.
do $$
declare
  r record;
  had_auth boolean;
begin
  for r in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
      and p.proname not in ('check_login_methods', 'timesheet_public', 'timesheet_decide',
                            'proposal_sign_status', 'hub_signed_proposals', 'account_public_card',
                            '_td_hub_exists', 'log_proposal_step', 'log_proposal_view_with_count')
  loop
    -- Whatever a signed-in user could call before, they still can: if
    -- authenticated only had EXECUTE through PUBLIC, it is granted directly
    -- before PUBLIC is revoked. Nothing new is opened to authenticated here.
    had_auth := has_function_privilege('authenticated', r.oid, 'EXECUTE');
    execute format('revoke execute on function %s from public, anon', r.sig);
    if had_auth then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
  -- timesheet_claim is only ever called from inside timesheet_public and
  -- timesheet_decide, which run as the owner.
  if to_regprocedure('public.timesheet_claim(uuid, text)') is not null then
    execute 'revoke execute on function public.timesheet_claim(uuid, text) from authenticated';
  end if;
end $$;

-- The eleven functions with a mutable search_path get a pinned one. Same
-- schemas they already resolve against, so nothing changes but the pin.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname in ('county_field_defs', 'device_tokens_touch', 'geo_radio_day', 'geo_street_line',
                        'get_account_delta', 'live_activity_tokens_touch', 'ops_metric_defs',
                        'prevent_undeletion', 'td_addr_key', 'team_members_owner_fill', 'timesheet_window')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, extensions', r.sig);
  end loop;
end $$;
