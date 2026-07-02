-- ONE-SHOT ATOMIC DELTA — the scale primitive for many-device accounts.
--
-- Every reconcile used to issue 14 parallel per-table reads plus a separate
-- cursor read plus (with the op channel) an ops pull. At N devices on one
-- account that multiplies into hundreds of requests/second of pure overhead,
-- and the cursor/data pair was read non-atomically (the read-skew family this
-- branch spent a day killing).
--
-- get_account_delta(since, ops_since) returns EVERYTHING in one call, from one
-- implicit Postgres snapshot (a single SELECT statement = one MVCC snapshot):
--   {
--     cursor: <zj_data.updated_at for this user>,     -- sampled ATOMICALLY with the rows
--     server_now: <now()>,                            -- clamp anchor for the client cursor
--     tables: { td_bids: [{id,data,updated_at,deleted_at}, ...], ... },
--     ops:    [{hlc,op_table,row_id,fields,device_id}, ...]  -- per-field op channel, hlc-asc
--   }
-- Soft-deletes ride along (deleted_at included, no filter). ops is [] when
-- ops_since is null (caller doesn't run the op channel). SECURITY INVOKER:
-- RLS owner policies scope every row to auth.uid() — the function grants
-- nothing the caller couldn't already read.
--
-- The client calls this for delta reloads and falls back to the per-table
-- reads when the function is missing (PGRST202), so deploys in any order stay safe.

drop function if exists get_account_delta(timestamptz);

create or replace function get_account_delta(since timestamptz, ops_since text default null)
returns jsonb
language sql
security invoker
stable
as $$
  select jsonb_build_object(
    'cursor', (select z.updated_at from zj_data z where z.user_id = auth.uid()),
    'server_now', now(),
    'tables', jsonb_build_object(
      'td_clients',      (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at)),'[]'::jsonb) from td_clients t      where t.user_id = auth.uid() and t.updated_at > since),
      'td_bids',         (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at)),'[]'::jsonb) from td_bids t         where t.user_id = auth.uid() and t.updated_at > since),
      'td_jobs',         (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at)),'[]'::jsonb) from td_jobs t         where t.user_id = auth.uid() and t.updated_at > since),
      'td_income',       (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at)),'[]'::jsonb) from td_income t       where t.user_id = auth.uid() and t.updated_at > since),
      'td_expenses',     (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at)),'[]'::jsonb) from td_expenses t     where t.user_id = auth.uid() and t.updated_at > since),
      'td_mileage',      (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at)),'[]'::jsonb) from td_mileage t      where t.user_id = auth.uid() and t.updated_at > since),
      'td_payments',     (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at)),'[]'::jsonb) from td_payments t     where t.user_id = auth.uid() and t.updated_at > since),
      'td_liens',        (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at)),'[]'::jsonb) from td_liens t        where t.user_id = auth.uid() and t.updated_at > since),
      'td_time_entries', (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at)),'[]'::jsonb) from td_time_entries t where t.user_id = auth.uid() and t.updated_at > since),
      'td_licenses',     (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at)),'[]'::jsonb) from td_licenses t     where t.user_id = auth.uid() and t.updated_at > since),
      'td_events',       (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at)),'[]'::jsonb) from td_events t       where t.user_id = auth.uid() and t.updated_at > since),
      'td_contracts',    (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at)),'[]'::jsonb) from td_contracts t    where t.user_id = auth.uid() and t.updated_at > since),
      'td_agreements',   (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at)),'[]'::jsonb) from td_agreements t   where t.user_id = auth.uid() and t.updated_at > since),
      'td_photos',       (select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'data',t.data,'updated_at',t.updated_at,'deleted_at',t.deleted_at)),'[]'::jsonb) from td_photos t       where t.user_id = auth.uid() and t.updated_at > since)
    ),
    'ops', case when ops_since is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object('hlc',o.hlc,'op_table',o.op_table,'row_id',o.row_id,'fields',o.fields,'device_id',o.device_id) order by o.hlc),'[]'::jsonb)
      from (
        select hlc, op_table, row_id, fields, device_id
        from td_ops
        where user_id = auth.uid() and hlc > ops_since
        order by hlc asc
        limit 500
      ) o
    ) end
  );
$$;

grant execute on function get_account_delta(timestamptz, text) to authenticated;
