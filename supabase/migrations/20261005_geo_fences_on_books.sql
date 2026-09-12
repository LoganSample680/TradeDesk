-- geo_fences_for, revision 3: rule 13's THIRD WITNESS (owner 2026-09-12).
--
-- "except for Laurie which we now tag as family and flag the question if it's
-- work or personal if there's no active job or proposal that's open on the
-- books."
--
-- Revision 2 gave the client fence `personal`, which takes the working-day
-- window away from a contact marked family and leaves two witnesses: a job on
-- the calendar THAT DAY, and a manual clock over the visit. Both are narrow.
-- A live job at a family member's address is business whether or not today is
-- one of its scheduled days, and a proposal still sitting out there unanswered
-- is itself the reason to be at the address: walking it, measuring, chasing
-- the signature.
--
-- So the fence now also carries `on_books`, and it is deliberately NOT
-- date-bound the way `scheduled` is. The two status vocabularies are
-- _GEO_OPEN_JOB and _GEO_OPEN_BID in js/geo-track.js and they must say the
-- same thing here; tests/fixtures/geo-fences-case.json is checked against BOTH
-- halves (the browser one in tests/e2e-geo-fences-server.spec.js, this one in
-- scripts/ci/geo-fences-equivalence.sql), which is what stops them drifting.
--
-- A Draft bid never counts: nothing has been put in front of the client, so it
-- is evidence of nothing. Neither does a finished job or a lost bid.
--
-- Additive and idempotent: a new nullable output column, null on every kind
-- but client, false for a client with nothing open. Rule 13 reads it only to
-- give a family contact a reprieve, so a null leaves every other client
-- exactly as they were.

drop function if exists geo_fences_for(uuid, date);

create or replace function geo_fences_for(p_contractor uuid, p_day date)
returns table (
  id text, kind text, name text, lat double precision, lng double precision,
  addr text, place_id text, client_id text, job_id text,
  scheduled boolean, radius_ft numeric, personal boolean, on_books boolean
)
language sql stable security definer set search_path = public as $$
  with jb as (
    select j.id as jid,
           j.data as jd,
           nullif(btrim(coalesce(j.data->>'start', j.data->>'date', '')), '') as start_key,
           greatest(coalesce(nullif(j.data->>'days','')::int, 1), 1) as days
      from td_jobs j
     where j.user_id = p_contractor
       and j.deleted_at is null
       and coalesce(j.data->>'status','') <> 'canceled'
       and coalesce(j.data->>'status','') <> 'done'
       and coalesce(j.data->>'cancelled','false') not in ('true','1')
       and (j.data->>'completion_date') is null
  ),
  active as (
    select * from jb
     where start_key is not null
       and start_key::date <= p_day
       and (start_key::date + (days - 1)) >= p_day
  ),
  cfg as (
    select (z.settings::jsonb) as s from zj_data z where z.user_id = p_contractor
  )
  -- shop
  select 'shop'::text,
         'shop'::text,
         coalesce(nullif(btrim(coalesce((select s->>'bname' from cfg), '')), '') || ' shop', 'Shop'),
         (select s->>'officeLat' from cfg)::double precision,
         (select s->>'officeLon' from cfg)::double precision,
         coalesce((select s->>'baddr' from cfg), ''),
         null::text, null::text, null::text, null::boolean,
         nullif((select s->>'geoFenceRadius' from cfg), '')::numeric,
         null::boolean, null::boolean
   where (select s->>'officeLat' from cfg) is not null
     and (select s->>'officeLon' from cfg) is not null

  union all
  -- places
  select 'place-' || p.id,
         coalesce(nullif(p.data->>'kind',''), 'other'),
         coalesce(p.data->>'name', ''),
         (p.data->>'lat')::double precision,
         (p.data->>'lon')::double precision,
         coalesce(p.data->>'addr', ''),
         p.id, null::text, null::text, null::boolean,
         nullif(p.data->>'fenceFt','')::numeric,
         null::boolean, null::boolean
    from td_places p
   where p.user_id = p_contractor and p.deleted_at is null
     and (p.data->>'lat') is not null and (p.data->>'lon') is not null

  union all
  -- clients. The coordinates must belong to the address the client has NOW:
  -- somebody who moved must not keep a fence on the old house, which is the
  -- same guard the device cache has always applied.
  select 'client-' || c.id,
         'client'::text,
         coalesce(nullif(c.data->>'name',''), 'Client'),
         (c.data->>'lat')::double precision,
         (c.data->>'lon')::double precision,
         coalesce(c.data->>'addr', ''),
         null::text, c.id, null::text,
         exists (select 1 from active a where a.jd->>'client_id' = c.id),
         null::numeric,
         -- Family or personal. Absent on every client saved before this
         -- existed, which reads as false and leaves rule 13 exactly as it was.
         coalesce((c.data->>'personal') in ('true','1'), false),
         -- OPEN ON THE BOOKS. The SQL half of _GEO_OPEN_JOB / _GEO_OPEN_BID
         -- (js/geo-track.js). Not date-bound the way `scheduled` is.
         (exists (select 1 from td_jobs j2
                   where j2.user_id = p_contractor and j2.deleted_at is null
                     and j2.data->>'client_id' = c.id
                     and coalesce(j2.data->>'status','') in
                         ('upcoming','active','in progress','scheduled'))
          or exists (select 1 from td_bids b2
                      where b2.user_id = p_contractor and b2.deleted_at is null
                        and b2.data->>'client_id' = c.id
                        and coalesce(b2.data->>'status','') in
                            ('Pending','sent','Sent','opportunity','Won','Closed Won')))
    from td_clients c
   where c.user_id = p_contractor and c.deleted_at is null
     and nullif(btrim(coalesce(c.data->>'addr','')), '') is not null
     and (c.data->>'lat') is not null and (c.data->>'lon') is not null
     and (c.data->>'geoAddr') = (c.data->>'addr')

  union all
  -- jobs active on the day
  select 'job-' || a.jid,
         'job'::text,
         -- A JOB FENCE IS NAMED FOR ITS CLIENT, not the job (20260929).
         coalesce(
           nullif((select c.data->>'name' from td_clients c
                    where c.user_id = p_contractor and c.deleted_at is null
                      and c.id = a.jd->>'client_id'), ''),
           nullif(a.jd->>'name',''),
           'Job'),
         (a.jd->>'lat')::double precision,
         (a.jd->>'lon')::double precision,
         coalesce(a.jd->>'addr', a.jd->>'address', ''),
         null::text, null::text, a.jid, null::boolean,
         null::numeric,
         -- A JOB IS WORK, whoever the client is. Rule 13 never asks about a
         -- job fence, and marking the contact must not change that: a
         -- scheduled job at a family member's address is exactly the case
         -- the flag is designed to keep counting.
         null::boolean, null::boolean
    from active a
   where (a.jd->>'lat') is not null and (a.jd->>'lon') is not null;
$$;

revoke all on function geo_fences_for(uuid, date) from anon, authenticated;
grant execute on function geo_fences_for(uuid, date) to authenticated;
