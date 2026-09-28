-- Wake a phone that went quiet after backgrounding (owner 2026-09-28: "do the
-- swipe fix", "go do it all").
--
-- Every two minutes pg_cron POSTs to the wake-quiet edge function, which finds
-- each phone whose last word to the server was "backgrounded" three to twenty
-- minutes ago, inside the working day, and sends it one silent push. Jack's
-- app sat dark for up to 18 minutes after a close because nothing woke it
-- until the half-hour ping (20260901_geo_ping_pg_cron).
--
-- The function asks, per person, for the newest row the server has heard. That
-- needs an index on (employee_user_id, created_at): the existing ones are per
-- type or on event time. Additive, no data touched.
create index if not exists geo_events_person_created_all_idx
  on public.geo_events (employee_user_id, created_at desc);

-- No `create extension` here, on purpose: pg_cron and pg_net are already on
-- the project (20260901), and a plain Postgres (the migration lint runner)
-- has neither, so the block below simply skips there.
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      perform cron.unschedule('geo-wake-quiet');
    exception when others then null;
    end;
    perform cron.schedule(
      'geo-wake-quiet',
      '*/2 * * * *',
      $job$
      select net.http_post(
        url := 'https://mwtsmctajhrrybblgorf.supabase.co/functions/v1/wake-quiet',
        body := '{}'::jsonb,
        headers := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 30000
      )
      $job$
    );
  end if;
end
$do$;
