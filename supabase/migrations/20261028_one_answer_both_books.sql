-- ════════════════════════════════════════════════════════════════════════
-- ONE ANSWER, ONE TRANSACTION, BOTH BOOKS (owner 2026-09-20)
--
-- "Home Depot runs aren't staying personal and aren't removing their drives
-- from mileage or time sheet." His 19 September, hours after he answered it:
--
--   job_time_entries  j-30a2b589-mu903o4m   source 'dismissed', answered ✓
--   td_mileage        j-30a2b589-mu903o4m   pendingReceipt true, personal —
--
-- One trip, two books, two different stories. The card reads the MILEAGE row,
-- so the run he had already answered was still sitting on the dashboard
-- asking him again. That is the whole of "not staying personal": the answer
-- stuck perfectly well in the book nobody was looking at.
--
-- Why they split: geo_answer_supply_run writes the time rows here, on the
-- server, while the mileage half was written only in the browser
-- (_supplyRunSettleByKeys, js/mileage.js) and left to reach the server on the
-- next sync, fire-and-forget, with its failure swallowed. Two writes, two
-- paths, two chances to land, and no way for the person to know only one did.
--
-- So the RPC writes both, in the one transaction it already had. The browser
-- still mutates its own copy first, because the card must come off the screen
-- the instant it is tapped, but that is now an echo of the authoritative
-- write rather than the only record of it.
--
-- Deliberately NOT extended to the receipt answers ('no receipt', 'scan a
-- receipt'). Those change the mileage row alone: there is no second book for
-- them to disagree with, so they are not this bug and widening the door to
-- reach them would be scope this owner did not ask for.
-- ════════════════════════════════════════════════════════════════════════

create or replace function geo_answer_supply_run(p_key text, p_mode text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  me    uuid := (auth.uid()::text)::uuid;
  keys  text[];
  n     int := 0;
  n_mi  int := 0;
begin
  if me is null then raise exception 'geo_answer_supply_run: not signed in'; end if;
  if coalesce(p_key,'') = '' then raise exception 'geo_answer_supply_run: key required'; end if;
  if p_mode not in ('personal','working') then
    raise exception 'geo_answer_supply_run: mode must be personal or working';
  end if;

  -- The legs of this run, and the two row keys each one owns. Scoped to the
  -- caller's own mileage: a key is just an id, so it must never be able to
  -- reach across accounts.
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
    return jsonb_build_object('key', p_key, 'mode', p_mode, 'rows', 0, 'miles', 0);
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

  -- ── AND THE OTHER BOOK, IN THE SAME BREATH ─────────────────────────────
  -- The same two sentences js/mileage.js says locally, said here so they are
  -- true on the server whether or not that device ever syncs again:
  --   personal → off the books, and the receipt question is settled
  --   working  → back on the books, keeping the receipt answer he gave
  -- 'personal' and 'noReceipt' are mutually exclusive by construction: each
  -- arm drops the other, so a row can never end up claiming both.
  update td_mileage m
     set data = case when p_mode = 'personal'
                     then (m.data - 'pendingReceipt' - 'noReceipt')
                          || jsonb_build_object('personal', true)
                     else (m.data - 'personal' - 'pendingReceipt')
                          || jsonb_build_object('noReceipt', true)
                end,
         updated_at = now()
   where m.user_id = me
     and m.deleted_at is null
     and m.data->>'supplyRunKey' = p_key;
  get diagnostics n_mi = row_count;

  return jsonb_build_object('key', p_key, 'mode', p_mode, 'rows', n, 'miles', n_mi);
end $$;

revoke all on function geo_answer_supply_run(text, text) from anon;
grant execute on function geo_answer_supply_run(text, text) to authenticated;
