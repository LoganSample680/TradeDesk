-- A contact the owner has marked as family, carried onto the fence.
--
-- Owner 2026-09-12: "Add in ability to mark a contact as family member so time
-- flags itself as need marked personal or work, thought we did that but don't
-- see it on lead record."
--
-- Rule 13 (js/geo-derive.js) has been answering this question by INFERENCE
-- since 2026-09-04, from his own words about doing work at his mother's
-- address, and the rule's own comment names the case it could not close:
-- "a genuinely personal weekday afternoon at a client with nothing scheduled
-- counts." Marking the contact is him answering that in advance.
--
-- What the flag does, precisely: it takes away ONE of rule 13's three
-- witnesses, the working-day window, which is the widest and only ever
-- existed to cover the forgetful contractor for free. A job on the calendar
-- still vouches, because a scheduled job at a family member's address is
-- work, and so does a manual clock running over the visit, because that is
-- the person saying so. Merely being there on a Tuesday no longer counts.
--
-- The deriver reads fence.personal, so the phone and the server both need it
-- on the fence or they would grade the same visit differently, which is the
-- one thing the equivalence harness exists to stop
-- (tests/e2e-geo-fences-server.spec.js, scripts/ci/geo-fences-equivalence.sql).
--
-- DROP first: create or replace cannot add a column to a function's return
-- type. Same body as 20260929 with one column and one expression added.

drop function if exists geo_fences_for(uuid, date);

create or replace function geo_fences_for(p_contractor uuid, p_day date)
returns table (
  id text, kind text, name text, lat double precision, lng double precision,
  addr text, place_id text, client_id text, job_id text,
  scheduled boolean, radius_ft numeric, personal boolean
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
         null::boolean
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
         null::boolean
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
         coalesce((c.data->>'personal') in ('true','1'), false)
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
         null::boolean
    from active a
   where (a.jd->>'lat') is not null and (a.jd->>'lon') is not null;
$$;

revoke all on function geo_fences_for(uuid, date) from anon, authenticated;
grant execute on function geo_fences_for(uuid, date) to authenticated;
