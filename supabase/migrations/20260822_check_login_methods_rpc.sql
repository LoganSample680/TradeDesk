-- Identifier-first sign-in gate (owner design 2026-08-22): the login screen no
-- longer shows Apple/Google buttons blind. A visitor types their email first,
-- this RPC reports which sign-in methods that email actually has on file, and
-- the UI surfaces exactly those, Face ID for a linked Apple identity, Google,
-- or a password field. A brand-new visitor never reaches this branch at all
-- (they use "Create your account" instead), so this closes the duplicate-
-- account problem structurally: a returning contractor can no longer
-- accidentally create a second account through a social button, because the
-- button doesn't exist until we've confirmed which methods their real
-- account has.
--
-- Called from a completely unauthenticated visitor (that's the whole point,
-- this runs BEFORE sign-in), so it must run SECURITY DEFINER and be granted
-- to anon, same pattern as claim_crew_by_email (20260718) for the "no session
-- yet" problem, just for a different caller. Deliberately returns ONLY
-- booleans, never any other account data: this exists to route a real sign-in
-- flow, not to become a data-enumeration oracle. Confirming "an account
-- exists for this email" is the same disclosure every "forgot password" flow
-- already makes (supaForgotPassword already exists here), not a new exposure.

create or replace function check_login_methods(check_email text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  uid uuid;
  providers text[];
begin
  if check_email is null or check_email = '' then
    return jsonb_build_object('exists', false, 'hasPassword', false, 'hasApple', false, 'hasGoogle', false);
  end if;
  select id into uid from auth.users where lower(email) = lower(check_email) limit 1;
  if uid is null then
    return jsonb_build_object('exists', false, 'hasPassword', false, 'hasApple', false, 'hasGoogle', false);
  end if;
  select array_agg(distinct provider) into providers from auth.identities where user_id = uid;
  return jsonb_build_object(
    'exists', true,
    'hasPassword', coalesce('email' = any(providers), false),
    'hasApple', coalesce('apple' = any(providers), false),
    'hasGoogle', coalesce('google' = any(providers), false)
  );
end $$;

grant execute on function check_login_methods(text) to anon, authenticated;
