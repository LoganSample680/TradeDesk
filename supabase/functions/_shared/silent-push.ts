// One silent (content-available) push to a set of devices, and the pruning of
// any Apple says are gone. push-geo-ping sends it to every device every half
// hour; ingest-geo sends it to one person's devices right after their app
// closes (see _shared/terminate-wake.mjs). One sender, so the payload, the
// priority Apple insists on, and the pruning can never differ between them.
import { apnsJwt, apnsSend } from "./apns.ts";

export async function sendSilentWake(
  svc: { from: (t: string) => any },
  tokens: string[],
  td: string,
  expireSec = 1500,
): Promise<{ sent: number; pruned: number }> {
  if (!tokens.length) return { sent: 0, pruned: 0 };
  const jwt = await apnsJwt();
  // aps is Apple's namespace; td is ours, read by the AppDelegate forward.
  const payload = JSON.stringify({ aps: { "content-available": 1 }, td });
  const dead: string[] = [];
  let sent = 0;
  await Promise.all(tokens.map(async (token) => {
    try {
      // Background pushes MUST be priority 5; Apple rejects 10 for
      // content-available-only payloads.
      const out = await apnsSend(jwt, token, payload, {
        "apns-push-type": "background",
        "apns-priority": "5",
        "apns-expiration": String(Math.floor(Date.now() / 1000) + expireSec),
      });
      if (out.ok) sent++;
      else if (out.dead) dead.push(token);
    } catch (e) {
      console.error(`[silent-push] ${String(e).slice(0, 200)}`);
    }
  }));
  if (dead.length) {
    await svc.from("device_tokens")
      .update({ invalid_at: new Date().toISOString() }).in("token", dead);
  }
  return { sent, pruned: dead.length };
}
