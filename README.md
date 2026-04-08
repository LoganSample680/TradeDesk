# TradeDesk — All-in-One Contractor Business Suite

A complete mobile-first business management app for solo and small contractors. Built as a single HTML file — no install, no app store, runs entirely in the browser. Add to iPhone home screen for a native app experience.

## Live App

**https://logansample680.github.io/TradeDesk/**

Safari → Share → Add to Home Screen

---

## What's in here

| File | Description |
|------|-------------|
| `index.html` | The full app — every feature in one file |
| `supabase-setup.sql` | Run once in Supabase SQL Editor to create the database |
| `supabase-setup/README.md` | Step-by-step Supabase + cloud sync setup |
| `signing-setup/README.md` | DocuSeal + ntfy remote signing and notifications |

---

## Features

### Estimate Builder — 7 Steps
- Client info with live duplicate detection
- Per-job labor rates set upfront — never hardcoded
- Scope of work — tap each item, set hours + rate per job
- Room-by-room surface entry with L×W auto sq ft calculation
- Bid review with full cost breakdown (labor, materials, scope)
- Pre-proposal confirmation screen showing client, total, deposit
- Single-line proposal — client sees one price, not the internal math
- PDF download for remote signing
- Client e-signature (typed name + draw canvas)
- UETA-compliant terms and change order language

### Client Management
- Full client records — name, phone, address, property type, lead source
- Duplicate detection on name and phone
- Client risk levels: normal / watch / high risk / blacklisted
- Timeline view — every bid, job, payment, and note in one place
- SMS templates for follow-up, reminders, and collections

### Job Lifecycle
- Lead → Estimate → Signed → Scheduled → Active → Complete → Collect
- Price adjustment on completion (raise or lower with required reason)
- Calendar with availability and conflict detection

### Collections & Lien Workflow
- 7 / 14 / 21 / 30 day escalation with pre-written SMS at each stage
- Kansas mechanic's lien filing (K.S.A. 60-1105 deadline warnings)
- Client risk tracking and blacklist

### Receipt Scanner (AI-Powered)
- Photograph any receipt — Claude AI reads vendor, amount, date, category
- Date confirmation step before saving
- Receipt photo stored inline with the expense record
- Duplicate receipt detection
- Export all receipts as a single PDF — one per page, sorted by date, IRS ready

### Books & Taxes
- Income tracking (auto-logged from payments)
- Expense tracking with IRS Schedule C categories
- Mileage log with IRS rate deduction
- Quarterly tax estimates (federal + Kansas)
- Full tax report PDF, expenses CSV, mileage CSV, full data backup

### Dashboard
- YTD revenue, expenses, mileage, taxes, profit
- Pipeline health with booking pace
- Lead source analytics — close rate and revenue per source
- What needs attention — collections, follow-ups, cold leads

### Notes Canvas
- Floating pencil button during any active estimate
- Full-screen infinite canvas, Apple Pencil compatible
- Auto-saves to the bid record

### Cloud Sync
- Sign in / sign up on first launch
- All data syncs in background after every save
- Restore everything on any new device
- Per-user data isolation — each account sees only their own data

---

## Cloud Sync Setup

See [`supabase-setup/README.md`](supabase-setup/README.md).

1. Create a free project at [supabase.com](https://supabase.com)
2. Run `supabase-setup.sql` in SQL Editor
3. Copy Project URL and anon key into `index.html`
4. Push — done

---

## Remote Signing Setup

See [`signing-setup/README.md`](signing-setup/README.md).

DocuSeal (self-hosted free on Railway) + ntfy push notifications. Zero monthly cost.

---

## Deploying

GitHub Pages is already configured. Every push to `main` goes live automatically.

To self-host (Nginx, Proxmox, etc) — serve `index.html` as a static file. The app calls Supabase directly from the browser, no backend required.

---

## Stack

| Layer | Tech |
|-------|------|
| App | Vanilla JS, single HTML file, no dependencies |
| Hosting | GitHub Pages |
| Auth + Database | Supabase (Postgres + GoTrue) |
| Receipt AI | Claude Haiku via Supabase Edge Function |
| Signing | DocuSeal |
| Notifications | ntfy.sh |

---

## Legal

Tax estimates are not a substitute for a licensed CPA.
Lien deadlines based on KS K.S.A. 60-1105 — verify with a Kansas attorney before filing.
Electronic signatures comply with the Kansas Uniform Electronic Transactions Act (UETA).
