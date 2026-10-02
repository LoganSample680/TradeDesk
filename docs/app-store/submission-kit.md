# App Store submission kit: TradeDesk 1.0

Copy and paste, top to bottom, in App Store Connect. Everything here matches
what the app actually does; change a line only if the app changes.

---

## 0. Before you start (one time)

1. **Developer portal** (developer.apple.com, Identifiers, `app.tradedesk`):
   turn on Increased Memory Limit, Extended Virtual Addressing, Background GPU
   Access, Time Sensitive Notifications. (The first store build registers the
   ID itself; if it is not there yet, fire the build once, then do this.)
2. **Supabase** (Authentication, Providers, Apple, Client IDs): add
   `app.tradedesk` next to `app.tradedesk.beta`, comma separated.
3. **Merge PR #147 and fire the store build** (tell Claude "merge and fire the
   store build"). The build lands in App Store Connect in about 20 minutes plus
   Apple's processing.

---

## 1. New app record (Apps, "+", New App)

| Field | Value |
|---|---|
| Platform | iOS |
| Name | **TradeDesk** (if Apple says it is taken: **TradeDesk Pro**) |
| Primary language | English (U.S.) |
| Bundle ID | `app.tradedesk` |
| SKU | `tradedesk-ios` |
| User access | Full access |

---

## 2. App Information

| Field | Value |
|---|---|
| Subtitle | `Estimate, invoice, get paid` |
| Category | Primary: **Business**. Secondary: **Productivity** |
| Content rights | Does not contain, show, or access third-party content |
| Age rating | Answer **None / No** to every question. Result: **4+** |

Age rating notes: no unrestricted web access (the app only opens its own
site), no user-to-user messaging, no gambling, no contests, no medical.

---

## 3. Pricing and availability

- Price: **Free**
- Availability: **United States** (add more later)
- No in-app purchases.

---

## 4. App Privacy

**Privacy Policy URL:** `https://tradedeskpro.app/privacy`

"Do you or your third-party partners collect data from this app?" **Yes.**

For every type below: **Linked to the user: Yes. Used for tracking: No.**
Purpose: **App Functionality** (plus Analytics where noted).

| Data type | Collected | Purpose |
|---|---|---|
| Contact Info: Name | Yes | App Functionality |
| Contact Info: Email Address | Yes | App Functionality |
| Contact Info: Phone Number | Yes | App Functionality |
| Contact Info: Physical Address | Yes | App Functionality |
| Location: Precise Location | Yes | App Functionality |
| Fitness (iPhone motion data that marks when a drive starts and stops) | Yes | App Functionality |
| Environment Scanning (LiDAR room scans saved to the account) | Yes | App Functionality |
| Contacts (clients imported from the phone's address book) | Yes | App Functionality |
| Financial Info: Other Financial Info (invoices, payments logged) | Yes | App Functionality |
| User Content: Photos or Videos | Yes | App Functionality |
| User Content: Other User Content (notes, estimates, signatures) | Yes | App Functionality |
| Identifiers: User ID | Yes | App Functionality |
| Identifiers: Device ID (push token) | Yes | App Functionality |
| Usage Data: Product Interaction | Yes | Analytics, App Functionality |
| Diagnostics: Crash Data, Other Diagnostic Data | Yes | App Functionality |

Not collected: Payment Info (card numbers stay with Stripe), Health, Browsing History, Search History, Audio (voice is transcribed on the
phone), Sensitive Info, Purchases.

---

## 5. Version 1.0 page

**Promotional text (170 max):**

```
Estimate on site, get it signed, schedule the crew and get paid, all from your phone. Drives and job time log themselves. Works with no signal.
```

**Description:**

```
TradeDesk runs a trade business from one app: the estimate, the signature, the schedule, the crew, the invoice and the payment. Built for painters, plumbers, electricians, HVAC, landscapers and general contractors who would rather be on the job than at a desk.

ESTIMATE AND SIGN ON THE SPOT
Build a fixed price, time and materials, or custom estimate in minutes using your own prices. Measure rooms by walking them with your iPhone. Send it by text or email and your client signs from their phone.

SCHEDULE AND RUN THE CREW
Book jobs, dispatch the crew and see who is where during working hours. Each crew member agrees on their own phone before their location is shared, and tracking runs only inside the business hours you set.

TIME AND MILEAGE THAT LOG THEMSELVES
Work drives become mileage entries with real road miles. Time on a job site is logged when you arrive and leave. Fix anything by hand in a tap.

INVOICE AND GET PAID
Send an invoice your client can pay by card through your own Stripe account, or log cash, check and Venmo yourself. Change orders, deposits and balances stay attached to the job.

THE BOOKS ARE BUILT IN
Income, expenses, mileage and lien deadlines are tracked as you work, so tax time is a report, not a weekend.

WORKS WITH NO SIGNAL
Basements, crawlspaces and rural jobs are fine. Your work saves on the phone and syncs when you are back online.

Questions: tradedeskprosupport@gmail.com
```

**Keywords (100 max):**

```
contractor,estimate,invoice,mileage,crew,plumber,electrician,painter,hvac,quote,timesheet,lien,job
```

| Field | Value |
|---|---|
| Support URL | `https://tradedeskpro.app/support` |
| Marketing URL | `https://tradedeskpro.app` |
| Version | 1.0 |
| Copyright | `2026 TradeDesk` |

---

## 6. Screenshots

Real app screens only, no "beta", no mention of Android. Apple needs:

- **iPhone 6.9"** (iPhone 16 Pro Max / 17 Pro Max), 3 to 10 shots
- **iPad 13"** (iPad Pro), 3 to 10 shots

Suggested order (same on both):
1. Home dashboard with today's jobs and money
2. An estimate being built
3. The client signing screen
4. Schedule / crew board
5. Time log or mileage with a logged drive
6. An invoice with Pay by card

Easiest way: open the store build from TestFlight on each device, sign into
the demo account, press side button + volume up on each screen.

---

## 7. App Review Information

**Sign-in required: Yes**

| Field | Value |
|---|---|
| User name | *(the tradedeskpro demo account email)* |
| Password | *(its password)* |
| Contact | your name, phone, `tradedeskprosupport@gmail.com` |

The demo account must already hold: a few clients, an estimate, a signed job,
a scheduled job, one crew member, an invoice, and some mileage. No two-factor
code on it.

**Attach:** a 30 to 60 second screen recording of a drive and job-site time
logging themselves (Settings, Control Center, Screen Recording).

**Notes (paste as is):**

```
TradeDesk is a business app for trade contractors (painters, plumbers, electricians, HVAC). It covers estimates, client e-signature, scheduling, crew dispatch, invoicing and payments.

DEMO ACCOUNT
The account above is a sample contracting business with clients, estimates, jobs, a crew member, invoices and mileage already in it.

BACKGROUND LOCATION (2.5.4)
Location is used to log work drives as mileage (an IRS business record) and time on job sites for payroll. It runs only inside the business hours the company sets in Settings. A crew member's location is shared with their employer only after they accept on their own phone, and anyone can turn it off in iOS Settings. Logged drives appear under Mileage, and job time appears on the job and in the time log. A screen recording of this is attached.

PAYMENTS (3.1.3(e))
Card payments are clients paying the contractor for physical, real-world services (painting, plumbing, repairs). They go through the contractor's own Stripe Connect account. The app sells no digital goods and has no in-app purchases. The app is free.

ACCOUNT DELETION (5.1.1(v))
Settings, Danger zone, Delete account. It permanently deletes the account and its data.

SIGN IN
Email and password, or Sign in with Apple.

OTHER PERMISSIONS
Camera: job photos and LiDAR room scans for estimates (room scan needs a LiDAR iPhone or iPad Pro). Microphone and speech: voice notes, transcribed on device. Motion: detects when a drive starts and ends. Face ID: locks the app to the signing screen while a client holds the phone. Notifications: job and payment alerts.

Support: tradedeskprosupport@gmail.com
```

---

## 8. Submit

1. Under **Build**, pick the store build (it shows once processing finishes).
2. Export compliance is already answered in the build (standard encryption only).
3. **Add for Review**, then **Submit to App Review**.
4. Release: **Manually release this version** so you pick the launch moment.

Typical review time is 24 to 48 hours.
