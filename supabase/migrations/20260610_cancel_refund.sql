-- Track the Stripe refund ID after a client-initiated cancellation.
-- cancel-refund edge function writes this after a successful stripe.refunds.create()
-- call; the idempotency check prevents double-refunds on repeat webhook delivery.
alter table signed_proposals
  add column if not exists stripe_refund_id text;
