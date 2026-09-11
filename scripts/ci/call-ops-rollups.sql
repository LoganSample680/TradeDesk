\set ON_ERROR_STOP on
-- Become an ops admin. The gate is the whole reason these shipped broken: it
-- returns before the query runs, so a test that only proves 42501 proves
-- nothing about the query underneath it.
insert into analytics_admins (user_id) values ('00000000-0000-4000-8000-0000000000ad')
  on conflict do nothing;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000ad","role":"authenticated"}', false);
do $$
declare f record; n bigint; bad int := 0;
begin
  for f in
    select p.proname, pg_get_function_arguments(p.oid) as args
      from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
     where nsp.nspname = 'public'
       and p.prokind = 'f'
       and (p.proname like 'ops\_%' or p.proname like 'funnel\_%'
            or p.proname like 'usage\_%' or p.proname like 'control\_usage%'
            or p.proname like 'money\_%' or p.proname = 'signing_funnel'
            or p.proname like 'app\_%')
     order by p.proname
  loop
    begin
      if f.args = 'p_from date, p_to date' then
        execute format('select count(*) from %I(%L::date, %L::date)', f.proname, '2026-01-01', '2026-12-31') into n;
      elsif f.args = '' then
        execute format('select count(*) from %I()', f.proname) into n;
      else
        raise notice 'SKIP % (args: %)', f.proname, f.args; continue;
      end if;
      raise notice 'ok   % (% rows)', f.proname, n;
    exception when others then
      bad := bad + 1;
      raise warning 'CALL FAILED: % => %', f.proname, sqlerrm;
    end;
  end loop;
  if bad > 0 then
    raise exception '% ops rollup(s) throw when called. Applying a migration is not calling it.', bad;
  end if;
end $$;
