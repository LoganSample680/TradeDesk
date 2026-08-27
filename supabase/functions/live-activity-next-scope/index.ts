// Supabase Edge Function: live-activity-next-scope
//
// Called from the LOCK SCREEN, not the app: the iOS 17 LiveActivityIntent
// behind the "Next" / "Clock out" button on the Live Activity card
// (native/td-live/ios/Extension/TdLiveWidget.swift) fires this directly from
// the widget extension process, with the app closed and nobody signed in on
// that request. No JWT is available there, so this follows the exact no-auth
// pattern log-proposal-view and log-qr-event already use: a plain identifying
// payload, verify_jwt = false (supabase/config.toml), the service-role key
// does the write server-side. Same shape, same reasoning, not a new pattern.
//
// WHAT IT REPRODUCES: clockIn()/clockOut() in js/jobs.js. Tapping the button
// must be indistinguishable, in the resulting data, from tapping the same
// task in the in-app clock-in sheet:
//   - close the currently open td_time_entries row (end_time, minutes, open:false)
//   - if nextScopeId is present: open a new one for that scope (byte-for-byte
//     what clockIn() pushes, same fields, same open:true)
//   - if nextScopeId is empty/absent: that's the "Clock out" tap (the button's
//     label already flips once the lock-screen card's queue runs out, see
//     js/live-activity.js _liveActNextScopeInfo), so no new row opens
//   - either way, bump the job's actualHours by the closed entry's minutes,
//     the same bump clockOut() does, so a lock-screen switch doesn't leave
//     the job's total stale until the app is next opened
//
// One function for both actions (not a sibling), because the close-the-open-
// entry half is identical either way and duplicating it would be exactly the
// house-of-cards risk CLAUDE.md §10 exists to prevent.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey } from '../_shared/keys.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supa = createClient(
  Deno.env.get('SUPABASE_URL')!,
  getServiceRoleKey()
);

type TimeEntryRow = { id: string; data: Record<string, unknown> };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const contractorUserId = body.contractorUserId != null ? String(body.contractorUserId) : '';
    const jobId = body.jobId != null ? String(body.jobId) : '';
    const currentScopeId = body.currentScopeId != null ? String(body.currentScopeId) : '';
    const nextScopeId = body.nextScopeId != null ? String(body.nextScopeId) : '';
    const nextScopeLabel = body.nextScopeLabel != null ? String(body.nextScopeLabel) : '';
    // '' means the owner, matching js/jobs.js _tlLoggedByInfo's null-means-
    // owner convention (a device's own account has no separate employee id).
    const loggedByUid = body.loggedByUid ? String(body.loggedByUid) : null;

    if (!contractorUserId || !jobId) {
      return json({ error: 'contractorUserId and jobId required' }, 400);
    }

    // Every td_time_entries row is (id text, user_id uuid, data jsonb): the
    // generic shape every td_* table shares (supabase/migrations/20260703_
    // core_td_tables.sql). user_id is the ACCOUNT (contractorUserId, what
    // js/data.js _effectiveUid() returns); the actual person is inside data
    // as logged_by_uid. Several crew can be clocked into the same job at
    // once, so job_id alone can't tell rows apart, only (job_id, person) can.
    const { data: rows, error: readErr } = await supa
      .from('td_time_entries')
      .select('id, data')
      .eq('user_id', contractorUserId)
      .is('deleted_at', null);

    if (readErr) {
      console.error('live-activity-next-scope read error:', readErr.message);
      return json({ error: readErr.message }, 500);
    }

    const openRow = ((rows || []) as TimeEntryRow[]).find((r) => {
      const d = r.data || {};
      return d.open === true &&
        String(d.job_id ?? '') === jobId &&
        ((d.logged_by_uid ?? null) === loggedByUid);
    });

    if (!openRow) {
      // Not an error in the adversarial sense: the card can be tapped after
      // a manager force-closed the entry from Time Log, or after the person
      // already clocked out in-app. Nothing to close, nothing to open.
      return json({ ok: false, error: 'no open time entry for this job/person' }, 404);
    }

    const openData = openRow.data || {};
    const startMs = Date.parse(String(openData.start_time ?? '')) || Date.now();
    const nowIso = new Date().toISOString();
    const minutes = Math.max(1, Math.round((Date.now() - startMs) / 60000));

    // Close it, byte-for-byte what clockOut() writes.
    const closedData = { ...openData, end_time: nowIso, minutes, open: false };
    const { error: closeErr } = await supa
      .from('td_time_entries')
      .update({ data: closedData, updated_at: nowIso, deleted_at: null })
      .eq('id', String(openRow.id))
      .eq('user_id', contractorUserId);
    if (closeErr) {
      console.error('live-activity-next-scope close error:', closeErr.message);
      return json({ error: closeErr.message }, 500);
    }

    // actualHours bump, same one clockOut() does, so the job's total reads
    // right even if the app isn't reopened for the rest of the shift.
    const { data: jobRow } = await supa
      .from('td_jobs')
      .select('data')
      .eq('id', jobId)
      .eq('user_id', contractorUserId)
      .maybeSingle();
    if (jobRow) {
      const jd = (jobRow.data || {}) as Record<string, unknown>;
      const nextHours = Math.round(((Number(jd.actualHours) || 0) + minutes / 60) * 10) / 10;
      const { error: jobErr } = await supa
        .from('td_jobs')
        .update({ data: { ...jd, actualHours: nextHours }, updated_at: nowIso })
        .eq('id', jobId)
        .eq('user_id', contractorUserId);
      if (jobErr) console.error('live-activity-next-scope actualHours error:', jobErr.message);
    }

    if (!nextScopeId) {
      // The "Clock out" tap: the button only shows this label once the
      // lock-screen card's own queue is empty (isLastScope), so an empty
      // nextScopeId here is the deliberate terminal case, not a bad payload.
      return json({ ok: true, action: 'clockout', minutes }, 200);
    }

    // Open the next scope's entry, byte-for-byte what clockIn() pushes.
    // Date.now() as a string id matches jobs.js's own `entryId=Date.now()`.
    const newId = String(Date.now());
    const newEntry = {
      id: newId,
      job_id: jobId,
      // UTC date, not the crew member's local date: the edge function has no
      // timezone context to do better. Only affects which day's Time Log
      // bucket a tap made right at local midnight lands in, never the
      // open/close correctness above.
      date: nowIso.slice(0, 10),
      start_time: nowIso,
      end_time: null,
      minutes: null,
      scope_id: nextScopeId,
      scope_label: nextScopeLabel || null,
      logged_by_uid: openData.logged_by_uid ?? null,
      logged_by_name: openData.logged_by_name ?? null,
      open: true,
    };
    const { error: openErr } = await supa
      .from('td_time_entries')
      .insert({ id: newId, user_id: contractorUserId, data: newEntry, updated_at: nowIso, deleted_at: null, archived_at: null });
    if (openErr) {
      console.error('live-activity-next-scope open error:', openErr.message);
      return json({ error: openErr.message }, 500);
    }

    return json({ ok: true, action: 'switch', minutes, entryId: newId }, 200);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('live-activity-next-scope error:', msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
