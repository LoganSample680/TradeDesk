// ── PUSHING THE ON-SITE CARD FROM THE SERVER ───────────────────────────────
//
// The sending half of live-card.mjs. The rules live there and are pure; this
// is the plumbing: find the device's activity token, decide whether anything
// changed, talk to APNs, and forget a token the moment Apple says it is dead.
//
// Why this is not update-live-activity. That function is an HTTP endpoint a
// signed-in PERSON calls, and its whole first half is working out whether the
// caller may touch the target's card. This runs inside ingest-geo, on the
// device's own flush, about that device's own card. There is no third party to
// authorise and no JWT to check: uid is who the events came from. Both build
// the content-state with the same liveContentState() so the field list cannot
// drift between them, which is the part that actually matters.
import { APNS_TOPIC, apnsConfigured, apnsJwt, apnsSend } from "./apns.ts";
import { liveCardSig, liveContentState } from "./live-card.mjs";

type Card = { channel: string; event: string; state: Record<string, unknown> };

// Push a card to one person's device, if anything about it changed.
//
// Returns a short reason rather than throwing, always: this runs after a flush
// whose events are already stored, and a lock screen that did not update is
// never worth failing an ingest over.
export async function pushLiveCard(
  svc: { from: (t: string) => any },
  uid: string,
  card: Card,
): Promise<string> {
  try {
    if (!apnsConfigured()) return "apns not configured";
    if (!card || !card.channel) return "no card";

    const { data: row } = await svc.from("live_activity_tokens")
      .select("token,last_sig")
      .eq("user_id", uid).eq("channel", card.channel)
      .maybeSingle();
    // NO TOKEN IS THE ORDINARY CASE, NOT A FAULT. A card only has an APNs
    // token while it is actually up, and it is only up if the app put it up in
    // the foreground (ActivityKit will not start one from the background). So
    // most flushes find nothing here and that is exactly right.
    if (!row || !row.token) return "no live card";

    const sig = liveCardSig(card);
    // UNCHANGED COSTS NOTHING AND MUST SEND NOTHING. The timer ticks on the
    // phone, so a card saying "ON SITE, John Doe, since 1:43" says the same
    // thing at 2:15 without being told. A flush lands every few minutes all
    // day; re-pushing each one would spend battery and APNs budget to change
    // no pixel.
    if (String(row.last_sig || "") === sig) return "unchanged";
    // An 'end' with no card up is a no-op by definition, and storing the
    // signature for it would then swallow the NEXT real end.
    if (card.event === "end" && !row.last_sig) return "nothing to end";

    const payload = {
      aps: {
        timestamp: Math.floor(Date.now() / 1000),
        event: card.event === "end" ? "end" : "update",
        "content-state": liveContentState(card.state),
        ...(card.event === "end" ? { "dismissal-date": Math.floor(Date.now() / 1000) } : {}),
      },
    };

    // THROUGH apnsSend, NOT A FETCH OF ITS OWN (owner 2026-09-28: "still
    // seeing the iOS banners reporting time at John Doe but I'm at the shop").
    // This used to POST to one fixed gateway and read BadDeviceToken as "the card
    // is gone". A TestFlight build's token belongs to whichever gateway its
    // signing says, and apns.ts already knows that one static host is wrong
    // for half the fleet: it tries the other before condemning a token. This
    // file skipped that, so every card on the wrong side was declared gone on
    // its first push and its token deleted, while the card itself sat on the
    // lock screen frozen at the last place the open app had seen. Every
    // live-push line in the function log that day read "card already gone".
    const jwt = await apnsJwt();
    const out = await apnsSend(jwt, row.token, JSON.stringify(payload), {
      // Live Activity pushes have their own topic suffix and push type; the
      // plain bundle-id topic silently does nothing.
      "apns-topic": `${APNS_TOPIC}.push-type.liveactivity`,
      "apns-push-type": "liveactivity",
      "apns-priority": "10",
    });

    if (!out.ok) {
      if (out.dead) {
        // Gone from BOTH gateways (or 410): the card really is gone, swiped
        // away or ended by iOS. Drop the row so every later flush
        // short-circuits on "no live card".
        await svc.from("live_activity_tokens")
          .delete().eq("user_id", uid).eq("channel", card.channel);
        return "card already gone";
      }
      return "apns failed";
    }

    if (card.event === "end") {
      // An ended card's token is dead by definition; forget it now.
      await svc.from("live_activity_tokens")
        .delete().eq("user_id", uid).eq("channel", card.channel);
      return "ended";
    }
    // Only after Apple accepted it. Storing the signature before the send
    // would make one failed push look like a card that is already correct,
    // and it would stay wrong until the words changed again.
    await svc.from("live_activity_tokens")
      .update({ last_sig: sig })
      .eq("user_id", uid).eq("channel", card.channel);
    return "sent";
  } catch (e) {
    console.error(`[live-push] ${String(e).slice(0, 300)}`);
    return "failed";
  }
}
