-- The server deriver reads two settings, not the whole blob (2026-09-28).
--
-- Supabase cut the whole project off on 2026-09-28: egress 6.02 GB of the
-- 5.5 GB free quota. The cause was zj_data.settings. It is one text column
-- holding every account setting, and since 2026-09-21 one account's copy also
-- held its logo as 1.5 MB of base64. derive-day (supabase/functions/_shared/
-- derive-day.mjs) read that whole column on every geo ingest, about 1,000 to
-- 1,300 times a day, to use two keys out of it: workHours and timeOff.
--
-- settings is text, so PostgREST cannot pick keys out of it. This returns just
-- those two, a few hundred bytes whatever else the blob grows to hold.
-- service_role only: it is for edge functions, and a browser already reads
-- its own settings through zj_data's own policies. A blob that is not valid
-- JSON returns null and the caller keeps its defaults, the same as the old
-- JSON.parse catch. Additive: nothing is changed or dropped.
create or replace function public.geo_work_settings(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s jsonb;
begin
  select settings::jsonb into s from zj_data where user_id = p_user;
  if s is null then return null; end if;
  return jsonb_build_object('workHours', s->'workHours', 'timeOff', s->'timeOff');
exception when others then
  return null;
end;
$$;

revoke all on function public.geo_work_settings(uuid) from public, anon, authenticated;
grant execute on function public.geo_work_settings(uuid) to service_role;
