-- Step 2 of running the deriver anywhere but the phone: the fence list.
--
-- geoDeriveDay (js/geo-derive.js) is pure and portable, 1,725 lines with zero
-- browser globals. _geoDeriveFences (js/geo-track.js) is not: it reads S,
-- places, clients, jobs and a localStorage geocode cache off the window. It is
-- the ONE piece that has to exist in two places, so it is the one piece that
-- can drift, and the equivalence test in tests/e2e-geo-fences-server.spec.js
-- exists because of that.
--
-- Step 1 (de70034, 6f3c49e) is what made this possible at all: client
-- coordinates now live on td_clients instead of only in localStorage. Before
-- that, every client fence was invisible off the device.
--
-- THE FOUR KINDS, matching _geoDeriveFences exactly and in its order:
--   shop    the business address from zj_data.settings, id 'shop'
--   place   every td_places row with coordinates, id 'place-<id>'
--   client  every td_clients row whose coordinates match its CURRENT address,
--           id 'client-<id>', carrying rule 13's `scheduled` witness
--   job     every td_jobs row active that day with coordinates, id 'job-<id>'
--
-- WHY `scheduled` IS COMPUTED HERE AND NOT LEFT TO THE CALLER: rule 13 asks
-- whether the calendar vouched for a client visit on that day, which is a
-- question about the job book, not about geography. The phone answers it with
-- _jobActiveOn; this answers it with the same arithmetic (start <= day <= start
-- + days - 1, ignoring cancelled, completed and done), so a caller cannot get
-- one without the other and reach a different conclusion.

create or replace function geo_fences_for(p_contractor uuid, p_day date)
returns table (
  id text, kind text, name text, lat double precision, lng double precision,
  addr text, place_id text, client_id text, job_id text,
  scheduled boolean, radius_ft numeric
)
language sql stable security definer set search_path = public as $$
  -- The job book for this day, used twice: once to vouch for a client fence
  -- (rule 13) and once as job fences in their own right.
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
         nullif((select s->>'geoFenceRadius' from cfg), '')::numeric
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
         nullif(p.data->>'fenceFt','')::numeric
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
         null::numeric
    from td_clients c
   where c.user_id = p_contractor and c.deleted_at is null
     and nullif(btrim(coalesce(c.data->>'addr','')), '') is not null
     and (c.data->>'lat') is not null and (c.data->>'lon') is not null
     and (c.data->>'geoAddr') = (c.data->>'addr')

  union all
  -- jobs active on the day
  select 'job-' || a.jid,
         'job'::text,
         -- A JOB FENCE IS NAMED FOR ITS CLIENT, not the job. The browser half
         -- uses _tlJobClientInfo(j.id).clientName and only falls back to the
         -- job's own name, then 'Job'. The first cut of this function used the
         -- job name and the equivalence fixture caught it immediately, which
         -- is the entire reason that test exists.
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
         null::numeric
    from active a
   where (a.jd->>'lat') is not null and (a.jd->>'lon') is not null;
$$;

revoke all on function geo_fences_for(uuid, date) from anon, authenticated;
grant execute on function geo_fences_for(uuid, date) to authenticated;
