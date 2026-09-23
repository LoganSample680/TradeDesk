-- ── EVERY PROPERTY HE TYPED IN, ON THE SERVER TOO ─────────────────────────
--
-- Owner 2026-09-19: "in lead client record if I add it it needs to carry over
-- to mileage and time sheet to."
--
-- The phone learned that the same day: _geoDeriveFences (js/geo-track.js)
-- walks c.extraAddresses and builds a fence for each property card. This
-- function never did, so the two fence lists disagreed, and CLAUDE.md 17
-- exists precisely so they cannot. Since 2026-09-19 the phone no longer
-- writes time rows at all, which means THIS list is the only one that decides
-- what a dwell is called: a landlord with four rentals got one fence and three
-- houses that derive as "unsaved address" forever, however carefully he had
-- typed them in.
--
-- It is also the exact shape of the owner's own miss. Saving a stop to a
-- customer who ALREADY has an address files the new pin as a property card,
-- not as the primary, so the fence the server needed on the next rebuild was
-- the one arm that did not exist.
--
-- Copied from the primary-client arm in 20261021_geo_fences_anchor.sql. The
-- per-person answers (scheduled, personal, on the books) are lifted into a
-- `cl` CTE so the two arms cannot drift into disagreeing about the same
-- customer: rule 13's witnesses are about the PERSON, not about which of
-- their houses this is. What differs between the arms is the coordinate.
--
-- NO ANCHOR on a property, deliberately, and that matches the phone: the
-- learner (js/geo-anchor.js) keys on the client record, so a property card has
-- nothing learned to prefer and falls through to the geocoded pin.
--
-- Additive: an account with no property cards produces byte-identical rows to
-- what it produced yesterday.

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
  ),
  -- EVERY ANSWER THAT BELONGS TO THE PERSON, computed once for all of their
  -- addresses. Both client arms below read it, so the primary house and the
  -- rental across town can never disagree about whether this customer is
  -- family or has work open.
  cl as (
    select c.id as cid,
           c.data as cd,
           coalesce(nullif(c.data->>'name',''), 'Client') as cname,
           exists (select 1 from active a where a.jd->>'client_id' = c.id) as scheduled,
           coalesce((c.data->>'personal') in ('true','1'), false) as personal,
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
                              ('Pending','sent','Sent','opportunity','Won','Closed Won'))) as on_books
      from td_clients c
     where c.user_id = p_contractor and c.deleted_at is null
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
         -- RULE 23: the learned anchor stands in for the geocoded pin, and
         -- only here. p.data->>'lat'/'lon' are untouched and still what the
         -- map, the address field and navigation use (js/geo-anchor.js).
         coalesce((p.data->'anchor'->>'lat')::double precision, (p.data->>'lat')::double precision),
         coalesce((p.data->'anchor'->>'lng')::double precision, (p.data->>'lon')::double precision),
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
  select 'client-' || cl.cid,
         'client'::text,
         cl.cname,
         -- RULE 23, same as the places arm above.
         coalesce((cl.cd->'anchor'->>'lat')::double precision, (cl.cd->>'lat')::double precision),
         coalesce((cl.cd->'anchor'->>'lng')::double precision, (cl.cd->>'lon')::double precision),
         coalesce(cl.cd->>'addr', ''),
         null::text, cl.cid, null::text,
         cl.scheduled,
         null::numeric,
         -- Family or personal. Absent on every client saved before this
         -- existed, which reads as false and leaves rule 13 exactly as it was.
         cl.personal,
         cl.on_books,
         -- A client is never a commute. Nobody reports to a customer's house
         -- every morning, and if they do, that is a job and it carries a job
         -- fence.
         false
    from cl
   where nullif(btrim(coalesce(cl.cd->>'addr','')), '') is not null
     and (cl.cd->>'lat') is not null and (cl.cd->>'lon') is not null
     and (cl.cd->>'geoAddr') = (cl.cd->>'addr')

  union all
  -- AND EVERY OTHER PROPERTY THAT CUSTOMER HAS. The mirror of the
  -- extraAddresses block in _geoDeriveFences (js/geo-track.js).
  select 'client-' || cl.cid || '-p' || (ax.ord - 1)::text,
         'client'::text,
         -- The label is what he typed to tell them apart, so it is what he
         -- should read back. "Primary" is not a place, so a card with no
         -- label is just the customer's name.
         cl.cname || coalesce(' (' || nullif(btrim(coalesce(ax.a->>'label','')), '') || ')', ''),
         (ax.a->>'lat')::double precision,
         (ax.a->>'lon')::double precision,
         coalesce(ax.a->>'addr', ''),
         -- c.id still on client_id, so every rule that asks "whose is this"
         -- gets the answer it always did; only the fence id tells two of his
         -- houses apart.
         null::text, cl.cid, null::text,
         cl.scheduled,
         null::numeric,
         cl.personal,
         cl.on_books,
         false
    from cl
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(cl.cd->'extraAddresses') = 'array'
           then cl.cd->'extraAddresses' else '[]'::jsonb end
    ) with ordinality as ax(a, ord)
   where nullif(btrim(coalesce(ax.a->>'addr','')), '') is not null
     -- The same two-copy rule the primary has: a property carries the address
     -- its coordinates were derived from, so editing the address retires the
     -- fence until it is geocoded again.
     and (ax.a->>'lat') is not null and (ax.a->>'lon') is not null
     and (ax.a->>'geoAddr') = (ax.a->>'addr')

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
