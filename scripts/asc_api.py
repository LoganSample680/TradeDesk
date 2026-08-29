#!/usr/bin/env python3
"""Shared App Store Connect access: auth, and the four verbs we use.

Two scripts now talk to Apple with the same key and the same JWT rules, so the
auth lives in one place rather than being copied and drifting (CLAUDE.md 7.3).
Every caller gets the same error handling too, which matters more here than
usual: Apple's error bodies are genuinely descriptive, and the difference
between surfacing one and swallowing it is the difference between a fix and a
morning of guessing.
"""
import json, os, time, urllib.request, urllib.error

API = 'https://api.appstoreconnect.apple.com/v1'


def token():
    """ES256 JWT, 20 minutes. Apple hard-rejects anything longer."""
    import jwt  # PyJWT[crypto]
    kid = os.environ['APPSTORE_KEY_ID']
    iss = os.environ['APPSTORE_ISSUER_ID']
    key = os.environ['APPSTORE_API_KEY']
    now = int(time.time())
    return jwt.encode(
        {'iss': iss, 'iat': now, 'exp': now + 20 * 60, 'aud': 'appstoreconnect-v1'},
        key, algorithm='ES256', headers={'kid': kid, 'typ': 'JWT'})


def _send(path, tok, method='GET', body=None):
    url = path if path.startswith('http') else API + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {'Authorization': 'Bearer ' + tok}
    if data is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        # 204 is Apple's success for a relationship write: no body, not an error.
        return json.loads(raw) if raw else {}


def get(path, tok):
    try:
        return _send(path, tok)
    except urllib.error.HTTPError as e:
        print('::error::App Store Connect %s on GET %s\n%s'
              % (e.code, path, e.read().decode('utf8', 'replace')[:800]))
        raise


def post(path, tok, body):
    try:
        return _send(path, tok, 'POST', body)
    except urllib.error.HTTPError as e:
        print('::error::App Store Connect %s on POST %s\n%s'
              % (e.code, path, e.read().decode('utf8', 'replace')[:800]))
        raise
