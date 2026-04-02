# TradeDesk — All-in-One Contractor Suite

A complete mobile-first business management app for a solo painting contractor. Built as a single HTML file — no server, no dependencies, no install. Runs entirely in the browser from a GitHub Pages URL.

## Live App

**[Open the app](https://logansample680.github.io/zj-painting/)**

Bookmark it on your iPhone home screen: Safari → Share → Add to Home Screen

---

## What's in here

| File | Description |
|------|-------------|
| `index.html` | The full app — every feature in one file |
| `signing-setup/README.md` | How to set up remote PDF signing + notifications |
| `signing-setup/webhook-test.sh` | Test your ntfy push notifications |
| `signing-setup/docuseal-env.txt` | Railway deployment variables for DocuSeal |

---

## Features

**Estimate builder (7 steps)**
- Client info + per-job labor rates set upfront
- Scope of work — tap each item, enter hours + rate, saves to bid
- Room-by-room surface entry with L×W auto-calc
- Bid review with full cost breakdown
- Proposal generation — matches real ZJ bid format
- PDF download for remote signing
- Client signature (typed name + draw canvas)

**Job management**
- Full lifecycle: Lead → Estimate → Signed → Scheduled → Active → Complete → Collect
- Price adjustment on completion (raise or lower with required reason)
- Before/after photo attachment
- Calendar with availability and conflict detection

**Collections**
- 7/14/21/30 day escalation workflow
- Pre-written SMS templates at each stage
- Mechanic's lien filing (KS K.S.A. 60-1105 deadline warnings)
- Client risk system (normal / watch / high risk / blacklisted)

**Money**
- Payment logging with deposit / final / custom
- Mileage tracking with IRS rate
- Expense tracking with receipt camera
- Quarterly tax estimates (KS + federal)
- Lead source analytics with close rate and revenue per source

**Notes & Sketches**
- ✏️ floating canvas — available during any active estimate
- Saves to the bid record automatically
- Infinite scroll, Apple Pencil compatible

---

## Data storage

All data lives in `localStorage` on the device. Nothing is sent to any server. Take regular exports via the Taxes → Export report function as backup until cloud sync is added.

---

## Remote signing setup

See [`signing-setup/README.md`](signing-setup/README.md) for the full walkthrough. Zero monthly cost using DocuSeal + ntfy.

---

## Deploying to GitHub Pages

1. Fork or clone this repo
2. Go to repo **Settings → Pages**
3. Source: **Deploy from branch → main → / (root)**
4. Save — GitHub gives you a URL in ~60 seconds
5. Open the URL on your iPhone and add to home screen

That's the whole deploy process. Every time you push a change to `main`, GitHub Pages updates automatically.

---

## Legal

Built for ZJ's Painting & Special Coatings, Wichita KS. Powered by TradeDesk.  
Tax estimates are not a substitute for a licensed CPA.  
Lien deadlines are based on KS K.S.A. 60-1105 — verify with a Kansas attorney before filing.
