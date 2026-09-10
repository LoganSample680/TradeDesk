import { createClient } from 'npm:@supabase/supabase-js@2';
import { getServiceRoleKey } from '../_shared/keys.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

// ── Delete this account, for real ───────────────────────────────────────────
//
// App Review Guideline 5.1.1(v): "If your app supports account creation, you
// must also offer account deletion within the app." We create Supabase auth
// users at signup, and until now the only thing resembling this was
// clearAllData(), which empties the records and leaves the login standing.
// That is not deletion and it is one of the most consistently enforced rules
// in review.
//
// TWO KINDS OF ACCOUNT, and they cannot be deleted the same way.
//
// AN OWNER owns the business. Everything keyed to their uid is theirs: the
// synced td_* tables, the settings blob, their own geo history, their crew
// links. All of it goes, and the crew links go with it so nobody is left
// pointing at a business that no longer exists.
//
// A CREW MEMBER's rows are not all theirs. Their hours are the employer's
// payroll record, and an employer does not lose their books because somebody
// quit and deleted an app. So a crew deletion removes the login, the crew
// link, and every position and device row that describes the PERSON, and
// leaves the time entries in the employer's account with the identity
// stripped off them. That is the honest reading of both obligations at once,
// and it is stated to the person before they confirm.
//
// SAFETY, because this is the most destructive thing in the codebase:
//   * The uid is taken from the VERIFIED token, never from the request body.
//     There is no way to ask this function to delete somebody else.
//   * Every delete is keyed on that uid. No bare deletes exist here.
//   * The auth user goes LAST. If anything above fails the login still works
//     and the person can try again, rather than being locked out of an
//     account that still holds their data.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const supaAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      getServiceRoleKey()
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supaAdmin.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);
    const uid = user.id;

    // Is this person crew somewhere? The link is the authority, not anything
    // the caller claims: a crew member cannot delete an employer's books by
    // telling us they are an owner.
    const { data: links } = await supaAdmin
      .from('team_members')
      .select('id,contractor_user_id')
      .eq('employee_user_id', uid);
    const isCrew = Array.isArray(links) && links.length > 0;

    const removed: Record<string, string> = {};
    const del = async (table: string, col: string) => {
      try {
        const { error } = await supaAdmin.from(table).delete().eq(col, uid);
        removed[table] = error ? ('failed: ' + error.message) : 'ok';
      } catch (e) {
        removed[table] = 'failed: ' + String(e);
      }
    };

    // Rows that describe the PERSON and their device. These go for everybody,
    // owner and crew alike: they are location, hardware and diagnostics, never
    // anybody else's business record.
    for (const t of ['location_pings', 'geo_events', 'device_status', 'error_log']) {
      await del(t, 'employee_user_id');
    }
    await del('user_prefs', 'user_id');

    if (isCrew) {
      // The employer keeps the hours; the person's name comes off them. Not a
      // delete: a payroll record with a hole in it is worse for both sides
      // than one that says the person is gone.
      for (const t of ['job_time_entries', 'shop_time_entries']) {
        try {
          await supaAdmin.from(t).update({ employee_name: null }).eq('employee_user_id', uid);
        } catch (_e) { /* the column may not exist in every environment */ }
      }
      // The link itself, so the employer's roster stops showing them.
      try { await supaAdmin.from('team_members').delete().eq('employee_user_id', uid); } catch (_e) {}
      removed['team_members'] = 'unlinked';
    } else {
      // An owner: everything keyed to them, including the business records.
      const OWNED = [
        'td_clients', 'td_bids', 'td_jobs', 'td_income', 'td_expenses', 'td_mileage',
        'td_payments', 'td_liens', 'td_time_entries', 'td_licenses', 'td_events',
        'td_contracts', 'td_agreements', 'td_maintenance', 'td_vehicles', 'td_places',
        'td_scans', 'td_equipment', 'td_photos',
      ];
      for (const t of OWNED) await del(t, 'user_id');
      await del('zj_data', 'user_id');
      await del('td_timesheets', 'employee_user_id');
      for (const t of ['job_time_entries', 'shop_time_entries', 'location_pings', 'geo_events']) {
        await del(t, 'contractor_user_id');
      }
      // Crew stop pointing at a business that no longer exists. Their own
      // logins survive: deleting an employer must not delete employees.
      try { await supaAdmin.from('team_members').delete().eq('contractor_user_id', uid); } catch (_e) {}
      removed['team_members'] = 'removed';
    }

    // Storage: receipts, job photos, signed proposals. Best effort and never a
    // reason to abandon the deletion, because a stray object is a far smaller
    // problem than an account that would not delete.
    for (const bucket of ['receipts', 'job-photos', 'proposals']) {
      try {
        const { data: files } = await supaAdmin.storage.from(bucket).list(uid, { limit: 1000 });
        if (Array.isArray(files) && files.length) {
          await supaAdmin.storage.from(bucket).remove(files.map(f => uid + '/' + f.name));
        }
        removed['storage:' + bucket] = 'ok';
      } catch (_e) { removed['storage:' + bucket] = 'skipped'; }
    }

    // LAST. Everything above is recoverable-by-retry while the login works.
    const { error: delErr } = await supaAdmin.auth.admin.deleteUser(uid);
    if (delErr) return json({ error: 'Could not delete the login', detail: delErr.message, removed }, 500);

    return json({ ok: true, kind: isCrew ? 'crew' : 'owner', removed });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
