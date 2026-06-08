alter table signed_proposals
  add column if not exists epa_required boolean default false,
  add column if not exists epa_ack_at timestamptz,
  add column if not exists rrp_firm_cert text,
  add column if not exists rrp_renovator_name text;
