-- One round trip per phone upload instead of five (2026-09-28).
--
-- Every flush a phone sends to ingest-geo made these calls one after another:
-- check the device's flush key, look up the crew link, store the events and
-- read the device state. On 2026-09-27 phones flushed 14,212 times, which is
-- most of the 115,000 requests that day. This does the same four things, in
-- the same way, in one call.
--
-- The fifth call is gone rather than moved: it set
-- device_status.location_checked_at, a column device_status has never had
-- (it lives on team_members, 20260810). All 13,841 of those updates on
-- 2026-09-27 came back 400, so removing it changes nothing anybody sees.
--
-- The state machine, the deriver and everything they write are untouched;
-- this only changes how many trips it takes to get there.
--
--   p_uid    the poster. Trusted when p_key is null: ingest-geo already
--            proved it from the caller's JWT.
--   p_key    the per-device flush key, for the native caller that has no
--            session. Checked exactly as before: user, device and key must
--            all match a geo_flush_keys row, or nothing else happens.
--   p_rows   the normalized events, as ingest-geo builds them. Stored with
--            the same dedupe index as the old upsert, so a re-flushed buffer
--            is still a free no-op.
--   p_cid    the business the phone says it is working for (the hat, §9.10).
--
-- ── WHOSE ACCOUNT THE ROWS BELONG TO (owner 2026-09-28: "fix crew") ───────
-- The old lookup asked team_members for a `status` column it has never had,
-- so every one of them failed (12,952 on 2026-09-27 for one crew member
-- alone) and every crew member was filed as the owner of their own business.
-- The server's real-time timesheet never reached a crew member's employer.
--
-- It is not fixed by reading the link, because a person can hold two hats:
-- crew on an employer's account by day, owner of their own on the side, and
-- only the phone knows which one is on (zp3_hat_<uid>). The employer must
-- never see the side business. So the phone names the business and this
-- only checks it is allowed: the poster's own account, or one they hold an
-- ACTIVE crew link to. Anything else, or nothing at all (a phone still on
-- the old code), files under the poster exactly as before.
--
-- service_role only. Additive.
create or replace function public.geo_ingest_begin(
  p_uid uuid,
  p_device text,
  p_key text,
  p_rows jsonb,
  p_cid uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cid uuid := p_uid;
  v_name text := null;
  v_state jsonb := null;
  v_updated timestamptz := null;
begin
  if p_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'no valid auth');
  end if;
  if p_key is not null then
    if not exists (
      select 1 from geo_flush_keys
      where user_id = p_uid and device_id = coalesce(p_device, '') and key = p_key
    ) then
      return jsonb_build_object('ok', false, 'reason', 'no valid auth');
    end if;
  end if;

  if p_cid is not null and p_cid <> p_uid then
    select tm.name into v_name
    from team_members tm
    where tm.employee_user_id = p_uid and tm.contractor_user_id = p_cid and tm.active
    order by tm.created_at desc
    limit 1;
    if found then v_cid := p_cid; else v_name := null; end if;
  end if;

  if p_rows is not null and jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) > 0 then
    insert into geo_events (contractor_user_id, employee_user_id, device_id, type, ts,
                            lat, lon, region_id, kind, flip_id, arrival_ts, detail)
    select v_cid, p_uid, coalesce(p_device, ''), r.type, r.ts,
           r.lat, r.lon, coalesce(r.region_id, ''), r.kind, r.flip_id, r.arrival_ts, r.detail
    from jsonb_to_recordset(p_rows) as r(type text, ts timestamptz, lat numeric, lon numeric,
                                         region_id text, kind text, flip_id text,
                                         arrival_ts timestamptz, detail jsonb)
    on conflict (employee_user_id, type, ts, region_id) do nothing;
  end if;

  select s.state, s.updated_at into v_state, v_updated
  from geo_device_state s
  where s.employee_user_id = p_uid and s.device_id = coalesce(p_device, '');

  return jsonb_build_object('ok', true, 'cid', v_cid, 'emp_name', v_name,
                            'state', v_state, 'state_updated_at', v_updated);
end;
$$;

revoke all on function public.geo_ingest_begin(uuid, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.geo_ingest_begin(uuid, text, text, jsonb, uuid) to service_role;
