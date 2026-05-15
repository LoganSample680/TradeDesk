# TradeDesk QA Test Script — Full Manual Walkthrough
**Version tested:** 05.15.26.49 · **Date:** 2026-05-15

---

> **Do not hallucinate. Only report what you actually see and observe. If something is missing, broken, or unclear — say so exactly. Do not assume something is working because it should be. Test it.**

---

## HOW TO USE THIS SCRIPT

Work through each numbered item top to bottom. For each step:
- Perform the action described
- Check whether the expected result matches what you actually see
- Write PASS, FAIL, or NOTE next to each item
- If something is wrong, describe exactly what you see instead

Items marked **[SETUP REQUIRED]** need specific test data in place before you can run them. Set up that data first, then run the test.

---

## SECTION 1 — AUTH & BOOT

**1.1** Open the app URL in a browser (or launch the PWA from your home screen). Observe the initial load.
- Expected: A boot/loading overlay appears briefly, then fades away revealing the dashboard. No blank white screen, no JS error alert.

**1.2** While still on the boot screen, open DevTools (F12) → Console tab. Reload the page.
- Expected: No red JS errors appear during boot. Yellow warnings are acceptable; red errors are a FAIL.

**1.3** Sign out if already signed in. Attempt to sign in using valid credentials.
- Expected: Sign-in flow completes, you land on the dashboard, your name appears in the greeting.

**1.4** After sign-in, observe whether a sync indicator appears briefly.
- Expected: Some indicator (spinner, "Syncing…" toast, or cloud icon) confirms data is loading from Supabase. The dashboard populates with your actual data, not empty states.

**1.5** Sign out. Confirm the sign-out completes cleanly.
- Expected: You are returned to the sign-in screen. Refreshing the page does not auto-sign you back in.

**1.6** [SETUP REQUIRED — must be signed in with data loaded] Put your device in airplane mode (or use browser DevTools → Network → Offline). Reload the page.
- Expected: The app still loads from the service worker cache. You can see the dashboard and navigate to pages. You do NOT get a browser "no internet" error page. A banner or indicator may appear noting offline status.

**1.7** Re-enable the network. Observe behavior.
- Expected: App reconnects. No forced reload required. Data remains intact.

**1.8** Go to Settings. Find the version number.
- Expected: Version shows "05.15.26.49" (or the current live version). It does not show a stale or placeholder value.

---

## SECTION 2 — DASHBOARD

**2.1** Sign in with an account that has real data. Read the greeting text at the top.
- Expected: Greeting uses your actual first name (e.g., "Good morning, [Name]"), not "User" or a blank.

**2.2** Read the sub-text line beneath the greeting. [SETUP REQUIRED — account must have at least one pending item: an unsent bid, a won job needing scheduling, or an overdue follow-up]
- Expected: Sub-text reads something like "3 things need your attention today. The biggest one is $X in outstanding balances." It does NOT say "You're all caught up — nothing urgent." when items are actually pending.

**2.3** With no pending items of any kind, re-check the sub-text.
- Expected: Sub-text says "You're all caught up — nothing urgent." This only appears when there genuinely is nothing pending.

**2.4** Look at the pipeline summary cards (Active leads, Won jobs, Collect).
- Count the number shown on each card.
- Manually count the matching items in Leads and Clients.
- Expected: The numbers match. A client with 3 won bids still counts as 1 won client, not 3.

**2.5** Look at the Today feed section.
- Expected: Shows jobs scheduled for today only. If no jobs today, shows a day-of-week message (e.g., "Open Monday. Book an estimate today."). Does not show yesterday's or tomorrow's jobs.

**2.6** Look at the Lead Sources table. [SETUP REQUIRED — create two clients both from "Word of mouth." Give one client two won bids.]
- Expected: "Word of mouth" shows 2 in the Leads column and 1 in the Won column. The won count is per client, not per bid. Revenue column shows the sum of all won bid amounts for that source.

**2.7** Verify the Won/Lost Close % in the Lead Sources table. [SETUP REQUIRED — one source with 1 won and 1 lost client]
- Expected: Close % = 50%. Calculation is won clients ÷ (won + lost clients), not won bids ÷ total bids.

**2.8** Look for the Average Job Value metric on the dashboard KPI row.
- Expected: Shows total revenue from all won bids ÷ number of won bids (not clients). If no won bids, shows "—".

**2.9** Look for the Active Liens card. [SETUP REQUIRED — account with no liens filed]
- Expected: Lien card is hidden or not visible. It should only appear when at least one lien exists.

**2.10** File a lien on a client (see Lien section for steps). Return to the dashboard.
- Expected: Active Liens card now appears with a countdown to lien expiry.

**2.11** Check the month-over-month trend arrows on the KPI metrics (Revenue, Expenses).
- Expected: Trend arrows appear only when in "Year" view mode. Switch to year view if needed. Arrows point up/down correctly relative to the prior year's same metric.

---

## SECTION 3 — LEADS / CLIENTS

**3.1** Tap "Add client" or the + button to create a new lead. Fill in a name and phone number. Save.
- Expected: New client appears in the leads list immediately, without a page reload.

**3.2** Open the client you just created. Edit the name, phone, and address. Save.
- Expected: Changes persist after navigating away and returning to that client.

**3.3** On the Clients page, tap each filter tab: All, Won, Active, Collect, Closed.
- Expected: Each tab shows only the clients matching that stage. "All" shows every client. Check that a client you know is in each stage appears under the correct tab.

**3.4** Open a client with multiple bids. Go to the Bids tab within the client detail.
- Expected: All bids for that client appear. No bids from other clients appear.

**3.5** Open a client and go to the Notes/Timeline tab.
- Expected: Entries are listed in reverse chronological order (newest first). Older entries appear below newer ones.

**3.6** Open a client. Find the risk badge options (Watch / High Risk / Blacklisted).
- Set it to "High Risk." Navigate away and return.
- Expected: Badge persists as "High Risk." When you try to start an estimate for this client, a warning confirmation appears before allowing you to proceed.

**3.7** Set a client to "Blacklisted." Attempt to start an estimate for them.
- Expected: App blocks the estimate and shows an alert like "This client is blacklisted. Estimates are blocked."

**3.8** Use the search or filter field on the Clients page to type a client's name.
- Expected: List filters to show only matching clients. Clearing the search restores all clients.

**3.9** Delete a client.
- Expected: Client disappears from all lists. A confirmation prompt appears before deletion. After deletion, navigating to Clients shows the client is gone.

---

## SECTION 4 — PAINT ESTIMATE FLOW (6 Steps)

**4.1** From a client's detail page, tap "Start Estimate." If prompted for trade type, select Painting. Select "Scope & Price" estimate style.
- Expected: Step 1 of the paint estimate opens, pre-filled with the client's name and address.

**4.2** Step 1: Fill in client info, job type (interior/exterior), and address. Tap Next.
- Expected: Proceeds to Step 2 without error. All entered data remains visible on the step header.

**4.3** Step 2: Select surface types. Choose "Walls" and "Ceiling."
- Expected: Only relevant surfaces for the selected job type appear. Exterior-only surfaces (Deck, Exterior walls) do not appear for an interior job.

**4.4** Step 3: Enter measurements. For a room, enter Length = 12, Width = 10, Height = 9.
- Expected: Wall area calculates as approximately (12+10+12+10) × 9 = 396 sq ft for the perimeter method (or verify visually what formula the app uses). Ceiling area shows 120 sq ft (12×10). Verify the numbers displayed match the inputs.

**4.5** Step 4: Select a paint product and color. Search for "Alabaster" in the color picker.
- Expected: SW 7008 Alabaster appears in results. Selecting it fills in the color field. A color swatch preview appears.

**4.6** Step 5: Review the pricing summary.
- Expected: Labor subtotal and materials subtotal are both visible. The margin percentage is applied. Total price reflects labor + materials with margin. The deposit field shows 25% of the total by default.

**4.7** Step 6: Review and confirm the estimate summary before sending.
- Expected: All rooms, surfaces, scope items, paint selections, and the total price are visible and accurate.

**4.8** Mid-estimate, navigate away to the Dashboard page without saving.
- Expected: When you return to the estimate (via the client detail or a prompt), a "Resume draft?" confirmation appears. Tapping Resume restores your work from where you left off.

**4.9** Accept the resume prompt and verify the draft is intact.
- Expected: All previously entered data (client, surfaces, measurements, products, pricing) is restored exactly as you left it.

**4.10** Check that the deposit field default is 25% of the total.
- For a $1,000 estimate, the deposit should pre-fill as $250.00 (or whatever value 25% rounds to). Verify the displayed number matches 25% of the bid total.

---

## SECTION 5 — GENERIC ESTIMATE (GEI / BUILD YOUR OWN)

**5.1** From a client detail or the trade picker, open a Generic / "Build Your Own" estimate.
- Expected: The generic estimate form opens (NOT the 6-step paint flow). A trade type is shown at the top.

**5.2** Step 1: Enter job name and verify the trade type is correct.
- Expected: Trade label matches what was selected. All fields are editable.

**5.3** Step 2: Add at least three line items. For each, enter a description, quantity, and rate.
- Line 1: Qty 2, Rate $100 → Line total should show $200.00
- Line 2: Qty 1, Rate $350 → Line total should show $350.00
- Line 3: Qty 5, Rate $25 → Line total should show $125.00
- Expected: Each line calculates qty × rate correctly. Subtotal = $675.00.

**5.4** Remove one line item.
- Expected: That line disappears and the subtotal updates immediately to reflect the remaining lines.

**5.5** Step 3: Check the pricing summary. Subtotal should equal the sum of all line items.
- Expected: Subtotal matches your manual calculation. Deposit field defaults to 25% of subtotal.

**5.6** Complete and save the generic estimate.
- Expected: A bid record is created with status "Pending." The bid appears in the client's Bids tab.

**5.7** Verify there is NO handwritten notes canvas anywhere in the generic estimate flow.
- Expected: No drawing canvas, no "Notes canvas" or sketch pad UI element exists. If you see one, that is a FAIL — report it.

---

## SECTION 6 — JOBS PAGE

**6.1** Navigate to the Jobs page. [SETUP REQUIRED — at least one active job]
- Expected: Jobs list shows all active jobs. Each job shows client name, date, and status.

**6.2** Tap a job to open its detail.
- Expected: Job detail shows scope items, a time entries section, and an expenses section.

**6.3** Tap "Clock In" on a job scope item.
- Expected: A timer starts. The scope item shows as active (highlighted or with a running time indicator). The active timer is visible.

**6.4** Tap "Clock Out."
- Expected: Timer stops. A time entry is added to the job. The logged time appears in the time entries section.

**6.5** [SETUP REQUIRED — location services enabled, and you are physically near a client's address, OR skip if location testing is not possible] Note whether a geo-trigger appears suggesting clock-in when near the job site.
- Expected: If within range of a job site address, a banner or prompt appears suggesting you clock in. If not near any job site, no such prompt appears. Note: This test can be skipped if location cannot be simulated.

**6.6** Mark a job as complete.
- Expected: A "Job Complete" scorecard modal appears showing Revenue, Materials, Labor, Net Profit, and Margin %. The job status updates to done.

**6.7** [SETUP REQUIRED — job with known revenue and expenses, and NO mileage logged against it] Check the Job Scorecard Net Profit.
- For a job with Revenue = $500, Materials = $100, Labor = 2 hrs × $45/hr = $90:
- Expected: Net Profit = $500 - $100 - $90 = $310. Mileage deduction does NOT appear in or reduce this number. Verify visually.

---

## SECTION 7 — MONEY / FINANCE PAGE

**7.1** Navigate to the Money page (also called Finance or Tracker). Add an income entry: vendor "Test Client," amount $500, today's date.
- Expected: Entry appears in the income log immediately. The monthly totals update.

**7.2** Add an expense entry: vendor "Home Depot," amount $75, category "Materials."
- Expected: Entry appears in the expenses list, categorized as Materials. Monthly totals update.

**7.3** Navigate to the Monthly P&L grid. Verify the column headers are: Month | Revenue | Expenses | Net.
- Expected: Exactly four columns. No "Mileage" column in the P&L grid itself.

**7.4** [SETUP REQUIRED] With Revenue = $1,000, Expenses = $200, and 100 miles logged in the same month (IRS rate = $0.725/mi = $72.50 deduction):
- Expected: The P&L grid shows Net = $800 ($1,000 - $200). The mileage deduction ($72.50) does NOT subtract from the net in the grid. Instead, a note below the grid (or below the totals row) mentions something like "100 mi driven · $72.50 mileage tax deduction — reduces taxable income, not cash profit."

**7.5** Verify the mileage note text. It should say something about "reduces taxable income, not cash profit" — not present it as a cash expense.
- Expected: Note is visible below the P&L table when mileage is logged. Exact wording: verify it says "reduces taxable income, not cash profit" or equivalent.

**7.6** Tap the Export/CSV button for the P&L.
- Expected: A CSV file downloads. Open it and verify: (a) Income column includes BOTH income[] entries AND payment[] entries for the selected period. (b) Net column = Revenue − Cash Expenses. (c) Mileage appears as a separate informational line, not deducted from the net.

---

## SECTION 8 — PAYMENTS / BIDS

**8.1** [SETUP REQUIRED] Create a bid for $100 with no deposit explicitly set (so it defaults to 25% = $25). Log a payment of $25.
- Expected: Payment status badge shows "Deposit paid" — NOT "Partial — $75 due."

**8.2** [SETUP REQUIRED] On that same $100 bid, log an additional $75 payment to bring the total to $100.
- Expected: Payment status badge now shows "Paid in full."

**8.3** [SETUP REQUIRED] Create a new $100 bid. Log a payment of $10 (less than the $25 deposit threshold).
- Expected: Payment status badge shows "Partial — $90 due" (or the exact remaining balance).

**8.4** [SETUP REQUIRED] Create a $100 bid with no payments at all.
- Expected: Payment status badge shows "Unpaid."

**8.5** Log a payment on any active bid. Navigate to the Dashboard.
- Expected: Revenue on the Dashboard KPI has increased by the payment amount. Income in the Finance/Books has also updated.

**8.6** Open a won bid and use "Quick Pay" or "Log payment" from the overview screen.
- Expected: Payment modal opens pre-filled with the balance amount. Submitting it records the payment and updates the bid status.

**8.7** Attempt to log a payment larger than the remaining balance. [SETUP REQUIRED — bid with $100 remaining]
- Try entering $150.
- Expected: App shows an error like "Amount exceeds balance of $100.00" or similar. It does NOT silently save the overpayment as a valid payment.

---

## SECTION 9 — MILEAGE TRACKER

**9.1** Navigate to the Tracker page, Mileage tab. Log a trip: 50 miles, purpose "Job site."
- Expected: Trip appears in the mileage list with date, miles, and purpose. The mileage total for the selected year updates.

**9.2** Verify the deduction calculation. The current IRS rate should be $0.725/mile (2026 rate).
- For 50 miles: deduction = 50 × 0.725 = $36.25.
- Expected: The deduction shown next to the entry or in the summary is $36.25. If a different rate is shown, note what it is.

**9.3** Navigate to the Taxes page. Find the mileage deduction entry.
- Expected: Mileage deduction appears as a deduction from taxable income in the tax calculation section — NOT as a line item in cash expenses or in the P&L net.

**9.4** Navigate to Settings → Vehicles. Locate the odometer section.
- Expected: An "Update readings" button or similar control is visible. Tap it.
- Expected: An odometer entry modal opens correctly. It does NOT show a dead link, broken reference, or "undefined" error.

**9.5** Enter a year-start (January 1) odometer reading for a vehicle. Save it.
- Expected: Reading saves. No error toast. Navigate away and return — the reading persists.

**9.6** Enter a year-end (December 31) odometer reading. Save it.
- Expected: App shows the year-end reading saved. Additionally, verify that the NEXT year's January 1 start odometer is automatically set to that same value (the carry-forward behavior). You should NOT need to re-enter it next year.

**9.7** Verify that odometer readings are saved to Supabase (not just localStorage). Sign out, sign back in on the same or a different device.
- Expected: Odometer readings persist after sign-out/sign-in. They are not lost when localStorage is cleared.

---

## SECTION 10 — TAXES PAGE

**10.1** Navigate to the Taxes page. Find the "Your situation" card.
- Expected: Card has exactly 4 fields arranged in a 2-column layout (2 fields per row, 2 rows). No field is floating alone on its own row. If a 4th field sits alone in a 3rd row, that is a FAIL.

**10.2** Change the Filing Status selector to "Married Filing Jointly."
- Expected: All tax calculations on the page update immediately. Federal income tax bracket thresholds double compared to Single status.

**10.3** Enter a Spouse Income amount (e.g., $50,000).
- Expected: The AGI (Adjusted Gross Income) and resulting tax estimates update in real time as you type or change the value.

**10.4** Enter an amount in the Quarterly Taxes Paid field (e.g., $2,000).
- Expected: The "Still owed" amount decreases by $2,000. Verify: Still owed = Total estimated − Already paid.

**10.5** Enter a Prior Year Tax amount (e.g., $8,000).
- Expected: The Safe Harbor section unlocks and shows: "$2,000/quarter" (8,000 ÷ 4) to guarantee no underpayment penalty. The safe harbor amount appears next to the quarterly due dates.

**10.6** [SETUP REQUIRED] With payments[] entries in the current year (e.g., a $76 payment logged), check the Gross Income shown on the tax page.
- Expected: Gross Income = income[] entries + payments[] entries for the selected year. If payments = $76 and income entries = $0, Gross Income shows $76 — NOT $0.

**10.7** Verify the DIF Audit Risk calculation. [SETUP REQUIRED]
- Set up: Gross income = $76, Cash expenses = $50.33, Mileage deduction = $251 (from logged miles).
- Expected: DIF ratio = 50.33 / 76 = 66% (medium or high risk). The mileage deduction of $251 is NOT included in the numerator. The result is NOT 397% or any figure that includes mileage in the expense ratio.

**10.8** Check the state tax label in the tax results section.
- Expected: Label shows "[Your State] tax" using the state name from your Settings (e.g., "Colorado tax," "Texas tax"). It does NOT say "Kansas state tax" unless your state is actually Kansas.

**10.9** Check the Tax Reserve banner.
- Expected: Banner says "[Your State] tax rates" where [Your State] is the name from Settings. It does NOT say "Kansas tax rates" unless state = KS.

**10.10** With state set to Kansas (KS) in Settings, navigate to the Taxes page → IRS Tips section.
- Expected: A Kansas-specific tip appears about Kansas commercial labor being taxable. The tip references "Kansas" and ksrevenue.gov.

**10.11** Change state to any state other than Kansas (e.g., Colorado). Navigate to Taxes → IRS Tips.
- Expected: The Kansas commercial labor tip does NOT appear. All tips are generic or applicable to that state.

**10.12** Verify the self-employment tax calculation.
- SE base = Net SE income × 0.9235
- SE tax = SE base × 0.153 (rounded up)
- Expected: The displayed SE tax matches this formula. Verify with a known input: Net SE income = $10,000 → SE base = $9,235 → SE tax = $1,413 (rounded up from $1412.96).

**10.13** Check the quarterly due dates shown on the Taxes page.
- Expected for 2026: Q1 due Apr 15, Q2 due Jun 16, Q3 due Sep 15, Q4 due Jan 15 (2027). Verify these match the current year dates, not prior year dates.

**10.14** Check the Footer or Disclaimer text on the Taxes page.
- Expected: No hardcoded "Kansas resident" language. Disclaimer is generic (applies to any user).

**10.15** Verify the IRS Tips section loads with clean formatting.
- Expected: Each tip has a clear header, readable body text, and no line-through text or garbled HTML. Tips are styled with colored backgrounds and borders.

---

## SECTION 11 — PROPOSALS

**11.1** Open a Pending bid. Find the "Send Proposal" option.
- Expected: Options to send via SMS, email, or copy a link are available.

**11.2** Generate a proposal link (copy link option).
- Expected: A URL is generated. It includes a signing token in the query string.

**11.3** Open the proposal link in a browser (or private/incognito window).
- Expected: The proposal page (sign.html) loads correctly showing the job scope, total price, contractor info, and a signature area.

**11.4** Sign the proposal using the signature area.
- Expected: Signature can be drawn. A "Submit" or "Sign" button completes the signature. A confirmation message appears.

**11.5** Return to TradeDesk. Check the bid that was just signed.
- Expected: Bid status has changed from "Pending" to "Closed Won." The signedAt date is recorded.

**11.6** Open the client hub for that client (client.html).
- Expected: The Documents tab shows the signed proposal. It appears in the documents list.

---

## SECTION 12 — CLIENT HUB (client.html)

**12.1** Open a client hub link (client.html?t=...) in a browser.
- Expected: Page loads. The top bar shows the contractor's business name or logo. No blank page or 404.

**12.2** Check the Overview tab. Find the main CTA headline showing the project amount.
- Expected: The headline CTA shows the TOTAL project amount (e.g., "$2,400.00"). A sub-label below it says "Deposit $600 due now" or "Balance $X due" — NOT the deposit amount as the headline itself.

**12.3** Check whether a "Needs your input" or "Approvals" card is visible on the Overview tab.
- Expected: This card does NOT exist. If you see an approvals card, that is a FAIL — report it.

**12.4** Navigate to the Payments tab on the client hub.
- Expected: A clean summary card shows the total project amount and remaining balance. There is NO large dark gradient card dominating the screen. The layout should be clean and readable.

**12.5** Check the Payment Schedule milestones (Payments tab).
- Expected: At minimum, Deposit and Final Balance milestones are listed. Each shows the correct amount. Paid milestones are visually marked as paid (green dot or checkmark).

**12.6** Check the Payment History table (Payments tab). [SETUP REQUIRED — at least two payments logged]
- Expected: All payments appear. They are sorted newest first (most recent payment at top).

**12.7** Navigate to the Documents tab.
- Expected: Documents are sorted newest first. The most recent proposal or invoice appears at the top of the list.

**12.8** After a bid is won, verify the Documents tab shows both: (a) Invoice and (b) Signed proposal.
- Expected: Both document types appear. Each has a label (Invoice / Signed Proposal). They are clickable/viewable.

**12.9** Navigate to the Messages tab.
- Expected: Contractor contact info (business name, phone number) is visible. Client can tap to call or text.

**12.10** On an iOS device with the app installed as a PWA: Tap "Preview" from within TradeDesk to open the client hub.
- Expected: An in-app iframe overlay opens. A "← TradeDesk" back button is visible at the top. Tapping it closes the overlay and returns you to TradeDesk WITHOUT force-closing the app.

---

## SECTION 13 — SETTINGS

**13.1** Open Settings. Fill in Business Name, Phone, Email, and Address. Tap Save.
- Expected: All fields save. Navigate away and return — values persist exactly as entered.

**13.2** Upload a logo image.
- Expected: A preview of the logo appears. The logo is used in proposals (visible on the next proposal you view or generate).

**13.3** Open the State selector. Change to a new state (e.g., from Kansas to Colorado).
- Expected: A toast appears confirming the state loaded (e.g., "Colorado tax rates loaded"). The tax rate fields (low rate, high rate, standard deduction) update to Colorado's values. The tax page also reflects the new state name.

**13.4** Navigate to Settings → Vehicles. Find the "Update readings" button.
- Expected: Button is present and tappable. Tapping it opens the odometer entry modal. It does NOT show an error, blank modal, or broken reference.

**13.5** Add a new vehicle in Settings. Enter make, model, and year.
- Expected: Vehicle appears in the vehicle list. Navigate away and return — vehicle persists.

**13.6** Remove the vehicle you just added.
- Expected: Vehicle disappears from the list after confirmation. No orphaned data or errors.

**13.7** Change the Trade selection (e.g., from Painting to Electrical).
- Expected: The estimate flow changes to reflect the new trade. Returning to estimates shows Electrical-specific options, not Painting-specific ones.

**13.8** Update the IRS Mileage Rate field (e.g., change it to test a value, then restore to 0.725).
- Expected: Field saves. The Mileage Tracker and Tax pages immediately reflect the new rate in calculations.

**13.9** Set a Brand Color in Settings (hex color picker).
- Expected: The accent color on proposals and client hub updates to match. Verify by generating or viewing a proposal after saving.

---

## SECTION 14 — LIEN MANAGEMENT

**14.1** [SETUP REQUIRED — client in the collection stage with an unpaid balance] Navigate to a client's collection stage. Find the option to file a lien.
- Expected: "File Lien" option is available. Tapping it opens a lien creation flow.

**14.2** Complete the lien filing flow. Confirm the lien document is generated.
- Expected: A print-ready lien document opens in a new window or overlay. It renders as a full legal document with all fields populated.

**14.3** Check the state name in the lien document title and body.
- Expected: State name matches the state of the client's address (or your business state if no address). It does NOT say "Kansas" if the client is in Colorado (unless the address is in Kansas).

**14.4** Check the statute reference in the lien document.
- Expected: For a Kansas address, the statute reads "K.S.A. 60-1101 et seq." For a non-Kansas address, it references "[State] mechanic's lien statutes" — NOT the Kansas statute.

**14.5** Check the county field in the lien document.
- Expected: For Kansas addresses, the county auto-populates (e.g., "Sedgwick County" for Wichita addresses). For other states, it shows a placeholder like "your county" or uses the detected county.

**14.6** Return to the Dashboard after filing a lien. Look for the Active Liens card.
- Expected: Card appears, shows the client name and amount. A countdown to lien expiry is visible.

---

## SECTION 15 — SCHEDULE / CALENDAR

**15.1** Navigate to the Calendar page.
- Expected: The current month renders correctly. Today's date is highlighted or marked.

**15.2** [SETUP REQUIRED — at least one job scheduled this month] Check whether jobs appear on the calendar.
- Expected: Jobs appear on their scheduled start dates as colored blocks or markers.

**15.3** Navigate to the Schedule page (separate from Calendar). Create an estimate appointment for a client — pick a date and time.
- Expected: Appointment saves. It appears on the calendar on the correct date.

---

## SECTION 16 — LICENSING

**16.1** Navigate to the Licensing page. Add a license record (e.g., General Liability Insurance with an expiry date in the future).
- Expected: Record appears in the list with the correct type, expiry date, and a "Current" status badge.

**16.2** Add a license with an expiry date in the past.
- Expected: Record shows an "Expired" badge in red.

**16.3** Add a license with an expiry date within 30 days from today.
- Expected: Record shows a badge like "Xd left" in amber/yellow.

**16.4** Edit an existing license record.
- Expected: Edit modal opens pre-filled with existing values. Changes save correctly.

**16.5** Delete a license record.
- Expected: Record disappears after confirmation.

---

## SECTION 17 — TEAM

**17.1** Navigate to the Team page. Verify team members are listed (if any exist).
- Expected: Each team member shows their name and role.

**17.2** [SETUP REQUIRED — employee account credentials] Sign in as an employee (not the owner).
- Expected: Employee lands on the dashboard. Navigation shows ONLY: Dashboard, Clients, Jobs, and possibly one or two other allowed pages.

**17.3** As the employee, attempt to navigate to each restricted page: Leads, Taxes, Tracker/Finance, Team, Settings, Checklist.
- Expected: All restricted pages are inaccessible. Attempting to navigate to them redirects to the Dashboard (or shows an access-denied message). None of the restricted pages load their content for the employee.

---

## SECTION 18 — MOBILE LAYOUT (screen width under 768px)

**18.1** Open the app on a phone or in browser DevTools with a mobile viewport (375px width). Look at the bottom of the screen.
- Expected: A bottom tab bar is visible with at minimum: Dashboard, Leads, Clients, Jobs, and a "More" (or "+" or similar) button.

**18.2** Tap the "More" button.
- Expected: A popup or sheet opens showing additional navigation items (Money, Calendar, Mileage, etc.).

**18.3** Tap an item in the More popup.
- Expected: You navigate to that page AND the popup closes. It does not stay open behind the new page.

**18.4** Tap outside the More popup (or tap "More" again).
- Expected: Popup closes cleanly.

**18.5** Navigate to every main page. Scroll each page up and down.
- Expected: No horizontal scroll bar appears. Content fits within the screen width. Nothing clips off the right edge.

**18.6** Open a paint estimate on mobile. Walk through all 6 steps.
- Expected: Each step is fully usable on a small screen. Input fields are large enough to tap accurately. Buttons are reachable. Content does not overflow or overlap.

**18.7** Check that all form inputs on mobile are large enough to tap.
- Expected: No input is so small that a finger tap misses it. Minimum tap target height should feel comfortable (not pixel-precise tapping required).

**18.8** Check that cards and list items do not overlap each other on mobile.
- Expected: Cards are stacked vertically with appropriate spacing. No two cards overlap.

**18.9** Open the client hub (client.html) on mobile. Navigate through all 5 tabs: Overview, Payments, Documents, Messages, and any additional tab.
- Expected: All 5 tabs are accessible. Content on each tab scrolls properly. No tab is hidden or broken on mobile.

---

## SECTION 19 — TABLET LAYOUT (768px – 1024px)

**19.1** Open the app on a tablet or in DevTools at ~900px width.
- Expected: Sidebar navigation appears on the left side (not the mobile bottom tab bar). Sidebar shows navigation items vertically.

**19.2** Navigate between pages using the sidebar.
- Expected: Active page is highlighted in the sidebar. Content area fills the remaining space.

**19.3** Look for any two-column layout sections (e.g., dashboard KPIs, settings form).
- Expected: Sections that use two columns on desktop render as two columns at tablet width. No layout breaks or overflow.

**19.4** Check that no content overflows its container at tablet width.
- Expected: No horizontal scrollbars on any page.

---

## SECTION 20 — DESKTOP LAYOUT (over 1024px)

**20.1** Open the app in a browser at full desktop width (1280px or wider).
- Expected: Full sidebar is visible on the left. All sidebar navigation items are accessible.

**20.2** Navigate to the Dashboard.
- Expected: Dashboard uses a multi-column layout for KPIs and pipeline cards, not a single narrow column.

**20.3** Open an estimate flow.
- Expected: The estimate step cards are wider and use the extra horizontal space appropriately. Form fields are not stretched excessively.

---

## SECTION 21 — CALCULATION VERIFICATION (Specific Numbers)

Run each of these with exact inputs and verify the exact output.

**21.1** Payment Status — Deposit threshold
- [SETUP REQUIRED] Bid amount = $100, no deposit explicitly set (defaults to 25% = $25). Log one payment of $25.
- Expected result: Status badge = "Deposit paid"
- Actual result: _______________

**21.2** Payment Status — Paid in full
- [SETUP REQUIRED] Same $100 bid. Log a second payment of $75 (total paid = $100).
- Expected result: Status badge = "Paid in full"
- Actual result: _______________

**21.3** DIF Audit Risk Ratio — Mileage excluded
- [SETUP REQUIRED] Set up: Gross income = $76, Cash expenses = $50.33, Mileage logged = 346 miles (at $0.725/mi = $250.85 deduction).
- Expected result: DIF expense ratio = $50.33 ÷ $76 = 66%. Status = medium or high risk. The $250.85 mileage deduction is NOT in the numerator. Result is NOT 397%.
- Actual result: _______________

**21.4** P&L Net — Mileage as note only
- [SETUP REQUIRED] Revenue (income + payments) = $1,000 this month. Expenses = $200. Mileage = 100 miles (at $0.725/mi = $72.50).
- Expected result: P&L grid Net = $800 ($1,000 − $200). The $72.50 mileage deduction appears as an informational note BELOW the table, not deducted from the $800.
- Actual result: _______________

**21.5** Lead Source — Per-client counting
- [SETUP REQUIRED] Create one client from "Word of mouth" and give that client 3 won bids.
- Expected result: Lead Sources table shows "Word of mouth" with 1 Won (not 3). Revenue column shows the total of all 3 bid amounts.
- Actual result: _______________

**21.6** Tax Gross Income — Payments included
- [SETUP REQUIRED] Log zero income[] entries for the current year. Log one payment of $76 via the Payments system (e.g., log a payment on a bid).
- Navigate to Taxes page. Check Gross Income.
- Expected result: Gross Income = $76. NOT $0.
- Actual result: _______________

---

## SECTION 22 — EDGE CASES

**22.1** New account with no data: navigate to each page (Dashboard, Leads, Clients, Jobs, Money, Mileage, Taxes, Calendar, Licensing, Settings).
- Expected: Each page shows an appropriate empty state message (e.g., "No clients yet," "No jobs scheduled," "No data yet"). No JS errors in the console. No broken layouts.

**22.2** Client with no phone number: find or create a client with no phone field filled in.
- Expected: SMS/text buttons for that client are either hidden or disabled. No "sms:undefined" links appear. The app does not crash.

**22.3** Bid with no deposit explicitly set. Open the client hub for that bid.
- Expected: The client hub displays 25% of the total bid as the deposit amount. It does not show $0 or NaN.

**22.4** Settings state not set (blank state field). Navigate to the Taxes page.
- Expected: Tax label says "State tax" (generic) — NOT "Kansas tax." No Kansas-specific tips appear. Reserve banner does not say "Kansas tax rates."

**22.5** Go offline mid-estimate (airplane mode after starting Step 3 of a paint estimate).
- Expected: Continue filling in data. The draft saves to localStorage (browser storage) silently. Re-enable network. Return to the estimate — your in-progress data is still there.

**22.6** [SETUP REQUIRED — dev support mode if applicable] If your account has a dev/support mode for viewing another user's data: enter support mode and verify you see the other user's data.
- Expected: While in support mode, the data shown belongs to the other account, not yours.
- Then exit support mode.
- Expected: Your own data is fully restored exactly as it was before entering support mode.

---

## SECTION 23 — GENERAL QUALITY CHECKS

**23.1** Open the browser console (F12 → Console) and navigate through every main page. Leave the console open while clicking through: Dashboard, Leads, Clients, Jobs, Money, Mileage, Taxes, Calendar, Settings.
- Expected: No red JavaScript errors appear at any point. Yellow warnings are acceptable.

**23.2** Check all monetary amounts displayed throughout the app.
- Expected: All dollar amounts use the format $X,XXX.XX with two decimal places. No "NaN," "undefined," "$null," or "Infinity" appears anywhere.

**23.3** Check all date displays throughout the app.
- Expected: No "Invalid Date," "NaN," or raw timestamp numbers (like 1747180800000) appear in the UI.

**23.4** Look for any placeholder or debug text in the live app (e.g., "TODO," "FIXME," "test," "[object Object]," "undefined").
- Expected: None of these appear in any visible UI element. Report any you find with the exact page and location.

**23.5** Sign out and sign back in. Verify your data is exactly the same as before you signed out.
- Expected: All clients, bids, jobs, income, expenses, mileage, and settings are intact. Nothing is lost on sign-out/sign-in.

---

*End of QA Test Script — TradeDesk v05.15.26.49*
