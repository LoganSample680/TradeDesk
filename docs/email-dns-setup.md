# Proposal Email DNS Setup

## Why this matters

When a proposal email comes from `proposals@tradedeskpro.app` with correct
SPF/DKIM/DMARC records, corporate spam filters see:

```
Sender domain  =  tradedeskpro.app
Link domain    =  tradedeskpro.app
DKIM signature =  ✅ valid
SPF check      =  ✅ pass
DMARC policy   =  ✅ aligned
```

That's why the email gets through. Previously the email came from the
contractor's Gmail account and had a link to tradedeskpro.app — two
unrelated domains. Corporate filters (Exchange, Proofpoint, Barracuda)
flag that pattern as phishing and quarantine it.

---

## Step 1 — Create a Resend account

1. Go to [resend.com](https://resend.com) and sign up (free tier: 3,000 emails/month)
2. Add your domain `tradedeskpro.app` under **Domains**
3. Resend gives you three DNS records to add (SPF, DKIM, DMARC)

---

## Step 2 — Add DNS records

Add these at your DNS provider (Cloudflare, Namecheap, etc.):

### SPF (TXT record on `tradedeskpro.app`)

If you already have an SPF record, **add** the Resend include — don't create a second TXT record:

```
v=spf1 include:_spf.resend.com ~all
```

If you have no SPF record yet, create:

| Type | Name              | Value                                |
|------|-------------------|--------------------------------------|
| TXT  | tradedeskpro.app  | `v=spf1 include:_spf.resend.com ~all` |

### DKIM (TXT record — Resend generates the value)

Resend will show you something like:

| Type  | Name                                    | Value             |
|-------|-----------------------------------------|-------------------|
| TXT   | `resend._domainkey.tradedeskpro.app`    | `p=MIIBIjAN…`     |

Copy the exact record from your Resend dashboard — the value is unique to your account.

### DMARC (TXT record on `_dmarc.tradedeskpro.app`)

| Type | Name                          | Value                                                         |
|------|-------------------------------|---------------------------------------------------------------|
| TXT  | `_dmarc.tradedeskpro.app`     | `v=DMARC1; p=quarantine; rua=mailto:dmarc@tradedeskpro.app`   |

Start with `p=quarantine` (blocks but quarantines, doesn't hard-reject).
Upgrade to `p=reject` once you've confirmed legitimate mail isn't being caught.

---

## Step 3 — Set the Resend API key as a Supabase secret

```bash
supabase secrets set RESEND_API_KEY=re_your_api_key_here
```

Or via the Supabase dashboard → Project Settings → Edge Functions → Secrets.

---

## Step 4 — Verify

Send a test proposal email. Check:
- [mail-tester.com](https://www.mail-tester.com) — paste the test address as the client email
- [MXToolbox](https://mxtoolbox.com/SuperTool.aspx) → SPF / DKIM / DMARC lookups

---

## Fallback behaviour

If `RESEND_API_KEY` is not set, or the Resend API returns an error, the app
automatically falls back to opening the device's native mail client via
`mailto:`. No data is lost — the contractor just sends from their Gmail
instead of the server.

The fallback makes the Resend setup optional: the app works without it,
but email deliverability is much better with it.

---

## Sending address

Emails are sent from:

```
proposals@tradedeskpro.app
```

The `reply-to` header is set to the contractor's own email address, so
when the client hits **Reply** it goes straight to the contractor — not to
the TradeDeskPro address.
