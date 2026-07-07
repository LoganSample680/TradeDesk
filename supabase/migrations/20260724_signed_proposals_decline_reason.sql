-- Client-facing "why are you declining?" reason picker (sign.html).
--
-- signed_proposals already carries payment_status='declined' when a client
-- declines a proposal, but nothing captured WHY — a contractor lost real
-- signal on every lost deal. decline_reason is optional free text (short
-- reason label, or 'Other: <typed note>') written by _confirmDecline() and
-- copied onto bid.lostReason by cloud.js the same way a contractor's own
-- manual "Mark Lost" action already populates it — same field, same Declined
-- tab UI, no new surface needed on the contractor side.

alter table signed_proposals add column if not exists decline_reason text;
