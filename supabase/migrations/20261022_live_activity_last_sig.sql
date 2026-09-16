-- ── THE LOCK SCREEN REMEMBERS WHAT IT WAS LAST TOLD ───────────────────────
--
-- Owner 2026-09-16: "live activities, if I'm in the ops portal it doesn't
-- update live when I go to drive, how can we make live activities
-- bulletproof?"
--
-- The server now pushes the on-site card from its own derive (ingest-geo,
-- ../functions/_shared/live-push.ts) so the card no longer depends on the
-- phone being on a screen that is allowed to derive. A flush lands every few
-- minutes all day and almost none of them change what the card says: the
-- timer ticks on the phone, so "ON SITE, John Doe, since 1:43" is still
-- correct at 2:15 without being told again.
--
-- This column is what makes that cheap. It holds the signature of the last
-- card Apple ACCEPTED (liveCardSig: the event, the words, the arrival
-- instant), so an unchanged card costs one already-fetched string comparison
-- instead of an APNs round trip and a radio wake on the phone.
--
-- Additive and null on every existing row, which reads as "nothing pushed
-- yet" and is exactly right for a card this has never spoken to.
alter table live_activity_tokens
  add column if not exists last_sig text;

comment on column live_activity_tokens.last_sig is
  'Signature of the last Live Activity content-state APNs accepted for this card. Written only after a successful send (supabase/functions/_shared/live-push.ts), so a failed push is retried rather than remembered as done.';
