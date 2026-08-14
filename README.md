# 43 Munn — Interactive Project Milestone Schedule

A static, interactive construction schedule / milestone tracker for **43 Munn**
(Residential Construction, start Fri Aug 7, 2026, target completion Apr 7, 2027).

No build tools, no backend, no dependencies beyond a Google Fonts link — it runs
as plain HTML/CSS/JS and is ready to host on GitHub Pages.

## Files

```
index.html          Page structure and the milestone edit modal
style.css            All styling (light, neutral, professional PM aesthetic)
data.js              PROJECT info, statutory holidays, and the 30-phase baseline schedule
script.js            Business-day engine, dependency scheduling, rendering, edit/import/export logic
firebase-config.js   Firebase project credentials + live-sync connection
README.md            This file
```

Upload all five of `index.html`, `style.css`, `script.js`, `data.js`,
`firebase-config.js` (plus this README) to GitHub — those five are the entire
application.

## Live sync (Firebase Realtime Database)

This build is connected to a free Firebase Realtime Database. Any edit made in
the app — status/progress changes, imports, resets, holiday changes — is
written to `https://munn-schedule-default-rtdb.firebaseio.com/schedule` and
pushed to every open copy of the site in real time. The footer shows
**🔥 Live sync on** when connected; if `firebase-config.js` is missing or
misconfigured it falls back to **Local mode** (edits only persist in that
browser tab, same as before).

**Security note:** the database is currently readable and writable by anyone
with its address (no login required) — fine for an internal team tool, but
worth tightening if this ever needs to be locked down. To restrict it later:

1. In the Firebase console, go to Realtime Database → **Rules**.
2. Replace the rules with something like:
   ```json
   {
     "rules": {
       "schedule": {
         ".read": true,
         ".write": true,
         ".validate": "newData.hasChildren(['milestones', 'holidays'])"
       }
     }
   }
   ```
   — or, for real access control, add [Firebase Authentication](https://firebase.google.com/docs/auth)
   (e.g. email/password or Google sign-in for your team) and require
   `auth != null` in the write rule.
3. Click **Publish**.

---

## 1. How to edit the schedule

**In the browser (no code):**
Click any milestone — on the Gantt bar (desktop) or the card (mobile) — to open
its detail panel. You can change:

- Start date (overrides the dependency-calculated date — see "Reset start" link)
- Duration (business days)
- Status (Not Started / In Progress / Complete / Delayed / On Hold)
- Progress (0–100%, slider)
- Assigned trade
- Notes

Click **Save Changes**. Every dependent milestone recalculates immediately, the
dashboard metrics update, and an entry is added to **Recent Activity** — including
a "Schedule impact: ±N business days" note if the change shifted the projected
completion date.

**In the source data (`data.js`):**
Edit the `BASELINE_MILESTONES` array directly — this is the schedule everyone
sees on first load, and what **Reset to Original Schedule** restores. Each row is:

```js
{ id, name, duration, dependency: [ids], manualStart: null, status, progress, trade, notes }
```

`dependency` is an array of milestone `id`s that must finish before this one
starts (empty array = starts at the project start date). Multiple ids means the
milestone waits for the *latest* of them to finish — this is how parallel trades
(e.g. Plumbing/HVAC/Electrical rough-in) and convergence points (e.g. Flooring
waiting on Trim, Cabinetry, and Tile) are modeled.

## 2. How the business-day calculation works

Two core functions in `script.js`:

- `addBusinessDays(fromDate, duration, holidays)` — rolls `fromDate` forward to
  the next business day if needed, then counts `duration` business days
  (Mon–Fri, minus configured holidays), returning `{start, finish}`.
- `calculateBusinessDays(startDate, endDate, holidays)` — signed business-day
  distance between two dates, used for "Days Remaining" and "Schedule Variance."

The full schedule is produced by `computeSchedule()`, which resolves each
milestone's start date as the next business day after the **latest** finish
date among its dependencies (or the project start date if it has none), then
applies `addBusinessDays`. It re-resolves automatically any time a duration,
status, dependency, or manual start date changes — nothing is hard-coded.

**Holidays:** click **Holidays** in the toolbar to view, add, or remove the
statutory holidays excluded from every calculation. Ontario statutory holidays
for the project window are pre-loaded (Labour Day, Thanksgiving, Christmas,
Boxing Day, New Year's Day, Family Day, Good Friday) — edit this list for a
different jurisdiction or to add company-specific closures.

## 3. How to export the schedule to Excel

Click **Export Schedule**. This downloads `43-munn-schedule.csv` with columns:

```
ID | Milestone | Start Date | Duration (Business Days) | Finish Date | Status | Progress % | Trade | Dependency | Notes
```

Open it directly in Excel — the *Dependency* column uses `;` to separate
multiple dependency IDs (e.g. `10;11;12`). A starter copy of this file
(`43-munn-schedule-template.csv`) is included alongside this README so you can
open the baseline schedule in Excel right away without touching the app.

## 4. How to import an updated Excel/CSV schedule

In Excel, edit the exported CSV — change dates, durations, statuses, progress,
trades, or notes, then save it as **CSV (Comma delimited)**. Back in the app,
click **Import Excel / CSV** and select the file.

On import, the app:
1. Validates every row (numeric IDs, no duplicate IDs, valid status values,
   dependencies that reference real IDs, durations ≥ 1, progress 0–100)
2. Replaces the entire milestone set
3. Recalculates every start/finish date, overall progress, projected
   completion, and schedule variance
4. Refreshes the Gantt timeline, mobile list, dashboard, and summary
5. Logs the import to Recent Activity

If validation fails, nothing is changed and you'll see exactly which row and
field caused the problem.

> Note: **Start Date** in the CSV is informational on import — the app always
> recalculates start dates from durations + dependencies unless you also set a
> manual override for that milestone in the app itself. This keeps the schedule
> internally consistent (you can't accidentally create a milestone that starts
> before its dependencies finish).

## 5. How to publish this on GitHub Pages

1. **Create a repository** — on GitHub, click *New repository*, name it
   (e.g. `43-munn-schedule`), and create it (public or private, both work with
   Pages on a paid plan; public repos get Pages free).
2. **Upload the files** — drag `index.html`, `style.css`, `script.js`, and
   `data.js` into the repo (use "Add file → Upload files" in the GitHub web UI,
   or `git add . && git commit -m "Initial schedule" && git push` from the
   command line).
3. **Enable GitHub Pages** — go to *Settings → Pages*, under "Build and
   deployment" set **Source** to `Deploy from a branch`, branch `main`,
   folder `/ (root)`, then **Save**.
4. **Publish** — GitHub gives you a URL like
   `https://<your-username>.github.io/43-munn-schedule/` within a minute or two.
5. **Update the website** — commit and push changes to `data.js` (new baseline)
   or any other file; GitHub Pages redeploys automatically within a minute.

## 6. How to eventually connect this to live Excel data

The app is intentionally decoupled from its data source — everything reads
from the `PROJECT`, `DEFAULT_HOLIDAYS`, and `BASELINE_MILESTONES` objects in
`data.js`, or from an imported CSV. Three paths forward, in increasing order
of automation:

**Option A — Simple (manual, works today)**
Edit the schedule in Excel → export as CSV → use **Import Excel / CSV** in the
app (or replace `data.js`'s `BASELINE_MILESTONES` and push to GitHub). No new
infrastructure required.

**Option B — Automated (Excel stays the source of truth)**
```
Excel on OneDrive / SharePoint
        ↓
Power Automate / Microsoft Graph API
        ↓
A small JSON endpoint (e.g. an Azure Function or a scheduled export)
        ↓
script.js fetches it instead of reading data.js
        ↓
Live dashboard, refreshed on page load
```
This requires adding one `fetch()` call in `script.js`'s `init()` that loads
milestone JSON from that endpoint before calling `renderAll()` — the rest of
the app (scheduling engine, Gantt, editing, dashboard) needs no changes.

**Option C — Database-backed**
```
Excel → Automation (Power Automate / script) → Supabase (or any DB) → website
```
Same idea as Option B, but `script.js` would call Supabase's REST/JS client
instead of a custom endpoint. Useful once multiple people need to edit the
schedule concurrently, since Supabase can also enforce validation and keep a
change history server-side instead of relying on the in-browser session log.

In all three options, the milestone shape stays identical to the CSV columns
above, so `computeSchedule()` and every rendering function keep working
unchanged — only *where the data comes from* changes.

## 8. Trade financials — how the data is structured

Every milestone doubles as a **trade**. Each one carries, in addition to the
schedule fields:

```js
{
  contractPrice: 25000,          // original quoted/contract price
  changeOrders: [
    { id, description, date, amount, approvedBy, status, notes }
    // status: "Pending" | "Approved" | "Rejected" — only Approved counts
  ],
  invoices: [
    { id, invoiceNumber, vendor, invoiceDate, dueDate, subtotal, hst, total,
      paymentStatus, paymentDate, fileName, notes }
    // paymentStatus: "Paid" | "Pending" (shown as "Overdue" automatically
    // once dueDate has passed and it's still unpaid — that's computed live,
    // never stored)
  ],
  paymentDetails: {
    vendorName, poNumber, paymentTerms, paymentMethod,
    bankName, accountName, accountLast4, paymentReference, notes
    // bankName/accountName are masked (password-style inputs) in the app
    // until "Reveal" is clicked
  }
}
```

Everything else — revised contract value, total invoiced, total paid,
balance remaining, and the trade's overall payment status — is **calculated
live** from those three lists every time the page renders (see
`revisedContractValue()`, `totalInvoiced()`, `totalPaid()`,
`balanceRemaining()`, `tradePaymentStatus()` in `script.js`). Nothing
financial is ever pre-computed and stored, so editing a change order or
invoice always immediately updates every dashboard number, the Trade Costs
table, and the trade's own summary.

**Invoice PDFs are a prototype feature, not persisted.** When you attach a
PDF to an invoice, the app keeps it in the browser's memory for that session
only (via `URL.createObjectURL`) so you can preview/download it right away —
it is **not** uploaded anywhere and does **not** sync through Firebase (PDF
files are far too large for a realtime database, and the project brief is
explicit that GitHub/Firebase should never become the permanent home for
financial documents). Only the invoice's *metadata* (number, vendor, dates,
amounts, status, and the filename as a label) syncs live like everything
else. Reopen the site in a new tab or on another device and you'll see the
invoice listed, but "View"/"Download" will explain the PDF itself isn't
available there — that's expected until real file storage is wired in.

## 9. Connecting real Excel and document storage later

The target structure, matching what a full Excel workbook or database for
this project would look like:

| Sheet | Columns |
|---|---|
| **PROJECT** | Project ID, Address, Start Date, Target Completion |
| **MILESTONES** | ID, Milestone, Start Date, Duration, Finish Date, Status, Progress %, Trade, Dependency, Notes |
| **TRADES** | Trade ID, Project ID, Trade, Vendor, Scope, Original Contract, Approved Change Orders, Revised Contract, Total Invoiced, Total Paid, Outstanding, Payment Status, PO Number, Payment Terms, Notes |
| **PAYMENTS** | Payment ID, Trade ID, Invoice ID, Payment Date, Amount, Payment Method, Payment Reference, Status, Notes |
| **INVOICES** | Invoice ID, Trade ID, Vendor, Invoice Number, Invoice Date, Due Date, Subtotal, HST, Total, Payment Status, Payment Date, File Name, File URL/Reference, Notes |
| **CHANGE ORDERS** | Change Order ID, Trade ID, Description, Date, Amount, Status, Approved By, Notes |
| **HOLIDAYS** | Date, Name |

Today, **Export Trade Financials** in the toolbar gives you the TRADES sheet
as a CSV (contract values, invoiced/paid/outstanding, and payment status per
trade, computed live). The MILESTONES sheet is covered by the existing
**Export Schedule** button. Full PAYMENTS/INVOICES/CHANGE ORDERS sheets
aren't separately exportable yet — they live nested inside each trade record
in `data.js`/Firebase — but the shape above is what to target when building
a real integration.

For invoice PDFs specifically, the recommended path is:

```
Invoice PDF uploaded in the app
        ↓
Instead of staying in browser memory, upload to OneDrive/SharePoint,
Google Drive, or Supabase Storage (whichever your team already uses)
        ↓
Store the returned file URL in the invoice's `fileName`/file-reference field
        ↓
"View" and "Download" open that real URL instead of a session-only blob
```

That's a backend change (a small upload endpoint or a Supabase Storage
bucket), not a rewrite of the app — the invoice list, financial totals, and
Trade Costs table all already work off whatever's in each invoice's fields,
so once file uploads point at real storage instead of `URL.createObjectURL`,
everything else keeps working unchanged.

**Security reminder:** because this now includes contract values and
banking-adjacent fields, the "database open to anyone with the link" setup
from earlier matters more here. If you haven't already tightened the
Firebase rules or added authentication, this is the point to prioritize it —
see the Live Sync section above.

## 10. Which files to upload to GitHub

Minimum required for the site to work on GitHub Pages:

- `index.html`
- `style.css`
- `script.js`
- `data.js`

Recommended to include:

- `README.md` (this file)
- `43-munn-schedule-template.csv` (starter Excel file, matches the export/import format)
