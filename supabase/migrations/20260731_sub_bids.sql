-- The REVERSE pipe: a subcontractor's BID back to the GC for their piece of a
-- job. The GC→sub channel (job_assignments) hands the sub an address; this is
-- the sub pricing that work as an independent business and sending it back for
-- the GC to approve. That round-trip — the sub sets their own price, the GC
-- accepts or declines — is the thing that makes the relationship a vendor
-- relationship and not a disguised-employee one, so it's first-class here.
--
-- Same one-way-offer shape as payment_offers, mirrored: the SUB inserts (only
-- to a GC they hold a standing link with), the GC decides (approve/decline),
-- and nobody can rewrite the amount after the fact.

create table if not exists sub_bids (
  id                bigint generated always as identity primary key,
  sub_user_id       uuid not null,          -- the 1099 who priced the work
  gc_user_id        uuid not null,          -- the GC who receives the bid
  job_addr          text not null default '' check (char_length(job_addr) <= 200),
  amount            numeric not null check (amount >= 0 and amount < 100000000),
  -- The sub's plain-English description of THEIR piece — what the GC needs to
  -- approve a price. Bounded so a hand-rolled call can't stuff a novel through.
  scope             text not null default '' check (char_length(scope) <= 2000),
  line_count        int not null default 0 check (line_count >= 0 and line_count < 10000),
  sub_business_name text not null default '' check (char_length(sub_business_name) <= 120),
  status            text not null default 'pending' check (status in ('pending','approved','declined','withdrawn')),
  -- The GC's e-signature ON the bid — this is the sub's protection: documented
  -- proof the GC agreed to pay this amount for this scope. 'approved' means
  -- signed; signed_name is who signed (the GC), signed_at when.
  signed_name       text not null default '' check (char_length(signed_name) <= 120),
  signed_at         timestamptz,
  created_at        timestamptz not null default now(),
  decided_at        timestamptz
);

alter table sub_bids enable row level security;

-- The SUB may send a bid ONLY to a GC they hold a standing link with — the same
-- link gate the payment pipe uses, just from the other side.
create policy sub_bids_sub_insert on sub_bids
  for insert to authenticated
  with check (
    sub_user_id::text = auth.uid()::text
    and status = 'pending'
    and exists (
      select 1 from business_links l
      where l.sub_user_id::text = auth.uid()::text
        and l.gc_user_id = sub_bids.gc_user_id
    )
  );

-- Both ends see the bid (the sub tracks what they sent; the GC sees what to act on).
create policy sub_bids_select on sub_bids
  for select to authenticated
  using (gc_user_id::text = auth.uid()::text or sub_user_id::text = auth.uid()::text);

-- The GC decides an OPEN bid: SIGN (approve) or decline. One-way, like signing a
-- proposal — with check pins status to a decided value so it can't be flipped
-- back to pending and re-decided. Approving carries the GC's signature
-- (signed_name/signed_at) written in the same update.
create policy sub_bids_gc_decide on sub_bids
  for update to authenticated
  using (gc_user_id::text = auth.uid()::text and status = 'pending')
  with check (gc_user_id::text = auth.uid()::text and status in ('approved','declined'));

-- The SUB may WITHDRAW their own still-open bid (mis-sent, re-priced). Same
-- one-way rule: only pending → withdrawn, never resurrected.
create policy sub_bids_sub_withdraw on sub_bids
  for update to authenticated
  using (sub_user_id::text = auth.uid()::text and status = 'pending')
  with check (sub_user_id::text = auth.uid()::text and status = 'withdrawn');

-- Column-level lockdown: the ONLY mutable columns are the decision fields.
-- Amount, scope, address, and identities are immutable after insert — neither
-- side can rewrite what was bid. No delete grant: bids are an audit trail of
-- what was priced and agreed, which is exactly the paper the 1099 story needs.
revoke update, delete on sub_bids from anon, authenticated;
grant update (status, decided_at, signed_name, signed_at) on sub_bids to authenticated;
