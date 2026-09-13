-- geo_answer_visit, widened past held visits (owner 2026-09-13)
--
-- "There are times he could go to his dads shop and it not be work related,
-- just visiting his old man."
--
-- The function already does exactly the right thing: 'personal' writes
-- source='dismissed' and stamps fixed_at, and geo_replace_day keeps an
-- answered source across every rebuild after that. One guard stopped it being
-- useful:
--
--   if row.source not in ('client-held','client','dismissed') then
--     raise exception 'geo_answer_visit: not a held visit';
--
-- So a held visit at a family address could be answered and a two-hour dwell
-- at a real shop could not, even though the shop row is the one MORE likely to
-- be wrong: the deriver is completely certain about where somebody was and
-- knows nothing at all about why. Working and visiting your dad look identical
-- from the outside, and no rule reaches that, because the information is not
-- in the data. The person is the only source of truth about intent, so every
-- derived row has to be answerable.
--
-- MANUAL ROWS ARE STILL REFUSED, and that is not an oversight. A manual clock
-- is somebody's own record and lives in td_time_entries, where deleting it
-- actually deletes it (deleteTimeEntry, js/jobs.js). Answering is for rows the
-- deriver would otherwise write again tomorrow.
--
-- PER ROW, NEVER PER PLACE. fixed_at is already per-row, so the next visit to
-- the same shop derives normally. Teaching the app that the shop is personal
-- would stop him being paid for the shop, which is the opposite of the ask.
create or replace function geo_answer_visit(p_id uuid, p_mode text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  me   uuid := (auth.uid()::text)::uuid;
  row  job_time_entries%rowtype;
  src  text;
begin
  if me is null then raise exception 'geo_answer_visit: not signed in'; end if;
  select * into row from job_time_entries where id = p_id and deleted_at is null;
  if row.id is null then raise exception 'geo_answer_visit: no such visit'; end if;
  if me <> row.employee_user_id and me <> row.contractor_user_id then
    raise exception 'geo_answer_visit: not your visit';
  end if;
  -- A DENYLIST, deliberately, where this used to be an allowlist. Every source
  -- the deriver invents from here on is answerable the day it ships; a new one
  -- that silently could not be overruled would be the bug, not the safeguard.
  if coalesce(row.source,'') = 'manual' then
    raise exception 'geo_answer_visit: manual entries are edited or deleted, not answered';
  end if;
  src := case p_mode when 'working' then 'client' when 'personal' then 'dismissed' else null end;
  if src is null then raise exception 'geo_answer_visit: mode must be working or personal'; end if;
  update job_time_entries set source = src, fixed_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'source', src);
end $$;

grant execute on function geo_answer_visit(uuid, text) to authenticated;
