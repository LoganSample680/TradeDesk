#!/usr/bin/env python3
"""Put the build this run just uploaded in front of every tester group.

WHY THIS EXISTS. `fastlane pilot upload` runs with
--skip_waiting_for_build_processing and exits before Apple has an opinion, so
a green ios-beta run proves the IPA left the runner and nothing else. Which
groups end up with the build is a separate question, and it was answered by
whoever remembered to go and click. Nobody remembered for builds 36 through
41, so an external tester sat on build 35 from 2026-08-19 to 2026-08-27 while
every run in between reported success.

The obvious fix, App Store Connect's per-group automatic distribution, is not
available: `hasAccessToAllBuilds` is create-only, and Apple refuses it in an
UPDATE ("The attribute 'hasAccessToAllBuilds' can not be included in a
'UPDATE' operation"). So the distribution happens here instead, which also
covers groups created before anyone thought about the flag.

SCOPE, deliberately narrow. It touches exactly one build, the one this run
produced, matched by CFBundleVersion against the run number. It never sweeps
history, never removes anything, never submits for review, never touches a
tester or the app record. Re-running it is a no-op: a group that already has
the build is skipped.
"""
import os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asc_api import token, get, post  # noqa: E402

BUNDLE_ID = os.environ.get('TD_BUNDLE_ID', '').strip()
WANT = str(os.environ.get('TD_BUILD_VERSION', '')).strip()
# Apple's processing is typically 5 to 15 minutes and occasionally much worse.
# The ceiling exists so a stuck build fails the job loudly instead of holding a
# runner for an hour, and a timeout here is a real signal: it means the build
# is not installable by anyone, which is exactly the thing nobody was noticing.
DEADLINE_S = int(os.environ.get('TD_WAIT_SECONDS', '1800'))
POLL_S = 30


def find_app(tok):
    apps = get('/apps?limit=50', tok)['data']
    if BUNDLE_ID:
        app = next((a for a in apps if a['attributes'].get('bundleId') == BUNDLE_ID), None)
        if not app:
            print('::error::no app with bundleId %s' % BUNDLE_ID)
            return None
        return app
    return apps[0] if apps else None


def find_build(aid, tok):
    """The build this run made, by version. Never 'the newest', which would
    happily distribute somebody else's concurrent upload."""
    for b in get('/builds?filter[app]=%s&limit=20&sort=-uploadedDate' % aid, tok)['data']:
        if str(b['attributes'].get('version')) == WANT:
            return b
    return None


def main():
    if not WANT:
        print('::error::TD_BUILD_VERSION is required: this distributes one specific build')
        return 1
    tok = token()
    app = find_app(tok)
    if not app:
        return 1
    aid = app['id']

    waited = 0
    build = None
    while waited <= DEADLINE_S:
        build = find_build(aid, tok)
        if build:
            state = build['attributes'].get('processingState')
            if state == 'VALID':
                break
            if state in ('INVALID', 'FAILED'):
                # The failure the CI board could never see: the run went green
                # and Apple threw the binary away.
                print('::error::build %s came back %s from Apple. The upload succeeded '
                      'and the build is not installable by anyone.' % (WANT, state))
                return 1
            print('build %s: %s, waiting' % (WANT, state))
        else:
            print('build %s not visible to the API yet, waiting' % WANT)
        time.sleep(POLL_S)
        waited += POLL_S
        # A JWT lives 20 minutes and this can outlast one.
        if waited % 600 == 0:
            tok = token()

    if not build or build['attributes'].get('processingState') != 'VALID':
        print('::error::build %s never reached VALID within %d minutes. Nobody can '
              'install it.' % (WANT, DEADLINE_S // 60))
        return 1

    bid = build['id']
    print('build %s is VALID (%s)\n' % (WANT, bid))

    groups = get('/betaGroups?filter[app]=%s&limit=50' % aid, tok)['data']
    if not groups:
        print('::warning::no tester groups exist, so there is nobody to distribute to')
        return 0

    already = {g['id'] for g in get('/builds/%s/betaGroups?limit=50' % bid, tok)['data']}
    failed = []
    for g in groups:
        gid, name = g['id'], g['attributes'].get('name', g['id'])
        if gid in already:
            print('  %s: already has build %s' % (name, WANT))
            continue
        try:
            post('/betaGroups/%s/relationships/builds' % gid, tok,
                 {'data': [{'type': 'builds', 'id': bid}]})
        except Exception:
            failed.append(name)
            continue
        print('  %s: build %s distributed' % (name, WANT))

    # Apple's answer, not ours. A write that reported success and did not land
    # is the exact failure mode this whole tool exists to catch.
    landed = {g['id'] for g in get('/builds/%s/betaGroups?limit=50' % bid, tok)['data']}
    missing = [g['attributes'].get('name', g['id']) for g in groups if g['id'] not in landed]
    print()
    if missing:
        print('::error::build %s did NOT reach: %s' % (WANT, ', '.join(missing)))
        return 1
    print('build %s is in every tester group (%d)' % (WANT, len(groups)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
