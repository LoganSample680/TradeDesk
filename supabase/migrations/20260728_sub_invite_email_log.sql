-- Sub referral invite emails: CAN-SPAM suppression list + send log.
-- Both tables are touched ONLY by the send-sub-invite-email edge function
-- (service role). RLS is enabled with no policies so clients can never read
-- or write them — the service role bypasses RLS.

create table if not exists sub_invite_optouts (
  email      text primary key,
  created_at timestamptz not null default now()
);

create table if not exists sub_invite_emails (
  email        text primary key,
  last_sent_at timestamptz not null default now(),
  send_count   int not null default 1
);

alter table sub_invite_optouts enable row level security;
alter table sub_invite_emails  enable row level security;
