-- ── PERSONAL HAS TO REACH THE HOURS TOO (owner 2026-09-16) ────────────────
--
-- "Personal should remove the mileage and the timesheet will then have a
-- personal hole and exclude itself from time."
--
-- Today Personal on a supply-run receipt card only ever touched the MILEAGE
-- row. Jack's Neenans run came off his deductible miles and left forty-four
-- minutes of drive and dwell sitting on his timesheet as paid work, so the app
-- told him two different stories about one trip. He is also right that the
-- button belongs there: "there could be times where a trip from a supply house
-- could be personal."
--
-- One trip, one answer, both books. This is the door for the time half, and it
-- is deliberately the SAME shape as geo_answer_visit (20261011): source
-- 'dismissed' plus answered_at, which the reader already draws as a grey
-- Personal row in no total, with the one chip that takes it back. The hole he
-- described is a row that says what it is, not a blank: a blank is what the
-- blend fills back in with paid time, which is the bug we spent this morning
-- on.
--
-- Keyed by the SUPPLY RUN, not by row id, because that is what the card is
-- about: a day and a store. The mileage legs carry supplyRunKey; each leg's id
-- is the drive row's client_key, and the dwell at the far end is 'd-' || that
-- id. So the key names the legs and the legs name the rows, with nothing for
-- the phone to look up or get wrong.

create or replace function geo_answer_supply_run(p_key text, p_mode text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  me    uuid := (auth.uid()::text)::uuid;
  keys  text[];
  src   text;
  n     int := 0;
begin
  if me is null then raise exception 'geo_answer_supply_run: not signed in'; end if;
  if coalesce(p_key,'') = '' then raise exception 'geo_answer_supply_run: key required'; end if;
  if p_mode not in ('personal','working') then
    raise exception 'geo_answer_supply_run: mode must be personal or working';
  end if;

  -- The legs of this run, and the two row keys each one owns. Scoped to the
  -- caller's own mileage: a key is just a date and a store name, so it must
  -- never be able to reach across accounts.
  select array_agg(k) into keys from (
    select m.id as k from td_mileage m
     where m.user_id = me and m.deleted_at is null
       and m.data->>'supplyRunKey' = p_key
    union all
    select 'd-' || m.id from td_mileage m
     where m.user_id = me and m.deleted_at is null
       and m.data->>'supplyRunKey' = p_key
  ) x;
  if keys is null or array_length(keys,1) is null then
    return jsonb_build_object('key', p_key, 'mode', p_mode, 'rows', 0);
  end if;

  -- WORKING RESTORES WHAT THE DERIVER SAID, it does not guess a source. A
  -- drive row is a drive and a dwell at a supply fence is a supply house;
  -- those are the only two shapes a supply run has. answered_at still moves,
  -- because taking an answer back is itself an answer and must survive the
  -- next rebuild exactly as the first one did.
  update job_time_entries t
     set source = case
           when p_mode = 'personal' then 'dismissed'
           when t.client_key like 'd-%' then 'place-supply'
           else 'drive' end,
         answered_at = now()
   where t.employee_user_id = me
     and t.deleted_at is null
     and t.client_key = any(keys)
     -- A row a person hand-corrected the TIMES on keeps its own source; that
     -- is fixed_at's job and this must not talk over it.
     and t.fixed_at is null;
  get diagnostics n = row_count;

  return jsonb_build_object('key', p_key, 'mode', p_mode, 'rows', n);
end $$;

revoke all on function geo_answer_supply_run(text, text) from anon;
grant execute on function geo_answer_supply_run(text, text) to authenticated;
