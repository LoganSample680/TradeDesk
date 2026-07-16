# TradeDesk, All-in-One Contractor Business Suite

A complete mobile-first business management app for solo and small contractors. Built as a progressive web app, no install, no app store, runs entirely in the browser. Add to iPhone home screen for a native app experience.

## Live App

**https://tradedeskpro.app**

Safari → Share → Add to Home Screen

---

## What's in here

| File | Description |
|------|-------------|
| `index.html` | The full app, every page and feature |
| `intake.html` | Client-facing lead intake form (shareable link) |
| `sign.html` | Client-facing proposal signing portal |
| `client.html` | Client portal, view proposals and history |
| `supabase-setup.sql` | Run once in Supabase SQL Editor to create the database |
| `supabase-setup/README.md` | Step-by-step Supabase + cloud sync setup |
| `signing-setup/README.md` | DocuSeal + ntfy remote signing and notifications |

---

## Features

### Estimate Builder, 7 Steps
- Client info with live duplicate detection and MapKit address autocomplete
- Per-job labor rates set upfront, never hardcoded
- Scope of work, tap each item, set hours + rate per job
- Room-by-room surface entry with L×W auto sq ft calculation
- Bid review with full cost breakdown (labor, materials, scope)
- Pre-proposal confirmation screen showing client, total, deposit
- Single-line proposal, client sees one price, not the internal math
- PDF download for remote signing
- Client e-signature (typed name + draw canvas)
- UETA-compliant terms and change order language
- Generic estimate type for any trade or job

### Client & Lead Management
- Full client records, name, phone, address, property type, lead source
- Multiple property addresses per client with labels
- MapKit-powered address autocomplete on every address entry field
- Duplicate detection on name and phone
- Client risk levels: normal / watch / high risk / blacklisted
- Timeline view, every bid, job, payment, and note in one place
- Lead intake form (shareable link), clients fill out their own info
- Lead status tracking with follow-up scheduling
- SMS templates for follow-up, reminders, and collections
- Lead source analytics, close rate and revenue per lead source

### Job Lifecycle
- Lead → Estimate → Signed → Scheduled → Active → Complete → Collect
- Price adjustment on completion (raise or lower with required reason)
- Calendar with availability and conflict detection
- Job documents, proposals, change orders, completion sign-off

### Mileage & GPS Tracking
- Live GPS drive tracking with MapKit maps
- Auto-calculates miles from start to stop
- IRS standard mileage rate deduction
- Trip history with client and job linking
- Export mileage log as CSV

### Collections & Lien Workflow
- 7 / 14 / 21 / 30 day escalation with pre-written SMS at each stage
- Kansas mechanic's lien filing (K.S.A. 60-1105 deadline warnings)
- Client risk tracking and blacklist

### Receipt Scanner (AI-Powered)
- Photograph any receipt, Claude AI reads vendor, amount, date, category
- Date confirmation step before saving
- Receipt photo stored inline with the expense record
- Duplicate receipt detection
- Export all receipts as a single PDF, one per page, sorted by date, IRS ready

### Books & Taxes
- Income tracking (auto-logged from payments)
- Expense tracking with IRS Schedule C categories
- Quarterly tax estimates, federal + state, SE tax with SS wage-base cap
- SE tax: Social Security (12.4%) capped at annual wage base; Medicare (2.9%) uncapped
- Safe harbor: 110% of prior-year tax when prior-year AGI > $150K
- Multi-state income tracking, apportions income by job location, credits for taxes paid to other states
- Full tax report PDF, expenses CSV, mileage CSV, full data backup

### Dashboard
- YTD revenue, expenses, mileage, taxes, profit
- Pipeline health with booking pace
- Lead source analytics, close rate and revenue per source
- What needs attention, collections, follow-ups, cold leads

### Notes Canvas
- Floating pencil button during any active estimate
- Full-screen infinite canvas, Apple Pencil compatible
- Auto-saves to the bid record

### PWA & Device Features
- Add to home screen, icon, splash screen, standalone mode
- App badge shows unsigned proposals + overdue follow-ups
- Wake lock during GPS tracking and estimate entry (screen stays on)
- Web Share API, native iOS share sheet for links and documents
- Home screen shortcuts: New Estimate, Log Expense, Clock In
- Share-target: share a receipt photo from any app directly into expenses

### Cloud Sync & Realtime
- Sign in / sign up on first launch
- All data syncs in real time across every logged-in device
- Fleet, gallery, licensing, and calendar update live when another device makes a change
- Connection restore: re-syncs immediately on reconnect, not on the next poll tick
- Per-user data isolation, each account sees only their own data

---

## Cloud Sync Setup

See [`supabase-setup/README.md`](supabase-setup/README.md).

1. Create a free project at [supabase.com](https://supabase.com)
2. Run `supabase-setup.sql` in SQL Editor
3. Copy Project URL and anon key into `index.html`, `intake.html`, `sign.html`, and `client.html`
4. Push, done

---

## Remote Signing Setup

See [`signing-setup/README.md`](signing-setup/README.md).

DocuSeal (self-hosted free on Railway) + ntfy push notifications. Zero monthly cost.

---

## Deploying

Hosted on Cloudflare Pages. Every push to `main` goes live automatically at **https://tradedeskpro.app**.

To self-host, serve the HTML files as static files. The app calls Supabase directly from the browser, no backend required.

---

## Stack

| Layer | Tech |
|-------|------|
| App | Vanilla JS, no framework, no build step |
| Hosting | Cloudflare Pages |
| Auth + Database | Supabase (Postgres + GoTrue) |
| Maps + Geocoding | Apple MapKit JS (primary), Photon + Census fallback |
| Receipt AI | Claude Haiku via Supabase Edge Function |
| Signing | DocuSeal |
| Notifications | ntfy.sh |

---

## Legal

Tax estimates are not a substitute for a licensed CPA.
Lien deadlines based on KS K.S.A. 60-1105, verify with a Kansas attorney before filing.
Electronic signatures comply with the Kansas Uniform Electronic Transactions Act (UETA).
