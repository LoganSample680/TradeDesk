-- The 30-minute geo nudge, server-side (owner 2026-08-27: "cron should tick
-- from uat and main"). A GitHub scheduled workflow can only ever tick from
-- the default branch, so the clock moves into the database itself: pg_cron
-- fires every 30 minutes and pg_net POSTs to push-geo-ping, which
-- silent-pushes every registered phone. This ticks for every environment at
-- once, whatever branch the app code is on, and keeps ticking if GitHub is
-- down. The GH workflow (geo-ping-cron.yml) stays as a manual tester and
-- fallback; the function's 20-minute cron_watermarks gate makes any overlap
-- between the two harmless.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    -- Idempotent re-run: replace, never stack.
    begin
      perform cron.unschedule('geo-ping-nudge');
    exception when others then null;
    end;
    perform cron.schedule(
      'geo-ping-nudge',
      '*/30 * * * *',
      $job$
      select net.http_post(
        url := 'https://mwtsmctajhrrybblgorf.supabase.co/functions/v1/push-geo-ping',
        body := '{}'::jsonb,
        headers := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 30000
      )
      $job$
    );
  end if;
end
$do$;
