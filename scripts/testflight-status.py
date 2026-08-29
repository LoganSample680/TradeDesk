#!/usr/bin/env python3
"""
Read-only TestFlight status against the App Store Connect API.

Answers the question the CI board cannot: a green `ios-beta` run proves the
IPA left the runner, NOT that Apple accepted it or that a tester can install
it. Those are different facts and only Apple holds the second one. This is
what let a tester sit on build 35 for days while every workflow run since
reported success.

Every request here is a GET. Nothing in this file creates, modifies, expires
or distributes anything, and it must stay that way: the .p8 it authenticates
with can upload builds and edit the store listing, so the blast radius of a
mistake is the live app, not a test account.
"""
import json, os, sys, urllib.request, urllib.error
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asc_api import API, token, get  # noqa: E402

BUNDLE_ID = os.environ.get('TD_BUNDLE_ID', '').strip()
LIMIT = int(os.environ.get('TD_BUILD_LIMIT', '10'))
# THE ONLY WRITE IN THIS FILE, and it is off unless something says the word.
# Every other call here is a GET on purpose: the .p8 this authenticates with
# can ship to the App Store, so a write path has to be impossible to trip by
# accident. Exact string, no truthiness, no default.
ENABLE_AUTO = os.environ.get('TD_ENABLE_AUTO_DISTRIBUTE', '') == 'yes'




def _utc(iso):
    """Apple stamps uploadedDate with its own UTC offset. Slicing the string
    kept that local time under a column headed UTC, showing build 43 as 10:03
    when it landed at 17:03. Normalise, or the column lies by hours."""
    if not iso:
        return ''
    try:
        from datetime import timezone
        return (datetime.fromisoformat(str(iso).replace('Z', '+00:00'))
                .astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M'))
    except Exception:
        return str(iso)[:16].replace('T', ' ')


def patch_auto_distribute(gid, name, tok):
    """Turn on automatic distribution for one group.

    Scope is deliberately one attribute. It does not distribute a build, add or
    remove a tester, or touch anything about the app: it says future builds
    reach this group without somebody remembering to push them, which is what
    was already true of the internal group and false of the external one.
    Reversible by setting it back.
    """
    body = json.dumps({'data': {'type': 'betaGroups', 'id': gid,
                                'attributes': {'hasAccessToAllBuilds': True}}}).encode()
    req = urllib.request.Request(API + '/betaGroups/' + gid, data=body, method='PATCH',
                                 headers={'Authorization': 'Bearer ' + tok,
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            got = json.loads(r.read())
        now = got.get('data', {}).get('attributes', {}).get('hasAccessToAllBuilds')
        # Apple's own answer, not our hope. A 200 that came back False is a
        # failure wearing a success code.
        print('  %s: automatic distribution -> %s' % (name, 'ON' if now else 'STILL OFF'))
        return bool(now)
    except urllib.error.HTTPError as e:
        print('::error::could not enable automatic distribution on %r: %s %s'
              % (name, e.code, e.read().decode('utf8', 'replace')[:500]))
        return False


def main():
    tok = token()

    apps = get('/apps?limit=50', tok)['data']
    if not apps:
        print('::error::the API key can see no apps at all: wrong issuer, or the key lacks App Manager access')
        return 1
    app = None
    if BUNDLE_ID:
        app = next((a for a in apps if a['attributes'].get('bundleId') == BUNDLE_ID), None)
        if not app:
            print('::error::no app with bundleId %s. Visible: %s' % (
                BUNDLE_ID, ', '.join(a['attributes'].get('bundleId', '?') for a in apps)))
            return 1
    else:
        app = apps[0]
    aid = app['id']
    print('App: %s (%s)\n' % (app['attributes'].get('name'), app['attributes'].get('bundleId')))

    # Beta groups, so "which builds can a tester actually see" has a name
    # attached rather than an opaque id.
    graw = get('/betaGroups?filter[app]=%s&limit=50' % aid, tok)['data']
    groups = {g['id']: g['attributes'].get('name', g['id']) for g in graw}
    ginternal = {g['id']: bool(g['attributes'].get('isInternalGroup')) for g in graw}
    # hasAccessToAllBuilds IS automatic distribution. A group with it off gets
    # only the builds somebody pushed to it by hand, which is a gap nobody sees
    # until a tester says they are on an old version. Reading the flag beats
    # guessing at App Store Connect menu labels.
    gauto = {g['id']: bool(g['attributes'].get('hasAccessToAllBuilds')) for g in graw}
    if groups:
        print('Tester groups: %s\n' % ', '.join(
            '%s (%s, auto-distribute %s)' % (
                groups[i], 'internal' if ginternal[i] else 'EXTERNAL',
                'ON' if gauto[i] else 'OFF') for i in groups))
    todo = [i for i in groups if not gauto[i]]
    if todo and ENABLE_AUTO:
        print('\nENABLING AUTOMATIC DISTRIBUTION')
        for i in todo:
            if patch_auto_distribute(i, groups[i], tok):
                gauto[i] = True
        print()
    for i in groups:
        if not gauto[i]:
            print('::warning::group %r has automatic distribution OFF. It only ever gets '
                  'builds somebody pushes to it by hand.' % groups[i])

    builds = get('/builds?filter[app]=%s&limit=%d&sort=-uploadedDate'
                 '&include=buildBetaDetail,betaGroups' % (aid, LIMIT), tok)
    included = {(i['type'], i['id']): i for i in builds.get('included', [])}

    rows, installable = [], []
    for b in builds['data']:
        at = b['attributes']
        rel = b.get('relationships', {})
        det_ref = (rel.get('buildBetaDetail') or {}).get('data')
        det = included.get(('buildBetaDetails', det_ref['id']), {}) if det_ref else {}
        da = det.get('attributes', {})
        grp = [groups.get(g['id'], g['id'])
               for g in ((rel.get('betaGroups') or {}).get('data') or [])]
        # processingState is Apple's verdict on the binary. internalBuildState
        # is whether a tester can press Install. A build can be VALID and still
        # be unreachable, which is exactly the failure this script exists for.
        # Apple uses BOTH spellings and they mean the same thing to a tester:
        # READY_FOR_BETA_TESTING is "available", IN_BETA_TESTING is "available
        # and somebody has it". Matching only the first is what made the very
        # first live run report "NO build is installable" against an account
        # where all ten were. The stubbed fixtures could not catch it: they
        # were written from the same wrong assumption as the code.
        ok = (at.get('processingState') == 'VALID'
              and da.get('internalBuildState') in ('READY_FOR_BETA_TESTING', 'IN_BETA_TESTING')
              and not at.get('expired'))
        if ok and grp:
            installable.append(at.get('version'))
        rows.append({
            'build': at.get('version'),
            'uploaded': _utc(at.get('uploadedDate')),
            'processing': at.get('processingState'),
            'internal': da.get('internalBuildState'),
            'external': da.get('externalBuildState'),
            'expired': bool(at.get('expired')),
            'groups': grp,
        })

    w = max([len(str(r['build'])) for r in rows] + [5])
    print('%-*s  %-16s  %-10s  %-24s  %-7s  %s' % (
        w, 'BUILD', 'UPLOADED (UTC)', 'PROCESS', 'INTERNAL STATE', 'EXPIRED', 'GROUPS'))
    for r in rows:
        print('%-*s  %-16s  %-10s  %-24s  %-7s  %s' % (
            w, r['build'], r['uploaded'], r['processing'] or '-',
            r['internal'] or '-', 'yes' if r['expired'] else 'no',
            ', '.join(r['groups']) or '(none: no tester can install this)'))

    print()
    if installable:
        print('Newest build a tester can install: %s' % installable[0])
        if rows and rows[0]['build'] != installable[0]:
            print('::warning::build %s is the newest uploaded but %s is the newest '
                  'INSTALLABLE. Testers are stuck below the tip.'
                  % (rows[0]['build'], installable[0]))
    else:
        print('::warning::NO build in the last %d is installable by any tester.' % LIMIT)

    # THE BUILD-35 CHECK. A build is only installable by the groups it was
    # actually distributed to, and a tester in a group the tip never reached
    # stays on whatever that group last got, silently, for as long as it takes
    # somebody to ask. Comparing the tip's groups against every group seen in
    # the window is what surfaces that without knowing who is in which.
    seen = set()
    for r in rows:
        seen.update(r['groups'])
    if rows and seen:
        missed = sorted(seen - set(rows[0]['groups']))
        for g in missed:
            last = next((r['build'] for r in rows if g in r['groups']), None)
            print('::warning::group %r cannot install build %s. Its newest is %s. '
                  'A tester in that group is stuck there.' % (g, rows[0]['build'], last))

    # WHO IS ACTUALLY IN EACH GROUP. The build table says which groups can
    # install what; it cannot say which group a given person is in, and that is
    # the half that decides whether someone is stuck. An external group is the
    # one to watch: Apple gates it behind Beta App Review, so it lags by
    # default rather than by mistake.
    print('\nMEMBERSHIP')
    for gid, gname in groups.items():
        newest = next((r['build'] for r in rows if gname in r['groups']), None)
        try:
            people = get('/betaGroups/%s/betaTesters?limit=200' % gid, tok)['data']
        except Exception:
            print('  %s: could not read the roster' % gname)
            continue
        kind = 'internal' if ginternal.get(gid) else 'EXTERNAL, gated by Beta App Review'
        print('  %s (%s) -- newest installable build: %s' % (gname, kind, newest or 'none'))
        if not people:
            print('      (nobody)')
        for p in people:
            a = p.get('attributes', {})
            nm = ' '.join(x for x in [a.get('firstName'), a.get('lastName')] if x) or '(no name)'
            # Masked on purpose: the roster is real people and this prints into
            # a CI log that lives in the repo's history. The name is enough to
            # tell who is who; the full address adds nothing and lingers.
            em = str(a.get('email') or '')
            em = (em[0] + '***@' + em.split('@', 1)[1]) if '@' in em and em else '(no email)'
            print('      %-28s %-24s %s' % (nm, em, a.get('state') or ''))
    print()

    for r in rows:
        if r['processing'] == 'INVALID':
            print('::warning::build %s: Apple rejected the binary (processingState INVALID). '
                  'The workflow that uploaded it still went green.' % r['build'])
        elif r['processing'] == 'PROCESSING':
            print('::warning::build %s: still processing at Apple.' % r['build'])
        elif not r['groups'] and not r['expired']:
            print('::warning::build %s: assigned to no tester group, so nobody can install it. '
                  'Check the group auto-distribute toggle in App Store Connect.' % r['build'])
    return 0


if __name__ == '__main__':
    sys.exit(main())
