-- Push subscription storage for Web Push notifications.
-- One row per device per user — upserted on every app load after permission granted.

create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  updated_at  timestamptz not null default now()
);

-- Each user can have multiple devices (phone + tablet etc.)
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);

-- RLS: users can only read/write their own subscriptions
alter table push_subscriptions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'push_subscriptions' and policyname = 'owner'
  ) then
    execute 'create policy "owner" on push_subscriptions
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id)';
  end if;
end $$;
