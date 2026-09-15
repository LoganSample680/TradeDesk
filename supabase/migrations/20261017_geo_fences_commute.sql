-- ── RULE 20: THE COMMUTE IS NOT WORK, AND IT IS NOT MILEAGE ───────────────
--
-- Owner 2026-09-15: "He doesn't get paid for his drive to his dads shop or
-- when he goes home, his time runs on arrival to the shop and or clock in time
-- and out time, we dont want to show his mileage to his dads or from home."
--
-- This is the IRS commuting rule, which is why it belongs to everybody rather
-- than to one man: travel between your home and your regular place of work is
-- never claimable, and everything from arrival onward is. The crew member
-- happening not to own the shop he reports to is incidental; an employee of
-- any contractor on this app makes the same two drives every day.
--
-- The fence carries the flag and js/geo-derive.js decides what it means: a leg
-- with a house at one end and a commute fence at the other, either direction,
-- writes no time row and no mileage row. Every other leg out of that place is
-- work exactly as before, which is the same line the deduction draws.
--
-- Absent everywhere it has not been set, which reads as false and leaves every
-- existing account deriving exactly as it does now. Everything else in this
-- function is 20261006 verbatim; a returns-table cannot be widened in place,
-- so the whole body comes along, and the old one has to be dropped first:
-- a RETURNS TABLE column is an OUT parameter, and Postgres refuses to change
-- a function's row type in place (42P13). 20261003 and 20261006 both did the
-- same thing for the same reason.

drop function if exists geo_fences_for(uuid, date);

create or replace function geo_fences_for(p_contractor uuid, p_day date)
returns table (
  id text, kind text, name text, lat double precision, lng double precision,
  addr text, place_id text, client_id text, job_id text,
  scheduled boolean, radius_ft numeric, personal boolean, on_books boolean,
  commute boolean
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
         null::boolean, null::boolean,
         -- The built-in Settings shop carries no flag of its own, and does not
         -- need one: _migrateShopToPlaces (js/places.js) lifts it into a real
         -- td_places row the moment the Places screen is opened, which is
         -- where the box is ticked, and _gdReportsHere (js/geo-derive.js)
         -- treats any fence standing at that spot as the same building. One
         -- yard registered twice is the shape of his actual account.
         false
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
         null::boolean, null::boolean,
         coalesce((p.data->>'commute') in ('true','1'), false)
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
                            ('Pending','sent','Sent','opportunity','Won','Closed Won'))),
         -- A client is never a commute. Nobody reports to a customer's house
         -- every morning, and if they do, that is a job and it carries a job
         -- fence.
         false
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
         null::boolean, null::boolean,
         -- A job is where the work IS, never the drive that is not work.
         false
    from active a
   where (a.jd->>'lat') is not null and (a.jd->>'lon') is not null;
$$;

revoke all on function geo_fences_for(uuid, date) from anon, authenticated;
grant execute on function geo_fences_for(uuid, date) to authenticated;
