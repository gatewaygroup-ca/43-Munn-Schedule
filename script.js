/* ============================================================
   43 MUNN — SCHEDULE ENGINE + APP
   ============================================================ */

/* ---------- Global mutable state ---------- */
const STATE = {
  milestones: deepClone(BASELINE_MILESTONES),
  holidays: deepClone(DEFAULT_HOLIDAYS),
  activity: [],
  lastUpdated: new Date(),
  statusFilter: "All",
  openMilestoneId: null,
};

const STATUS_OPTIONS = ["Not Started", "In Progress", "Complete", "Delayed", "On Hold"];
const STATUS_COLOR = {
  "Not Started": "gray",
  "In Progress": "blue",
  "Complete": "green",
  "Delayed": "red",
  "On Hold": "amber",
};

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function pad(n) { return n < 10 ? "0" + n : "" + n; }
function isoDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function fmtDate(d) { return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function fmtDateShort(d) { return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }

/* ============================================================
   BUSINESS-DAY ENGINE
   ============================================================ */

function isWeekend(d) { const day = d.getDay(); return day === 0 || day === 6; }

function isHoliday(d, holidays) {
  const s = isoDate(d);
  return holidays.some(h => h.date === s);
}

function isBusinessDay(d, holidays) {
  return !isWeekend(d) && !isHoliday(d, holidays);
}

function nextBusinessDay(d, holidays) {
  const cur = new Date(d);
  cur.setDate(cur.getDate() + 1);
  while (!isBusinessDay(cur, holidays)) cur.setDate(cur.getDate() + 1);
  return cur;
}

// Returns {start, finish} — start is rolled forward to the first
// business day on/after the given date; finish is `duration`
// business days later inclusive of start.
function addBusinessDays(fromDate, duration, holidays) {
  const start = new Date(fromDate);
  while (!isBusinessDay(start, holidays)) start.setDate(start.getDate() + 1);
  let count = 1;
  const cursor = new Date(start);
  const dur = Math.max(1, duration);
  while (count < dur) {
    cursor.setDate(cursor.getDate() + 1);
    if (isBusinessDay(cursor, holidays)) count++;
  }
  return { start, finish: cursor };
}

// Signed count of business days between two dates (end - start),
// excluding weekends/holidays. Positive = end is after start.
function calculateBusinessDays(startDate, endDate, holidays) {
  if (isoDate(startDate) === isoDate(endDate)) return 0;
  const forward = endDate > startDate;
  let a = new Date(Math.min(startDate, endDate));
  const b = new Date(Math.max(startDate, endDate));
  let count = 0;
  const cur = new Date(a);
  while (cur < b) {
    cur.setDate(cur.getDate() + 1);
    if (isBusinessDay(cur, STATE.holidays)) count++;
  }
  return forward ? count : -count;
}

/* ============================================================
   SCHEDULE COMPUTATION (dependency resolution)
   ============================================================ */

function computeSchedule(milestones, holidays, projectStartISO) {
  const projectStart = parseISO(projectStartISO);
  const resolved = {};
  const results = {};
  let iterations = 0;
  const maxIter = milestones.length + 5;

  while (Object.keys(resolved).length < milestones.length && iterations < maxIter) {
    iterations++;
    for (const m of milestones) {
      if (resolved[m.id]) continue;
      const deps = m.dependency || [];
      const ready = deps.every(depId => resolved[depId]);
      if (!ready) continue;

      let fromDate;
      if (m.manualStart) {
        fromDate = parseISO(m.manualStart);
      } else if (deps.length === 0) {
        fromDate = projectStart;
      } else {
        const depFinishes = deps.map(depId => results[depId].finish);
        const maxFinish = new Date(Math.max(...depFinishes.map(d => d.getTime())));
        fromDate = nextBusinessDay(maxFinish, holidays);
      }
      const { start, finish } = addBusinessDays(fromDate, m.duration, holidays);
      results[m.id] = { start, finish };
      resolved[m.id] = true;
    }
  }

  if (Object.keys(resolved).length < milestones.length) {
    milestones.forEach(m => {
      if (!resolved[m.id]) console.error(`Circular or broken dependency at milestone #${m.id} (${m.name})`);
    });
  }
  return results;
}

/* ============================================================
   DERIVED METRICS
   ============================================================ */

function getComputed() {
  return computeSchedule(STATE.milestones, STATE.holidays, PROJECT.start);
}

function getProjectedCompletion(schedule) {
  let latest = null;
  STATE.milestones.forEach(m => {
    const f = schedule[m.id] && schedule[m.id].finish;
    if (f && (!latest || f > latest)) latest = f;
  });
  return latest;
}

function getOverallProgress() {
  const totalDur = STATE.milestones.reduce((s, m) => s + m.duration, 0);
  const weighted = STATE.milestones.reduce((s, m) => s + m.duration * m.progress, 0);
  return totalDur ? Math.round(weighted / totalDur) : 0;
}

function getCounts() {
  const c = { "Not Started": 0, "In Progress": 0, "Complete": 0, "Delayed": 0, "On Hold": 0 };
  STATE.milestones.forEach(m => c[m.status] = (c[m.status] || 0) + 1);
  return c;
}

function getScheduleHealth(varianceDays, counts) {
  const delayed = counts["Delayed"] || 0;
  let level, label, icon;
  if (varianceDays > 10 || delayed >= 2) { level = "red"; label = "DELAYED"; icon = "\uD83D\uDD34"; }
  else if (varianceDays > 0 || delayed === 1) { level = "amber"; label = "AT RISK"; icon = "\uD83D\uDFE1"; }
  else { level = "green"; label = "ON TRACK"; icon = "\uD83D\uDFE2"; }

  let explanation;
  if (delayed > 0) {
    const worst = STATE.milestones.filter(m => m.status === "Delayed")[0];
    explanation = `Project is currently ${Math.abs(varianceDays)} business day${Math.abs(varianceDays) === 1 ? "" : "s"} ${varianceDays >= 0 ? "behind" : "ahead of"} target, with ${delayed} milestone${delayed === 1 ? "" : "s"} marked delayed (e.g. ${worst.name}).`;
  } else if (varianceDays > 0) {
    explanation = `Projected completion is ${varianceDays} business day${varianceDays === 1 ? "" : "s"} past the target completion date.`;
  } else if (varianceDays < 0) {
    explanation = `Projected completion is ${Math.abs(varianceDays)} business day${Math.abs(varianceDays) === 1 ? "" : "s"} ahead of the target completion date.`;
  } else {
    explanation = `Projected completion lands exactly on the target completion date.`;
  }
  return { level, label, icon, explanation };
}

/* ============================================================
   LIVE SYNC (Firebase Realtime Database)
   Every mutation writes the whole schedule to /schedule.
   Every client listens to /schedule and re-renders on any
   change — including its own writes and writes from other
   tabs/devices. Last write wins.
   ============================================================ */

let FIREBASE_READY = false;

// Firebase Realtime Database silently drops empty arrays ([]) and null
// fields on write — they simply won't exist when read back, leaving the
// JS object with `undefined` for that key instead of [] or null. That
// undefined then blows up code expecting an array, and if it gets written
// back verbatim, Firebase's .set() throws and aborts the ENTIRE save
// (nothing else in that write goes through either). These two helpers
// keep milestone objects well-formed on the way out and on the way in.
function sanitizeMilestone(m) {
  return {
    id: m.id,
    name: m.name,
    duration: m.duration,
    dependency: Array.isArray(m.dependency) ? m.dependency : [],
    manualStart: (m.manualStart === undefined || m.manualStart === null) ? null : m.manualStart,
    status: m.status,
    progress: m.progress,
    trade: m.trade || "",
    notes: m.notes || "",
    contractPrice: Number(m.contractPrice) || 0,
    changeOrders: (Array.isArray(m.changeOrders) ? m.changeOrders : []).map(sanitizeChangeOrder),
    invoices: (Array.isArray(m.invoices) ? m.invoices : []).map(sanitizeInvoice),
    paymentDetails: sanitizePaymentDetails(m.paymentDetails),
  };
}
function sanitizeChangeOrder(c) {
  return {
    id: c.id,
    description: c.description || "",
    date: c.date || null,
    amount: Number(c.amount) || 0,
    approvedBy: c.approvedBy || "",
    status: c.status || "Pending",
    notes: c.notes || "",
  };
}
function sanitizeInvoice(inv) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber || "",
    vendor: inv.vendor || "",
    invoiceDate: inv.invoiceDate || null,
    dueDate: inv.dueDate || null,
    subtotal: Number(inv.subtotal) || 0,
    hst: Number(inv.hst) || 0,
    total: Number(inv.total) || 0,
    paymentStatus: inv.paymentStatus || "Pending",
    paymentDate: inv.paymentDate || null,
    fileName: inv.fileName || "",
    notes: inv.notes || "",
  };
}
function sanitizePaymentDetails(pd) {
  pd = pd || {};
  return {
    vendorName: pd.vendorName || "",
    poNumber: pd.poNumber || "",
    paymentTerms: pd.paymentTerms || "",
    paymentMethod: pd.paymentMethod || "",
    bankName: pd.bankName || "",
    accountName: pd.accountName || "",
    accountLast4: pd.accountLast4 || "",
    paymentReference: pd.paymentReference || "",
    notes: pd.notes || "",
  };
}
function rehydrateMilestone(m) {
  return {
    ...m,
    dependency: Array.isArray(m.dependency) ? m.dependency : [],
    manualStart: m.manualStart === undefined ? null : m.manualStart,
    trade: m.trade || "",
    notes: m.notes || "",
    contractPrice: Number(m.contractPrice) || 0,
    changeOrders: Array.isArray(m.changeOrders) ? m.changeOrders.map(sanitizeChangeOrder) : [],
    invoices: Array.isArray(m.invoices) ? m.invoices.map(sanitizeInvoice) : [],
    paymentDetails: sanitizePaymentDetails(m.paymentDetails),
  };
}

function firebaseSave() {
  if (typeof db === "undefined") return;
  const payload = {
    milestones: STATE.milestones.map(sanitizeMilestone),
    holidays: STATE.holidays,
    activity: STATE.activity.map(a => ({ text: a.text, time: a.time.toISOString() })),
    lastUpdated: STATE.lastUpdated.toISOString(),
  };
  db.ref("schedule").set(payload).catch((err) => {
    console.error("Firebase save failed:", err);
    alert("Couldn't sync to the live database: " + err.message + "\n\nYour change is only visible in this browser until this is fixed.");
  });
}

function firebaseListen() {
  if (typeof db === "undefined") {
    // Firebase not configured — fall back to local-only mode.
    logActivity("Schedule loaded — baseline for 43 Munn, project start Aug 7, 2026.");
    renderAll();
    return;
  }
  db.ref("schedule").on("value", (snapshot) => {
    const val = snapshot.val();
    if (!val) {
      // Nothing in the database yet — seed it with the baseline.
      STATE.milestones = deepClone(BASELINE_MILESTONES);
      STATE.holidays = deepClone(DEFAULT_HOLIDAYS);
      STATE.activity = [];
      STATE.lastUpdated = new Date();
      logActivity("Schedule loaded — baseline for 43 Munn, project start Aug 7, 2026.");
      firebaseSave();
      return;
    }
    STATE.milestones = (val.milestones || deepClone(BASELINE_MILESTONES)).map(rehydrateMilestone);
    STATE.holidays = val.holidays || deepClone(DEFAULT_HOLIDAYS);
    STATE.activity = (val.activity || []).map(a => ({ text: a.text, time: new Date(a.time) }));
    STATE.lastUpdated = val.lastUpdated ? new Date(val.lastUpdated) : new Date();
    FIREBASE_READY = true;
    renderAll();
  }, (err) => {
    console.error("Firebase listen failed:", err);
  });
}

/* ============================================================
   TRADE FINANCIALS — calculation engine
   Each milestone doubles as a "trade." All figures derive live
   from contractPrice + changeOrders + invoices; nothing here is
   stored pre-computed.
   ============================================================ */

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function approvedChangeOrderTotal(m) {
  return (m.changeOrders || []).filter(c => c.status === "Approved").reduce((s, c) => s + (Number(c.amount) || 0), 0);
}

function revisedContractValue(m) {
  return (Number(m.contractPrice) || 0) + approvedChangeOrderTotal(m);
}

function totalInvoiced(m) {
  return (m.invoices || []).reduce((s, inv) => s + (Number(inv.total) || 0), 0);
}

function totalPaid(m) {
  return (m.invoices || []).filter(inv => inv.paymentStatus === "Paid").reduce((s, inv) => s + (Number(inv.total) || 0), 0);
}

function balanceRemaining(m) {
  return revisedContractValue(m) - totalPaid(m);
}

function isInvoiceOverdue(inv) {
  if (inv.paymentStatus === "Paid" || !inv.dueDate) return false;
  return parseISO(inv.dueDate) < new Date();
}

function invoiceDisplayStatus(inv) {
  return isInvoiceOverdue(inv) ? "Overdue" : inv.paymentStatus;
}

function tradePaymentStatus(m) {
  const revised = revisedContractValue(m);
  const paid = totalPaid(m);
  if ((m.invoices || []).some(isInvoiceOverdue)) return "Overdue";
  if (paid <= 0) return "Unpaid";
  if (revised > 0 && paid >= revised) return "Paid";
  return "Partially Paid";
}

function pendingInvoiceCount() {
  let n = 0;
  STATE.milestones.forEach(m => (m.invoices || []).forEach(inv => { if (inv.paymentStatus !== "Paid") n++; }));
  return n;
}

function financialTotals() {
  return STATE.milestones.reduce((acc, m) => {
    acc.contract += revisedContractValue(m);
    acc.invoiced += totalInvoiced(m);
    acc.paid += totalPaid(m);
    acc.outstanding += (totalInvoiced(m) - totalPaid(m));
    return acc;
  }, { contract: 0, invoiced: 0, paid: 0, outstanding: 0 });
}

let FIN_ID_SEQ = Date.now();
function nextFinId() { return ++FIN_ID_SEQ; }

// Session-only object URLs for uploaded PDFs — never synced to Firebase.
// Keyed by invoice id. Cleared/rebuilt every page load; this is the
// prototype's local-preview layer per the "temporary local upload
// interface" requirement — real deployments should point fileName at an
// actual document-storage system (OneDrive/SharePoint/Supabase/S3).
const LOCAL_INVOICE_FILES = {};

/* ============================================================
   ACTIVITY FEED
   ============================================================ */

function logActivity(text) {
  STATE.activity.unshift({ text, time: new Date() });
  if (STATE.activity.length > 25) STATE.activity.pop();
}

/* ============================================================
   RENDERING
   ============================================================ */

let CACHED_SCHEDULE = {};

function renderAll() {
  CACHED_SCHEDULE = getComputed();
  renderHeader();
  renderDashboard();
  renderSummary();
  renderHealth();
  renderLegendFilters();
  renderGantt();
  renderMobileList();
  renderUpcoming();
  renderActivity();
  renderHolidays();
  renderFinancialSummary();
  renderTradeCostTable();
  document.getElementById("lastUpdated").textContent = "Last updated: " + STATE.lastUpdated.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const syncEl = document.getElementById("syncStatus");
  if (syncEl) syncEl.textContent = FIREBASE_READY ? "🔥 Live sync on" : "Local mode";
}

function renderHeader() {
  document.getElementById("projAddress").textContent = PROJECT.address.toUpperCase();
  document.getElementById("projType").textContent = PROJECT.type;
}

function renderDashboard() {
  const schedule = CACHED_SCHEDULE;
  const projected = getProjectedCompletion(schedule);
  const target = parseISO(PROJECT.targetCompletion);
  const today = new Date();
  const progress = getOverallProgress();
  const daysRemaining = projected ? Math.max(0, calculateBusinessDays(today, projected)) : 0;
  const variance = projected ? calculateBusinessDays(target, projected) : 0;

  let statusLabel, statusClass;
  if (variance < 0) { statusLabel = "AHEAD OF SCHEDULE"; statusClass = "green"; }
  else if (variance === 0) { statusLabel = "ON SCHEDULE"; statusClass = "blue"; }
  else { statusLabel = "BEHIND SCHEDULE"; statusClass = "red"; }

  document.getElementById("metricProgress").textContent = progress + "%";
  document.getElementById("metricDaysRemaining").textContent = daysRemaining + " Business Days";
  document.getElementById("metricProjected").textContent = projected ? fmtDate(projected) : "—";
  const statusEl = document.getElementById("metricStatus");
  statusEl.textContent = statusLabel;
  statusEl.className = "metric-value badge-text " + statusClass;

  document.getElementById("varianceNote").textContent =
    variance === 0 ? "Exactly on target" :
    (variance < 0 ? `${Math.abs(variance)} business day${Math.abs(variance) === 1 ? "" : "s"} ahead of target` : `${variance} business day${variance === 1 ? "" : "s"} behind target`);
}

function renderSummary() {
  const schedule = CACHED_SCHEDULE;
  const projected = getProjectedCompletion(schedule);
  const counts = getCounts();
  const el = document.getElementById("summaryGrid");
  el.innerHTML = "";
  const rows = [
    ["Project", PROJECT.address],
    ["Start", fmtDate(parseISO(PROJECT.start))],
    ["Target Completion", fmtDate(parseISO(PROJECT.targetCompletion))],
    ["Projected Completion", projected ? fmtDate(projected) : "—"],
    ["Total Milestones", STATE.milestones.length],
    ["Completed", counts["Complete"] || 0],
    ["In Progress", counts["In Progress"] || 0],
    ["Upcoming", counts["Not Started"] || 0],
    ["Delayed", counts["Delayed"] || 0],
    ["Overall Progress", getOverallProgress() + "%"],
  ];
  rows.forEach(([label, val]) => {
    const d = document.createElement("div");
    d.className = "summary-row";
    d.innerHTML = `<span class="summary-label">${label}</span><span class="summary-val">${val}</span>`;
    el.appendChild(d);
  });
}

function renderHealth() {
  const schedule = CACHED_SCHEDULE;
  const projected = getProjectedCompletion(schedule);
  const target = parseISO(PROJECT.targetCompletion);
  const variance = projected ? calculateBusinessDays(target, projected) : 0;
  const counts = getCounts();
  const h = getScheduleHealth(variance, counts);
  document.getElementById("healthIcon").textContent = h.icon;
  document.getElementById("healthLabel").textContent = h.label;
  document.getElementById("healthLabel").className = "health-label " + h.level;
  document.getElementById("healthExplain").textContent = h.explanation;
}

function renderLegendFilters() {
  const el = document.getElementById("statusFilters");
  el.innerHTML = "";
  ["All", ...STATUS_OPTIONS].forEach(s => {
    const btn = document.createElement("button");
    btn.className = "chip" + (STATE.statusFilter === s ? " active" : "") + (s !== "All" ? " dot-" + STATUS_COLOR[s] : "");
    btn.textContent = s;
    btn.onclick = () => { STATE.statusFilter = s; renderAll(); };
    el.appendChild(btn);
  });
}

function visibleMilestones() {
  if (STATE.statusFilter === "All") return STATE.milestones;
  return STATE.milestones.filter(m => m.status === STATE.statusFilter);
}

function statusOfDate(m, schedule, today) {
  // Determine display bucket for coloring the bar, independent of manual status label
  return m.status;
}

function renderGantt() {
  const schedule = CACHED_SCHEDULE;
  const container = document.getElementById("ganttBody");
  container.innerHTML = "";
  const projectStart = parseISO(PROJECT.start);
  const target = parseISO(PROJECT.targetCompletion);
  const today = new Date();
  const list = visibleMilestones();

  const lastFinish = getProjectedCompletion(schedule) || target;
  const spanEnd = new Date(Math.max(target.getTime(), lastFinish.getTime()));
  const totalDays = Math.round((spanEnd - projectStart) / 86400000) + 15;
  const PX = 8;
  const LABEL_W = 230;

  const monthsRow = document.getElementById("ganttMonths");
  monthsRow.innerHTML = "";
  monthsRow.style.width = (totalDays * PX) + "px";
  let mCursor = new Date(projectStart.getFullYear(), projectStart.getMonth(), 1);
  while (mCursor <= spanEnd) {
    const offset = Math.round((mCursor - projectStart) / 86400000);
    if (offset >= 0) {
      const m = document.createElement("div");
      m.className = "gantt-month";
      m.style.left = (offset * PX) + "px";
      m.textContent = mCursor.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      monthsRow.appendChild(m);
    }
    mCursor.setMonth(mCursor.getMonth() + 1);
  }

  container.style.width = (totalDays * PX) + "px";

  list.forEach(m => {
    const sched = schedule[m.id];
    if (!sched) return;
    const row = document.createElement("div");
    row.className = "gantt-row";

    const label = document.createElement("div");
    label.className = "gantt-label";
    label.innerHTML = `<span class="gname">${m.name}</span><span class="gsub">${fmtDateShort(sched.start)} – ${fmtDateShort(sched.finish)} · ${m.duration}d</span>`;
    label.style.width = LABEL_W + "px";
    label.onclick = () => openModal(m.id);
    row.appendChild(label);

    const lane = document.createElement("div");
    lane.className = "gantt-lane";
    lane.style.width = (totalDays * PX) + "px";

    const off = Math.round((sched.start - projectStart) / 86400000);
    const span = Math.round((sched.finish - sched.start) / 86400000) + 1;
    const bar = document.createElement("div");
    bar.className = "gantt-bar bar-" + STATUS_COLOR[m.status];
    bar.style.left = (off * PX) + "px";
    bar.style.width = Math.max(span * PX - 2, 6) + "px";
    bar.title = `${m.name}: ${fmtDate(sched.start)} → ${fmtDate(sched.finish)} (${m.duration} business days) — ${m.status}`;
    bar.onclick = () => openModal(m.id);

    const fill = document.createElement("div");
    fill.className = "gantt-bar-fill";
    fill.style.width = m.progress + "%";
    bar.appendChild(fill);

    lane.appendChild(bar);
    row.appendChild(lane);
    container.appendChild(row);
  });

  // today marker
  const oldMarkers = document.querySelectorAll(".gantt-todaymark, .gantt-targetmark");
  oldMarkers.forEach(n => n.remove());
  const ganttWrap = document.getElementById("ganttWrap");
  const bodyHeight = 40 + list.length * 40;

  const todayOff = Math.round((today - projectStart) / 86400000);
  if (todayOff >= -2 && todayOff <= totalDays) {
    const line = document.createElement("div");
    line.className = "gantt-todaymark";
    line.style.left = (LABEL_W + todayOff * PX) + "px";
    line.style.height = bodyHeight + "px";
    line.innerHTML = `<span>TODAY</span>`;
    ganttWrap.appendChild(line);
  }
  const targetOff = Math.round((target - projectStart) / 86400000);
  const tLine = document.createElement("div");
  tLine.className = "gantt-targetmark";
  tLine.style.left = (LABEL_W + targetOff * PX) + "px";
  tLine.style.height = bodyHeight + "px";
  tLine.innerHTML = `<span>TARGET</span>`;
  ganttWrap.appendChild(tLine);
}

function renderMobileList() {
  const schedule = CACHED_SCHEDULE;
  const container = document.getElementById("mobileList");
  container.innerHTML = "";
  visibleMilestones().forEach(m => {
    const sched = schedule[m.id];
    if (!sched) return;
    const card = document.createElement("div");
    card.className = "mcard";
    card.onclick = () => openModal(m.id);
    card.innerHTML = `
      <div class="mcard-top">
        <span class="mcard-name">${m.name}</span>
        <span class="status-badge bg-${STATUS_COLOR[m.status]}">${m.status}</span>
      </div>
      <div class="mcard-dates">${fmtDate(sched.start)} → ${fmtDate(sched.finish)} · ${m.duration} business days</div>
      <div class="progress-track"><div class="progress-fill fill-${STATUS_COLOR[m.status]}" style="width:${m.progress}%"></div></div>
      <div class="mcard-meta">${m.trade}</div>
    `;
    container.appendChild(card);
  });
}

function renderUpcoming() {
  const schedule = CACHED_SCHEDULE;
  const today = new Date();
  const upcoming = STATE.milestones
    .filter(m => m.status === "Not Started" || m.status === "In Progress")
    .map(m => ({ m, sched: schedule[m.id] }))
    .filter(x => x.sched)
    .sort((a, b) => a.sched.start - b.sched.start)
    .slice(0, 5);
  const el = document.getElementById("upcomingList");
  el.innerHTML = "";
  if (upcoming.length === 0) {
    el.innerHTML = `<div class="empty-note">No upcoming milestones.</div>`;
    return;
  }
  upcoming.forEach(({ m, sched }) => {
    const row = document.createElement("div");
    row.className = "upcoming-row";
    row.onclick = () => openModal(m.id);
    row.innerHTML = `
      <div class="upcoming-name">${m.name}</div>
      <div class="upcoming-dates">${fmtDateShort(sched.start)} – ${fmtDateShort(sched.finish)}</div>
      <div class="upcoming-dur">${m.duration}d</div>
      <div class="upcoming-trade">${m.trade}</div>
      <span class="status-badge bg-${STATUS_COLOR[m.status]}">${m.status}</span>
    `;
    el.appendChild(row);
  });
}

function renderActivity() {
  const el = document.getElementById("activityList");
  el.innerHTML = "";
  if (STATE.activity.length === 0) {
    el.innerHTML = `<div class="empty-note">No changes yet this session.</div>`;
    return;
  }
  STATE.activity.forEach(a => {
    const row = document.createElement("div");
    row.className = "activity-row";
    row.innerHTML = `<span class="activity-dot"></span><span class="activity-text">${a.text}</span><span class="activity-time">${a.time.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>`;
    el.appendChild(row);
  });
}

function renderHolidays() {
  const el = document.getElementById("holidayList");
  el.innerHTML = "";
  STATE.holidays
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(h => {
      const row = document.createElement("div");
      row.className = "holiday-row";
      row.innerHTML = `<span>${fmtDate(parseISO(h.date))} — ${h.name}</span>`;
      const rm = document.createElement("button");
      rm.className = "icon-btn";
      rm.textContent = "×";
      rm.onclick = () => {
        STATE.holidays = STATE.holidays.filter(x => !(x.date === h.date && x.name === h.name));
        STATE.lastUpdated = new Date();
        logActivity(`Holiday removed: ${h.name} (${h.date})`);
        firebaseSave();
        renderAll();
      };
      row.appendChild(rm);
      el.appendChild(row);
    });
}

function renderFinancialSummary() {
  const totals = financialTotals();
  const el = document.getElementById("finSummaryMetrics");
  if (!el) return;
  el.innerHTML = `
    <div class="metric-card">
      <div class="metric-label">Total Contract Value</div>
      <div class="metric-value">${fmtMoney(totals.contract)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Invoiced</div>
      <div class="metric-value">${fmtMoney(totals.invoiced)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Paid</div>
      <div class="metric-value green">${fmtMoney(totals.paid)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Outstanding</div>
      <div class="metric-value ${totals.outstanding > 0 ? "red" : ""}">${fmtMoney(totals.outstanding)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Pending Invoices</div>
      <div class="metric-value">${pendingInvoiceCount()}</div>
    </div>
  `;
}

function statusPillClass(status) {
  const map = {
    "Paid": "st-paid", "Partially Paid": "st-partial", "Unpaid": "st-unpaid",
    "Overdue": "st-overdue", "Pending": "st-pending", "Approved": "st-approved", "Rejected": "st-rejected",
  };
  return map[status] || "st-pending";
}

function renderTradeCostTable() {
  const body = document.getElementById("tradeCostTableBody");
  if (!body) return;
  body.innerHTML = "";
  STATE.milestones.forEach(m => {
    const invoiced = totalInvoiced(m);
    const paid = totalPaid(m);
    const outstanding = invoiced - paid;
    const status = tradePaymentStatus(m);
    const tr = document.createElement("tr");
    tr.className = "clickable";
    tr.onclick = () => openModal(m.id, "financials");
    tr.innerHTML = `
      <td>${m.name}</td>
      <td>${m.trade || "—"}</td>
      <td class="num">${fmtMoney(revisedContractValue(m))}</td>
      <td class="num">${fmtMoney(invoiced)}</td>
      <td class="num">${fmtMoney(paid)}</td>
      <td class="num">${fmtMoney(outstanding)}</td>
      <td><span class="status-pill ${statusPillClass(status)}">${status}</span></td>
    `;
    body.appendChild(tr);
  });
}

/* ============================================================
   MODAL — VIEW / EDIT MILESTONE
   ============================================================ */

let MODAL_REVEAL_PAYMENT = false;

function openModal(id, tab) {
  STATE.openMilestoneId = id;
  MODAL_REVEAL_PAYMENT = false;
  const m = STATE.milestones.find(x => x.id === id);
  const sched = CACHED_SCHEDULE[id];
  const overlay = document.getElementById("modalOverlay");
  overlay.classList.add("show");

  document.getElementById("modalTitle").textContent = m.name;
  document.getElementById("mStart").value = isoDate(sched.start);
  document.getElementById("mFinishDisplay").textContent = fmtDate(sched.finish);
  document.getElementById("mDuration").value = m.duration;
  document.getElementById("mStatus").value = m.status;
  document.getElementById("mProgress").value = m.progress;
  document.getElementById("mProgressLabel").textContent = m.progress + "%";
  document.getElementById("mTrade").value = m.trade;
  document.getElementById("mNotes").value = m.notes;
  document.getElementById("mDependency").textContent = ((m.dependency || []).length
    ? m.dependency.map(id2 => STATE.milestones.find(x => x.id === id2)?.name).filter(Boolean).join(", ")
    : "None — starts at project start");
  document.getElementById("mError").textContent = "";

  renderFinancialsTab(m);
  switchModalTab(tab === "financials" ? "financials" : "schedule");
}

function switchModalTab(tab) {
  const schedBtn = document.getElementById("tabBtnSchedule");
  const finBtn = document.getElementById("tabBtnFinancials");
  const schedBody = document.getElementById("scheduleTabContent");
  const finBody = document.getElementById("financialsTabContent");
  const schedFoot = document.getElementById("scheduleModalFoot");
  if (tab === "financials") {
    schedBtn.classList.remove("active"); finBtn.classList.add("active");
    schedBody.style.display = "none"; finBody.style.display = "block";
    schedFoot.style.display = "none";
  } else {
    finBtn.classList.remove("active"); schedBtn.classList.add("active");
    finBody.style.display = "none"; schedBody.style.display = "flex";
    schedFoot.style.display = "flex";
  }
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("show");
  STATE.openMilestoneId = null;
}

function saveModal() {
  const id = STATE.openMilestoneId;
  const m = STATE.milestones.find(x => x.id === id);
  const errEl = document.getElementById("mError");

  const newDuration = parseInt(document.getElementById("mDuration").value, 10);
  const newStatus = document.getElementById("mStatus").value;
  const newProgress = parseInt(document.getElementById("mProgress").value, 10);
  const newTrade = document.getElementById("mTrade").value.trim();
  const newNotes = document.getElementById("mNotes").value.trim();
  const newStartRaw = document.getElementById("mStart").value;

  if (!newDuration || newDuration < 1) { errEl.textContent = "Duration must be at least 1 business day."; return; }
  if (newProgress < 0 || newProgress > 100 || isNaN(newProgress)) { errEl.textContent = "Progress must be between 0 and 100."; return; }
  if (!newStartRaw) { errEl.textContent = "Start date is required."; return; }

  const oldStartISO = isoDate(CACHED_SCHEDULE[id].start);
  const manualOverride = newStartRaw !== oldStartISO ? newStartRaw : m.manualStart;

  const changes = [];
  if (m.duration !== newDuration) changes.push(`duration ${m.duration}d → ${newDuration}d`);
  if (m.status !== newStatus) changes.push(`status "${m.status}" → "${newStatus}"`);
  if (m.progress !== newProgress) changes.push(`progress ${m.progress}% → ${newProgress}%`);
  if (m.trade !== newTrade) changes.push(`trade reassigned`);
  if (newStartRaw !== oldStartISO) changes.push(`start moved to ${newStartRaw}`);

  m.duration = newDuration;
  m.status = newStatus;
  m.progress = newProgress;
  m.trade = newTrade;
  m.notes = newNotes;
  m.manualStart = manualOverride;

  STATE.lastUpdated = new Date();
  if (changes.length) {
    logActivity(`${m.name}: ${changes.join(", ")}`);
    const oldProjected = getProjectedCompletion(CACHED_SCHEDULE);
    const newSchedule = computeSchedule(STATE.milestones, STATE.holidays, PROJECT.start);
    const newProjected = getProjectedCompletion(newSchedule);
    if (oldProjected && newProjected && isoDate(oldProjected) !== isoDate(newProjected)) {
      const delta = calculateBusinessDays(oldProjected, newProjected);
      logActivity(`Schedule impact: ${delta > 0 ? "+" : ""}${delta} business days — projected completion moved from ${fmtDate(oldProjected)} to ${fmtDate(newProjected)}`);
    }
  } else {
    logActivity(`${m.name}: notes updated`);
  }

  closeModal();
  firebaseSave();
  renderAll();
}

function clearManualStart() {
  const id = STATE.openMilestoneId;
  const m = STATE.milestones.find(x => x.id === id);
  m.manualStart = null;
  STATE.lastUpdated = new Date();
  logActivity(`${m.name}: start date reset to dependency-calculated date`);
  firebaseSave();
  renderAll();
  openModal(id);
}

/* ============================================================
   FINANCIALS TAB — render + mutations
   ============================================================ */

let PENDING_INVOICE_FILE = null; // {file, objectUrl} staged before "Add Invoice" is clicked

function renderFinancialsTab(m) {
  const el = document.getElementById("financialsTabContent");
  const revised = revisedContractValue(m);
  const invoiced = totalInvoiced(m);
  const paid = totalPaid(m);
  const balance = balanceRemaining(m);
  const status = tradePaymentStatus(m);
  const pd = m.paymentDetails || {};
  const masked = !MODAL_REVEAL_PAYMENT;

  const changeOrdersHtml = (m.changeOrders || []).length
    ? m.changeOrders.map(c => `
      <div class="fin-list-item">
        <div class="fin-list-item-top">
          <strong>${escapeHtml(c.description) || "Change order"}</strong>
          <span class="status-pill ${statusPillClass(c.status)}">${c.status}</span>
        </div>
        <div class="fin-list-item-meta">${c.date ? fmtDate(parseISO(c.date)) : "No date"} · ${fmtMoney(c.amount)}${c.approvedBy ? " · Approved by " + escapeHtml(c.approvedBy) : ""}</div>
        ${c.notes ? `<div class="fin-list-item-meta">${escapeHtml(c.notes)}</div>` : ""}
        <div class="fin-list-actions">
          <select data-action="co-status" data-id="${c.id}">
            <option value="Pending" ${c.status === "Pending" ? "selected" : ""}>Pending</option>
            <option value="Approved" ${c.status === "Approved" ? "selected" : ""}>Approved</option>
            <option value="Rejected" ${c.status === "Rejected" ? "selected" : ""}>Rejected</option>
          </select>
          <button class="danger" data-action="co-delete" data-id="${c.id}">Delete</button>
        </div>
      </div>
    `).join("")
    : `<div class="empty-note">No change orders yet.</div>`;

  const invoicesHtml = (m.invoices || []).length
    ? m.invoices.map(inv => {
        const dispStatus = invoiceDisplayStatus(inv);
        const hasLocalFile = !!LOCAL_INVOICE_FILES[inv.id];
        return `
      <div class="fin-list-item">
        <div class="fin-list-item-top">
          <strong>${escapeHtml(inv.invoiceNumber) || "Invoice"}</strong>
          <span class="status-pill ${statusPillClass(dispStatus)}">${dispStatus}</span>
        </div>
        <div class="fin-list-item-meta">${escapeHtml(inv.vendor) || m.trade} · ${fmtMoney(inv.total)}${inv.dueDate ? " · Due " + fmtDate(parseISO(inv.dueDate)) : ""}</div>
        <div class="fin-list-item-meta">${inv.fileName ? "📎 " + escapeHtml(inv.fileName) + (hasLocalFile ? "" : " (preview not available in this session)") : "No file attached"}</div>
        ${inv.notes ? `<div class="fin-list-item-meta">${escapeHtml(inv.notes)}</div>` : ""}
        <div class="fin-list-actions">
          <select data-action="inv-status" data-id="${inv.id}">
            <option value="Pending" ${inv.paymentStatus === "Pending" ? "selected" : ""}>Pending</option>
            <option value="Paid" ${inv.paymentStatus === "Paid" ? "selected" : ""}>Paid</option>
          </select>
          ${hasLocalFile ? `<button data-action="inv-view" data-id="${inv.id}">View</button><button data-action="inv-download" data-id="${inv.id}">Download</button>` : ""}
          <button class="danger" data-action="inv-delete" data-id="${inv.id}">Delete</button>
        </div>
      </div>
    `;
      }).join("")
    : `<div class="empty-note">No invoices yet.</div>`;

  el.innerHTML = `
    <div class="fin-section">
      <div class="fin-section-title">Contract Summary</div>
      <div class="field">
        <label>Contract / Quoted Price</label>
        <div class="field-row" style="grid-template-columns: 1fr auto;">
          <input type="number" id="finContractPrice" min="0" step="1" value="${m.contractPrice || 0}">
          <button class="btn" data-action="save-contract-price">Save</button>
        </div>
      </div>
      <div class="fin-grid">
        <div class="fin-stat"><div class="fin-stat-label">Approved Change Orders</div><div class="fin-stat-val">${fmtMoney(approvedChangeOrderTotal(m))}</div></div>
        <div class="fin-stat"><div class="fin-stat-label">Revised Contract Value</div><div class="fin-stat-val">${fmtMoney(revised)}</div></div>
        <div class="fin-stat"><div class="fin-stat-label">Total Invoiced</div><div class="fin-stat-val">${fmtMoney(invoiced)}</div></div>
        <div class="fin-stat"><div class="fin-stat-label">Total Paid</div><div class="fin-stat-val">${fmtMoney(paid)}</div></div>
      </div>
      <div class="fin-grid" style="grid-template-columns: 1fr 1fr;">
        <div class="fin-stat"><div class="fin-stat-label">Balance Remaining</div><div class="fin-stat-val">${fmtMoney(balance)}</div></div>
        <div class="fin-stat"><div class="fin-stat-label">Payment Status</div><div class="fin-stat-val"><span class="status-pill ${statusPillClass(status)}">${status}</span></div></div>
      </div>
    </div>

    <div class="fin-section">
      <div class="fin-section-title">Change Orders</div>
      ${changeOrdersHtml}
      <div class="fin-add-form">
        <div class="field"><label>Description</label><input type="text" id="coDescription" placeholder="e.g. Add basement egress window"></div>
        <div class="field-row">
          <div class="field"><label>Date</label><input type="date" id="coDate"></div>
          <div class="field"><label>Amount</label><input type="number" id="coAmount" min="0" step="1"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Approved By</label><input type="text" id="coApprovedBy"></div>
          <div class="field"><label>Status</label>
            <select id="coStatus"><option>Pending</option><option>Approved</option><option>Rejected</option></select>
          </div>
        </div>
        <div class="field"><label>Notes</label><textarea id="coNotes"></textarea></div>
        <button class="btn primary" data-action="co-add">Add Change Order</button>
      </div>
    </div>

    <div class="fin-section">
      <div class="fin-section-title">Invoices</div>
      ${invoicesHtml}
      <div class="fin-add-form">
        <div class="fin-dropzone" id="invDropzone">
          Drag &amp; drop a PDF here, or <span style="color:var(--accent); font-weight:600;">browse files</span>
          <input type="file" id="invFileInput" accept="application/pdf" style="display:none;">
        </div>
        <div class="fin-note" id="invFileStatus" style="display:none;"></div>
        <div class="field-row">
          <div class="field"><label>Invoice Number</label><input type="text" id="invNumber"></div>
          <div class="field"><label>Vendor</label><input type="text" id="invVendor" value="${escapeHtml(m.trade)}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Invoice Date</label><input type="date" id="invDate"></div>
          <div class="field"><label>Due Date</label><input type="date" id="invDue"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Subtotal</label><input type="number" id="invSubtotal" min="0" step="1"></div>
          <div class="field"><label>HST</label><input type="number" id="invHst" min="0" step="1"></div>
        </div>
        <div class="field"><label>Total (subtotal + HST)</label><div class="dep-static" id="invTotalDisplay">$0</div></div>
        <div class="field-row">
          <div class="field"><label>Payment Status</label><select id="invStatus"><option>Pending</option><option>Paid</option></select></div>
          <div class="field"><label>Payment Date</label><input type="date" id="invPaymentDate"></div>
        </div>
        <div class="field"><label>Notes</label><textarea id="invNotes"></textarea></div>
        <button class="btn primary" data-action="inv-add">Add Invoice</button>
      </div>
    </div>

    <div class="fin-section">
      <div class="fin-section-title">
        Payment Details
        <button class="fin-reveal-btn" data-action="toggle-reveal">${masked ? "Reveal" : "Hide"} sensitive fields</button>
      </div>
      <div class="field-row">
        <div class="field"><label>Vendor Name</label><input type="text" id="pdVendorName" value="${escapeHtml(pd.vendorName)}"></div>
        <div class="field"><label>PO Number</label><input type="text" id="pdPoNumber" value="${escapeHtml(pd.poNumber)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Payment Terms</label><input type="text" id="pdPaymentTerms" value="${escapeHtml(pd.paymentTerms)}" placeholder="e.g. Net 30"></div>
        <div class="field"><label>Payment Method</label><input type="text" id="pdPaymentMethod" value="${escapeHtml(pd.paymentMethod)}" placeholder="e.g. E-transfer"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Bank Name</label><input type="${masked ? "password" : "text"}" id="pdBankName" value="${escapeHtml(pd.bankName)}"></div>
        <div class="field"><label>Account Name</label><input type="${masked ? "password" : "text"}" id="pdAccountName" value="${escapeHtml(pd.accountName)}"></div>
      </div>
      <div class="field">
        <label>Account Ending</label>
        <div class="fin-masked">•••• ${escapeHtml(pd.accountLast4) || "----"}</div>
        ${masked ? "" : `<input type="text" id="pdAccountLast4" value="${escapeHtml(pd.accountLast4)}" maxlength="4" placeholder="Last 4 digits" style="margin-top:6px;">`}
      </div>
      <div class="field"><label>Payment Reference</label><input type="text" id="pdPaymentReference" value="${escapeHtml(pd.paymentReference)}"></div>
      <div class="field"><label>Notes</label><textarea id="pdNotes">${escapeHtml(pd.notes)}</textarea></div>
      <button class="btn primary" data-action="save-payment-details">Save Payment Details</button>
      <div class="fin-note">Sensitive fields are masked by default. This is a prototype — for real use, restrict who can reveal or edit banking details with proper login-based permissions.</div>
    </div>
  `;

  wireFinancialsTabInputs(m);
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function wireFinancialsTabInputs(m) {
  const subtotalEl = document.getElementById("invSubtotal");
  const hstEl = document.getElementById("invHst");
  const totalDisplay = document.getElementById("invTotalDisplay");
  const updateTotal = () => {
    const t = (Number(subtotalEl.value) || 0) + (Number(hstEl.value) || 0);
    totalDisplay.textContent = fmtMoney(t);
  };
  subtotalEl.addEventListener("input", updateTotal);
  hstEl.addEventListener("input", updateTotal);

  const dropzone = document.getElementById("invDropzone");
  const fileInput = document.getElementById("invFileInput");
  const fileStatus = document.getElementById("invFileStatus");
  const showStaged = () => {
    if (PENDING_INVOICE_FILE) {
      fileStatus.style.display = "block";
      fileStatus.textContent = `Staged: ${PENDING_INVOICE_FILE.file.name} — will attach when you click "Add Invoice."`;
    } else {
      fileStatus.style.display = "none";
    }
  };
  const stageFile = (file) => {
    if (!file) return;
    if (file.type !== "application/pdf") { alert("Please choose a PDF file."); return; }
    if (PENDING_INVOICE_FILE) URL.revokeObjectURL(PENDING_INVOICE_FILE.objectUrl);
    PENDING_INVOICE_FILE = { file, objectUrl: URL.createObjectURL(file) };
    showStaged();
  };
  dropzone.onclick = () => fileInput.click();
  fileInput.onchange = (e) => stageFile(e.target.files[0]);
  dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); };
  dropzone.ondragleave = () => dropzone.classList.remove("drag-over");
  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    stageFile(e.dataTransfer.files[0]);
  };
  showStaged();

  // Delegated click/change handler for all financials actions (rebound on every render)
  const el = document.getElementById("financialsTabContent");
  el.onclick = (e) => handleFinancialsClick(e, m.id);
  el.onchange = (e) => handleFinancialsChange(e, m.id);
}

function handleFinancialsClick(e, mId) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const coId = btn.dataset.id ? Number(btn.dataset.id) : null;

  if (action === "save-contract-price") return saveContractPrice(mId);
  if (action === "co-add") return addChangeOrder(mId);
  if (action === "co-delete") return deleteChangeOrder(mId, coId);
  if (action === "inv-add") return addInvoice(mId);
  if (action === "inv-delete") return deleteInvoice(mId, coId);
  if (action === "inv-view") return viewInvoiceFile(mId, coId);
  if (action === "inv-download") return downloadInvoiceFile(mId, coId);
  if (action === "save-payment-details") return savePaymentDetails(mId);
  if (action === "toggle-reveal") {
    MODAL_REVEAL_PAYMENT = !MODAL_REVEAL_PAYMENT;
    const m = STATE.milestones.find(x => x.id === mId);
    renderFinancialsTab(m);
  }
}

function handleFinancialsChange(e, mId) {
  const el = e.target;
  if (el.dataset.action === "co-status") {
    const m = STATE.milestones.find(x => x.id === mId);
    const c = (m.changeOrders || []).find(x => x.id === Number(el.dataset.id));
    if (!c) return;
    const old = c.status;
    c.status = el.value;
    STATE.lastUpdated = new Date();
    logActivity(`${m.name}: change order "${c.description || c.id}" ${old} → ${c.status}`);
    firebaseSave();
    renderAll();
    renderFinancialsTab(m);
  }
  if (el.dataset.action === "inv-status") {
    const m = STATE.milestones.find(x => x.id === mId);
    const inv = (m.invoices || []).find(x => x.id === Number(el.dataset.id));
    if (!inv) return;
    const old = inv.paymentStatus;
    inv.paymentStatus = el.value;
    if (el.value === "Paid" && !inv.paymentDate) inv.paymentDate = isoDate(new Date());
    STATE.lastUpdated = new Date();
    logActivity(`${m.name}: invoice ${inv.invoiceNumber || inv.id} marked ${inv.paymentStatus} (was ${old})`);
    firebaseSave();
    renderAll();
    renderFinancialsTab(m);
  }
}

function saveContractPrice(mId) {
  const m = STATE.milestones.find(x => x.id === mId);
  const newPrice = Number(document.getElementById("finContractPrice").value) || 0;
  if (newPrice === m.contractPrice) return;
  logActivity(`${m.name}: contract price updated from ${fmtMoney(m.contractPrice)} to ${fmtMoney(newPrice)}`);
  m.contractPrice = newPrice;
  STATE.lastUpdated = new Date();
  firebaseSave();
  renderAll();
  renderFinancialsTab(m);
}

function addChangeOrder(mId) {
  const m = STATE.milestones.find(x => x.id === mId);
  const description = document.getElementById("coDescription").value.trim();
  const date = document.getElementById("coDate").value || null;
  const amount = Number(document.getElementById("coAmount").value) || 0;
  const approvedBy = document.getElementById("coApprovedBy").value.trim();
  const status = document.getElementById("coStatus").value;
  const notes = document.getElementById("coNotes").value.trim();
  if (!description) { alert("Enter a description for the change order."); return; }
  m.changeOrders = m.changeOrders || [];
  m.changeOrders.push({ id: nextFinId(), description, date, amount, approvedBy, status, notes });
  STATE.lastUpdated = new Date();
  logActivity(`${m.name}: change order added — ${description} (${fmtMoney(amount)}, ${status})`);
  firebaseSave();
  renderAll();
  renderFinancialsTab(m);
}

function deleteChangeOrder(mId, coId) {
  const m = STATE.milestones.find(x => x.id === mId);
  const c = (m.changeOrders || []).find(x => x.id === coId);
  if (!c) return;
  if (!confirm(`Delete change order "${c.description}"?`)) return;
  m.changeOrders = m.changeOrders.filter(x => x.id !== coId);
  STATE.lastUpdated = new Date();
  logActivity(`${m.name}: change order deleted — ${c.description}`);
  firebaseSave();
  renderAll();
  renderFinancialsTab(m);
}

function addInvoice(mId) {
  const m = STATE.milestones.find(x => x.id === mId);
  const invoiceNumber = document.getElementById("invNumber").value.trim();
  const vendor = document.getElementById("invVendor").value.trim();
  const invoiceDate = document.getElementById("invDate").value || null;
  const dueDate = document.getElementById("invDue").value || null;
  const subtotal = Number(document.getElementById("invSubtotal").value) || 0;
  const hst = Number(document.getElementById("invHst").value) || 0;
  const total = subtotal + hst;
  const paymentStatus = document.getElementById("invStatus").value;
  const paymentDate = document.getElementById("invPaymentDate").value || null;
  const notes = document.getElementById("invNotes").value.trim();
  if (!invoiceNumber) { alert("Enter an invoice number."); return; }
  if (total <= 0) { alert("Invoice total must be greater than $0."); return; }

  const id = nextFinId();
  const fileName = PENDING_INVOICE_FILE ? PENDING_INVOICE_FILE.file.name : "";
  if (PENDING_INVOICE_FILE) {
    LOCAL_INVOICE_FILES[id] = PENDING_INVOICE_FILE.objectUrl;
    PENDING_INVOICE_FILE = null;
  }

  m.invoices = m.invoices || [];
  m.invoices.push({ id, invoiceNumber, vendor, invoiceDate, dueDate, subtotal, hst, total, paymentStatus, paymentDate, fileName, notes });
  STATE.lastUpdated = new Date();
  logActivity(`${m.name}: invoice ${invoiceNumber} uploaded — ${fmtMoney(total)}${fileName ? " (" + fileName + ")" : ""}`);
  firebaseSave();
  renderAll();
  renderFinancialsTab(m);
  if (fileName) alert("Invoice uploaded successfully.");
}

function deleteInvoice(mId, invId) {
  const m = STATE.milestones.find(x => x.id === mId);
  const inv = (m.invoices || []).find(x => x.id === invId);
  if (!inv) return;
  if (!confirm(`Delete invoice "${inv.invoiceNumber}"?`)) return;
  if (LOCAL_INVOICE_FILES[invId]) { URL.revokeObjectURL(LOCAL_INVOICE_FILES[invId]); delete LOCAL_INVOICE_FILES[invId]; }
  m.invoices = m.invoices.filter(x => x.id !== invId);
  STATE.lastUpdated = new Date();
  logActivity(`${m.name}: invoice deleted — ${inv.invoiceNumber}`);
  firebaseSave();
  renderAll();
  renderFinancialsTab(m);
}

function viewInvoiceFile(mId, invId) {
  const url = LOCAL_INVOICE_FILES[invId];
  if (!url) { alert("This PDF is only available in the browser session it was uploaded in. Real file storage (OneDrive/SharePoint/Supabase) is needed to make invoices viewable everywhere."); return; }
  window.open(url, "_blank");
}

function downloadInvoiceFile(mId, invId) {
  const m = STATE.milestones.find(x => x.id === mId);
  const inv = (m.invoices || []).find(x => x.id === invId);
  const url = LOCAL_INVOICE_FILES[invId];
  if (!url || !inv) { alert("This PDF is only available in the browser session it was uploaded in."); return; }
  const a = document.createElement("a");
  a.href = url;
  a.download = inv.fileName || "invoice.pdf";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function savePaymentDetails(mId) {
  const m = STATE.milestones.find(x => x.id === mId);
  const pd = {
    vendorName: document.getElementById("pdVendorName").value.trim(),
    poNumber: document.getElementById("pdPoNumber").value.trim(),
    paymentTerms: document.getElementById("pdPaymentTerms").value.trim(),
    paymentMethod: document.getElementById("pdPaymentMethod").value.trim(),
    bankName: document.getElementById("pdBankName").value.trim(),
    accountName: document.getElementById("pdAccountName").value.trim(),
    accountLast4: (document.getElementById("pdAccountLast4")?.value || m.paymentDetails.accountLast4 || "").trim(),
    paymentReference: document.getElementById("pdPaymentReference").value.trim(),
    notes: document.getElementById("pdNotes").value.trim(),
  };
  m.paymentDetails = pd;
  STATE.lastUpdated = new Date();
  logActivity(`${m.name}: payment details updated`);
  firebaseSave();
  renderAll();
  renderFinancialsTab(m);
}

/* ============================================================
   IMPORT / EXPORT
   ============================================================ */

function exportCSV() {
  const schedule = CACHED_SCHEDULE;
  const header = ["ID", "Milestone", "Start Date", "Duration (Business Days)", "Finish Date", "Status", "Progress %", "Trade", "Dependency", "Notes"];
  const rows = [header];
  STATE.milestones.forEach(m => {
    const sched = schedule[m.id];
    rows.push([
      m.id,
      m.name,
      sched ? isoDate(sched.start) : "",
      m.duration,
      sched ? isoDate(sched.finish) : "",
      m.status,
      m.progress,
      m.trade,
      m.dependency.join(";"),
      m.notes,
    ]);
  });
  const csv = rows.map(r => r.map(csvEscape).join(",")).join("\r\n");
  downloadFile(csv, "43-munn-schedule.csv", "text/csv");
  logActivity("Schedule exported to CSV.");
}

function exportTradeFinancialsCSV() {
  const header = ["Trade ID", "Trade", "Vendor", "Contract Price", "Approved Change Orders", "Revised Contract",
    "Total Invoiced", "Total Paid", "Outstanding", "Payment Status", "PO Number", "Payment Terms", "Notes"];
  const rows = [header];
  STATE.milestones.forEach(m => {
    rows.push([
      m.id, m.name, m.trade,
      m.contractPrice || 0,
      approvedChangeOrderTotal(m),
      revisedContractValue(m),
      totalInvoiced(m),
      totalPaid(m),
      totalInvoiced(m) - totalPaid(m),
      tradePaymentStatus(m),
      (m.paymentDetails && m.paymentDetails.poNumber) || "",
      (m.paymentDetails && m.paymentDetails.paymentTerms) || "",
      m.notes,
    ]);
  });
  const csv = rows.map(r => r.map(csvEscape).join(",")).join("\r\n");
  downloadFile(csv, "43-munn-trade-financials.csv", "text/csv");
  logActivity("Trade financials exported to CSV.");
}

function csvEscape(val) {
  const s = String(val ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function importCSVFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const rows = parseCSV(reader.result);
      if (rows.length < 2) throw new Error("File appears to be empty.");
      const body = rows.slice(1).filter(r => r.length >= 10 && r[0] !== "");
      const seen = new Set();
      const newMilestones = body.map(r => {
        const id = parseInt(r[0], 10);
        const duration = parseInt(r[3], 10);
        const progress = parseInt(r[6], 10);
        const status = r[5].trim();
        if (isNaN(id)) throw new Error(`Invalid milestone ID: "${r[0]}"`);
        if (seen.has(id)) throw new Error(`Duplicate milestone ID: ${id}`);
        seen.add(id);
        if (isNaN(duration) || duration < 1) throw new Error(`Invalid duration for milestone #${id}`);
        if (isNaN(progress) || progress < 0 || progress > 100) throw new Error(`Invalid progress for milestone #${id}`);
        if (!STATUS_OPTIONS.includes(status)) throw new Error(`Invalid status "${status}" for milestone #${id}. Must be one of: ${STATUS_OPTIONS.join(", ")}`);
        const dependency = r[8].trim() ? r[8].split(";").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) : [];
        // Preserve any existing financial data for this milestone ID — the
        // schedule CSV doesn't carry contract/invoice fields, so re-importing
        // a schedule must not wipe out financials already entered in the app.
        const existing = STATE.milestones.find(x => x.id === id);
        return {
          id, name: r[1].trim(), duration, dependency, manualStart: null,
          status, progress, trade: r[7].trim(), notes: r[9] ? r[9].trim() : "",
          contractPrice: existing ? existing.contractPrice : 0,
          changeOrders: existing ? existing.changeOrders : [],
          invoices: existing ? existing.invoices : [],
          paymentDetails: existing ? existing.paymentDetails : sanitizePaymentDetails({ vendorName: r[7].trim() }),
        };
      });
      // validate dependencies reference known ids
      const ids = new Set(newMilestones.map(m => m.id));
      newMilestones.forEach(m => m.dependency.forEach(d => {
        if (!ids.has(d)) throw new Error(`Milestone #${m.id} (${m.name}) references unknown dependency #${d}`);
      }));

      STATE.milestones = newMilestones;
      STATE.lastUpdated = new Date();
      STATE.statusFilter = "All";
      logActivity(`Schedule imported from CSV — ${newMilestones.length} milestones loaded.`);
      firebaseSave();
      renderAll();
      alert(`Import successful: ${newMilestones.length} milestones loaded.`);
    } catch (err) {
      alert("Import failed: " + err.message);
    }
  };
  reader.readAsText(file);
}

/* ============================================================
   RESET
   ============================================================ */

function resetSchedule() {
  if (!confirm("Reset the entire schedule AND all trade financial data (contracts, change orders, invoices, payment details) to the original 43 Munn baseline? This will discard everything entered this session and cannot be undone.")) return;
  STATE.milestones = deepClone(BASELINE_MILESTONES);
  STATE.holidays = deepClone(DEFAULT_HOLIDAYS);
  STATE.statusFilter = "All";
  STATE.lastUpdated = new Date();
  logActivity("Schedule reset to original baseline.");
  firebaseSave();
  renderAll();
}

/* ============================================================
   HOLIDAYS UI
   ============================================================ */

function addHoliday() {
  const dateInput = document.getElementById("newHolidayDate");
  const nameInput = document.getElementById("newHolidayName");
  const date = dateInput.value;
  const name = nameInput.value.trim() || "Statutory Holiday";
  if (!date) { alert("Choose a date first."); return; }
  STATE.holidays.push({ date, name });
  dateInput.value = "";
  nameInput.value = "";
  STATE.lastUpdated = new Date();
  logActivity(`Holiday added: ${name} (${date})`);
  firebaseSave();
  renderAll();
}

/* ============================================================
   INIT
   ============================================================ */

function init() {
  document.getElementById("btnExport").onclick = exportCSV;
  document.getElementById("btnExportFinancials").onclick = exportTradeFinancialsCSV;
  document.getElementById("btnImport").onclick = () => document.getElementById("csvFileInput").click();
  document.getElementById("csvFileInput").onchange = (e) => {
    if (e.target.files[0]) importCSVFile(e.target.files[0]);
    e.target.value = "";
  };
  document.getElementById("btnReset").onclick = resetSchedule;
  document.getElementById("btnAddHoliday").onclick = addHoliday;
  document.getElementById("btnCloseModal").onclick = closeModal;
  document.getElementById("btnCancelModal").onclick = closeModal;
  document.getElementById("btnSaveModal").onclick = saveModal;
  document.getElementById("btnClearManualStart").onclick = clearManualStart;
  document.getElementById("mProgress").oninput = (e) => {
    document.getElementById("mProgressLabel").textContent = e.target.value + "%";
  };
  document.getElementById("modalOverlay").onclick = (e) => {
    if (e.target.id === "modalOverlay") closeModal();
  };
  document.getElementById("btnToggleHolidays").onclick = () => {
    document.getElementById("holidayPanel").classList.toggle("show");
  };
  document.getElementById("tabBtnSchedule").onclick = () => switchModalTab("schedule");
  document.getElementById("tabBtnFinancials").onclick = () => switchModalTab("financials");

  firebaseListen();
}

document.addEventListener("DOMContentLoaded", init);
