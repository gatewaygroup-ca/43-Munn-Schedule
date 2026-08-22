# Project Schedule Portal — Admin/Client Real-Time Tracker

One shared codebase that powers both the 43 Munn and 38 Niagara project
sites (and any future project you clone it for). Same UI, same Gantt
engine, same financial system as before — now with a real-time admin
editing layer and a read-only client view backed by actual Firebase
Authentication and Security Rules.

## What's new vs. the original site

- **Admin / Client roles**, enforced by Firebase Auth + Realtime Database
  Security Rules (not just hidden buttons — see "Security model" below).
- **Admin Panel**: edit project title, address, client name, type, dates,
  status, description, manager/contact, subtitle, footer text, and a
  "show financials to clients" toggle — all live, all synced instantly.
- **Company logo** upload/replace/remove, persisted in the database
  (not a browser blob — survives refresh, shows for every visitor).
- **Milestone galleries**: upload photos per milestone, caption them,
  delete/replace, view in a lightbox with prev/next. Client view is
  strictly view-only.
- **Milestone management**: add, duplicate, delete, reorder — from the
  browser, no code edits required.
- **Everything still real-time**: admin changes anywhere (settings,
  milestones, trades, financials, holidays, galleries, logo) push to
  every open browser instantly via Firebase listeners.

Nothing about the existing look was changed — colors, layout, Gantt
rendering, financial calculations, and mobile behavior are untouched.

---

## 1. Project overview

Each deployed site is one project (e.g. "43 Munn" or "38 Niagara"),
identified by `PROJECT_ID` in that repo's `data.js`. All of a project's
live data lives under `projects/{PROJECT_ID}/` in one shared Firebase
Realtime Database, so multiple project sites can run off the same
Firebase project without their data ever mixing.

Anyone who opens the site sees the **client view**: full dashboard,
timeline, milestone details, galleries, and (optionally) financials —
entirely read-only. Clicking **Admin** and logging in with a Firebase
Auth account switches that browser into **admin mode**, unlocking every
editing control described above. Logging out (or simply not being
signed in) returns to client view.

---

## 2. Admin setup (one-time, in the Firebase console)

You're on the **Spark (free) plan** currently. Everything below works on
Spark — you do **not** need to upgrade to use Authentication or the
admin/client system. The one thing Spark doesn't include is Firebase
*Storage*, which is why photos/logos use a different storage approach
here (see section 5).

### a) Enable Authentication
1. Firebase console → your project (`munn-schedule`) → **Build → Authentication**
2. Click **Get started**
3. Under **Sign-in method**, enable **Email/Password**
4. Under **Users**, click **Add user** and create an account for each
   admin (yourself, Cory, etc.) — just an email + password. This is the
   *only* place admin accounts are created. Nothing in this codebase
   stores or checks a password.

Anyone who successfully signs in with a Firebase Auth account on this
project is treated as an admin. There's no separate roles table — access
control is simply "did you authenticate," which is enforced by the
Security Rules below, not by the app's JavaScript.

### b) Publish the Security Rules
1. Firebase console → **Build → Realtime Database → Rules**
2. Replace the existing rules with the contents of
   [`firebase-database-rules.json`](./firebase-database-rules.json) in
   this repo
3. Click **Publish**

This is what actually stops a client from writing data — even if someone
opened the browser console and called a JavaScript function directly,
Firebase itself rejects the write with `PERMISSION_DENIED` unless
they're signed in. The app's `USER_ROLE` checks are a UI convenience on
top of this, not the real protection.

### c) That's it
No service account keys, no server, no Cloud Functions. Everything else
(hosting, config) works exactly like the site already did.

---

## 3. Client access

Clients don't need an account. They just visit the site URL — same as
today. They automatically get the read-only view. There's no separate
`/admin` URL or query parameter to worry about: the **Admin** button in
the toolbar is how anyone (staff or otherwise) reaches the login form,
and Firebase Rules are what actually decide whether their sign-in
attempt (if they even have credentials) is allowed to write.

If you want a cleaner mental model: think of "admin mode" as *whichever
browser is currently signed in*, not a separate site.

---

## 4. Project configuration — how a new project is created

To spin up a third project on this same codebase:

1. Copy this whole folder
2. In the new copy's `data.js`, change **only**:
   - `PROJECT_ID` — a short, URL-safe, unique slug (e.g. `"12-oak"`)
   - `DEFAULT_SETTINGS` — the new project's initial title/address/dates/etc.
   - `BASELINE_MILESTONES` / `BASELINE_TRADES` / `DEFAULT_HOLIDAYS` — the
     starting schedule (or leave as-is/empty and build it from the Admin
     Panel after deploying)
3. Deploy as its own GitHub Pages site (own repo, or a subfolder — either
   works, since Firebase paths are scoped by `PROJECT_ID`, not by URL)
4. `firebase-config.js`, `index.html`, `style.css`, and `script.js` are
   **identical** across every project — never hand-edit project details
   into them

After first load, all further editing happens from the Admin Panel —
you should essentially never need to touch `data.js` again except to
redefine what "Reset to Original Schedule" restores.

---

## 5. Gallery & logo image storage (important — read this)

Firebase **Storage** (the normal place to put uploaded files) requires
the **Blaze** billing plan. Since this project is on Spark, photos and
the company logo are instead:

1. Compressed and resized client-side (canvas-based, before upload)
2. Converted to a base64 data URL
3. Written directly into the Realtime Database, inside the
   milestone's `gallery` array (photos) or `settings.companyLogoDataUrl`
   (logo)

This is genuinely persistent — it syncs via Firebase like everything
else, survives refreshes, and shows the same for every visitor. It is
**not** a `blob:` URL and does not depend on any one browser's memory.

Two sizes are generated per photo: a small thumbnail (used in the grid,
lazy-loaded) and a larger version (loaded only when you open the
lightbox), so the dashboard stays fast even as galleries grow.

**Trade-offs of this approach**, so you can decide if/when to upgrade:
- Realtime Database has practical limits — this is fine for dozens of
  photos per project, but if you expect *hundreds*, Firebase Storage
  (below) is the better long-term fit.
- Each photo write is somewhat larger than a Storage-based approach
  (base64 inflates size ~33%), which is why photos are compressed
  fairly aggressively (1600px / JPEG q0.75 for full-size, 320px / q0.7
  for thumbnails).

### Upgrading to Firebase Storage later (when you're ready for Blaze)

The swap is contained to two functions in `script.js`:

- `compressImageToDataUrl()` → change to upload the compressed
  `Blob`/`File` via `storageRef.put(file)` and store the resulting
  `getDownloadURL()` string instead of a data URL
- Everywhere a photo/logo's `dataUrl` / `thumbDataUrl` /
  `companyLogoDataUrl` is read, it already just expects "a URL the
  browser can load" — a Storage download URL works as a drop-in
  replacement, no other code needs to change

We didn't wire this up now since Storage isn't enabled on your plan, but
the data model was deliberately kept URL-based (not "always a data URI")
so this upgrade doesn't require restructuring anything later.

---

## 6. Data architecture

```
projects/
  43-munn/
    settings/     ← title, address, clientName, dates, logo, footer text, etc.
    schedule/
      milestones   ← array, each with schedule/financial/gallery data
      trades       ← array
      holidays     ← array
      activity     ← array
      lastUpdated
  38-niagara/
    settings/ ...
    schedule/ ...
```

Each project's data is fully isolated under its own `PROJECT_ID` key —
nothing under `projects/43-munn` can ever be touched by code running
against `projects/38-niagara`, and vice versa.

**Milestones and trades are still stored as arrays** (each item carries
its own `id`), rather than a fully normalized `milestones/{id}` map.
This was a deliberate choice to reuse the existing, already-working
dependency/business-day scheduling engine without rewriting it — the
isolation you actually need (one project's data never touching
another's) is achieved via the `projects/{PROJECT_ID}/` prefix, which is
what the Security Rules key off of.

### Backward compatibility / migration

If this project previously stored its data at a flat `schedule` (43
Munn) or `schedule_38niagara` (38 Niagara) path — i.e. the version of
the site before this admin/client upgrade — the app automatically
copies that data into the new `projects/{PROJECT_ID}/schedule` location
the first time it loads, and only if the new location doesn't already
have data. It never deletes the old node, and it only runs once
(subsequent loads find the new location already populated and skip it).
No manual database surgery is required.

---

## 7. Security model (read this if anything about "read-only" feels unclear)

There are two layers, and only one of them is real security:

- **UI layer (`USER_ROLE`, the `admin-only` CSS class, disabled form
  fields)** — this is convenience only. It hides buttons and disables
  inputs so a client never *sees* an edit control, and it also adds a
  client-side early-return in write functions like `firebaseSave()`.
  None of this is trustworthy on its own — anyone can open dev tools and
  ignore it.
- **Firebase Security Rules (`firebase-database-rules.json`)** — this is
  the actual enforcement. `.write: "auth != null"` means Firebase itself
  refuses any write from a browser that isn't signed in, full stop,
  regardless of what JavaScript does or doesn't run. This is what makes
  "client is read-only" a real guarantee rather than a UI suggestion.

No admin password, API key secret, or service-account credential is
stored anywhere in this repository. The `firebaseConfig` object in
`firebase-config.js` is a public identifier (which Firebase project to
talk to), not a secret — it grants no access by itself.

---

## 8. Managing milestones

- **Add**: "+ Add Milestone" button above the Gantt (admin only)
- **Duplicate / Delete / Reorder**: open any milestone → footer buttons
  (Duplicate, Delete, ▲/▼). Deleting a milestone that other milestones
  depend on shows a warning listing exactly which ones, and
  automatically removes the dead dependency reference so the schedule
  doesn't break.
- **Edit everything else** (name via duplicate+rename, description,
  duration, dependencies via CSV re-import, status, progress, priority,
  trade, notes): from the milestone modal's Schedule tab
- **Gallery**: the milestone modal's new Gallery tab

---

## 9. Financial visibility control

Admin Panel → Project tab → "Show financial information to clients"
checkbox. Off by default. When off, clients cannot see contract values,
invoices, payments, outstanding balances, or change-order amounts (the
Trade Financials export is also blocked client-side for consistency);
admins always see everything regardless of this setting.

---

## 10. Deployment (GitHub Pages)

Same as before — this is still a static site, no build step:

1. Push all files (`index.html`, `style.css`, `script.js`, `data.js`,
   `firebase-config.js`, `firebase-database-rules.json`, this README) to
   the project's repo, `main` branch
2. Settings → Pages → Deploy from branch → `main` / root
3. Complete the Firebase console steps in section 2 (once per Firebase
   project — not per site, since both 43 Munn and 38 Niagara share the
   same Firebase project)

---

## 11. Testing checklist

**Admin**: log in → change project title/address/client/dates → upload
a logo → add a milestone → edit it (status/progress/priority) → add
gallery photos → edit a caption → delete a photo → add a trade → add a
change order/invoice/payment → add a holiday → confirm each change
appears in Recent Activity → open a second browser (or incognito) and
confirm every change above appears there automatically, no refresh.

**Client**: open in a signed-out browser → confirm project info, logo,
dashboard, timeline, and galleries all display correctly → open a
milestone → view its gallery → open the lightbox, use next/prev/close →
confirm no Save/Edit/Delete/Add/Archive/Import/Export/Reset controls are
visible anywhere → open dev tools and try calling `firebaseSave()` or
writing to the database directly → confirm Firebase rejects it with a
permission error.
