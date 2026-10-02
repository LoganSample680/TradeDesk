\set ON_ERROR_STOP on
-- ── How each phone is doing (20261061, 20261063) ─────────────────────────
--
-- One work day for one phone, written the way the plugin writes it, then
-- every number the Phones card shows is checked against what a person would
-- work out by hand. The traps are the ones real days hit: a truck charger at
-- 10am, an app killed with GPS still on, a reading after 6pm, a stranger
-- asking for somebody else's phone.
--
-- Day: 2026-09-30, Central (UTC-5). 13:00Z is 8:00am.

do $$
declare
  p  uuid := '66666666-6666-4666-8666-666666666666';
  x  uuid := '77777777-7777-4777-8777-777777777777';
  ad uuid := '00000000-0000-4000-8000-0000000000ad';
  dy date := date '2026-09-30';
  r  record;
  n  int;
  br jsonb;
  dev jsonb;
begin
  insert into auth.users (id, email) values (p, 'ci-phone@example.test') on conflict (id) do nothing;
  insert into auth.users (id, email) values (x, 'ci-stranger@example.test') on conflict (id) do nothing;
  insert into auth.users (id, email) values (ad, 'ci-admin@example.test') on conflict (id) do nothing;
  delete from geo_events where employee_user_id = p;

  insert into geo_events (contractor_user_id, employee_user_id, type, ts, region_id, kind, detail) values
    -- Battery: 100 -> 95 over an hour, on the charger back to 100, then 100 -> 90
    -- over an hour. 15 points lost in 2 hours of discharge: 7.5 an hour. The
    -- charge must not count, and first-to-last (100 -> 90 over 3h) would say 3.3.
    (p, p, 'battery', '2026-09-30 13:00Z', '', 'battery 100', null),
    (p, p, 'battery', '2026-09-30 14:00Z', '', 'battery 95',  null),
    (p, p, 'battery', '2026-09-30 15:00Z', '', 'battery 100', null),
    (p, p, 'battery', '2026-09-30 16:00Z', '', 'battery 90',  null),
    -- 6:30pm, after work: not part of the working day.
    (p, p, 'battery', '2026-09-30 23:30Z', '', 'battery 50',  null),
    -- Wakes carrying the plugin's stats. Hottest is serious, Low Power was on
    -- once, Background App Refresh reads as the latest one said.
    (p, p, 'push-ping', '2026-09-30 13:05Z', '', null, '{"stats":{"th":"fair","lp":false,"bgr":"on","cpu":3.2,"mem":180,"loc":"always","acc":"full","net":"wifi"}}'),
    (p, p, 'push-ping', '2026-09-30 14:05Z', '', null, '{"stats":{"th":"serious","lp":true,"bgr":"off","cpu":12.5,"mem":210,"loc":"whenInUse","acc":"reduced","net":"cell","radio":"lte","lowData":true}}'),
    (p, p, 'heartbeat', '2026-09-30 15:05Z', '', null, null),
    (p, p, 'app-terminate', '2026-09-30 15:10Z', '', null, null),
    -- GPS: a 30 minute drive, then a burst whose "off" never arrived (the app
    -- was killed). The lost off counts two hours, not the rest of the day.
    (p, p, 'radio', '2026-09-30 13:10Z', 'drive', null, '{"on":true}'),
    (p, p, 'radio', '2026-09-30 13:40Z', 'drive', null, '{"on":false}'),
    (p, p, 'radio', '2026-09-30 17:00Z', 'burst', null, '{"on":true}'),
    -- The live watcher running alongside the drive is the same receiver: its
    -- 13:20 to 13:50 adds only the 10 minutes the drive did not cover.
    (p, p, 'radio', '2026-09-30 13:20Z', 'js-watcher', null, '{"on":true}'),
    (p, p, 'radio', '2026-09-30 13:50Z', 'js-watcher', null, '{"on":false}'),
    -- The realtime socket is not the GPS receiver.
    (p, p, 'radio', '2026-09-30 13:00Z', 'realtime', null, '{"on":true}'),
    (p, p, 'motion', '2026-09-30 13:09Z', '', 'automotive', null),
    -- Apple's report for the day that STARTED 9/30 8am, delivered the next
    -- morning. Normal exits are the app ending itself and do not count as
    -- iOS ending it; watchdog is the reason it gave most.
    (p, p, 'metrickit', '2026-10-01 13:00Z', '', null, jsonb_build_object('from', extract(epoch from timestamptz '2026-09-30 13:00Z') * 1000,
       'mx', jsonb_build_object('loc_nav_s', 600, 'loc_best_s', 1200, 'bg_loc_s', 7200, 'cpu_s', 90,
                                'bgx_normal', 3, 'bgx_watchdog', 2, 'bgx_mem_pressure', 1,
                                'cell_up_b', 2000000, 'cell_down_b', 8000000, 'bars', 3.2))),
    (p, p, 'mx-diag', '2026-10-01 13:00Z', '', null, jsonb_build_object('from', extract(epoch from timestamptz '2026-09-30 13:00Z') * 1000,
       'crashes', 1, 'hangs', 1, 'why', 'Namespace SPRINGBOARD')),
    -- A day in August, so a month and a year have more than one day in them:
    -- 80 -> 70 over two hours is 5.0 an hour, a 20 minute drive, one close.
    (p, p, 'battery', '2026-08-14 13:00Z', '', 'battery 80', null),
    (p, p, 'battery', '2026-08-14 15:00Z', '', 'battery 70', null),
    (p, p, 'radio', '2026-08-14 14:00Z', 'drive', null, '{"on":true}'),
    (p, p, 'radio', '2026-08-14 14:20Z', 'drive', null, '{"on":false}'),
    (p, p, 'app-terminate', '2026-08-14 16:00Z', '', null, null),
    -- The next window, which started 10/1: not part of 9/30.
    (p, p, 'metrickit', '2026-10-02 13:00Z', '', null, jsonb_build_object('from', extract(epoch from timestamptz '2026-10-01 13:00Z') * 1000,
       'mx', jsonb_build_object('cpu_s', 6000, 'bgx_cpu_limit', 9)));

  -- ── A stranger sees nothing ─────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, false);
  select count(*) into n from device_days_by_person(dy, dy) where person_user_id = p;
  if n <> 0 then raise exception 'a stranger read % day(s) of somebody else''s phone', n; end if;
  select count(*) into n from ops_device_hours(p, dy) where batt is not null or gps_min > 0;
  if n <> 0 then raise exception 'a stranger read % hour(s) of somebody else''s phone', n; end if;

  -- ── The person sees their own ───────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false);
  select * into r from device_days_by_person(dy, dy) where person_user_id = p;
  if r is null then raise exception 'the phone''s own person could not read their day'; end if;

  -- ── Every number, by hand ───────────────────────────────────────────────
  if r.drain_hr is distinct from 7.5 then raise exception 'drain: expected 7.5 an hour (charging skipped), got %', r.drain_hr; end if;
  if r.batt_first <> 100 or r.batt_last <> 90 or r.batt_low <> 90 then
    raise exception 'battery: expected 100 / 90 / low 90 (6:30pm excluded), got % / % / %', r.batt_first, r.batt_last, r.batt_low;
  end if;
  if r.heat is distinct from 'serious' then raise exception 'heat: expected serious, got %', r.heat; end if;
  if r.low_power_days <> 1 then raise exception 'low power: expected 1, got %', r.low_power_days; end if;
  if r.bg_refresh is distinct from 'off' then raise exception 'background refresh: expected the latest (off), got %', r.bg_refresh; end if;
  if r.gps_min <> 160 then raise exception 'gps: expected 160 (40 merged drive+watcher, 120 capped burst, realtime excluded), got %', r.gps_min; end if;
  if r.kills <> 1 or r.wakes <> 2 then raise exception 'kills/wakes: expected 1/2, got %/%', r.kills, r.wakes; end if;
  if r.cpu_max is distinct from 12.5 or r.mem_max is distinct from 210 then
    raise exception 'cpu/mem: expected 12.5/210, got %/%', r.cpu_max, r.mem_max;
  end if;

  -- Apple's report and the latest permission and network.
  if r.apple_gps_min <> 30 or r.apple_bg_loc_min <> 120 or r.apple_cpu_min <> 1.5 then
    raise exception 'apple: expected gps 30, background location 120, cpu 1.5; got %/%/%', r.apple_gps_min, r.apple_bg_loc_min, r.apple_cpu_min;
  end if;
  if r.ios_ended <> 3 or r.ended_why is distinct from 'watchdog' then
    raise exception 'ended: expected 3 by watchdog (normal exits excluded), got % %', r.ios_ended, r.ended_why;
  end if;
  if r.crashes <> 2 then raise exception 'crashes and hangs: expected 2, got %', r.crashes; end if;
  if r.cell_mb <> 10.0 or r.bars <> 3.2 then raise exception 'cell/bars: expected 10.0/3.2, got %/%', r.cell_mb, r.bars; end if;
  if r.loc_perm is distinct from 'while using, approximate' then raise exception 'permission: got %', r.loc_perm; end if;
  if r.network is distinct from 'LTE, Low Data' then raise exception 'network: got %', r.network; end if;

  -- ── The hour chart behind a tapped day ──────────────────────────────────
  select count(*) into n from ops_device_hours(p, dy);
  if n <> 24 then raise exception 'hours: expected 24 rows, got %', n; end if;
  select * into r from ops_device_hours(p, dy) where hour = 7;
  if r.batt is not null then raise exception 'hour 7: no reading yet, got %', r.batt; end if;
  select * into r from ops_device_hours(p, dy) where hour = 8;
  if r.batt <> 100 or r.gps_min <> 40 or r.flips <> 1 or r.wakes <> 1 or r.heat <> 'fair' then
    raise exception 'hour 8: expected batt 100, gps 30, 1 flip, 1 wake, fair; got %', row_to_json(r);
  end if;
  select * into r from ops_device_hours(p, dy) where hour = 9;
  if r.batt <> 95 or r.heat <> 'serious' or r.cpu_max <> 12.5 then raise exception 'hour 9: got %', row_to_json(r); end if;
  select * into r from ops_device_hours(p, dy) where hour = 10;
  if r.batt <> 100 or r.kills <> 1 then raise exception 'hour 10: got %', row_to_json(r); end if;
  select * into r from ops_device_hours(p, dy) where hour = 12;
  if r.gps_min <> 60 then raise exception 'hour 12: a bar is never past 60, got %', r.gps_min; end if;
  select * into r from ops_device_hours(p, dy) where hour = 13;
  if r.gps_min <> 60 then raise exception 'hour 13: the rest of the lost burst, got %', r.gps_min; end if;
  select * into r from ops_device_hours(p, dy) where hour = 14;
  if r.gps_min <> 0 then raise exception 'hour 14: the burst stops at its two hour cap, got %', r.gps_min; end if;

  -- ── Ops: the person view and the account brief read the same rows ────────
  insert into analytics_admins (user_id) values (ad) on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', ad, 'role', 'authenticated')::text, false);
  select count(*) into n from ops_device_days(p, dy - 1, dy);
  if n <> 1 then raise exception 'ops_device_days: expected 1 day, got %', n; end if;

  br := ops_account_brief(p, dy, dy);
  select s -> 'metrics' into dev from jsonb_array_elements(br -> 'sections') s where s ->> 'key' = 'device';
  if dev is null then raise exception 'the brief has no Phones section'; end if;
  if jsonb_array_length(dev) <> 20 then raise exception 'Phones: expected 20 metrics, got %', jsonb_array_length(dev); end if;
  if (select m ->> 'value' from jsonb_array_elements(dev) m where m ->> 'key' = 'ended_why') is distinct from 'watchdog' then
    raise exception 'brief reason differs from the person view: %', dev;
  end if;
  if (select m -> 'value' from jsonb_array_elements(dev) m where m ->> 'key' = 'drain_hr') <> to_jsonb(7.5) then
    raise exception 'brief drain differs from the person view: %', dev;
  end if;
  if (select (m ->> 'value')::int from jsonb_array_elements(dev) m where m ->> 'key' = 'gps_min') <> 160 then
    raise exception 'brief gps differs from the person view: %', dev;
  end if;
  -- Every column the person view shows is a registry key, so the page can label
  -- it from the brief and never from its own list (CLAUDE.md 18).
  select count(*) into n from ops_metric_defs() d where d.section = 'device'
     and d.key in ('drain_hr','batt_low','heat','low_power_days','bg_refresh','gps_min','kills','wakes','cpu_max','mem_max',
                   'apple_gps_min','apple_bg_loc_min','apple_cpu_min','ios_ended','ended_why','crashes','cell_mb','bars','loc_perm','network');
  if n <> 20 then raise exception 'registry: expected the 20 Phones keys, found %', n; end if;

  -- ── Days into months and years (device_rollup) ─────────────────────────
  select count(*) into n from ops_device_periods(p, date '2026-08-01', date '2026-09-30', 'month');
  if n <> 2 then raise exception 'months: expected August and September, got %', n; end if;
  select * into r from ops_device_periods(p, date '2026-08-01', date '2026-09-30', 'month') limit 1;
  if r.period <> date '2026-09-01' then raise exception 'months: newest first, got %', r.period; end if;
  if r.days <> 1 or r.drain_hr <> 7.5 or r.gps_min <> 160 or r.ended_why is distinct from 'watchdog' then
    raise exception 'September: expected the day it holds, got %', row_to_json(r);
  end if;
  select * into r from ops_device_periods(p, date '2026-01-01', date '2026-09-30', 'year');
  -- Totals add, rates average, the lowest is the lowest, peaks peak, the
  -- latest setting wins, and a reason only one month gave is still the reason.
  if r.period <> date '2026-01-01' or r.days <> 2 then raise exception 'year: expected 2026 with 2 days, got %', row_to_json(r); end if;
  if r.drain_hr <> 6.3 then raise exception 'year: drain averages 7.5 and 5.0 to 6.3, got %', r.drain_hr; end if;
  if r.batt_low <> 70 then raise exception 'year: lowest battery is August''s 70, got %', r.batt_low; end if;
  if r.gps_min <> 180 or r.kills <> 2 then raise exception 'year: gps 160 + 20, kills 1 + 1; got % %', r.gps_min, r.kills; end if;
  if r.heat is distinct from 'serious' or r.cpu_max <> 12.5 then raise exception 'year: peaks; got % %', r.heat, r.cpu_max; end if;
  if r.network is distinct from 'LTE, Low Data' then raise exception 'year: latest network; got %', r.network; end if;
  select count(*) into n from ops_device_periods(p, date '2026-01-01', date '2026-09-30', 'week');
  if n <> 0 then raise exception 'an unknown grain must return nothing, got %', n; end if;

  -- A stranger rolls up nothing either.
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, false);
  select count(*) into n from ops_device_periods(p, date '2026-01-01', date '2026-12-31', 'year');
  if n <> 0 then raise exception 'a stranger read % roll-up(s) of somebody else''s phone', n; end if;
  -- Naming the person does not get a stranger in either (20261063: the
  -- filter moved inside the scan, the access check did not move out of it).
  select count(*) into n from device_days_by_person(dy, dy, p);
  if n <> 0 then raise exception 'a stranger named the person and read % day(s)', n; end if;
  select count(*) into n from device_rollup(date '2026-01-01', dy, 'all', 'account', null, p);
  if n <> 0 then raise exception 'a stranger named the account and read % roll-up(s)', n; end if;

  -- ── Reading one person reads the same rows as reading everyone ──────────
  -- (20261063) The person and account filters only narrow the scan; a day
  -- must come out identical either way, or the fast path is a different
  -- definition.
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false);
  select count(*) into n from (
    (select * from device_days_by_person(date '2026-08-01', dy) where person_user_id = p
     except all select * from device_days_by_person(date '2026-08-01', dy, p))
    union all
    (select * from device_days_by_person(date '2026-08-01', dy, p)
     except all select * from device_days_by_person(date '2026-08-01', dy) where person_user_id = p)) d;
  if n <> 0 then raise exception 'the person filter changed % day row(s)', n; end if;
  select count(*) into n from (
    (select * from device_rollup(date '2026-08-01', dy, 'all', 'account') where contractor_user_id = p
     except all select * from device_rollup(date '2026-08-01', dy, 'all', 'account', null, p))
    union all
    (select * from device_rollup(date '2026-08-01', dy, 'all', 'account', null, p)
     except all select * from device_rollup(date '2026-08-01', dy, 'all', 'account') where contractor_user_id = p)) d;
  if n <> 0 then raise exception 'the account filter changed % roll-up row(s)', n; end if;
  select count(*) into n from device_days_by_person(dy, dy, x);
  if n <> 0 then raise exception 'naming another person returned % row(s) of this one', n; end if;

  raise notice 'Phones card: every number matches the day worked by hand';
end $$;

-- ── Nobody signed out can call any of it ────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['device_days_by_person(date,date,uuid,uuid)','ops_device_days(uuid,date,date)','ops_device_hours(uuid,date)','ops_metric_defs()',
                           'device_rollup(date,date,text,text,uuid,uuid)','ops_device_periods(uuid,date,date,text)'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute') then
      raise exception 'anon can call %', f;
    end if;
    if not has_function_privilege('authenticated', 'public.' || f, 'execute') then
      raise exception 'a signed-in user cannot call %', f;
    end if;
  end loop;
end $$;
