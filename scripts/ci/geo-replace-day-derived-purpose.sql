\set ON_ERROR_STOP on
-- ── A purpose the deriver wrote is no answer (20261062) ────────────────────
--
-- Logan, 2026-10-01: one drive from John Doe's to the shop, 12:04 to 12:25.
-- The server described it at 13:00 starting 12:11 (journey j-SRV); the phone
-- described it again at 13:15 starting 12:04 (journey j-PHN). Both carried the
-- deriver's own purpose 'Shop', step 6b read that as a person's answer, and
-- both 3.3 mi legs stayed. Replayed in order, with what must still survive.

do $$
declare
  u  uuid := '88888888-8888-4888-8888-888888888888';
  d  text := (current_date - 1)::text;
  a  timestamptz := (current_date - 1)::timestamptz;
  b  timestamptz := (current_date)::timestamptz;
  iso text := 'YYYY-MM-DD"T"HH24:MI:SS"Z"';
  leg jsonb;
  res jsonb;
  n int;
begin
  insert into auth.users (id, email) values (u, 'ci-derived-purpose@example.test') on conflict (id) do nothing;
  delete from td_mileage where user_id = u;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);

  -- Legs a person answered, and one that does not overlap: none may go.
  insert into td_mileage (id, user_id, data, deleted_at) values
    ('j-PICKED', u, jsonb_build_object('id','j-PICKED','gps',true,'date',d,'miles',2,'purpose','Shop','purposeAt','2026-10-01T18:00:00Z',
       'startedIso', to_char(a + interval '17h 06m', iso), 'endedIso', to_char(a + interval '17h 10m', iso)), null),
    ('j-OWNWORD', u, jsonb_build_object('id','j-OWNWORD','gps',true,'date',d,'miles',2,'purpose','Job site',
       'startedIso', to_char(a + interval '17h 13m', iso), 'endedIso', to_char(a + interval '17h 15m', iso)), null),
    ('j-NOTED', u, jsonb_build_object('id','j-NOTED','gps',true,'date',d,'miles',2,'purpose','Business','notes','picked up fittings',
       'startedIso', to_char(a + interval '17h 16m', iso), 'endedIso', to_char(a + interval '17h 18m', iso)), null),
    ('j-LATER', u, jsonb_build_object('id','j-LATER','gps',true,'date',d,'miles',2,'purpose','Shop',
       'startedIso', to_char(a + interval '19h 00m', iso), 'endedIso', to_char(a + interval '19h 10m', iso)), null);

  -- 1. The server's description at 13:00.
  leg := jsonb_build_object('id','j-SRV','gps',true,'date',d,'miles',3.3,'purpose','Shop',
    'startedIso', to_char(a + interval '17h 11m 32s', iso), 'endedIso', to_char(a + interval '17h 19m 47s', iso));
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, jsonb_build_array(leg), false, null);
  if (res->>'locked') = 'true' then raise exception 'derived-purpose: day unexpectedly locked'; end if;

  -- 2. The phone's description at 13:15, a new journey id over the same drive.
  leg := jsonb_build_object('id','j-PHN','gps',true,'date',d,'miles',3.3,'purpose','Shop',
    'startedIso', to_char(a + interval '17h 04m 55s', iso), 'endedIso', to_char(a + interval '17h 25m 52s', iso));
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, jsonb_build_array(leg), false, null);

  -- One trip, one leg: the newer description stands, the older is retired.
  select count(*) into n from td_mileage where user_id = u and deleted_at is null and id in ('j-SRV','j-PHN');
  if n <> 1 then raise exception 'derived-purpose: one drive is still % legs', n; end if;
  select count(*) into n from td_mileage where user_id = u and deleted_at is null and id = 'j-PHN';
  if n <> 1 then raise exception 'derived-purpose: the newer description is not the one that stood'; end if;
  if (res->'superseded'->>'miles')::int <> 1 then
    raise exception 'derived-purpose: expected 1 superseded leg, got %', res->'superseded';
  end if;

  -- What a person did survives, even inside the drive's window.
  select count(*) into n from td_mileage where user_id = u and deleted_at is null
    and id in ('j-PICKED','j-OWNWORD','j-NOTED','j-LATER');
  if n <> 4 then raise exception 'derived-purpose: retired a leg a person answered or one outside the drive (% of 4 left)', n; end if;

  -- A person's pick rides across a re-derive of the same leg, stamp included.
  update td_mileage set data = data || jsonb_build_object('purpose','Client Consult','purposeAt','2026-10-01T19:00:00Z')
   where user_id = u and id = 'j-PHN';
  res := geo_replace_day(u, u, d, a, b, '[]'::jsonb, '[]'::jsonb, jsonb_build_array(leg), false, null);
  select count(*) into n from td_mileage where user_id = u and id = 'j-PHN' and deleted_at is null
    and data->>'purpose' = 'Client Consult' and data ? 'purposeAt';
  if n <> 1 then raise exception 'derived-purpose: a person''s purpose did not survive the re-derive'; end if;

  raise notice 'derived-purpose: one drive is one leg, and every person''s answer stays';
end $$;
