# 43 Munn — Interactive Project Milestone Schedule

A static, interactive construction schedule / milestone tracker for **43 Munn**
(Residential Construction, start Fri Aug 7, 2026, target completion Apr 7, 2027).

No build tools, no backend, no dependencies beyond a Google Fonts link — it runs
as plain HTML/CSS/JS and is ready to host on GitHub Pages.

## Files

```
index.html   Page structure and the milestone edit modal
style.css    All styling (light, neutral, professional PM aesthetic)
data.js      PROJECT info, statutory holidays, and the 30-phase baseline schedule
script.js    Business-day engine, dependency scheduling, rendering, edit/import/export logic
README.md    This file
```

Upload all four of `index.html`, `style.css`, `script.js`, `data.js` (plus this
README) to GitHub — those four are the entire application.

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

## 7. Which files to upload to GitHub

Minimum required for the site to work on GitHub Pages:

- `index.html`
- `style.css`
- `script.js`
- `data.js`

Recommended to include:

- `README.md` (this file)
- `43-munn-schedule-template.csv` (starter Excel file, matches the export/import format)
